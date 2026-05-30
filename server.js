const express = require('express');
const session = require('express-session');
const multer = require('multer');
const path = require('path');
const bcrypt = require('bcrypt');
const fs = require('fs');
const mm = require('music-metadata');
const ffmpeg = require('fluent-ffmpeg');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const dotenv = require('dotenv');
dotenv.config();
const db = require('./database');
const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf-8'));

const FFMPEG_PATH = '/mnt/c/Users/User/AppData/Local/Packages/PythonSoftwareFoundation.Python.3.11_qbz5n2kfra8p0/LocalCache/local-packages/Python311/Scripts/ffmpeg.exe';
ffmpeg.setFfmpegPath(FFMPEG_PATH);

const app = express();
const PORT = process.env.PORT || 3000;

// ---- EJS Setup ----
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
const helpers = require('./views/helpers')(db, config);
const { escapeHtml, fmtDur, fmtDate, isPremium, isVerified, isAdmin, userBadge, adminBadge, userBadgeFull, getUploaderBadges, isLiked, songItem, getAllowedQualities, GENRES } = helpers;

app.locals.escapeHtml = escapeHtml;
app.locals.fmtDur = fmtDur;
app.locals.fmtDate = fmtDate;
app.locals.isPremium = isPremium;
app.locals.isVerified = isVerified;
app.locals.isAdmin = isAdmin;
app.locals.userBadge = userBadge;
app.locals.adminBadge = adminBadge;
app.locals.userBadgeFull = userBadgeFull;
app.locals.getUploaderBadges = getUploaderBadges;
app.locals.isLiked = isLiked;
app.locals.songItem = songItem;
app.locals.getAllowedQualities = getAllowedQualities;
app.locals.GENRES = GENRES;
app.locals.config = config;
app.locals.db = db;
app.locals.helpers = helpers;

// ---- Security Middleware ----
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(cookieParser());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: { error: 'Too many requests' }
});
app.use('/api/', limiter);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Too many login attempts' }
});

app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(express.json({ limit: '1mb' }));

// CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Accept, Authorization');
  res.header('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.header('Pragma', 'no-cache');
  res.header('Expires', '0');
  res.header('Surrogate-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  next();
});

app.use(session({
  secret: process.env.SESSION_SECRET || 'nexorava-session-secret-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000, httpOnly: true, sameSite: 'lax' }
}));

// CSRF token generation
app.use((req, res, next) => {
  if (!req.session.csrfToken) {
    req.session.csrfToken = require('crypto').randomBytes(32).toString('hex');
  }
  res.locals.csrfToken = req.session.csrfToken;
  next();
});

// CSRF validation middleware (skip GET/HEAD/OPTIONS/multipart)
app.use((req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  // Skip multipart forms - token validated inside route handler after multer parses body
  if (req.headers['content-type']?.startsWith('multipart/form-data')) return next();
  const token = req.body?._csrf || req.headers['x-csrf-token'];
  if (!token || token !== req.session.csrfToken) {
    return res.status(403).json({ error: 'Invalid CSRF token' });
  }
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

// ---- File Upload Setup ----
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, 'public', 'uploads')),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});

// Virus scan placeholder - in production, integrate ClamAV or similar
function virusScanCheck(fp, cb) {
  // Placeholder: always passes. Replace with actual virus scanning.
  // Example: require('clamav.js').createReadStream(fp).then(...)
  cb(null, true);
}

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const extMatch = file.originalname.match(/\.(mp3|wav|flac|ogg|aac|m4a|png|jpg|jpeg|gif|webp)$/i);
    if (!extMatch) return cb(new Error('Only audio/image files allowed'));
    cb(null, true);
  }
});
const iconUpload = multer({ storage, limits: { fileSize: 2 * 1024 * 1024 }, fileFilter: (req, file, cb) => {
  if (file.originalname.match(/\.(png|jpg|jpeg|gif|webp)$/i)) return cb(null, true);
  cb(new Error('Only image files for icon'));
}});

// ---- Brute Force Protection ----
function checkBruteForce(username, ip) {
  const windowStart = new Date(Date.now() - config.security.brute_force_window_minutes * 60 * 1000).toISOString();
  const attempts = db.prepare('SELECT COUNT(*) AS c FROM login_attempts WHERE username = ? AND ip = ? AND attempted_at > ?').get(username, ip, windowStart).c;
  return attempts >= config.security.login_attempts_before_lockout;
}

function logLoginAttempt(username, ip) {
  db.prepare('INSERT INTO login_attempts (username, ip) VALUES (?, ?)').run(username, ip);
}

// ---- Helper Functions ----
function requireAuth(req, res, next) {
  if (!req.session.userId) {
    if (req.xhr || req.headers.accept?.includes('json')) return res.status(401).json({ error: 'Not authenticated' });
    return res.redirect('/login');
  }
  next();
}

function requireAdmin(req, res, next) {
  const user = getSessionUser(req);
  if (!user || !isAdmin(user)) {
    if (req.xhr || req.headers.accept?.includes('json')) return res.status(403).json({ error: 'Admin access required' });
    return res.redirect('/');
  }
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
    strikes: u.strikes || 0,
    email_verified: u.email_verified || 0,
    is_guest: u.is_guest || 0
  };
}

function isFollowing(followerId, followedId) {
  if (!followerId) return false;
  return !!db.prepare('SELECT id FROM follows WHERE follower_id = ? AND followed_id = ?').get(followerId, followedId);
}

