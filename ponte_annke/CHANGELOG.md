# Changelog

## 1.0.4
- Corretto l'avvio della 1.0.3 (errore se non si trova l'indirizzo IP locale).

## 1.0.3
- Audio: l'audio G.711 A-law dell'NVR viene inoltrato a go2rtc (sorgente WAV separata, silenzio se manca) e si sente nel player tramite WebRTC (porta 8556). Opzione `audio` per disattivarlo.
- Nuovo pannello: griglia delle camere, tocco per aprire in HD con pulsanti Chiudi, Precedente/Successiva e Audio.
- Titolo del pannello in barra laterale: "Annke" (la plancia "Telecamere" e ora una dashboard di Home Assistant).

## 1.0.2
- Se il flusso si ferma subito dopo il primo fotogramma chiave (l'NVR manda un fotogramma e poi niente) il ponte lo riconosce dopo 5 s e riapre da solo la connessione, fino a 3 volte, senza chiudere il flusso verso go2rtc. Prima aspettava 15 s e Home Assistant andava in timeout ("Error demuxing stream").
- Log piu chiari: ogni chiusura indica il motivo, la durata della sessione e i fotogrammi ricevuti; il primo fotogramma chiave indica dopo quanto e arrivato.
- Indirizzo predefinito dell'NVR corretto da 192.168.1.6 a 192.168.1.2.

## 1.0.1
- go2rtc copiato dall'immagine Docker ufficiale (versione 1.9.14, l'ultima su Docker Hub) invece che scaricato da GitHub (errore DNS su release-assets.githubusercontent.com durante la costruzione).

## 1.0.0
- Prima versione: ponte WebSocket -> H.265 grezzo, go2rtc v1.9.14 (prima v1.9.15), opzioni NVR, pannello in barra laterale.
