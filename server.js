const express = require('express');
const session = require('express-session');
const multer = require('multer');
const path = require('path');
const bcrypt = require('bcrypt');
const fs = require('fs');
const mm = require('music-metadata');
const ffmpeg = require('fluent-ffmpeg');
const db = require('./database');

const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf-8'));
const FFMPEG_PATH = '/mnt/c/Users/User/AppData/Local/Packages/PythonSoftwareFoundation.Python.3.11_qbz5n2kfra8p0/LocalCache/local-packages/Python311/Scripts/ffmpeg.exe';
ffmpeg.setFfmpegPath(FFMPEG_PATH);

const app = express();
const PORT = process.env.PORT || 3000;
const GENRES = ['Pop','Rock','Hip Hop','Electronic','Jazz','Classical','R&B','Country','Metal','Folk','Blues','Reggae','Latin','Indie','Ambient','Nightcore','Techno','Phonk','Other'];

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
  secret: 'nexorava-session-secret-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }
}));
app.use(express.static(path.join(__dirname, 'public')));

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, 'public', 'uploads')),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['audio/mpeg', 'audio/wav', 'audio/flac', 'audio/ogg', 'audio/aac', 'audio/m4a', 'audio/mp3', 'image/png', 'image/jpeg', 'image/gif', 'image/webp'];
    const extMatch = file.originalname.match(/\.(mp3|wav|flac|ogg|aac|m4a|png|jpg|jpeg|gif|webp)$/i);
    if (extMatch) return cb(null, true);
    cb(new Error('Only audio/image files allowed'));
  }
});

const iconUpload = multer({ storage, limits: { fileSize: 2 * 1024 * 1024 }, fileFilter: (req, file, cb) => {
  if (file.originalname.match(/\.(png|jpg|jpeg|gif|webp)$/i)) return cb(null, true);
  cb(new Error('Only image files for icon'));
}});

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.redirect('/login');
  next();
}

function getFullUser(userId) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
}

function getSessionUser(req) {
  if (!req.session.userId) return null;
  const u = getFullUser(req.session.userId);
  if (!u) return null;
  return {
    id: u.id, username: u.username, email: u.email, created_at: u.created_at, avatar: u.avatar || '',
    premium: (config.debug.force_premium || config.debug.premium_user_ids.includes(u.id) || u.premium === 1) ? 1 : 0,
    verified: (config.debug.force_verified || config.debug.verified_user_ids.includes(u.id) || u.verified === 1) ? 1 : 0,
    stream_quality: u.stream_quality || 'standard',
    theme: u.theme || 'dark',
    strikes: u.strikes || 0
  };
}

function isPremium(user) { return user && user.premium === 1; }
function isVerified(user) { return user && user.verified === 1; }

function userBadge(user) {
  let html = escapeHtml(user.username);
  if (isPremium(user)) html += ' <span class="badge badge-premium" title="Premium">' + config.premium.badge + '</span>';
  if (isVerified(user)) html += ' <span class="badge badge-verified" title="Verified">' + config.verified.badge + '</span>';
  return html;
}

function getAllowedQualities(user) {
  return isPremium(user) ? config.premium.allowed_qualities : config.free.allowed_qualities;
}
function getQualityConfig(quality) { return config.streaming[quality] || config.streaming.default_quality; }
function getThemeConfig(t) { return config.themes[t] || config.themes.dark; }

function getUploaderBadges(s) {
  const prem = config.debug.force_premium || config.debug.premium_user_ids.includes(s.user_id) || s.uploader_premium === 1;
  const ver = config.debug.force_verified || config.debug.verified_user_ids.includes(s.user_id) || s.uploader_verified === 1;
  return (prem ? '<span class="badge badge-premium badge-sm">' + config.premium.badge + '</span>' : '') +
         (ver ? '<span class="badge badge-verified badge-sm">' + config.verified.badge + '</span>' : '');
}

function isLiked(userId, songId) {
  if (!userId) return false;
  return !!db.prepare('SELECT id FROM likes WHERE user_id = ? AND song_id = ?').get(userId, songId);
}
function isFollowing(followerId, followedId) {
  if (!followerId) return false;
  return !!db.prepare('SELECT id FROM follows WHERE follower_id = ? AND followed_id = ?').get(followerId, followedId);
}

// ---- AUTH ----
app.get('/login', (req, res) => { if (req.session.userId) return res.redirect('/'); res.send(renderPage('login', { user: null })); });
app.post('/login', (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password)) return res.send(renderPage('login', { user: null, error: 'Invalid username or password' }));
  req.session.userId = user.id;
  res.redirect('/');
});
app.get('/register', (req, res) => { if (req.session.userId) return res.redirect('/'); res.send(renderPage('register', { user: null })); });
app.post('/register', (req, res) => {
  const { username, email, password, password_confirm } = req.body;
  if (password !== password_confirm) return res.send(renderPage('register', { user: null, error: 'Passwords do not match' }));
  if (password.length < 6) return res.send(renderPage('register', { user: null, error: 'Password must be at least 6 characters' }));
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.send(renderPage('register', { user: null, error: 'Invalid email address' }));
  const usernameExists = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  const emailExists = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (usernameExists && emailExists) return res.send(renderPage('register', { user: null, error: 'Username and email are already taken' }));
  if (usernameExists) return res.send(renderPage('register', { user: null, error: 'Username is already taken' }));
  if (emailExists) return res.send(renderPage('register', { user: null, error: 'Email is already taken' }));
  db.prepare('INSERT INTO users (username, email, password) VALUES (?, ?, ?)').run(username, email, bcrypt.hashSync(password, 10));
  req.session.userId = db.prepare('SELECT id FROM users WHERE username = ?').get(username).id;
  res.redirect('/');
});
app.get('/logout', (req, res) => { req.session.destroy(() => res.redirect('/')); });

// ---- HOMEPAGE ----
app.get('/', (req, res) => {
  const user = getSessionUser(req);
  const genre = req.query.genre || '';
  let sql = 'SELECT s.*, u.username AS uploader_name, u.premium AS uploader_premium, u.verified AS uploader_verified FROM songs s JOIN users u ON s.user_id = u.id';
  let params = [];
  if (genre && GENRES.includes(genre)) { sql += ' WHERE s.genre = ?'; params.push(genre); }
  sql += ' ORDER BY s.uploaded_at DESC';
  const songs = db.prepare(sql).all(...params);

  let topSongs = [], feedSongs = [], historySongs = [];
  if (!genre) {
    topSongs = db.prepare('SELECT s.*, u.username AS uploader_name, u.premium AS uploader_premium, u.verified AS uploader_verified FROM songs s JOIN users u ON s.user_id = u.id ORDER BY s.plays DESC LIMIT 10').all();
    if (user) {
      historySongs = db.prepare('SELECT s.*, u.username AS uploader_name, u.premium AS uploader_premium, u.verified AS uploader_verified, MAX(h.played_at) AS last_played FROM history h JOIN songs s ON h.song_id = s.id JOIN users u ON s.user_id = u.id WHERE h.user_id = ? GROUP BY s.id ORDER BY last_played DESC LIMIT 10').all(user.id);
      const followedIds = db.prepare('SELECT followed_id FROM follows WHERE follower_id = ?').all(user.id).map(r => r.followed_id);
      if (followedIds.length) {
        feedSongs = db.prepare(`SELECT s.*, u.username AS uploader_name, u.premium AS uploader_premium, u.verified AS uploader_verified FROM songs s JOIN users u ON s.user_id = u.id WHERE s.user_id IN (${followedIds.map(() => '?').join(',')}) ORDER BY s.uploaded_at DESC LIMIT 10`).all(...followedIds);
      }
    }
  }

  if (req.query.partial === '1') {
    return res.json({ content: renderContent('home', { user, songs, topSongs, feedSongs, historySongs, selectedGenre: genre }), title: 'Nexorava' });
  }
  res.send(renderPage('home', { user, songs, topSongs, feedSongs, historySongs, selectedGenre: genre }));
});

// ---- SEARCH ----
app.get('/search', (req, res) => {
  const user = getSessionUser(req);
  const q = req.query.q || '';
  const genre = req.query.genre || '';
  const dur = req.query.dur || '';
  const uploader = req.query.uploader || '';
  const dateFrom = req.query.date_from || '';
  const dateTo = req.query.date_to || '';
  let sql = `SELECT s.*, u.username AS uploader_name, u.premium AS uploader_premium, u.verified AS uploader_verified
    FROM songs s JOIN users u ON s.user_id = u.id WHERE (s.title LIKE ? OR s.artist LIKE ? OR s.album LIKE ? OR u.username LIKE ?)`;
  let params = [`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`];
  if (genre && GENRES.includes(genre)) { sql += ' AND s.genre = ?'; params.push(genre); }
  if (dur === 'short') { sql += ' AND s.duration < 180'; }
  else if (dur === 'medium') { sql += ' AND s.duration >= 180 AND s.duration < 420'; }
  else if (dur === 'long') { sql += ' AND s.duration >= 420'; }
  if (uploader) { sql += ' AND u.username LIKE ?'; params.push('%' + uploader + '%'); }
  if (dateFrom) { sql += ' AND s.uploaded_at >= ?'; params.push(dateFrom); }
  if (dateTo) { sql += ' AND s.uploaded_at <= ?'; params.push(dateTo + ' 23:59:59'); }
  sql += ' ORDER BY s.uploaded_at DESC';
  const songs = db.prepare(sql).all(...params);

  if (req.query.partial === '1') {
    return res.json({ content: renderContent('home', { user, songs, searchQuery: q, selectedGenre: genre, searchDur: dur, searchUploader: uploader, searchDateFrom: dateFrom, searchDateTo: dateTo }), title: 'Search - Nexorava' });
  }
  res.send(renderPage('home', { user, songs, searchQuery: q, selectedGenre: genre, searchDur: dur, searchUploader: uploader, searchDateFrom: dateFrom, searchDateTo: dateTo }));
});

// ---- UPLOAD ----
app.get('/upload', requireAuth, (req, res) => {
  const user = getSessionUser(req);
  if (req.query.partial === '1') return res.json({ content: renderContent('upload', { user }), title: 'Upload - Nexorava' });
  res.send(renderPage('upload', { user }));
});

