#!/usr/bin/env node
'use strict';
/*
 * Ponte Annke Sight -> go2rtc
 * ---------------------------------------------------------------
 * Si collega all'NVR wireless Annke (base JuanVision, WebSocket porta 10000)
 * usando la stessa libreria della pagina web dell'NVR (/dist/import.js),
 * apre un canale e scrive il video H.265 "grezzo" (Annex-B) su stdout.
 * go2rtc lo legge con una sorgente "exec:" e lo ripubblica in RTSP/WebRTC.
 *
 * Uso:
 *   node ponte-annke.js <canale 1..8> [sub|main]      -> video su stdout (per go2rtc)
 *   node ponte-annke.js <canale> [sub|main] --test    -> prova di 10 s, nessun video in uscita
 *
 * Tutti i messaggi vanno su stderr: stdout trasporta solo il video.
 * Non modifica nulla sull'NVR: legge soltanto il flusso, come la pagina web.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const DIR = __dirname;
const log = (...a) => process.stderr.write('[ponte] ' + a.join(' ') + '\n');

// ---------- argomenti ----------
const args = process.argv.slice(2);
const TEST = args.includes('--test');
const pos = args.filter((a) => !a.startsWith('--'));
const CH = Math.max(1, parseInt(pos[0] || '1', 10) || 1);       // 1 = primo canale
const STREAM_NAME = (pos[1] || 'sub').toLowerCase();
const STREAM_ID = STREAM_NAME === 'main' ? 0 : 1;               // 0 principale, 1 secondario

// ---------- configurazione ----------
const cfg = { host: '192.168.1.2', port: 10000, user: 'admin', password: '' };
try {
  const raw = fs.readFileSync(path.join(DIR, 'config.json'), 'utf8').replace(/^﻿/, '');
  Object.assign(cfg, JSON.parse(raw));
} catch (e) {
  log('ATTENZIONE: config.json mancante o non valido (' + e.message + '), uso i valori predefiniti');
}

// ---------- libreria dell'NVR ----------
async function loadLib() {
  const local = path.join(DIR, 'import.js');
  let code = null;
  try {
    const r = await fetch(`http://${cfg.host}/dist/import.js`, { signal: AbortSignal.timeout(5000) });
    if (r.ok) {
      code = await r.text();
      try { fs.writeFileSync(local, code); } catch (_) { /* copia locale facoltativa */ }
    } else {
      log('download import.js: HTTP', r.status);
    }
  } catch (e) {
    log('download import.js non riuscito (' + e.message + '), provo la copia locale');
  }
  if (!code) {
    if (!fs.existsSync(local)) throw new Error("impossibile ottenere import.js dall'NVR " + cfg.host);
    code = fs.readFileSync(local, 'utf8');
  }

  if (typeof WebSocket === 'undefined') {
    throw new Error('serve Node.js 22 o piu recente (WebSocket integrato)');
  }

  // Ambiente minimo da browser richiesto dalla libreria
  const noop = () => {};
  const fakeEl = () => ({
    style: {}, appendChild: noop, removeChild: noop, setAttribute: noop, addEventListener: noop,
    contentWindow: { document: { open: noop, write: noop, close: noop, F: Object } },
  });
  globalThis.window = globalThis;
  globalThis.self = globalThis;
  globalThis.document = {
    createElement: fakeEl, documentElement: fakeEl(), body: fakeEl(), head: fakeEl(),
    getElementsByTagName: () => [fakeEl()], getElementById: () => null,
    querySelector: () => null, addEventListener: noop,
  };
  globalThis.XMLHttpRequest = class { open() {} send() {} setRequestHeader() {} };

  vm.runInThisContext(code, { filename: 'import.js' });
  const A = globalThis.apip2p;
  if (!A || typeof A.connectbyip !== 'function') throw new Error('apip2p non trovato in import.js');
  return A;
}

// ---------- programma ----------
const MAX_FAILS = 3;          // tentativi consecutivi senza video prima di arrendersi
const STALL_MS = 5000;        // fermo subito dopo il primo fotogramma chiave
const NO_VIDEO_MS = 15000;    // nessun video durante la visione
const GOOD_FRAMES = 10;       // da qui in poi la sessione e considerata sana