// ---- Send Page Helper ----
function sendPage(req, res, page, data) {
  const user = data.user || null;
  const title = data.title || 'Nexorava';
  const themeKey = user ? user.theme : 'dark';
  const streamQuality = user ? user.stream_quality : 'standard';
  
  // Add common data with defaults
  data.error = data.error || null;
  data.success = data.success || null;
  data.config = config;
  data.db = db;
  data.helpers = helpers;
  data.csrfToken = req.session.csrfToken || '';
  
  app.render('pages/' + page, data, (err, content) => {
    if (err) { console.error('Render error:', err); return res.status(500).send('Error rendering page'); }
    
    if (req.query.partial === '1') {
      return res.json({ content, title });
    }
    
    res.render('layout', {
      body: content,
      user,
      title,
      themeKey,
      config,
      userBadge: user ? userBadge(user) : '',
      escapeHtml,
      isPremium,
      getAllowedQualities,
      streamQuality,
      helpers
    });
  });
}

function sendError(req, res, error) {
  res.status(400).send(escapeHtml(error));
}

// Validate CSRF inside multer route handlers (called after multer populates req.body)
function validateMultipartCsrf(req, res) {
  const token = req.body?._csrf || req.headers['x-csrf-token'];
  if (!token || token !== req.session.csrfToken) {
    res.status(403).json({ error: 'Invalid CSRF token' });
    return false;
  }
  return true;
}

// ---- AUTH ROUTES ----
app.get('/login', (req, res) => {
  if (req.session.userId) return res.redirect('/');
  sendPage(req, res, 'login', { user: null, title: 'Login - Nexorava' });
});

app.post('/login', authLimiter, (req, res) => {
  const { username, password } = req.body;
  const ip = req.ip || req.connection.remoteAddress;
  
  // Brute force check
  if (username && checkBruteForce(username, ip)) {
    return sendPage(req, res, 'login', { user: null, title: 'Login - Nexorava', error: 'Too many login attempts. Please try again in ' + config.security.login_lockout_minutes + ' minutes.' });
  }
  
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    if (username) logLoginAttempt(username, ip);
    return sendPage(req, res, 'login', { user: null, title: 'Login - Nexorava', error: 'Invalid username or password' });
  }
  req.session.userId = user.id;
  res.redirect('/');
});

// Guest login
app.post('/login/guest', (req, res) => {
  // Generate unique guest username
  const guestName = 'Guest-' + Math.random().toString(36).substring(2, 8);
  const guestEmail = guestName.toLowerCase() + '@guest.nexorava';
  const guestPass = bcrypt.hashSync('guest', 10);
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(guestName);
  if (existing) return res.redirect('/login');
  db.prepare('INSERT INTO users (username, email, password, is_guest) VALUES (?, ?, ?, 1)').run(guestName, guestEmail, guestPass);
  req.session.userId = db.prepare('SELECT id FROM users WHERE username = ?').get(guestName).id;
  res.redirect('/');
});

app.get('/register', (req, res) => {
  if (req.session.userId) return res.redirect('/');
  sendPage(req, res, 'register', { user: null, title: 'Register - Nexorava' });
});

app.post('/register', (req, res) => {
  const { username, email, password, password_confirm } = req.body;
  if (password !== password_confirm) return sendPage(req, res, 'register', { user: null, title: 'Register - Nexorava', error: 'Passwords do not match' });
  if (password.length < 6) return sendPage(req, res, 'register', { user: null, title: 'Register - Nexorava', error: 'Password must be at least 6 characters' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return sendPage(req, res, 'register', { user: null, title: 'Register - Nexorava', error: 'Invalid email address' });
  const usernameExists = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  const emailExists = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (usernameExists && emailExists) return sendPage(req, res, 'register', { user: null, title: 'Register - Nexorava', error: 'Username and email are already taken' });
  if (usernameExists) return sendPage(req, res, 'register', { user: null, title: 'Register - Nexorava', error: 'Username is already taken' });
  if (emailExists) return sendPage(req, res, 'register', { user: null, title: 'Register - Nexorava', error: 'Email is already taken' });
  db.prepare('INSERT INTO users (username, email, password) VALUES (?, ?, ?)').run(username, email, bcrypt.hashSync(password, 10));
  req.session.userId = db.prepare('SELECT id FROM users WHERE username = ?').get(username).id;
  const emailVerificationEnabled = false; // Set to true when nodemailer configured
  if (emailVerificationEnabled) {
    res.redirect('/settings?verify=1');
  } else {
    db.prepare('UPDATE users SET email_verified = 1 WHERE username = ?').run(username);
    res.redirect('/');
  }
});

app.get('/logout', (req, res) => { req.session.destroy(() => res.redirect('/')); });

// Re-auth endpoint
app.post('/reauth', (req, res) => {
  const { password } = req.body;
  if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });
  const user = db.prepare('SELECT password FROM users WHERE id = ?').get(req.session.userId);
  if (!user || !bcrypt.compareSync(password, user.password)) return res.json({ error: 'Invalid password' });
  res.json({ ok: true });
});

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

  sendPage(req, res, 'home', {
    user, songs, topSongs, feedSongs, historySongs,
    selectedGenre: genre, searchQuery: '', searchDur: '', searchUploader: '', searchDateFrom: '', searchDateTo: '',
    title: 'Nexorava'
  });
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
  let sql = 'SELECT s.*, u.username AS uploader_name, u.premium AS uploader_premium, u.verified AS uploader_verified FROM songs s JOIN users u ON s.user_id = u.id WHERE (s.title LIKE ? OR s.artist LIKE ? OR s.album LIKE ? OR u.username LIKE ?)';
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

  sendPage(req, res, 'home', {
    user, songs, topSongs: [], feedSongs: [], historySongs: [],
    selectedGenre: genre, searchQuery: q, searchDur: dur, searchUploader: uploader, searchDateFrom: dateFrom, searchDateTo: dateTo,
    title: 'Search - Nexorava'
  });
});

