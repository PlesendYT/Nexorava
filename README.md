# Nexorava

Music streaming platform—upload your own music and share it with others.

## Setup

```bash
npm install
npm start
```

The app will then run at `http://localhost:3000`.

## Features

- User registration and login
- Upload music (MP3, WAV, FLAC, OGG, AAC, M4A – max. 50 MB)
- Stream music with the built-in player
- Song search
- Personal profile with uploaded songs
- Play count
- Legal pages included:
  - Terms of Service (/tos)
  - Privacy Policy (/privacy)
  - Upload guidelines (/upload-rules)
  - Copyright reporting system (/copyright)

## Configuration

Before going live, make the following changes in `server.js`:

- `session.secret` – replace with a secure, random string
- `PORT` – adjust if necessary (default: 3000)