app.post('/upload', requireAuth, upload.fields([{ name: 'audio', maxCount: 1 }, { name: 'icon', maxCount: 1 }]), async (req, res) => {
  const user = getSessionUser(req);
  if (!req.files || !req.files.audio) return res.send(renderPage('upload', { user, error: 'No audio file selected' }));
  const af = req.files.audio[0];
  const { title, album, genre } = req.body;
  let iconFile = '';
  if (req.files.icon) iconFile = req.files.icon[0].filename;

  let bitrate = 0, sampleRate = 0, duration = 0;
  try { const meta = await mm.parseFile(af.path, { duration: true }); bitrate = meta.format.bitrate ? Math.round(meta.format.bitrate / 1000) : 0; sampleRate = meta.format.sampleRate || 0; duration = meta.format.duration ? Math.round(meta.format.duration) : 0; } catch (e) {}

   db.prepare(`INSERT INTO songs (title, artist, album, filename, original_name, mime_type, file_size, bitrate, sample_rate, duration, genre, icon, user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
     title || af.originalname.replace(/\.[^/.]+$/, ''), user.username, album || '', af.filename, af.originalname, af.mimetype, af.size, bitrate, sampleRate, duration, genre || '', iconFile, user.id
   );
   res.redirect('/profile?upload_success=1');
});

// ---- STREAMING ----
function streamFile(res, fp, mime) { const s = fs.statSync(fp); res.writeHead(200,{'Content-Length':s.size,'Content-Type':mime,'Accept-Ranges':'bytes','Cache-Control':'no-cache'}); fs.createReadStream(fp).pipe(res); }
function streamTranscoded(res, fp, qk) {
  const q = getQualityConfig(qk);
  res.writeHead(200,{'Content-Type':'audio/aac','Cache-Control':'no-cache','X-Transcoded':qk});
  ffmpeg(fp).audioCodec('aac').audioBitrate(q.bitrate).audioFrequency(parseInt(q.sample_rate)).audioChannels(2).format('adts')
    .on('error', (e) => { console.error('FFmpeg:', e.message); if (!res.headersSent) streamFile(res, fp, 'audio/mpeg'); })
    .pipe(res, { end: true });
}

app.get('/song/:id/stream', (req, res) => {
  const user = getSessionUser(req);
  const song = db.prepare('SELECT * FROM songs WHERE id = ?').get(req.params.id);
  if (!song) return res.status(404).end();
  const fp = path.join(__dirname, 'public', 'uploads', song.filename);
  if (!fs.existsSync(fp)) return res.status(404).end();
  let quality = req.query.q || (user ? user.stream_quality : null) || config.streaming.default_quality;
  const allowed = getAllowedQualities(user);
  if (!allowed.includes(quality)) quality = allowed[0];
  if (req.headers.range) {
    const s = fs.statSync(fp), fz = s.size, p = req.headers.range.replace(/bytes=/, '').split('-');
    const st = parseInt(p[0]), en = p[1] ? parseInt(p[1]) : fz - 1;
    res.writeHead(206,{'Content-Range':`bytes ${st}-${en}/${fz}`,'Accept-Ranges':'bytes','Content-Length':en-st+1,'Content-Type':song.mime_type});
    fs.createReadStream(fp,{start:st,end:en}).pipe(res);
    return;
  }
  if (quality === 'original') return streamFile(res, fp, song.mime_type);
  streamTranscoded(res, fp, quality);
});

app.post('/song/:id/play', (req, res) => {
  db.prepare('UPDATE songs SET plays = plays + 1 WHERE id = ?').run(req.params.id);
  if (req.session.userId) {
    db.prepare('INSERT INTO history (user_id, song_id) VALUES (?, ?)').run(req.session.userId, req.params.id);
  }
  res.json({ok:true});
});

app.post('/song/:id/delete', requireAuth, (req, res) => {
  const song = db.prepare('SELECT * FROM songs WHERE id = ?').get(req.params.id);
  if (!song) return res.status(404).end();
  if (song.user_id !== req.session.userId) return res.status(403).end();
  const fp = path.join(__dirname, 'public', 'uploads', song.filename);
  if (fs.existsSync(fp)) fs.unlinkSync(fp);
  db.prepare('DELETE FROM songs WHERE id = ?').run(song.id);
  res.redirect('/profile');
});

app.get('/song/:id/data', (req, res) => {
  const s = db.prepare('SELECT s.*, u.username AS uploader_name, u.premium AS uploader_premium, u.verified AS uploader_verified FROM songs s JOIN users u ON s.user_id = u.id WHERE s.id = ?').get(req.params.id);
  if (!s) return res.status(404).json(null);
  const liked = isLiked(req.session.userId, s.id);
  const likeCount = db.prepare('SELECT COUNT(*) AS c FROM likes WHERE song_id = ?').get(s.id).c;
  res.json({ id:s.id, title:s.title, artist:s.artist, album:s.album, genre:s.genre, icon:s.icon, duration:s.duration, plays:s.plays, uploader:s.uploader_name, premium:s.uploader_premium, verified:s.uploader_verified, file:'/uploads/'+s.filename, liked, likeCount });
});

app.get('/api/likes/count/:id', (req, res) => {
  const c = db.prepare('SELECT COUNT(*) AS c FROM likes WHERE song_id = ?').get(req.params.id);
  res.json({ count: c.c });
});

// ---- LIKES ----
app.post('/song/:id/like', requireAuth, (req, res) => {
  const uid = req.session.userId;
  const sid = req.params.id;
  
  // Rate limiting: check if user liked any song in the last 2 seconds
  const recentLike = db.prepare('SELECT created_at FROM likes WHERE user_id = ? ORDER BY created_at DESC LIMIT 1').get(uid);
  if (recentLike && recentLike.created_at) {
    const lastLikeTime = new Date(recentLike.created_at).getTime();
    const currentTime = new Date().getTime();
    if (currentTime - lastLikeTime < 2000) { // 2 second cooldown
      return res.status(429).json({ error: 'Please wait before liking again' });
    }
  }
  
  const existing = db.prepare('SELECT id FROM likes WHERE user_id = ? AND song_id = ?').get(uid, sid);
  if (existing) {
    db.prepare('DELETE FROM likes WHERE user_id = ? AND song_id = ?').run(uid, sid);
  } else {
    db.prepare('INSERT INTO likes (user_id, song_id, created_at) VALUES (?, ?, datetime(\'now\'))').run(uid, sid);
  }
  const likeCount = db.prepare('SELECT COUNT(*) AS c FROM likes WHERE song_id = ?').get(sid).c;
  const liked = !existing;
  res.json({ liked, likeCount });
});

app.get('/api/likes', requireAuth, (req, res) => {
  const ids = db.prepare('SELECT song_id FROM likes WHERE user_id = ?').all(req.session.userId).map(r => r.song_id);
  res.json(ids);
});

app.get('/api/user-playlists', requireAuth, (req, res) => {
  const playlists = db.prepare('SELECT id, title FROM playlists WHERE user_id = ? ORDER BY created_at DESC').all(req.session.userId);
  res.json(playlists);
});

app.get('/likes', requireAuth, (req, res) => {
  const user = getSessionUser(req);
  const songs = db.prepare('SELECT s.*, u.username AS uploader_name, u.premium AS uploader_premium, u.verified AS uploader_verified FROM likes l JOIN songs s ON l.song_id = s.id JOIN users u ON s.user_id = u.id WHERE l.user_id = ? ORDER BY l.created_at DESC').all(user.id);
  if (req.query.partial === '1') return res.json({ content: renderContent('likes', { user, songs }), title: 'Liked Songs - Nexorava' });
  res.send(renderPage('likes', { user, songs }));
});

// ---- ARTIST PAGE ----
app.get('/artist/:username', (req, res) => {
  const artist = db.prepare('SELECT * FROM users WHERE username = ?').get(req.params.username);
  if (!artist) return res.redirect('/');
  const user = getSessionUser(req);
  const songs = db.prepare('SELECT s.*, u.username AS uploader_name, u.premium AS uploader_premium, u.verified AS uploader_verified FROM songs s JOIN users u ON s.user_id = u.id WHERE s.user_id = ? ORDER BY s.uploaded_at DESC').all(artist.id);
  const followerCount = db.prepare('SELECT COUNT(*) AS c FROM follows WHERE followed_id = ?').get(artist.id).c;
  const following = user ? isFollowing(user.id, artist.id) : false;
  const artistUser = {
    id: artist.id, username: artist.username, email: artist.email, created_at: artist.created_at, avatar: artist.avatar || '',
    premium: (config.debug.force_premium || config.debug.premium_user_ids.includes(artist.id) || artist.premium === 1) ? 1 : 0,
    verified: (config.debug.force_verified || config.debug.verified_user_ids.includes(artist.id) || artist.verified === 1) ? 1 : 0
   };
  if (req.query.partial === '1') return res.json({ content: renderContent('artist', { user, artist: artistUser, songs, followerCount, following }), title: escapeHtml(artist.username) + ' - Nexorava' });
  res.send(renderPage('artist', { user, artist: artistUser, songs, followerCount, following }));
});

// Backward compatibility: redirect old ID-based URLs to username-based URLs
app.get('/artist/:id([0-9]+)', (req, res) => {
  const artist = getFullUser(req.params.id);
  if (!artist) return res.redirect('/');
  res.redirect('/artist/' + encodeURIComponent(artist.username));
});

// ---- FOLLOW ----
app.post('/follow/:id', requireAuth, (req, res) => {
  const uid = req.session.userId;
  const targetId = req.params.id;
  if (uid == targetId) return res.status(400).json({ error: 'Cannot follow yourself' });
  const existing = db.prepare('SELECT id FROM follows WHERE follower_id = ? AND followed_id = ?').get(uid, targetId);
  if (existing) {
    db.prepare('DELETE FROM follows WHERE follower_id = ? AND followed_id = ?').run(uid, targetId);
    res.json({ following: false });
  } else {
    db.prepare('INSERT INTO follows (follower_id, followed_id) VALUES (?, ?)').run(uid, targetId);
    res.json({ following: true });
  }
});

app.get('/api/check-follow/:id', requireAuth, (req, res) => {
  res.json({ following: isFollowing(req.session.userId, req.params.id) });
});

// ---- AUTO-PLAY SUGGESTIONS ----
app.get('/api/suggestions/:song_id', (req, res) => {
  const song = db.prepare('SELECT * FROM songs WHERE id = ?').get(req.params.song_id);
  if (!song) return res.json([]);
  const suggestions = db.prepare(`SELECT s.*, u.username AS uploader_name FROM songs s JOIN users u ON s.user_id = u.id WHERE s.genre = ? AND s.id != ? ORDER BY RANDOM() LIMIT 5`).all(song.genre || '', song.id);
  res.json(suggestions.map(s => ({ id: s.id, title: s.title, artist: s.artist, file: '/uploads/' + s.filename, duration: s.duration, genre: s.genre })));
});

// ---- THEME API ----
app.get('/api/theme', (req, res) => {
  const name = req.query.name || 'dark';
  const t = getThemeConfig(name);
  const vars = Object.keys(t).filter(k => k !== 'label').map(k => `  --${k}: ${t[k]};`).join('\n');
  res.type('text/plain').send(vars);
});

// ---- PROFILE ----
app.get('/profile', requireAuth, (req, res) => {
  const user = getSessionUser(req);
  const songs = db.prepare('SELECT * FROM songs WHERE user_id = ? ORDER BY uploaded_at DESC').all(user.id);
  const albums = db.prepare('SELECT * FROM albums WHERE user_id = ? ORDER BY created_at DESC').all(user.id);
  const playlists = db.prepare('SELECT * FROM playlists WHERE user_id = ? ORDER BY created_at DESC').all(user.id);
  const followerCount = db.prepare('SELECT COUNT(*) AS c FROM follows WHERE followed_id = ?').get(user.id).c;
  const followingCount = db.prepare('SELECT COUNT(*) AS c FROM follows WHERE follower_id = ?').get(user.id).c;
  const success = req.query.upload_success ? 'Song uploaded successfully!' : null;
  if (req.query.partial === '1') return res.json({ content: renderContent('profile', { user, songs, albums, playlists, followerCount, followingCount, success }), title: 'Profile - Nexorava' });
  res.send(renderPage('profile', { user, songs, albums, playlists, followerCount, followingCount, success }));
});

// ---- ALBUMS ----
app.get('/albums', (req, res) => {
  const user = getSessionUser(req);
  const albums = db.prepare('SELECT a.*, u.username AS owner_name, (SELECT COUNT(*) FROM album_songs WHERE album_id = a.id) AS song_count FROM albums a JOIN users u ON a.user_id = u.id WHERE a.is_public = 1 ORDER BY a.created_at DESC').all();
  if (req.query.partial === '1') return res.json({ content: renderContent('albums', { user, albums }), title: 'Albums - Nexorava' });
  res.send(renderPage('albums', { user, albums }));
});

app.get('/album/:id', (req, res) => {
  const user = getSessionUser(req);
  const album = db.prepare('SELECT a.*, u.username AS owner_name FROM albums a JOIN users u ON a.user_id = u.id WHERE a.id = ?').get(req.params.id);
  if (!album) return res.redirect('/');
  const songs = db.prepare('SELECT s.*, u.username AS uploader_name, u.premium AS uploader_premium, u.verified AS uploader_verified, as2.track_number FROM songs s JOIN album_songs as2 ON s.id = as2.song_id JOIN users u ON s.user_id = u.id WHERE as2.album_id = ? ORDER BY as2.track_number').all(album.id);
  if (req.query.partial === '1') return res.json({ content: renderContent('album-detail', { user, album, songs }), title: escapeHtml(album.title) + ' - Nexorava' });
  res.send(renderPage('album-detail', { user, album, songs }));
});

app.post('/album/create', requireAuth, (req, res) => {
  const user = getSessionUser(req);
  const { title, description, genre } = req.body;
  db.prepare('INSERT INTO albums (title, description, genre, user_id) VALUES (?, ?, ?, ?)').run(title || 'Untitled', description || '', genre || '', user.id);
  res.redirect('/profile');
});

app.post('/album/:id/toggle', requireAuth, (req, res) => {
  const album = db.prepare('SELECT * FROM albums WHERE id = ?').get(req.params.id);
  if (!album || album.user_id !== req.session.userId) return res.status(403).end();
  db.prepare('UPDATE albums SET is_public = ? WHERE id = ?').run(album.is_public ? 0 : 1, album.id);
  res.redirect('/profile');
});

app.post('/album/:id/add-song', requireAuth, (req, res) => {
  const album = db.prepare('SELECT * FROM albums WHERE id = ?').get(req.params.id);
  if (!album || album.user_id !== req.session.userId) return res.status(403).end();
  const { song_id } = req.body;
  const max = db.prepare('SELECT MAX(track_number) AS mx FROM album_songs WHERE album_id = ?').get(album.id);
  db.prepare('INSERT INTO album_songs (album_id, song_id, track_number) VALUES (?, ?, ?)').run(album.id, song_id, (max.mx || 0) + 1);
  res.redirect('/profile');
});

app.post('/album/:id/delete', requireAuth, (req, res) => {
  const album = db.prepare('SELECT * FROM albums WHERE id = ?').get(req.params.id);
  if (!album || album.user_id !== req.session.userId) return res.status(403).end();
  db.prepare('DELETE FROM albums WHERE id = ?').run(album.id);
  res.redirect('/profile');
});

// ---- PLAYLISTS ----
app.get('/playlists', (req, res) => {
  const user = getSessionUser(req);
  const playlists = db.prepare('SELECT p.*, u.username AS owner_name, (SELECT COUNT(*) FROM playlist_songs WHERE playlist_id = p.id) AS song_count FROM playlists p JOIN users u ON p.user_id = u.id WHERE p.is_public = 1 ORDER BY p.created_at DESC').all();
  if (req.query.partial === '1') return res.json({ content: renderContent('playlists', { user, playlists }), title: 'Playlists - Nexorava' });
  res.send(renderPage('playlists', { user, playlists }));
});

app.get('/playlist/:id', (req, res) => {
  const user = getSessionUser(req);
  const pl = db.prepare('SELECT p.*, u.username AS owner_name FROM playlists p JOIN users u ON p.user_id = u.id WHERE p.id = ?').get(req.params.id);
  if (!pl) return res.redirect('/');
  const songs = db.prepare('SELECT s.*, u.username AS uploader_name, u.premium AS uploader_premium, u.verified AS uploader_verified, ps.position FROM songs s JOIN playlist_songs ps ON s.id = ps.song_id JOIN users u ON s.user_id = u.id WHERE ps.playlist_id = ? ORDER BY ps.position').all(pl.id);
  if (req.query.partial === '1') return res.json({ content: renderContent('playlist-detail', { user, playlist: pl, songs }), title: escapeHtml(pl.title) + ' - Nexorava' });
  res.send(renderPage('playlist-detail', { user, playlist: pl, songs }));
});

app.post('/playlist/create', requireAuth, (req, res) => {
  const user = getSessionUser(req);
  const { title, description } = req.body;
  db.prepare('INSERT INTO playlists (title, description, user_id) VALUES (?, ?, ?)').run(title || 'Untitled', description || '', user.id);
  res.redirect('/profile');
});

app.post('/playlist/:id/toggle', requireAuth, (req, res) => {
  const pl = db.prepare('SELECT * FROM playlists WHERE id = ?').get(req.params.id);
  if (!pl || pl.user_id !== req.session.userId) return res.status(403).end();
  db.prepare('UPDATE playlists SET is_public = ? WHERE id = ?').run(pl.is_public ? 0 : 1, pl.id);
  res.redirect('/profile');
});

app.post('/playlist/:id/add-song', requireAuth, (req, res) => {
  const pl = db.prepare('SELECT * FROM playlists WHERE id = ?').get(req.params.id);
  if (!pl || pl.user_id !== req.session.userId) return res.status(403).end();
  const { song_id } = req.body;
  const max = db.prepare('SELECT MAX(position) AS mx FROM playlist_songs WHERE playlist_id = ?').get(pl.id);
  db.prepare('INSERT INTO playlist_songs (playlist_id, song_id, position) VALUES (?, ?, ?)').run(pl.id, song_id, (max.mx || 0) + 1);
  res.redirect('/profile');
});

app.post('/playlist/:id/delete', requireAuth, (req, res) => {
  const pl = db.prepare('SELECT * FROM playlists WHERE id = ?').get(req.params.id);
  if (!pl || pl.user_id !== req.session.userId) return res.status(403).end();
  db.prepare('DELETE FROM playlists WHERE id = ?').run(pl.id);
  res.redirect('/profile');
});

// ---- SETTINGS ----
app.get('/settings', requireAuth, (req, res) => {
  const user = getSessionUser(req);
  if (req.query.partial === '1') return res.json({ content: renderContent('settings', { user }), title: 'Settings - Nexorava' });
  res.send(renderPage('settings', { user }));
});
app.post('/settings', requireAuth, (req, res) => {
  const user = getSessionUser(req);
  const { stream_quality, theme } = req.body;
  const allowed = getAllowedQualities(user);
  if (stream_quality && allowed.includes(stream_quality)) db.prepare('UPDATE users SET stream_quality = ? WHERE id = ?').run(stream_quality, user.id);
  if (theme && config.themes[theme]) db.prepare('UPDATE users SET theme = ? WHERE id = ?').run(theme, user.id);
  if (req.xhr || req.headers.accept?.includes('json')) return res.json({ ok: true });
  res.redirect('/settings');
});

app.post('/settings/password', requireAuth, (req, res) => {
  const user = getSessionUser(req);
  const { old_password, new_password, new_password_confirm } = req.body;
  const row = db.prepare('SELECT password FROM users WHERE id = ?').get(user.id);
  if (!bcrypt.compareSync(old_password, row.password)) return res.json({ error: 'Current password is wrong' });
  if (new_password.length < 6) return res.json({ error: 'New password must be at least 6 characters' });
  if (new_password !== new_password_confirm) return res.json({ error: 'New passwords do not match' });
  db.prepare('UPDATE users SET password = ? WHERE id = ?').run(bcrypt.hashSync(new_password, 10), user.id);
  res.json({ ok: true });
});

app.post('/account/delete', requireAuth, (req, res) => {
  const uid = req.session.userId;
  db.prepare('SELECT filename FROM songs WHERE user_id = ?').all(uid).forEach(s => { const fp = path.join(__dirname, 'public', 'uploads', s.filename); if (fs.existsSync(fp)) fs.unlinkSync(fp); });
  db.prepare('DELETE FROM users WHERE id = ?').run(uid);
  req.session.destroy(() => res.redirect('/'));
});

// ---- AVATAR UPLOAD ----
app.post('/avatar/upload', requireAuth, iconUpload.single('avatar'), (req, res) => {
  const user = getSessionUser(req);
  if (!req.file) return res.json({ error: 'No file selected' });
  try {
    db.prepare('UPDATE users SET avatar = ? WHERE id = ?').run(req.file.filename, user.id);
    res.json({ ok: true, filename: req.file.filename });
  } catch (error) {
    console.error('Avatar upload error:', error);
    res.json({ error: 'Failed to update avatar in database' });
  }
});

// ---- COPYRIGHT / REVIEW / STRIKES ----
app.get('/contact', (req, res) => { const user = getSessionUser(req); res.send(renderPage('contact', { user })); });
app.post('/contact', (req, res) => {
  const { name, email, subject, message } = req.body;
  db.prepare('INSERT INTO contact_messages (name, email, subject, message) VALUES (?, ?, ?, ?)').run(name, email, subject, message);
  res.redirect('/contact?success=1');
});

app.get('/bug-report', (req, res) => { const user = getSessionUser(req); res.send(renderPage('bug-report', { user })); });
app.post('/bug-report', (req, res) => {
  const { name, email, subject, description } = req.body;
  db.prepare('INSERT INTO bug_reports (name, email, subject, description) VALUES (?, ?, ?, ?)').run(name, email, subject, description);
  res.redirect('/bug-report?success=1');
});

app.get('/copyright', (req, res) => { const user = getSessionUser(req); res.send(renderPage('copyright', { user, copyrightSongId: req.query.song_id || '' })); });
app.post('/copyright', (req, res) => {
  const { song_id, claimant_name, claimant_email, reason } = req.body;
  if (!db.prepare('SELECT id FROM songs WHERE id = ?').get(song_id)) return res.status(404).end();
  db.prepare('INSERT INTO reviews (target_type, target_id, reason, reported_by) VALUES (?, ?, ?, ?)').run('song', song_id, reason, req.session.userId || null);
  res.redirect('/copyright?success=1');
});

app.get('/review-queue', requireAuth, (req, res) => {
  const user = getSessionUser(req);
  const reviews = db.prepare('SELECT r.*, s.title AS song_title, u.username AS reporter_name FROM reviews r LEFT JOIN songs s ON r.target_id = s.id LEFT JOIN users u ON r.reported_by = u.id WHERE r.status = ? ORDER BY r.created_at DESC').all('pending');
  const strikesList = db.prepare('SELECT st.*, u.username AS user_name, iss.username AS issuer_name FROM strikes st JOIN users u ON st.user_id = u.id JOIN users iss ON st.issued_by = iss.id ORDER BY st.created_at DESC LIMIT 50').all();
  if (req.query.partial === '1') return res.json({ content: renderContent('review-queue', { user, reviews, strikesList }), title: 'Review Queue - Nexorava' });
  res.send(renderPage('review-queue', { user, reviews, strikesList }));
});

app.post('/review/:id/action', requireAuth, (req, res) => {
  const review = db.prepare('SELECT * FROM reviews WHERE id = ?').get(req.params.id);
  if (!review) return res.status(404).end();
  const { action, notes } = req.body;
  if (action === 'approve') {
    if (review.target_type === 'song') {
      const song = db.prepare('SELECT * FROM songs WHERE id = ?').get(review.target_id);
      if (song) {
        const fp = path.join(__dirname, 'public', 'uploads', song.filename);
        if (fs.existsSync(fp)) fs.unlinkSync(fp);
        db.prepare('DELETE FROM songs WHERE id = ?').run(song.id);
        db.prepare('UPDATE users SET strikes = strikes + 1 WHERE id = ?').run(song.user_id);
        const s = db.prepare('SELECT strikes FROM users WHERE id = ?').get(song.user_id);
        if (s.strikes >= config.moderation.max_strikes && config.moderation.auto_ban_on_max_strikes) {
          db.prepare('UPDATE users SET username = ? WHERE id = ?').run('[banned-' + song.user_id + ']', song.user_id);
        }
        db.prepare('INSERT INTO strikes (user_id, reason, issued_by) VALUES (?, ?, ?)').run(song.user_id, 'Copyright violation: ' + (notes || review.reason), req.session.userId);
      }
    }
    db.prepare('UPDATE reviews SET status = ?, reviewer_id = ?, notes = ?, resolved_at = ? WHERE id = ?').run('approved', req.session.userId, notes || '', new Date().toISOString(), review.id);
  } else if (action === 'reject') {
    db.prepare('UPDATE reviews SET status = ?, reviewer_id = ?, notes = ?, resolved_at = ? WHERE id = ?').run('rejected', req.session.userId, notes || '', new Date().toISOString(), review.id);
  }
  res.redirect('/review-queue');
});

// ---- SHARE ----
app.get('/share/song/:id', (req, res) => {
  const song = db.prepare('SELECT s.*, u.username AS uploader_name FROM songs s JOIN users u ON s.user_id = u.id WHERE s.id = ?').get(req.params.id);
  if (!song) return res.status(404).send('Song not found');
  res.send(renderPage('share', { user: getSessionUser(req), song, __req: req }));
});

// ---- RENDER ----
function renderContent(page, data, req) {
  const user = data.user || null;
  const error = data.error || null;
  const success = data.success || null;
  const searchQuery = data.searchQuery || '';
  const selectedGenre = data.selectedGenre || '';
  const searchDur = data.searchDur || '';
  const searchUploader = data.searchUploader || '';
  const searchDateFrom = data.searchDateFrom || '';
  const searchDateTo = data.searchDateTo || '';
  const songs = data.songs || [];
  const albums = data.albums || [];
  const playlists = data.playlists || [];
  const album = data.album || null;
  const playlist = data.playlist || null;
  const reviews = data.reviews || [];
  const strikesList = data.strikesList || [];
  const song = data.song || null;
  const topSongs = data.topSongs || [];
  const feedSongs = data.feedSongs || [];
  const historySongs = data.historySongs || [];
  const artist = data.artist || null;
  const followerCount = data.followerCount || 0;
  const followingCount = data.followingCount || 0;
  const following = data.following || false;
  const copyrightSongId = data.copyrightSongId || '';

  const genreFilter = GENRES.map(g => `<option value="${g}" ${selectedGenre === g ? 'selected' : ''}>${g}</option>`).join('');

  function fmtDur(s) { if (!s) return ''; const m = Math.floor(s / 60), sec = Math.floor(s % 60); return m + ':' + (sec < 10 ? '0' : '') + sec; }
  function fmtDate(d) { return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }

  function songItem(s, extraMeta = '', userForLikes = null, userAlbums = [], userPlaylists = []) {
    const q = s.bitrate ? `<span class="quality-badge">${s.bitrate}kbps</span>` : '';
    const ub = getUploaderBadges(s);
    const userForLikeCount = userForLikes || user;
    const liked = userForLikeCount ? isLiked(userForLikeCount.id, s.id) : false;
    const likeCount = db.prepare('SELECT COUNT(*) AS c FROM likes WHERE song_id = ?').get(s.id).c;
    const h = liked ? '♥ ' + likeCount : '♡ ' + likeCount;
    const hc = liked ? 'liked' : '';
    const iconUrl = s.icon ? `/uploads/${s.icon}` : 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50" fill="%231db954"/><text x="50" y="65" text-anchor="middle" font-size="50" fill="white">♫</text></svg>';
    return `<div class="song-item" data-id="${s.id}" data-title="${escapeHtml(s.title)}" data-artist="${escapeHtml(s.artist)}" data-uploader="${escapeHtml(s.uploader_name || s.uploader || '')}" data-file="/uploads/${s.filename}" data-duration="${s.duration || 0}" data-icon="${s.icon || ''}" data-genre="${escapeHtml(s.genre || '')}">
      <div class="song-icon-wrapper">
        <img class="song-icon" src="${iconUrl}" alt="">
        <button class="song-play-btn-preview" onclick="playPreview(event, ${s.id}, '/uploads/${s.filename}', '${escapeHtml(s.title)}', '${escapeHtml(s.artist)}')">▶</button>
      </div>
      <div class="song-play-btn" onclick="playSongFull(event, ${s.id}, '${escapeHtml(s.title)}', '${escapeHtml(s.artist)}', '/uploads/${s.filename}', '${escapeHtml(s.genre || '')}')">▶</div>
      <div class="song-info"><strong>${escapeHtml(s.title)}</strong><span><a href="/artist/${escapeHtml(s.uploader_name || s.uploader || '')}" class="artist-link">${escapeHtml(s.artist)}</a></span></div>
      <div class="song-meta">${q}${s.genre ? '<span class="genre-tag">' + escapeHtml(s.genre) + '</span>' : ''}<span class="song-uploader"><a href="/artist/${escapeHtml(s.uploader_name || s.uploader || '')}" class="artist-link">${escapeHtml(s.uploader_name || s.uploader || '')}</a> ${ub}</span><span>${s.plays} plays</span>${extraMeta}</div>
      <div class="song-actions">
        ${userForLikeCount ? `<button class="like-btn ${hc}" data-id="${s.id}" title="Like">${h}</button>` : ''}
        <button class="btn btn-sm btn-share" title="Share" onclick="copySongLink(${s.id}, '${escapeHtml(s.title)}')">🔗</button>
        ${userAlbums.length > 0 ? `<div class="dropdown song-dropdown">
          <button class="btn btn-sm btn-add" title="Add to Album">+ Album</button>
          <div class="dropdown-menu">
            ${userAlbums.map(a => `<a href="#" onclick="addToAlbum(${s.id}, ${a.id}); return false;">${escapeHtml(a.title)}</a>`).join('')}
          </div>
        </div>` : ''}
        ${userPlaylists.length > 0 ? `<div class="dropdown song-dropdown">
          <button class="btn btn-sm btn-add" title="Add to Playlist">+ Playlist</button>
          <div class="dropdown-menu">
            ${userPlaylists.map(p => `<a href="#" onclick="addToPlaylist(${s.id}, ${p.id}); return false;">${escapeHtml(p.title)}</a>`).join('')}
          </div>
        </div>` : ''}
      </div>
    </div>`;
  }

  let content = '';
  if (page === 'login') {
    content = `<div class="auth-page"><div class="auth-card"><h1>Login</h1>${error ? `<div class="alert alert-error">${escapeHtml(error)}</div>` : ''}<form method="POST"><div class="form-group"><label>Username</label><input type="text" name="username" required></div><div class="form-group"><label>Password</label><input type="password" name="password" required></div><button type="submit" class="btn btn-primary btn-block">Login</button></form><p class="auth-link">No account yet? <a href="/register">Register</a></p></div></div>`;
  } else if (page === 'register') {
    content = `<div class="auth-page"><div class="auth-card"><h1>Register</h1>${error ? `<div class="alert alert-error">${escapeHtml(error)}</div>` : ''}<form method="POST"><div class="form-group"><label>Username</label><input type="text" name="username" required></div><div class="form-group"><label>Email</label><input type="email" name="email" required></div><div class="form-group"><label>Password</label><input type="password" name="password" required minlength="6"></div><div class="form-group"><label>Confirm Password</label><input type="password" name="password_confirm" required></div><p class="form-hint">By registering you accept our <a href="/tos">Terms of Service</a> and <a href="/privacy">Privacy Policy</a>.</p><button type="submit" class="btn btn-primary btn-block">Register</button></form><p class="auth-link">Already have an account? <a href="/login">Login</a></p></div></div>`;
  } else if (page === 'upload') {
    content = `<div class="upload-page"><h1>Upload Music</h1>${error ? `<div class="alert alert-error">${escapeHtml(error)}</div>` : ''}<div class="upload-card"><form method="POST" enctype="multipart/form-data">
      <div class="form-group"><label>Title</label><input type="text" name="title" placeholder="Song title"></div>
      <div class="form-group"><label>Artist</label><input type="text" value="${user ? escapeHtml(user.username) : ''}" disabled><small class="form-hint">Artist is set to your username</small></div>
      <div class="form-row"><div class="form-group"><label>Album</label><input type="text" name="album" placeholder="Album name"></div><div class="form-group"><label>Genre</label><select name="genre"><option value="">-- Select --</option>${GENRES.map(g => `<option value="${g}">${g}</option>`).join('')}</select></div></div>
      <div class="form-group"><label>Audio File *</label><div class="file-input-area"><input type="file" name="audio" accept="audio/*" required id="audioFile"><label for="audioFile" class="file-label">Choose File</label><span class="file-name" id="fileName">No file selected</span></div><small>MP3, WAV, FLAC, OGG, AAC, M4A (max 50 MB)</small></div>
      <div class="form-group"><label>Song Icon (optional)</label><div class="file-input-area"><input type="file" name="icon" accept="image/*" id="iconFile"><label for="iconFile" class="file-label">Choose Image</label><span class="file-name" id="iconName">No file selected</span></div><small>PNG, JPG, GIF, WebP (max 2 MB). Displayed in now-playing sidebar.</small></div>
      <button type="submit" class="btn btn-primary btn-block">Upload</button></form></div></div>`;
  } else if (page === 'profile') {
    const sList = songs.length ? songs.map(s => songItem(s, `<span>${fmtDate(s.uploaded_at)}</span><form method="POST" action="/song/${s.id}/delete" style="display:inline" onsubmit="return confirm('Delete?')"><button type="submit" class="btn btn-sm btn-danger">Delete</button></form>`, user, albums, playlists)).join('') : '<p class="empty-state">No songs yet.</p>';
    const aList = albums.length ? albums.map(a => `<div class="mini-card"><strong>${escapeHtml(a.title)}</strong> ${a.is_public ? '<span class="genre-tag">Public</span>' : '<span class="genre-tag">Private</span>'}<br><small>${db.prepare('SELECT COUNT(*) AS c FROM album_songs WHERE album_id = ?').get(a.id).c} songs</small>
      <div style="margin-top:6px;display:flex;gap:4px"><form method="POST" action="/album/${a.id}/toggle" style="display:inline"><button class="btn btn-sm">${a.is_public ? 'Unpublish' : 'Publish'}</button></form><form method="POST" action="/album/${a.id}/delete" style="display:inline" onsubmit="return confirm('Delete album?')"><button class="btn btn-sm btn-danger">Del</button></form></div></div>`).join('') : '';
    const pList = playlists.length ? playlists.map(p => `<div class="mini-card"><strong>${escapeHtml(p.title)}</strong> ${p.is_public ? '<span class="genre-tag">Public</span>' : '<span class="genre-tag">Private</span>'}<br><small>${db.prepare('SELECT COUNT(*) AS c FROM playlist_songs WHERE playlist_id = ?').get(p.id).c} songs</small>
      <div style="margin-top:6px;display:flex;gap:4px"><form method="POST" action="/playlist/${p.id}/toggle" style="display:inline"><button class="btn btn-sm">${p.is_public ? 'Unpublish' : 'Publish'}</button></form><form method="POST" action="/playlist/${p.id}/delete" style="display:inline" onsubmit="return confirm('Delete playlist?')"><button class="btn btn-sm btn-danger">Del</button></form></div></div>`).join('') : '';
    const addSongForm = songs.length ? `<form method="POST" action="/album/create" class="inline-form"><input type="text" name="title" placeholder="Album title" required><button class="btn btn-sm btn-primary">Create Album</button></form>
      <form method="POST" action="/playlist/create" class="inline-form"><input type="text" name="title" placeholder="Playlist title" required><button class="btn btn-sm btn-primary">Create Playlist</button></form>` : '';
    
    const avatarUrl = user.avatar ? `/uploads/${user.avatar}` : `data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><circle cx='50' cy='50' r='50' fill='%231db954'/><text x='50' y='65' text-anchor='middle' font-size='50' fill='white'>${user.username[0].toUpperCase()}</text></svg>`;

    content = `<div class="profile-page">
      ${success ? `<div class="alert alert-success">${escapeHtml(success)}</div>` : ''}
      <div class="profile-header"><img src="${escapeHtml(avatarUrl)}" alt="Avatar" class="profile-avatar" style="width:72px;height:72px;border-radius:50%;object-fit:cover"><div><h1>${userBadge(user)}</h1><p>Member since ${fmtDate(user.created_at)} &middot; ${songs.length} songs &middot; ${followerCount || 0} followers &middot; ${followingCount || 0} following</p>${isPremium(user) ? '<span class="badge badge-premium badge-lg">' + config.premium.badge + ' PREMIUM</span>' : ''} ${isVerified(user) ? '<span class="badge badge-verified badge-lg">' + config.verified.badge + ' VERIFIED</span>' : ''}</div></div>
      <div class="section-header"><h2>Your Songs</h2><a href="/upload" class="btn btn-primary">+ Upload</a></div>
      <div class="song-list">${sList}</div>
      <hr style="border-color:var(--border);margin:24px 0">
      <div class="section-header"><h2>Albums</h2>${addSongForm}</div><div class="mini-grid">${aList || '<p class="empty-state">No albums yet.</p>'}</div>
      <hr style="border-color:var(--border);margin:24px 0">
      <div class="section-header"><h2>Playlists</h2></div><div class="mini-grid">${pList || '<p class="empty-state">No playlists yet.</p>'}</div>
    </div>`;
  } else if (page === 'home') {
    const sList = songs.length ? songs.map(s => songItem(s, '', user)).join('') : '<p class="empty-state">No songs found.</p>';
    const hero = !user ? '<a href="/register" class="btn btn-primary btn-lg">Get Started</a>' : '';
    const tList = topSongs.length ? topSongs.map(s => songItem(s, '', user)).join('') : '';
    const fList = feedSongs.length ? feedSongs.map(s => songItem(s, '', user)).join('') : '';
    const hList = historySongs.length ? historySongs.map(s => songItem(s, '', user)).join('') : '';

    const searchFilters = `<div class="search-filters">
      <select name="dur" class="filter-select"><option value="">Any Duration</option><option value="short" ${searchDur === 'short' ? 'selected' : ''}>&lt; 3 min</option><option value="medium" ${searchDur === 'medium' ? 'selected' : ''}>3-7 min</option><option value="long" ${searchDur === 'long' ? 'selected' : ''}>&gt; 7 min</option></select>
      <input type="text" name="uploader" placeholder="Uploader" value="${escapeHtml(searchUploader)}" class="filter-input">
      <input type="date" name="date_from" value="${searchDateFrom}" class="filter-input" style="max-width:150px">
      <input type="date" name="date_to" value="${searchDateTo}" class="filter-input" style="max-width:150px">
    </div>`;

    content = `${!user ? `<div class="hero"><h1>Welcome to Nexorava</h1><p>Your music. Your platform.</p>${hero}</div>` : ''}
      ${searchQuery ? `<div class="section-header"><h2>Results for "${escapeHtml(searchQuery)}"</h2></div>` : ''}
      ${historySongs.length ? `<div class="section-header"><h2>Recently Played</h2></div><div class="song-list">${hList}</div><hr style="border-color:var(--border);margin:20px 0">` : ''}
      ${tList && !searchQuery ? `<div class="section-header"><h2>Top Charts</h2></div><div class="song-list">${tList}</div><hr style="border-color:var(--border);margin:20px 0">` : ''}
      ${fList && !searchQuery ? `<div class="section-header"><h2>From Your Feed</h2></div><div class="song-list">${fList}</div><hr style="border-color:var(--border);margin:20px 0">` : ''}
      ${searchQuery ? `<div class="section-header"><h2>${searchQuery ? 'All Results' : 'All Songs'}</h2>
        <form action="/search" method="GET" class="filter-form"><input type="hidden" name="q" value="${escapeHtml(searchQuery)}"><select name="genre" class="filter-select" onchange="this.form.submit()"><option value="">All Genres</option>${genreFilter}</select>${searchFilters}<button type="submit" class="btn btn-sm btn-primary">Filter</button></form></div>` : ''}
      ${!searchQuery ? `<div class="section-header"><h2>Latest Songs</h2>
        <form action="/" method="GET" class="genre-filter-form"><select name="genre" onchange="navigate('/?genre='+this.value)" class="filter-select"><option value="">All Genres</option>${genreFilter}</select></form></div>` : ''}
      <div class="song-list">${sList}</div>`;
  } else if (page === 'likes') {
    const sList = songs.length ? songs.map(s => songItem(s, '', user)).join('') : '<p class="empty-state">No liked songs yet. Click the ♡ button on songs to add them.</p>';
    content = `<h1>Liked Songs</h1><p style="color:var(--text2);margin-bottom:20px">${songs.length} songs</p><div class="song-list">${sList}</div>`;
  } else if (page === 'artist') {
    const sList = songs.length ? songs.map(s => songItem(s, '', user)).join('') : '<p class="empty-state">No songs uploaded yet.</p>';
    const isOwner = user && user.id == artist.id;
    const avatarUrl = artist.avatar ? `/uploads/${artist.avatar}` : `data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><circle cx='50' cy='50' r='50' fill='%231db954'/><text x='50' y='65' text-anchor='middle' font-size='50' fill='white'>${artist.username[0].toUpperCase()}</text></svg>`;
     content = `<div class="profile-page">
      <div class="profile-header"><img src="${escapeHtml(avatarUrl)}" alt="Avatar" style="width:72px;height:72px;border-radius:50%;object-fit:cover"><div><h1>${userBadge(artist)}</h1><p>Member since ${fmtDate(artist.created_at)} &middot; ${songs.length} songs &middot; ${followerCount} followers <span class="artist-id-tooltip" data-artist-id="${artist.id}">ℹ️</span></p>
      ${!isOwner && user ? `<button class="btn btn-sm follow-btn" data-id="${artist.id}" data-following="${following}">${following ? 'Unfollow' : 'Follow'}</button>` : ''}
      </div></div>
      <div class="section-header"><h2>Songs by ${escapeHtml(artist.username)}</h2></div>
      <div class="song-list">${sList}</div>
    </div>`;
  } else if (page === 'albums') {
    const aList = albums.length ? albums.map(a => `<a href="/album/${a.id}" class="mini-card" style="text-decoration:none;color:inherit"><strong>${escapeHtml(a.title)}</strong><br><small>${escapeHtml(a.owner_name)} &middot; ${a.song_count} songs</small></a>`).join('') : '<p class="empty-state">No public albums yet.</p>';
    content = `<h1>Public Albums</h1><div class="mini-grid">${aList}</div>`;
  } else if (page === 'album-detail') {
    const sList = songs.length ? songs.map(s => songItem(s, `<span>Track ${s.track_number}</span>`, user)).join('') : '<p class="empty-state">No songs in this album.</p>';
    content = `<h1>${escapeHtml(album.title)}</h1><p style="color:var(--text2)">by <a href="/artist/${escapeHtml(album.owner_name)}" class="artist-link">${escapeHtml(album.owner_name)}</a>${album.genre ? ' &middot; ' + escapeHtml(album.genre) : ''}${album.description ? ' &middot; ' + escapeHtml(album.description) : ''}</p><div class="song-list">${sList}</div>`;
  } else if (page === 'playlists') {
    const pList = playlists.length ? playlists.map(p => `<a href="/playlist/${p.id}" class="mini-card" style="text-decoration:none;color:inherit"><strong>${escapeHtml(p.title)}</strong><br><small>${escapeHtml(p.owner_name)} &middot; ${p.song_count} songs</small></a>`).join('') : '<p class="empty-state">No public playlists yet.</p>';
    content = `<h1>Public Playlists</h1><div class="mini-grid">${pList}</div>`;
  } else if (page === 'playlist-detail') {
    const sList = songs.length ? songs.map(s => songItem(s, '', user)).join('') : '<p class="empty-state">No songs in this playlist.</p>';
    let coverImg = '';
    if (playlist.cover_art) coverImg = `<img src="/uploads/${playlist.cover_art}" class="playlist-cover" alt="Cover">`;
    content = `<div class="playlist-header">${coverImg}<div><h1>${escapeHtml(playlist.title)}</h1><p style="color:var(--text2)">by <a href="/artist/${escapeHtml(playlist.owner_name)}" class="artist-link">${escapeHtml(playlist.owner_name)}</a>${playlist.description ? ' &middot; ' + escapeHtml(playlist.description) : ''}</p></div></div><div class="song-list">${sList}</div>`;
  } else if (page === 'contact') {
    const successMsg = success ? '<div class="alert alert-success">Message sent! We\'ll get back to you at ' + escapeHtml(data.email || '') + ' soon.</div>' : '';
    content = `<div class="legal-page"><h1>Contact Us</h1>${successMsg}<p>Have a question or need help? Reach out to us via email or use the form below.</p>
      <div class="upload-card">
        <div style="margin-bottom:20px;padding:16px;background:var(--bg2);border-radius:var(--radius);border:1px solid var(--border)">
          <strong>Email:</strong> <a href="mailto:Nexorava@proton.me">Nexorava@proton.me</a>
        </div>
        <form method="POST"><div class="form-group"><label>Full Name *</label><input type="text" name="name" required></div>
        <div class="form-group"><label>Email *</label><input type="email" name="email" required></div>
        <div class="form-group"><label>Subject *</label><input type="text" name="subject" required></div>
        <div class="form-group"><label>Message *</label><textarea name="message" rows="5" required placeholder="Your message..."></textarea></div>
        <button type="submit" class="btn btn-primary btn-block">Send Message</button></form>
      </div></div>`;
  } else if (page === 'bug-report') {
    const successMsg = success ? '<div class="alert alert-success">Bug report sent! Thank you for helping us improve Nexorava.</div>' : '';
    content = `<div class="legal-page"><h1>Report a Bug</h1>${successMsg}<p>Found a problem? Let us know and we\'ll fix it ASAP!</p>
      <div class="upload-card">
        <div style="margin-bottom:20px;padding:16px;background:var(--bg2);border-radius:var(--radius);border:1px solid var(--border)">
          <strong>Email:</strong> <a href="mailto:Nexorava@proton.me">Nexorava@proton.me</a>
        </div>
        <form method="POST"><div class="form-group"><label>Full Name *</label><input type="text" name="name" required></div>
        <div class="form-group"><label>Email *</label><input type="email" name="email" required></div>
        <div class="form-group"><label>Issue Title *</label><input type="text" name="subject" required></div>
        <div class="form-group"><label>Describe the Bug *</label><textarea name="description" rows="5" required placeholder="What went wrong? Steps to reproduce?"></textarea></div>
        <button type="submit" class="btn btn-primary btn-block">Report Bug</button></form>
      </div></div>`;
  } else if (page === 'copyright') {
    const songsOpts = db.prepare('SELECT id, title, artist FROM songs ORDER BY title').all();
    const successMsg = success ? '<div class="alert alert-success">Report submitted. We will review the case.</div>' : '';
    content = `<div class="legal-page"><h1>Report Copyright Violation</h1>${successMsg}<p>If you believe a song infringes your copyright, submit a report. It will enter the review queue.</p>
      <div class="upload-card"><form method="POST"><div class="form-group"><label>Affected Song *</label><select name="song_id" required><option value="">-- Select --</option>${songsOpts.map(s => `<option value="${s.id}" ${String(s.id) === copyrightSongId ? 'selected' : ''}>${escapeHtml(s.title)} - ${escapeHtml(s.artist)}</option>`).join('')}</select></div>
      <div class="form-group"><label>Your Full Name *</label><input type="text" name="claimant_name" required></div><div class="form-group"><label>Your Email *</label><input type="email" name="claimant_email" required></div>
      <div class="form-group"><label>Reason *</label><textarea name="reason" rows="4" required placeholder="Describe..."></textarea></div><button type="submit" class="btn btn-primary btn-block">Submit Report</button></form></div></div>`;
  } else if (page === 'review-queue') {
    const rList = reviews.length ? reviews.map(r => `<div class="review-card"><strong>Review #${r.id}</strong> &middot; ${escapeHtml(r.target_type)} #${r.target_id}${r.song_title ? ' &middot; ' + escapeHtml(r.song_title) : ''} &middot; reported by ${escapeHtml(r.reporter_name || 'anonymous')}<br><small>${escapeHtml(r.reason)}</small>
      <form method="POST" action="/review/${r.id}/action" style="display:flex;gap:4px;margin-top:6px"><input type="text" name="notes" placeholder="Notes"><button name="action" value="approve" class="btn btn-sm" style="background:var(--accent);color:#000">Approve & Takedown</button><button name="action" value="reject" class="btn btn-sm btn-danger">Reject</button></form></div>`).join('') : '<p class="empty-state">No pending reviews.</p>';
    const sList = strikesList.length ? strikesList.map(s => `<div class="review-card"><strong>Strike</strong> &middot; ${escapeHtml(s.user_name)} &middot; by ${escapeHtml(s.issuer_name)}<br><small>${escapeHtml(s.reason)} &middot; ${fmtDate(s.created_at)}</small></div>`).join('') : '<p class="empty-state">No strikes.</p>';
    content = `<h1>Review Queue</h1><div class="section-header"><h2>Pending Reviews</h2></div>${rList}<hr style="border-color:var(--border);margin:24px 0"><div class="section-header"><h2>Recent Strikes</h2></div><div style="display:flex;flex-direction:column;gap:6px">${sList}</div>`;
  } else if (page === 'share') {
    const protocol = (req && req.protocol) || 'https';
    const host = (req && req.get && req.get('host')) || 'localhost:3000';
    content = `<div class="legal-page"><h1>${escapeHtml(song.title)}</h1><p style="color:var(--text2)">by ${escapeHtml(song.artist)} &middot; uploaded by ${escapeHtml(song.uploader_name)}</p><p>Share this link: <code style="background:var(--bg3);padding:4px 8px;border-radius:4px">${protocol}://${host}/share/song/${song.id}</code></p><div class="upload-card"><div class="song-item" data-id="${song.id}" data-title="${escapeHtml(song.title)}" data-artist="${escapeHtml(song.artist)}" data-file="/uploads/${song.filename}" data-duration="${song.duration || 0}"><div class="song-play-btn">▶</div><div class="song-info"><strong>${escapeHtml(song.title)}</strong><span>${escapeHtml(s.artist)}</span></div></div></div></div>`;
  } else if (page === 'settings') {
    const allowed = getAllowedQualities(user);
    const qualityHtml = Object.keys(config.streaming).filter(k => allowed.includes(k)).map(k =>
      `<label class="quality-option ${user.stream_quality === k ? 'selected' : ''}"><input type="radio" name="stream_quality" value="${k}" ${user.stream_quality === k ? 'checked' : ''} onchange="saveSetting('stream_quality', '${k}')"><div class="quality-info"><strong>${config.streaming[k].label}</strong></div></label>`).join('');
    const themeHtml = Object.keys(config.themes).map(k =>
      `<label class="quality-option ${user.theme === k ? 'selected' : ''}"><input type="radio" name="theme" value="${k}" ${user.theme === k ? 'checked' : ''} onchange="saveSetting('theme', '${k}')"><div class="quality-info"><strong>${config.themes[k].label}</strong></div></label>`).join('');
    const avatarUrl = user.avatar ? `/uploads/${user.avatar}` : `data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><circle cx='50' cy='50' r='50' fill='%231db954'/><text x='50' y='65' text-anchor='middle' font-size='50' fill='white'>${user.username[0].toUpperCase()}</text></svg>`;
    content = `<div class="auth-page"><div class="auth-card"><h1>Settings</h1>
      <h2>Profile Avatar</h2><p class="form-hint">Upload a custom profile picture.</p>
      <div class="avatar-settings">
        <div class="avatar-preview" id="avatarPreview" style="width:120px;height:120px;border-radius:50%;margin:12px 0;background:var(--bg2);overflow:hidden;border:2px solid var(--border)">
          <img src="${escapeHtml(avatarUrl)}" alt="Avatar" style="width:100%;height:100%;object-fit:cover">
        </div>
        <div class="file-input-area">
          <input type="file" id="avatarFile" accept="image/*" style="display:none">
          <label for="avatarFile" class="file-label">Choose Avatar</label>
          <span class="file-name" id="avatarName">PNG, JPG, GIF, WebP (max 2 MB)</span>
        </div>
      </div>
      <hr style="border-color:var(--border);margin:24px 0">
      <h2>Streaming Quality</h2><p class="form-hint">Higher quality uses more bandwidth.</p><div class="quality-selector">${qualityHtml}</div>
      <h2>Theme</h2><p class="form-hint">Instant apply.</p><div class="quality-selector">${themeHtml}</div>
      <hr style="border-color:var(--border);margin:24px 0">
      ${!isPremium(user) ? `<div class="premium-upsell"><h3>${config.premium.badge} Premium</h3><p>Unlock High Quality streaming.</p></div>` : `<div class="premium-badge"><h3>${config.premium.badge} PREMIUM</h3><p>You have access to all quality levels.</p></div>`}
      ${isVerified(user) ? `<div class="premium-badge" style="border-color:rgba(0,200,100,0.4);background:rgba(0,200,100,0.08)"><h3 style="color:#00c864">${config.verified.badge} VERIFIED</h3></div>` : ''}
      <hr style="border-color:var(--border);margin:24px 0">
      <h2>Change Password</h2><form id="passwordForm"><div class="form-group"><label>Current Password</label><input type="password" id="old_password" required></div><div class="form-group"><label>New Password</label><input type="password" id="new_password" minlength="6" required></div><div class="form-group"><label>Confirm New Password</label><input type="password" id="new_password_confirm" required></div><button type="submit" class="btn btn-primary btn-block">Change Password</button></form>
      <hr style="border-color:var(--border);margin:24px 0">
      <h2 style="color:var(--danger)">Delete Account</h2><p style="color:var(--text2);font-size:0.9rem;margin-bottom:12px">This cannot be undone.</p><form method="POST" action="/account/delete" onsubmit="return confirm('Permanently delete your account?')"><button type="submit" class="btn btn-danger btn-block">Delete Account</button></form></div></div>`;
  } else if (page === 'tos') { content = `<div class="legal-page">${tosContent()}</div>`; }
  else if (page === 'privacy') { content = `<div class="legal-page">${privacyContent()}</div>`; }
  else if (page === 'upload-rules') { content = `<div class="legal-page">${uploadRulesContent()}</div>`; }

  return content;
}

function renderPage(page, data) {
  const user = data.user || null;
  const content = renderContent(page, data, data.__req || null);

  const userMenu = user
    ? `<div class="dropdown">
        <button class="dropdown-trigger user-btn" onclick="event.stopPropagation();this.parentElement.classList.toggle('open')">${userBadge(user)} <span class="dropdown-arrow">▾</span></button>
        <div class="dropdown-menu">
          <a href="/profile">Profile</a>
          <a href="/likes">Liked Songs</a>
          <a href="/settings">Settings</a>
          <a href="/review-queue">Review Queue</a>
          <hr>
          <a href="/logout">Logout</a>
        </div>
       </div>`
    : `<div class="user-menu"><a href="/login" class="btn btn-sm">Login</a><a href="/register" class="btn btn-sm btn-primary">Register</a></div>`;

  const themeKey = user ? user.theme : 'dark';
  const t = getThemeConfig(themeKey);
  const themeVars = Object.keys(t).filter(k => k !== 'label').map(k => `  --${k}: ${t[k]};`).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Nexorava</title>
<style id="themeStyle">:root{${themeVars}--accent:#1db954;--accent2:#169c46;--danger:#e74c3c;--radius:8px;--radius-sm:4px;}</style>
<link rel="stylesheet" href="/css/style.css">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🎵</text></svg>"></head>
<body data-theme="${escapeHtml(themeKey)}">
<nav class="navbar"><div class="nav-inner"><a href="/" class="nav-brand" onclick="return navigate(event)">Nexorava</a><div class="nav-center">
<form action="/search" method="GET" class="search-form" onsubmit="return navigateSubmit(event)"><input type="text" name="q" placeholder="Search..." value=""><button type="submit">🔍</button></form></div>
   ${userMenu}</div></nav>
<main id="mainContent">${user ? `<div class="layout-with-sidebar"><aside class="sidebar-playlists"><h3>My Playlists</h3><div class="sidebar-playlists-list" id="playlistsSidebar"></div><button class="sidebar-playlist-create" onclick="togglePlaylistForm()">+ New</button></aside><div class="container">${content}</div></div>` : `<div class="container">${content}</div>`}</main>

<div class="player-bar" id="playerBar" style="display:none">
  <div class="player-inner">
    <div class="player-info"><strong id="playerTitle">Title</strong><span id="playerArtist">Artist</span></div>
    <div class="player-controls"><button id="shuffleBtn" class="ctrl-btn" title="Shuffle">🔀</button><button id="prevBtn" class="ctrl-btn">⏮</button><button id="playBtn" class="ctrl-btn ctrl-play">▶</button><button id="nextBtn" class="ctrl-btn">⏭</button></div>
    <div class="player-progress"><span id="currentTime">0:00</span><input type="range" id="progressBar" value="0" max="100"><span id="totalTime">0:00</span></div>
    <div class="player-volume"><span>🔊</span><input type="range" id="volumeBar" min="0" max="1" step="0.05" value="0.7"></div>
    <div class="player-quality">${isPremium(user) ? '<span class="premium-dot">⭐</span>' : ''}<select id="qualitySelect">${Object.keys(config.streaming).filter(k => (user ? getAllowedQualities(user) : config.free.allowed_qualities).includes(k)).map(k => `<option value="${k}" ${(user ? user.stream_quality : 'standard') === k ? 'selected' : ''}>${config.streaming[k].label}</option>`).join('')}</select></div>
  </div>
</div>

<div id="nowPlayingSidebar" class="now-playing-sidebar" style="display:none">
  <div class="sidebar-card">
    <div class="sidebar-icon-wrap" id="sidebarIcon"><div class="sidebar-icon-placeholder">🎵</div></div>
    <div class="sidebar-body">
      <div class="sidebar-title" id="sidebarTitle">Title</div>
      <div class="sidebar-artist" id="sidebarArtist">Artist</div>
      <div class="sidebar-actions">
        <button id="shareBtn" class="sidebar-btn" title="Share">🔗</button>
        <button id="reportBtn" class="sidebar-btn" title="Report Copyright">⚖️</button>
      </div>
    </div>
  </div>
</div>

<footer class="footer"><div class="footer-inner"><span>&copy; ${new Date().getFullYear()} Nexorava</span><div class="footer-links"><a href="/tos" onclick="return navigate(event)">Terms of Service</a><a href="/privacy" onclick="return navigate(event)">Privacy Policy</a><a href="/upload-rules" onclick="return navigate(event)">Upload Guidelines</a><a href="/contact" onclick="return navigate(event)">Contact Us</a><a href="/bug-report" onclick="return navigate(event)">Report Bug</a><a href="/copyright" onclick="return navigate(event)">Report Copyright</a></div></div></footer>
<script src="/js/player.js"></script>
<script>
let navCache = {};

async function navigate(event, url) {
  const href = url || (event && event.currentTarget ? event.currentTarget.getAttribute('href') : (typeof event === 'string' ? event : null));
  if (!href || href.startsWith('http') || href.startsWith('//')) return true;
  if (event && event.preventDefault) event.preventDefault();
  await loadPage(href);
  return false;
}

async function navigateSubmit(event) {
  event.preventDefault();
  const form = event.target;
  const url = form.action + '?' + new URLSearchParams(new FormData(form)).toString();
  await loadPage(url);
  return false;
}

async function loadPage(url) {
  const sep = url.includes('?') ? '&' : '?';
  try {
    const r = await fetch(url + sep + 'partial=1');
    const data = await r.json();
    document.getElementById('mainContent').innerHTML = data.content;
    document.title = data.title;
    window.history.pushState({ url }, '', url);
    reinitPage();
  } catch (e) {
    window.location.href = url;
  }
}

function reinitPage() {
  document.querySelectorAll('.genre-filter-form select').forEach(el => {
    el.addEventListener('change', function() { this.form.submit(); });
  });
  document.getElementById('audioFile')?.addEventListener('change', function(){ document.getElementById('fileName').textContent = this.files[0] ? this.files[0].name : 'No file selected'; });
  document.getElementById('iconFile')?.addEventListener('change', function(){ document.getElementById('iconName').textContent = this.files[0] ? this.files[0].name : 'No file selected'; });
  document.getElementById('passwordForm')?.addEventListener('submit', passwordHandler);
  window.buildPlaylist?.();
  window.updateSidebarFromActive?.();
  setTimeout(() => {
    document.querySelectorAll('.like-btn').forEach(btn => {
      const id = btn.dataset.id;
      fetch('/api/likes/count/' + id).then(r => r.json()).then(d => {
        const liked = btn.classList.contains('liked');
        btn.textContent = liked ? '♥ ' + d.count : '♡ ' + d.count;
      }).catch(() => {});
    });
  }, 100);
}

let passwordHandler = async function(e) {
  e.preventDefault();
  const fd = new URLSearchParams();
  fd.set('old_password', document.getElementById('old_password').value);
  fd.set('new_password', document.getElementById('new_password').value);
  fd.set('new_password_confirm', document.getElementById('new_password_confirm').value);
  const r = await fetch('/settings/password', { method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'}, body:fd });
  const d = await r.json();
  if (d.error) alert(d.error); else { alert('Password changed!'); this.reset(); }
};

window.addEventListener('popstate', async (e) => {
  if (e.state && e.state.url) {
    const sep = e.state.url.includes('?') ? '&' : '?';
    try {
      const r = await fetch(e.state.url + sep + 'partial=1');
      const data = await r.json();
      document.getElementById('mainContent').innerHTML = data.content;
      document.title = data.title;
      reinitPage();
    } catch (ex) {
      window.location.href = e.state.url;
    }
  }
});

document.addEventListener('click', (e) => {
  if (!e.target.closest('.dropdown')) {
    document.querySelectorAll('.dropdown.open').forEach(d => d.classList.remove('open'));
  }
});

async function saveSetting(key, value) {
  const fd = new URLSearchParams();
  fd.set(key, value);
  await fetch('/settings', { method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded','Accept':'application/json'}, body:fd });
  if (key === 'theme') {
    const r = await fetch('/api/theme?name=' + value);
    const vars = await r.text();
    const s = document.getElementById('themeStyle');
    if (s) s.textContent = ':root{' + vars + '}';
    document.body.dataset.theme = value;
  }
}

document.querySelectorAll('.quality-selector').forEach(selector => {
   selector.addEventListener('click', (e) => {
    const radio = e.target.closest('.quality-option')?.querySelector('input[type="radio"]');
    if (radio) {
      radio.closest('.quality-selector').querySelectorAll('.quality-option').forEach(opt => opt.classList.remove('selected'));
      radio.closest('.quality-option').classList.add('selected');
    }
  });
});

const avatarFileInput = document.getElementById('avatarFile');
  if (avatarFileInput) {
    avatarFileInput.addEventListener('change', async function(e) {
      if (!this.files[0]) return;
      const fileName = this.files[0].name;
      document.getElementById('avatarName').textContent = fileName;
      const fd = new FormData();
      fd.append('avatar', this.files[0]);
      try {
        const r = await fetch('/avatar/upload', { method:'POST', body:fd });
        const data = await r.json();
        if (data.ok && document.getElementById('avatarPreview')) {
          const reader = new FileReader();
          reader.onload = (e) => {
            const img = document.getElementById('avatarPreview').querySelector('img');
            if (img) img.src = e.target.result;
          };
          reader.readAsDataURL(this.files[0]);
          alert('Avatar updated successfully!');
        } else if (data.error) {
          alert('Error: ' + data.error);
        } else {
          alert('Error updating avatar. Please try again.');
        }
      } catch (ex) {
        console.error(ex);
        alert('Network error. Please check your connection.');
      }
    });
}

document.querySelectorAll('.genre-filter-form select').forEach(el => {
  el.addEventListener('change', function() {
    if (window.navigate) {
      const url = this.form.action + '?' + new URLSearchParams(new FormData(this.form)).toString();
      window.loadPage(url);
    } else {
      this.form.submit();
    }
  });
});

async function loadPlaylistsSidebar() {
  const sidebar = document.getElementById('playlistsSidebar');
  if (!sidebar) return;
  try {
    const r = await fetch('/api/user-playlists');
    const playlists = await r.json();
    sidebar.innerHTML = playlists.map(p => \`<div class="sidebar-playlist-item" onclick="loadPlaylist(\${p.id})">\${escapeHtmlJS(p.title)}</div>\`).join('');
  } catch (e) { console.error(e); }
}

function escapeHtmlJS(text) {
  const map = {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'};
  return text ? text.replace(/[&<>"']/g, c => map[c]) : '';
}

function togglePlaylistForm() {
  alert('Create New Playlist');
}

function loadPlaylist(id) {
  window.loadPage('/playlist/' + id);
}

loadPlaylistsSidebar();

let previewAudio = null;

async function addToAlbum(songId, albumId) {
  try {
    const response = await fetch('/album/' + albumId + '/add-song', {
      method: 'POST',
      headers: {'Content-Type': 'application/x-www-form-urlencoded'},
      body: 'song_id=' + songId
    });
    if (response.ok) {
      alert('Song added to album!');
      window.location.reload();
    } else {
      alert('Failed to add song to album');
    }
  } catch (error) {
    console.error('Error adding to album:', error);
    alert('Error adding song to album');
  }
}

async function addToPlaylist(songId, playlistId) {
  try {
    const response = await fetch('/playlist/' + playlistId + '/add-song', {
      method: 'POST',
      headers: {'Content-Type': 'application/x-www-form-urlencoded'},
      body: 'song_id=' + songId
    });
    if (response.ok) {
      alert('Song added to playlist!');
      window.location.reload();
    } else {
      alert('Failed to add song to playlist');
    }
  } catch (error) {
    console.error('Error adding to playlist:', error);
    alert('Error adding song to playlist');
  }
}

function playPreview(event, id, file, title, artist) {
  event.stopPropagation();
  if (previewAudio) previewAudio.pause();
  if (window.audio) window.audio.pause();
  previewAudio = new Audio(file + '?q=standard');
  previewAudio.play().catch(() => {});
  setTimeout(() => { if (previewAudio) previewAudio.pause(); }, 30000);
}

function playSongFull(event, id, title, artist, file, genre) {
  event.stopPropagation();
  if (previewAudio) previewAudio.pause();
  if (window.playSong) window.playSong(id, title, artist, file, genre);
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('.song-play-btn-preview')) return;
});
</script>
</body></html>`;
}

function tosContent() { return `<h1>Terms of Service</h1><p><strong>May 2026</strong></p>
<h2>1. Scope</h2><p>These terms govern the use of Nexorava. By using the platform you agree to these terms.</p>
<h2>2. Service</h2><p>Nexorava provides infrastructure for users to upload and share audio files.</p>
<h2>3. User Account</h2><p>Registration required. You are responsible for your credentials. Minimum age: 16 (or 13 with parental consent).</p>
<h2>4. Content Rights</h2><p><strong>You retain all rights to your content.</strong> You grant Nexorava a non-exclusive license to store and stream your content. You warrant that you own all necessary rights.</p>
<h2>5. Prohibited Content</h2><p>Copyrighted music without permission, hate speech, illegal content, malware, and offensive material are prohibited.</p>
<h2>6. Copyright Takedown</h2><p>Rights holders can report violations via our <a href="/copyright">copyright form</a>. Content will be reviewed and potentially removed. Repeat infringers may receive strikes and be banned.</p>
<h2>7. Liability</h2><p>Nexorava is not liable for user-uploaded content. We respond to valid takedown notices.</p>
<h2>8. Termination</h2><p>We may suspend or ban users for violations. After 3 strikes, accounts are automatically banned.</p>`; }

function privacyContent() { return `<h1>Privacy Policy</h1><p><strong>May 2026</strong></p>
<h2>1. Data Collected</h2><p>Username, email, uploaded files, play counts, IP address (server logs).</p>
<h2>2. Purpose</h2><p>Platform operation, streaming, copyright enforcement.</p>
<h2>3. Storage</h2><p>Data is retained until account deletion. Logs deleted after 30 days.</p>
<h2>4. Your Rights</h2><p>Access, correction, deletion, portability under GDPR (Articles 15-21). Contact us via email.</p>
<h2>5. Cookies</h2><p>Only session cookies for login.</p>`; }

function uploadRulesContent() { return `<h1>Upload Guidelines</h1><p><strong>May 2026</strong></p>
<p>You may only upload music you own or have rights to. No copyrighted music without permission. No illegal samples. Allowed formats: MP3, WAV, FLAC, OGG, AAC, M4A. Max 50 MB per file. Violations result in content removal, strikes, and potential account banning.</p>`; }

function escapeHtml(t) { if (!t) return ''; return String(t).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;'); }

app.get('/tos', (req, res) => { const u = getSessionUser(req); res.send(renderPage('tos', { user: u })); });
app.get('/privacy', (req, res) => { const u = getSessionUser(req); res.send(renderPage('privacy', { user: u })); });
app.get('/upload-rules', (req, res) => { const u = getSessionUser(req); res.send(renderPage('upload-rules', { user: u })); });

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) return res.status(413).send(renderPage('upload', { user: getSessionUser(req), error: err.code === 'LIMIT_FILE_SIZE' ? 'File too large' : err.message }));
  if (err.message) return res.status(400).send(renderPage('upload', { user: getSessionUser(req), error: err.message }));
  console.error(err); res.status(500).send('Error');
});

app.listen(PORT, '0.0.0.0', () => { console.log('Nexorava on http://0.0.0.0:' + PORT); });