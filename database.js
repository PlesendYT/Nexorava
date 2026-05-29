const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'data.db'));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    username    TEXT UNIQUE NOT NULL,
    email       TEXT UNIQUE NOT NULL,
    password    TEXT NOT NULL,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS songs (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    title         TEXT NOT NULL,
    artist        TEXT DEFAULT 'Unknown Artist',
    album         TEXT DEFAULT 'Unknown Album',
    filename      TEXT NOT NULL,
    original_name TEXT NOT NULL,
    mime_type     TEXT DEFAULT 'audio/mpeg',
    file_size     INTEGER DEFAULT 0,
    bitrate       INTEGER DEFAULT 0,
    sample_rate   INTEGER DEFAULT 0,
    duration      REAL DEFAULT 0,
    user_id       INTEGER NOT NULL,
    genre         TEXT DEFAULT '',
    icon          TEXT DEFAULT '',
    plays         INTEGER DEFAULT 0,
    uploaded_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS albums (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT NOT NULL,
    description TEXT DEFAULT '',
    cover_art   TEXT DEFAULT '',
    genre       TEXT DEFAULT '',
    user_id     INTEGER NOT NULL,
    is_public   INTEGER DEFAULT 0,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS album_songs (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    album_id     INTEGER NOT NULL,
    song_id      INTEGER NOT NULL,
    track_number INTEGER DEFAULT 0,
    FOREIGN KEY (album_id) REFERENCES albums(id) ON DELETE CASCADE,
    FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS playlists (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT NOT NULL,
    description TEXT DEFAULT '',
    user_id     INTEGER NOT NULL,
    is_public   INTEGER DEFAULT 0,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS playlist_songs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    playlist_id INTEGER NOT NULL,
    song_id     INTEGER NOT NULL,
    position    INTEGER DEFAULT 0,
    FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE,
    FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS strikes (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL,
    reason     TEXT NOT NULL,
    issued_by  INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (issued_by) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS reviews (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    target_type TEXT NOT NULL,
    target_id   INTEGER NOT NULL,
    reason      TEXT NOT NULL,
    reported_by INTEGER,
    status      TEXT DEFAULT 'pending',
    reviewer_id INTEGER,
    notes       TEXT DEFAULT '',
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    resolved_at DATETIME,
    FOREIGN KEY (reported_by) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (reviewer_id) REFERENCES users(id) ON DELETE SET NULL
  );
`);

try { db.exec('ALTER TABLE songs ADD COLUMN bitrate INTEGER DEFAULT 0'); } catch (e) {}
try { db.exec('ALTER TABLE songs ADD COLUMN sample_rate INTEGER DEFAULT 0'); } catch (e) {}
try { db.exec('ALTER TABLE songs ADD COLUMN duration REAL DEFAULT 0'); } catch (e) {}
try { db.exec('ALTER TABLE songs ADD COLUMN genre TEXT DEFAULT \'\''); } catch (e) {}
try { db.exec('ALTER TABLE songs ADD COLUMN icon TEXT DEFAULT \'\''); } catch (e) {}
try { db.exec('ALTER TABLE users ADD COLUMN premium INTEGER DEFAULT 0'); } catch (e) {}
try { db.exec('ALTER TABLE users ADD COLUMN stream_quality TEXT DEFAULT \'standard\''); } catch (e) {}
try { db.exec('ALTER TABLE users ADD COLUMN verified INTEGER DEFAULT 0'); } catch (e) {}
try { db.exec('ALTER TABLE users ADD COLUMN theme TEXT DEFAULT \'dark\''); } catch (e) {}
try { db.exec('ALTER TABLE users ADD COLUMN strikes INTEGER DEFAULT 0'); } catch (e) {}
try { db.exec('ALTER TABLE copyright_claims ADD COLUMN reviewed INTEGER DEFAULT 0'); } catch (e) {}
try { db.exec('ALTER TABLE copyright_claims ADD COLUMN reviewer_notes TEXT DEFAULT \'\''); } catch (e) {}
try { db.exec('ALTER TABLE copyright_claims ADD COLUMN resolved_at DATETIME'); } catch (e) {}
try { db.exec('ALTER TABLE playlists ADD COLUMN cover_art TEXT DEFAULT \'\''); } catch (e) {}

db.exec(`
  CREATE TABLE IF NOT EXISTS likes (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL,
    song_id    INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE CASCADE,
    UNIQUE(user_id, song_id)
  );

  CREATE TABLE IF NOT EXISTS history (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL,
    song_id    INTEGER NOT NULL,
    played_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS follows (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    follower_id INTEGER NOT NULL,
    followed_id INTEGER NOT NULL,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (follower_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (followed_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(follower_id, followed_id)
  );
`);

module.exports = db;
