# Nexorava

Music-Streaming-Plattform – eigene Musik hochladen und mit anderen teilen.

## Setup

```bash
npm install
npm start
```

Die App läuft dann auf `http://localhost:3000`.

## Features

- Benutzer-Registrierung und Login
- Musik hochladen (MP3, WAV, FLAC, OGG, AAC, M4A – max. 50 MB)
- Musik streamen mit integriertem Player
- Song-Suche
- Eigenes Profil mit hochgeladenen Songs
- Play-Zähler
- Rechtliche Seiten integriert:
  - Nutzungsbedingungen (/tos)
  - Datenschutzerklärung (/privacy)
  - Upload-Richtlinien (/upload-rules)
  - Copyright-Meldesystem (/copyright)

## Konfiguration

Vor Produktivbetrieb in `server.js` ändern:

- `session.secret` – durch einen sicheren, zufälligen String ersetzen
- `PORT` – ggf. anpassen (Standard: 3000)