(async () => {
  let A;
  try {
    A = await loadLib();
  } catch (e) {
    log('ERRORE:', e.message);
    process.exit(1);
  }

  let cur = null;       // sessione attiva
  let stopping = false;
  let fails = 0;        // sessioni fallite di fila

  const closeSession = (s) => {
    if (!s || s.closed) return;
    s.closed = true;
    try { A.close_stream(s.c, CH - 1, STREAM_ID); } catch (_) {}
    try { A.close_socket(s.c); } catch (_) {}
  };

  const finish = (code) => {
    stopping = true;
    closeSession(cur);
    setTimeout(() => process.exit(code), 200);
  };
  process.on('SIGINT', () => finish(0));
  process.on('SIGTERM', () => finish(0));
  process.stdout.on('error', () => finish(0)); // go2rtc ha chiuso il flusso

  // Chiude la sessione; se retry=true e restano tentativi, ne apre una nuova
  // senza uscire (go2rtc continua a ricevere il video da questo stesso processo).
  const end = (s, reason, code, retry) => {
    if (!s || s.closed || stopping) return;
    const secs = ((Date.now() - s.t0) / 1000).toFixed(1);
    closeSession(s);
    if (s.frames >= GOOD_FRAMES) fails = 0; else fails++;
    const detail = `${reason} (sessione di ${secs} s, ${s.frames} fotogrammi)`;
    if (retry && !TEST && fails < MAX_FAILS) {
      log(`${detail} - nuovo tentativo ${fails + 1}/${MAX_FAILS} tra 1,5 s`);
      setTimeout(() => { if (!stopping) startSession(); }, 1500);
    } else {
      log(detail + ' - chiudo');
      finish(code);
    }
  };

  A.onconnect = (conn, code) => {
    const s = cur;
    if (!s || conn !== s.c || s.closed) return;
    if (code !== 0) return end(s, 'connessione non riuscita, codice ' + code, 2, true);
    s.connected = true;
    log(`connesso a ${cfg.host}:${cfg.port}`);
    A.login(s.c, String(cfg.user), String(cfg.password));
  };
  A.onloginresult = (conn, r) => {
    const s = cur;
    if (!s || conn !== s.c || s.closed) return;
    if (r !== 0) {
      log(`accesso rifiutato (codice ${r}): controlla utente e password in config.json`);
      return finish(3); // inutile riprovare
    }
    log(`accesso OK, apro canale ${CH} (${STREAM_NAME === 'main' ? 'principale' : 'secondario'})`);
    A.open_stream(s.c, CH - 1, STREAM_ID);
  };
  A.onopenstream = (conn, ch, st, r) => {
    const s = cur;
    if (!s || conn !== s.c || s.closed) return;
    if (r !== 0) end(s, 'apertura canale non riuscita, codice ' + r, 4, true);
  };
  A.ondisconnect = (conn, code) => {
    const s = cur;
    if (!s || conn !== s.c || s.closed) return;
    end(s, "disconnesso dall'NVR, codice " + code, 5, true);
  };
  A.onclosestream = () => {};
  A.onptzresult = () => {};

  A.onrecvframeex = (conn, frametype, data, len, ch, w, h, enc) => {
    const s = cur;
    if (!s || conn !== s.c || s.closed) return;
    if (frametype !== 1 && frametype !== 2) return;      // 1 = chiave, 2 = intermedio; 0 = audio
    if (!s.gotKey) {
      if (frametype !== 1) return;                       // si parte sempre da un fotogramma chiave
      s.gotKey = true;
      log(`primo fotogramma chiave: ${enc} ${w}x${h} (dopo ${((Date.now() - s.t0) / 1000).toFixed(1)} s)`);
    }
    s.frames++;
    s.bytes += len;
    s.lastFrame = Date.now();
    if (s.frames === GOOD_FRAMES) fails = 0;
    if (!TEST) process.stdout.write(Buffer.from(data.subarray(0, len)));
  };

  function startSession() {
    const s = { c: A.create(0), connected: false, gotKey: false, frames: 0, bytes: 0, closed: false, t0: Date.now(), lastFrame: Date.now() };
    s.c.preview = {};
    cur = s;
    log(`collegamento a ${cfg.host}:${cfg.port}...`);
    A.connectbyip(s.c, cfg.host, String(cfg.port));
  }

  // controlli di sicurezza
  setInterval(() => {
    const s = cur;
    if (!s || s.closed || stopping) return;
    const now = Date.now();
    if (!s.connected && now - s.t0 > 10000) return end(s, "nessuna risposta dall'NVR in 10 s", 6, true);
    if (s.connected && !s.gotKey && now - s.t0 > 15000) return end(s, 'nessun fotogramma chiave entro 15 s', 10, true);
    if (s.gotKey && s.frames < GOOD_FRAMES && now - s.lastFrame > STALL_MS) {
      return end(s, `flusso fermo da ${STALL_MS / 1000} s subito dopo il primo fotogramma`, 9, true);
    }
    if (s.gotKey && now - s.lastFrame > NO_VIDEO_MS) return end(s, `nessun video da ${NO_VIDEO_MS / 1000} s`, 7, true);
  }, 1000);

  if (TEST) {
    const t0 = Date.now();
    setTimeout(() => {
      const s = cur;
      const secs = (Date.now() - t0) / 1000;
      if (s && s.frames > 0) {
        log(`PROVA RIUSCITA: ${s.frames} fotogrammi, ${(s.bytes / 1024).toFixed(0)} KB in ${secs.toFixed(1)} s`);
        finish(0);
      } else {
        log('PROVA FALLITA: nessun fotogramma video ricevuto');
        finish(8);
      }
    }, 10000);
  }

  startSession();
})();