// ---- UPLOAD ----
app.get('/upload', requireAuth, (req, res) => {
  const user = getSessionUser(req);
  sendPage(req, res, 'upload', { user, title: 'Upload - Nexorava' });
});

app.post('/upload', requireAuth, upload.fields([{ name: 'audio', maxCount: 1 }, { name: 'icon', maxCount: 1 }]), async (req, res) => {
  if (!validateMultipartCsrf(req, res)) return;
  const user = getSessionUser(req);
  if (!req.files || !req.files.audio) return sendPage(req, res, 'upload', { user, title: 'Upload - Nexorava', error: 'No audio file selected' });
  const af = req.files.audio[0];
  const { title, album, genre } = req.body;
  let iconFile = '';
  if (req.files.icon) iconFile = req.files.icon[0].filename;

  let bitrate = 0, sampleRate = 0, duration = 0;
  try { const meta = await mm.parseFile(af.path, { duration: true }); bitrate = meta.format.bitrate ? Math.round(meta.format.bitrate / 1000) : 0; sampleRate = meta.format.sampleRate || 0; duration = meta.format.duration ? Math.round(meta.format.duration) : 0; } catch (e) {}

  db.prepare('INSERT INTO songs (title, artist, album, filename, original_name, mime_type, file_size, bitrate, sample_rate, duration, genre, icon, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
    title || af.originalname.replace(/\.[^/.]+$/, ''), user.username, album || '', af.filename, af.originalname, af.mimetype, af.size, bitrate, sampleRate, duration, genre || '', iconFile, user.id
  );
  
  // Create notification for followers
  const followers = db.prepare('SELECT follower_id FROM follows WHERE followed_id = ?').all(user.id);
  const songId = db.prepare('SELECT last_insert_rowid()').get()['last_insert_rowid()'];
  followers.forEach(f => {
    db.prepare('INSERT INTO notifications (user_id, type, actor_id, song_id, message) VALUES (?, ?, ?, ?, ?)').run(f.follower_id, 'upload', user.id, songId, user.username + ' uploaded a new song: ' + (title || af.originalname.replace(/\.[^/.]+$/, '')));
  });

  res.redirect('/profile?upload_success=1');
});

// ---- STREAMING ----
function streamFile(res, fp, mime) { const s = fs.statSync(fp); res.writeHead(200,{'Content-Length':s.size,'Content-Type':mime,'Accept-Ranges':'bytes','Cache-Control':'no-cache'}); fs.createReadStream(fp).pipe(res); }
function streamTranscoded(res, fp, qk) {
  const q = config.streaming[qk] || config.streaming[config.streaming.default_quality];
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
  const ip = req.ip || req.connection.remoteAddress || '';
  if (req.session.userId) {
    db.prepare('INSERT INTO history (user_id, song_id) VALUES (?, ?)').run(req.session.userId, req.params.id);
  }
  db.prepare('INSERT INTO analytics_plays (song_id, user_id, ip) VALUES (?, ?, ?)').run(req.params.id, req.session.userId || null, ip);
  res.json({ok:true});
});

