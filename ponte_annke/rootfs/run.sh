#!/usr/bin/with-contenv bashio
# shellcheck shell=bash
set -e

OPTS=/data/options.json
CHANNELS=$(jq -r '.channels' "$OPTS")
AUDIO=$(jq -r 'if .audio == false then "false" else "true" end' "$OPTS")
if [ "$AUDIO" != "true" ]; then export PONTE_AUDIO=0; fi
IP=$(hostname -I 2>/dev/null | tr ' ' '\n' | grep -E '^192\.168\.|^10\.|^172\.(1[6-9]|2[0-9]|3[01])\.' | head -n1 || true)

# config.json per il ponte (stessa forma usata sul PC)
jq '{host: .host, port: .port, user: .user, password: .password}' "$OPTS" > /app/config.json

NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
bashio::log.info "Node.js $(node --version), go2rtc $(go2rtc -version 2>/dev/null | head -n1)"
if [ "$NODE_MAJOR" -lt 22 ]; then
  bashio::log.error "Serve Node.js 22 o piu recente (trovato $NODE_MAJOR)"
  exit 1
fi

# configurazione go2rtc: porte diverse da quelle del go2rtc interno di Home Assistant
{
  echo "streams:"
  for i in $(seq 1 "$CHANNELS"); do
    if [ "$AUDIO" = "true" ]; then
      echo "  cam${i}:"
      echo "    - exec:node /app/ponte-annke.js ${i} sub"
      echo "    - exec:node /app/ponte-annke.js ${i} sub --audio"
      echo "  cam${i}_hd:"
      echo "    - exec:node /app/ponte-annke.js ${i} main"
      echo "    - exec:node /app/ponte-annke.js ${i} main --audio"
    else
      echo "  cam${i}: exec:node /app/ponte-annke.js ${i} sub"
      echo "  cam${i}_hd: exec:node /app/ponte-annke.js ${i} main"
    fi
  done
  echo "api:"
  echo "  listen: \":1994\""
  echo "  static_dir: /app/www"
  echo "rtsp:"
  echo "  listen: \":8654\""
  echo "webrtc:"
  echo "  listen: \":8556\""
  if [ -n "$IP" ]; then
    echo "  candidates:"
    echo "    - ${IP}:8556"
  fi
  echo "log:"
  echo "  exec: debug"
} > /app/go2rtc.yaml

bashio::log.info "NVR $(jq -r .host "$OPTS"), ${CHANNELS} telecamere -> rtsp://127.0.0.1:8654/cam1 ... cam${CHANNELS} (e camN_hd)"
cd /app
exec go2rtc -config /app/go2rtc.yaml