// Track skip for analytics
app.post('/song/:id/skip', (req, res) => {
  db.prepare('INSERT INTO analytics_skips (song_id, user_id) VALUES (?, ?)').run(req.params.id, req.session.userId || null);
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

// ---- COMMENTS ----
app.get('/api/song/:id/comments', (req, res) => {
  const comments = db.prepare('SELECT c.*, u.username, u.avatar FROM comments c JOIN users u ON c.user_id = u.id WHERE c.song_id = ? ORDER BY c.created_at DESC LIMIT 50').all(req.params.id);
  res.json(comments);
});

app.post('/api/song/:id/comment', requireAuth, (req, res) => {
  const { text } = req.body;
  if (!text || text.trim().length === 0) return res.status(400).json({ error: 'Comment cannot be empty' });
  if (text.length > 1000) return res.status(400).json({ error: 'Comment too long' });
  db.prepare('INSERT INTO comments (song_id, user_id, text) VALUES (?, ?, ?)').run(req.params.id, req.session.userId, text.trim());
  const song = db.prepare('SELECT user_id, title FROM songs WHERE id = ?').get(req.params.id);
  if (song && song.user_id !== req.session.userId) {
    db.prepare('INSERT INTO notifications (user_id, type, actor_id, song_id, message) VALUES (?, ?, ?, ?, ?)').run(song.user_id, 'comment', req.session.userId, req.params.id, 'left a comment on your song: ' + song.title);
  }
  res.json({ ok: true });
});

app.post('/api/comment/:id/delete', requireAuth, (req, res) => {
  const comment = db.prepare('SELECT * FROM comments WHERE id = ?').get(req.params.id);
  if (!comment) return res.status(404).json({ error: 'Comment not found' });
  if (comment.user_id !== req.session.userId) return res.status(403).json({ error: 'Not your comment' });
  db.prepare('DELETE FROM comments WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---- COMMENT LIKES ----
app.post('/api/comment/:id/like', requireAuth, (req, res) => {
  const uid = req.session.userId;
  const cid = req.params.id;
  const comment = db.prepare('SELECT id FROM comments WHERE id = ?').get(cid);
  if (!comment) return res.status(404).json({ error: 'Comment not found' });
  const existing = db.prepare('SELECT id FROM comment_likes WHERE user_id = ? AND comment_id = ?').get(uid, cid);
  if (existing) {
    db.prepare('DELETE FROM comment_likes WHERE user_id = ? AND comment_id = ?').run(uid, cid);
    res.json({ liked: false, count: db.prepare('SELECT COUNT(*) AS c FROM comment_likes WHERE comment_id = ?').get(cid).c });
  } else {
    db.prepare('INSERT INTO comment_likes (user_id, comment_id) VALUES (?, ?)').run(uid, cid);
    res.json({ liked: true, count: db.prepare('SELECT COUNT(*) AS c FROM comment_likes WHERE comment_id = ?').get(cid).c });
  }
});

app.get('/api/comment/:id/likes', (req, res) => {
  const count = db.prepare('SELECT COUNT(*) AS c FROM comment_likes WHERE comment_id = ?').get(req.params.id).c;
  const liked = req.session.userId ? !!db.prepare('SELECT id FROM comment_likes WHERE user_id = ? AND comment_id = ?').get(req.session.userId, req.params.id) : false;
  res.json({ count, liked });
});

// ---- NOTIFICATIONS ----
app.get('/api/notifications', requireAuth, (req, res) => {
  const notifications = db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50').all(req.session.userId);
  const unread = db.prepare('SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND is_read = 0').get(req.session.userId).c;
  res.json({ notifications, unread });
});

app.post('/api/notifications/read', requireAuth, (req, res) => {
  db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(req.session.userId);
  res.json({ ok: true });
});

app.post('/api/notifications/read/:id', requireAuth, (req, res) => {
  db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?').run(req.params.id, req.session.userId);
  res.json({ ok: true });
});

// ---- REPOSTS ----
app.post('/api/song/:id/repost', requireAuth, (req, res) => {
  const existing = db.prepare('SELECT id FROM reposts WHERE user_id = ? AND song_id = ?').get(req.session.userId, req.params.id);
  if (existing) {
    db.prepare('DELETE FROM reposts WHERE id = ?').run(existing.id);
    res.json({ reposted: false });
  } else {
    db.prepare('INSERT INTO reposts (user_id, song_id) VALUES (?, ?)').run(req.session.userId, req.params.id);
    const song = db.prepare('SELECT user_id, title FROM songs WHERE id = ?').get(req.params.id);
    if (song && song.user_id !== req.session.userId) {
      const user = getSessionUser(req);
      db.prepare('INSERT INTO notifications (user_id, type, actor_id, song_id, message) VALUES (?, ?, ?, ?, ?)').run(song.user_id, 'repost', req.session.userId, req.params.id, user.username + ' reposted your song: ' + song.title);
    }
    res.json({ reposted: true });
  }
});

app.get('/api/reposts/:userId', (req, res) => {
  const reposts = db.prepare('SELECT song_id FROM reposts WHERE user_id = ?').all(req.params.userId).map(r => r.song_id);
  res.json(reposts);
});

// ---- COLLABORATIVE PLAYLISTS ----
app.post('/api/playlist/:id/collaborator', requireAuth, (req, res) => {
  const pl = db.prepare('SELECT * FROM playlists WHERE id = ?').get(req.params.id);
  if (!pl) return res.status(404).json({ error: 'Playlist not found' });
  if (pl.user_id !== req.session.userId) return res.status(403).json({ error: 'Not your playlist' });
  const { username } = req.body;
  const target = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (!target) return res.status(404).json({ error: 'User not found' });
  if (target.id === req.session.userId) return res.status(400).json({ error: 'Cannot add yourself' });
  const existing = db.prepare('SELECT id FROM playlist_collaborators WHERE playlist_id = ? AND user_id = ?').get(req.params.id, target.id);
  if (existing) {
    db.prepare('DELETE FROM playlist_collaborators WHERE id = ?').run(existing.id);
    res.json({ added: false });
  } else {
    db.prepare('INSERT INTO playlist_collaborators (playlist_id, user_id) VALUES (?, ?)').run(req.params.id, target.id);
    db.prepare('INSERT INTO notifications (user_id, type, actor_id, message) VALUES (?, ?, ?, ?)').run(target.id, 'collaborator', req.session.userId, 'You were added as a collaborator to playlist: ' + pl.title);
    res.json({ added: true });
  }
});

app.get('/api/playlist/:id/collaborators', (req, res) => {
  const collabs = db.prepare('SELECT u.id, u.username FROM playlist_collaborators pc JOIN users u ON pc.user_id = u.id WHERE pc.playlist_id = ?').all(req.params.id);
  res.json(collabs);
});

// Extend playlist add-song to allow collaborators
app.post('/playlist/:id/add-song', requireAuth, (req, res) => {
  const pl = db.prepare('SELECT * FROM playlists WHERE id = ?').get(req.params.id);
  if (!pl) return res.status(404).end();
  const isOwner = pl.user_id === req.session.userId;
  const isCollab = !!db.prepare('SELECT id FROM playlist_collaborators WHERE playlist_id = ? AND user_id = ?').get(req.params.id, req.session.userId);
  if (!isOwner && !isCollab) return res.status(403).end();
  const { song_id } = req.body;
  const max = db.prepare('SELECT MAX(position) AS mx FROM playlist_songs WHERE playlist_id = ?').get(pl.id);
  db.prepare('INSERT INTO playlist_songs (playlist_id, song_id, position) VALUES (?, ?, ?)').run(pl.id, song_id, (max.mx || 0) + 1);
  res.redirect('/profile');
});

// ---- LIKES ----
app.post('/song/:id/like', requireAuth, (req, res) => {
  const uid = req.session.userId;
  const sid = req.params.id;
  const recentLike = db.prepare('SELECT created_at FROM likes WHERE user_id = ? ORDER BY created_at DESC LIMIT 1').get(uid);
  if (recentLike && recentLike.created_at) {
    const lastLikeTime = new Date(recentLike.created_at).getTime();
    if (Date.now() - lastLikeTime < 2000) return res.status(429).json({ error: 'Please wait before liking again' });
  }
  const existing = db.prepare('SELECT id FROM likes WHERE user_id = ? AND song_id = ?').get(uid, sid);
  if (existing) {
    db.prepare('DELETE FROM likes WHERE user_id = ? AND song_id = ?').run(uid, sid);
  } else {
    db.prepare('INSERT INTO likes (user_id, song_id, created_at) VALUES (?, ?, datetime(\'now\'))').run(uid, sid);
    // Notify song owner
    const song = db.prepare('SELECT user_id, title FROM songs WHERE id = ?').get(sid);
    if (song && song.user_id !== uid) {
      const user = getSessionUser(req);
      db.prepare('INSERT INTO notifications (user_id, type, actor_id, song_id, message) VALUES (?, ?, ?, ?, ?)').run(song.user_id, 'like', uid, sid, user.username + ' liked your song: ' + song.title);
    }
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
  sendPage(req, res, 'likes', { user, songs, title: 'Liked Songs - Nexorava' });
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
  const isOwner = user && user.id == artist.id;
  sendPage(req, res, 'artist', { user, artist: artistUser, songs, followerCount, following, isOwner, title: escapeHtml(artist.username) + ' - Nexorava' });
});

app.get('/artist/:id([0-9]+)', (req, res) => {
  const artist = getFullUser(req.params.id);
  if (!artist) return res.redirect('/');
  res.redirect('/artist/' + encodeURIComponent(artist.username));
});

// ---- FOLLOW ----
app.post('/follow/:id', requireAuth, (req, res) => {
  const uid = req.session.userId;
  const targetId = parseInt(req.params.id);
  if (uid == targetId) return res.status(400).json({ error: 'Cannot follow yourself' });
  const existing = db.prepare('SELECT id FROM follows WHERE follower_id = ? AND followed_id = ?').get(uid, targetId);
  if (existing) {
    db.prepare('DELETE FROM follows WHERE follower_id = ? AND followed_id = ?').run(uid, targetId);
    res.json({ following: false });
  } else {
    db.prepare('INSERT INTO follows (follower_id, followed_id) VALUES (?, ?)').run(uid, targetId);
    const user = getSessionUser(req);
    db.prepare('INSERT INTO notifications (user_id, type, actor_id, message) VALUES (?, ?, ?, ?)').run(targetId, 'follow', uid, user.username + ' started following you');
    res.json({ following: true });
  }
});

app.get('/api/check-follow/:id', requireAuth, (req, res) => {
  res.json({ following: isFollowing(req.session.userId, parseInt(req.params.id)) });
});

// ---- SUGGESTIONS ----
app.get('/api/suggestions/:song_id', (req, res) => {
  const song = db.prepare('SELECT * FROM songs WHERE id = ?').get(req.params.song_id);
  if (!song) return res.json([]);
  const suggestions = db.prepare('SELECT s.*, u.username AS uploader_name FROM songs s JOIN users u ON s.user_id = u.id WHERE s.genre = ? AND s.id != ? ORDER BY RANDOM() LIMIT 5').all(song.genre || '', song.id);
  res.json(suggestions.map(s => ({ id: s.id, title: s.title, artist: s.artist, file: '/uploads/' + s.filename, duration: s.duration, genre: s.genre })));
});

// ---- THEME API ----
app.get('/api/theme', (req, res) => {
  const name = req.query.name || 'dark';
  const t = config.themes[name] || config.themes.dark;
  const vars = Object.keys(t).filter(k => k !== 'label').map(k => '  --' + k + ': ' + t[k] + ';').join('\n');
  const borderColor = t.bg === '#ffffff' ? '#ddd' : '#333';
  res.type('text/plain').send(vars + '\n  --border: ' + borderColor + ';');
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
  sendPage(req, res, 'profile', { user, songs, albums, playlists, followerCount, followingCount, success, title: 'Profile - Nexorava' });
});

// ---- ALBUMS ----
app.get('/albums', (req, res) => {
  const user = getSessionUser(req);
  const albums = db.prepare('SELECT a.*, u.username AS owner_name, (SELECT COUNT(*) FROM album_songs WHERE album_id = a.id) AS song_count FROM albums a JOIN users u ON a.user_id = u.id WHERE a.is_public = 1 ORDER BY a.created_at DESC').all();
  sendPage(req, res, 'albums', { user, albums, title: 'Albums - Nexorava' });
});

app.get('/album/:id', (req, res) => {
  const user = getSessionUser(req);
  const album = db.prepare('SELECT a.*, u.username AS owner_name FROM albums a JOIN users u ON a.user_id = u.id WHERE a.id = ?').get(req.params.id);
  if (!album) return res.redirect('/');
  const songs = db.prepare('SELECT s.*, u.username AS uploader_name, u.premium AS uploader_premium, u.verified AS uploader_verified, as2.track_number FROM songs s JOIN album_songs as2 ON s.id = as2.song_id JOIN users u ON s.user_id = u.id WHERE as2.album_id = ? ORDER BY as2.track_number').all(album.id);
  sendPage(req, res, 'album-detail', { user, album, songs, title: escapeHtml(album.title) + ' - Nexorava' });
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
  sendPage(req, res, 'playlists', { user, playlists, title: 'Playlists - Nexorava' });
});

app.get('/playlist/:id', (req, res) => {
  const user = getSessionUser(req);
  const pl = db.prepare('SELECT p.*, u.username AS owner_name FROM playlists p JOIN users u ON p.user_id = u.id WHERE p.id = ?').get(req.params.id);
  if (!pl) return res.redirect('/');
  const songs = db.prepare('SELECT s.*, u.username AS uploader_name, u.premium AS uploader_premium, u.verified AS uploader_verified, ps.position FROM songs s JOIN playlist_songs ps ON s.id = ps.song_id JOIN users u ON s.user_id = u.id WHERE ps.playlist_id = ? ORDER BY ps.position').all(pl.id);
  sendPage(req, res, 'playlist-detail', { user, playlist: pl, songs, title: escapeHtml(pl.title) + ' - Nexorava' });
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

app.post('/playlist/:id/delete', requireAuth, (req, res) => {
  const pl = db.prepare('SELECT * FROM playlists WHERE id = ?').get(req.params.id);
  if (!pl || pl.user_id !== req.session.userId) return res.status(403).end();
  db.prepare('DELETE FROM playlists WHERE id = ?').run(pl.id);
  res.redirect('/profile');
});

// ---- AUTO-GENERATED PLAYLISTS ----
app.get('/api/auto-playlists', requireAuth, (req, res) => {
  const userId = req.session.userId;
  const genres = db.prepare('SELECT DISTINCT s.genre FROM history h JOIN songs s ON h.song_id = s.id WHERE h.user_id = ? AND s.genre != ? ORDER BY COUNT(*) DESC LIMIT 3').all(userId, '').map(r => r.genre);
  const topArtists = db.prepare('SELECT s.artist FROM history h JOIN songs s ON h.song_id = s.id WHERE h.user_id = ? GROUP BY s.artist ORDER BY COUNT(*) DESC LIMIT 3').all(userId).map(r => r.artist);
  
  const result = [];
  
  // Daily Mix - top genres
  if (genres.length) {
    const daily = db.prepare(`SELECT s.*, u.username AS uploader_name FROM songs s JOIN users u ON s.user_id = u.id WHERE s.genre IN (${genres.map(() => '?').join(',')}) ORDER BY s.plays DESC LIMIT 15`).all(...genres);
    if (daily.length >= 3) result.push({ title: 'Daily Mix', songs: daily, description: 'Based on your top genres' });
  }
  
  // Mood Mix - focus on instrumental/ambient
  const mood = db.prepare("SELECT s.*, u.username AS uploader_name FROM songs s JOIN users u ON s.user_id = u.id WHERE s.genre IN ('Ambient','Classical','Jazz') ORDER BY RANDOM() LIMIT 15").all();
  if (mood.length >= 3) result.push({ title: 'Mood Mix', songs: mood, description: 'Relaxing tunes for any mood' });
  
  // Workout Mix - high energy
  const workout = db.prepare("SELECT s.*, u.username AS uploader_name FROM songs s JOIN users u ON s.user_id = u.id WHERE s.genre IN ('Rock','Metal','Techno','Phonk','Hip Hop') ORDER BY RANDOM() LIMIT 15").all();
  if (workout.length >= 3) result.push({ title: 'Workout Mix', songs: workout, description: 'High energy tracks' });
  
  res.json(result);
});

// ---- CREATOR ANALYTICS ----
app.get('/analytics', requireAuth, (req, res) => {
  const user = getSessionUser(req);
  const songs = db.prepare('SELECT * FROM songs WHERE user_id = ? ORDER BY uploaded_at DESC').all(user.id);
  const totalSongs = songs.length;
  const totalPlays = songs.reduce((sum, s) => sum + (s.plays || 0), 0);
  const today = new Date().toISOString().split('T')[0];
  const monthStart = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const playsToday = db.prepare('SELECT COUNT(*) AS c FROM analytics_plays WHERE song_id IN (SELECT id FROM songs WHERE user_id = ?) AND DATE(played_at) = ?').get(user.id, today).c;
  const playsMonth = db.prepare('SELECT COUNT(*) AS c FROM analytics_plays WHERE song_id IN (SELECT id FROM songs WHERE user_id = ?) AND played_at > ?').get(user.id, monthStart).c;
  const totalSkips = db.prepare('SELECT COUNT(*) AS c FROM analytics_skips WHERE song_id IN (SELECT id FROM songs WHERE user_id = ?)').get(user.id).c;
  const skipRate = totalPlays > 0 ? totalSkips / totalPlays : 0;
  const totalLikes = db.prepare('SELECT COUNT(*) AS c FROM likes WHERE song_id IN (SELECT id FROM songs WHERE user_id = ?)').get(user.id).c;
  
  // Listener languages (approximate via IP, simplified to just count)
  const listenerLanguages = [];
  
  // Tips
  const tips = db.prepare('SELECT t.*, u.username AS from_name FROM tips t LEFT JOIN users u ON t.from_user_id = u.id WHERE t.to_user_id = ? ORDER BY t.created_at DESC LIMIT 20').all(user.id);
  
  // Song-level stats
  const songStats = songs.map(s => {
    const likeCount = db.prepare('SELECT COUNT(*) AS c FROM likes WHERE song_id = ?').get(s.id).c;
    const skipCount = db.prepare('SELECT COUNT(*) AS c FROM analytics_skips WHERE song_id = ?').get(s.id).c;
    return { ...s, likeCount, skipCount };
  });
  
  sendPage(req, res, 'analytics', { user, songs: songStats, totalSongs, totalPlays, playsToday, playsMonth, skipRate, totalLikes, listenerLanguages, tips, title: 'Analytics - Nexorava' });
});

// ---- TIPS / DONATIONS ----
app.post('/api/tip', requireAuth, (req, res) => {
  const { to_user_id, amount, message } = req.body;
  if (!to_user_id || !amount || amount < 1) return res.json({ error: 'Invalid tip amount' });
  if (parseInt(to_user_id) === req.session.userId) return res.json({ error: 'Cannot tip yourself' });
  const target = db.prepare('SELECT id FROM users WHERE id = ?').get(to_user_id);
  if (!target) return res.json({ error: 'User not found' });
  db.prepare('INSERT INTO tips (from_user_id, to_user_id, amount, message) VALUES (?, ?, ?, ?)').run(req.session.userId, to_user_id, parseInt(amount), (message || '').trim());
  db.prepare('INSERT INTO notifications (user_id, type, actor_id, message) VALUES (?, ?, ?, ?)').run(to_user_id, 'tip', req.session.userId, 'You received a tip of ' + amount + ' coins!');
  res.json({ ok: true });
});

// ---- EMAIL VERIFICATION ----
app.get('/verify-email', requireAuth, (req, res) => {
  const user = getSessionUser(req);
  if (user.email_verified) return res.redirect('/settings');
  sendPage(req, res, 'verify', { user, verified: false, error: null, title: 'Verify Email - Nexorava' });
});

app.post('/verify-email', requireAuth, (req, res) => {
  const user = getSessionUser(req);
  if (user.email_verified) return res.json({ ok: true });
  const { code } = req.body;
  if (!code || code.length !== 9) return sendPage(req, res, 'verify', { user, verified: false, error: 'Invalid code format', title: 'Verify Email - Nexorava' });
  const verification = db.prepare('SELECT * FROM email_verifications WHERE user_id = ? AND code = ?').get(user.id, code.toUpperCase());
  if (!verification) return sendPage(req, res, 'verify', { user, verified: false, error: 'Invalid or expired verification code', title: 'Verify Email - Nexorava' });
  if (new Date(verification.expires_at) < new Date()) {
    db.prepare('DELETE FROM email_verifications WHERE user_id = ?').run(user.id);
    return sendPage(req, res, 'verify', { user, verified: false, error: 'Verification code expired. Request a new one.', title: 'Verify Email - Nexorava' });
  }
  db.prepare('UPDATE users SET email_verified = 1 WHERE id = ?').run(user.id);
  db.prepare('DELETE FROM email_verifications WHERE user_id = ?').run(user.id);
  sendPage(req, res, 'verify', { user, verified: true, error: null, title: 'Email Verified - Nexorava' });
});

app.post('/api/resend-verification', requireAuth, (req, res) => {
  const user = getSessionUser(req);
  if (user.email_verified) return res.json({ ok: true });
  const code = Math.random().toString(36).substring(2, 11).toUpperCase();
  const expires = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  db.prepare('DELETE FROM email_verifications WHERE user_id = ?').run(user.id);
  db.prepare('INSERT INTO email_verifications (user_id, code, expires_at) VALUES (?, ?, ?)').run(user.id, code, expires);
  // In production, send email via nodemailer
  console.log('Verification code for user ' + user.id + ': ' + code);
  res.json({ ok: true, message: 'Verification code sent (check server console)' });
});
app.get('/settings', requireAuth, (req, res) => {
  const user = getSessionUser(req);
  sendPage(req, res, 'settings', { user, title: 'Settings - Nexorava' });
});

app.post('/settings', requireAuth, (req, res) => {
  const user = getSessionUser(req);
  const { stream_quality, theme } = req.body;
  const allowed = getAllowedQualities(user);
  if (stream_quality && allowed.includes(stream_quality)) {
    db.prepare('UPDATE users SET stream_quality = ? WHERE id = ?').run(stream_quality, user.id);
  }
  if (theme && config.themes[theme]) {
    db.prepare('UPDATE users SET theme = ? WHERE id = ?').run(theme, user.id);
  }
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

// ---- AVATAR ----
app.post('/avatar/upload', requireAuth, iconUpload.single('avatar'), (req, res) => {
  if (!validateMultipartCsrf(req, res)) return;
  const user = getSessionUser(req);
  if (!req.file) return res.json({ error: 'No file selected' });
  try {
    db.prepare('UPDATE users SET avatar = ? WHERE id = ?').run(req.file.filename, user.id);
    res.json({ ok: true, filename: req.file.filename });
  } catch (error) {
    res.json({ error: 'Failed to update avatar in database' });
  }
});

// ---- CONTACT / BUG / COPYRIGHT / REVIEW ----
app.get('/contact', (req, res) => { const user = getSessionUser(req); sendPage(req, res, 'contact', { user, title: 'Contact - Nexorava' }); });
app.post('/contact', (req, res) => {
  const { name, email, subject, message } = req.body;
  db.prepare('INSERT INTO contact_messages (name, email, subject, message) VALUES (?, ?, ?, ?)').run(name, email, subject, message);
  res.redirect('/contact?success=1');
});

app.get('/bug-report', (req, res) => { const user = getSessionUser(req); sendPage(req, res, 'bug-report', { user, title: 'Bug Report - Nexorava' }); });
app.post('/bug-report', (req, res) => {
  const { name, email, subject, description } = req.body;
  db.prepare('INSERT INTO bug_reports (name, email, subject, description) VALUES (?, ?, ?, ?)').run(name, email, subject, description);
  res.redirect('/bug-report?success=1');
});

app.get('/copyright', (req, res) => {
  const user = getSessionUser(req);
  const songsOpts = db.prepare('SELECT id, title, artist FROM songs ORDER BY title').all();
  sendPage(req, res, 'copyright', { user, copyrightSongId: req.query.song_id || '', songOptions: songsOpts, title: 'Copyright - Nexorava' });
});

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
  sendPage(req, res, 'review-queue', { user, reviews, strikesList, title: 'Review Queue - Nexorava' });
});

// ---- ADMIN PANEL ----
app.get('/admin', requireAuth, requireAdmin, (req, res) => {
  const user = getSessionUser(req);
  const reviews = db.prepare('SELECT r.*, s.title AS song_title, u.username AS reporter_name FROM reviews r LEFT JOIN songs s ON r.target_id = s.id LEFT JOIN users u ON r.reported_by = u.id WHERE r.status = ? ORDER BY r.created_at DESC').all('pending');
  const strikesList = db.prepare('SELECT st.*, u.username AS user_name, iss.username AS issuer_name FROM strikes st JOIN users u ON st.user_id = u.id JOIN users iss ON st.issued_by = iss.id ORDER BY st.created_at DESC LIMIT 50').all();
  sendPage(req, res, 'admin', { user, reviews, strikesList, title: 'Admin Panel - Nexorava' });
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
  const shareUrl = req.protocol + '://' + req.get('host') + '/share/song/' + song.id;
  sendPage(req, res, 'share', { user: getSessionUser(req), song, shareUrl, title: escapeHtml(song.title) + ' - Nexorava' });
});

// ---- LEGAL PAGES ----
app.get('/tos', (req, res) => { const user = getSessionUser(req); sendPage(req, res, 'tos', { user, title: 'Terms of Service - Nexorava' }); });
app.get('/privacy', (req, res) => { const user = getSessionUser(req); sendPage(req, res, 'privacy', { user, title: 'Privacy Policy - Nexorava' }); });
app.get('/upload-rules', (req, res) => { const user = getSessionUser(req); sendPage(req, res, 'upload-rules', { user, title: 'Upload Guidelines - Nexorava' }); });

// ---- FEED: reposts from followed users ----
app.get('/api/feed', requireAuth, (req, res) => {
  const userId = req.session.userId;
  const followedIds = db.prepare('SELECT followed_id FROM follows WHERE follower_id = ?').all(userId).map(r => r.followed_id);
  if (!followedIds.length) return res.json([]);
  const songs = db.prepare(`SELECT s.*, u.username AS uploader_name, u.premium AS uploader_premium, u.verified AS uploader_verified FROM songs s JOIN users u ON s.user_id = u.id WHERE s.user_id IN (${followedIds.map(() => '?').join(',')}) ORDER BY s.uploaded_at DESC LIMIT 20`).all(...followedIds);
  const reposts = db.prepare(`SELECT s.*, u.username AS uploader_name, u.premium AS uploader_premium, u.verified AS uploader_verified, r.user_id AS reposter_id, ru.username AS reposter_name FROM reposts r JOIN songs s ON r.song_id = s.id JOIN users u ON s.user_id = u.id JOIN users ru ON r.user_id = ru.id WHERE r.user_id IN (${followedIds.map(() => '?').join(',')}) ORDER BY r.created_at DESC LIMIT 20`).all(...followedIds);
  res.json({ songs, reposts });
});

// ---- ERROR HANDLER ----
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    const user = getSessionUser(req);
    return res.status(413).send(err.code === 'LIMIT_FILE_SIZE' ? 'File too large' : err.message);
  }
  if (err.message && err.message.startsWith('Only ')) {
    const user = getSessionUser(req);
    return res.status(400).send(err.message);
  }
  console.error(err);
  res.status(500).send('Error');
});

// ---- START ----
app.listen(PORT, '0.0.0.0', () => { console.log('Nexorava on http://0.0.0.0:' + PORT); });
