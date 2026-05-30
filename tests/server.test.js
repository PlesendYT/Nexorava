const assert = require('assert');
const path = require('path');
const fs = require('fs');

// Test configuration loads
console.log('Testing configuration...');
const config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config.json'), 'utf-8'));
assert.ok(config.streaming, 'Streaming config exists');
assert.ok(config.themes, 'Themes config exists');
assert.ok(config.premium, 'Premium config exists');
assert.ok(config.moderation, 'Moderation config exists');
console.log('  OK - Configuration loads correctly');

// Test database
console.log('Testing database...');
const db = require(path.join(__dirname, '..', 'database'));
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
const tableNames = tables.map(t => t.name);
assert.ok(tableNames.includes('users'), 'Users table exists');
assert.ok(tableNames.includes('songs'), 'Songs table exists');
assert.ok(tableNames.includes('albums'), 'Albums table exists');
assert.ok(tableNames.includes('playlists'), 'Playlists table exists');
assert.ok(tableNames.includes('likes'), 'Likes table exists');
assert.ok(tableNames.includes('history'), 'History table exists');
assert.ok(tableNames.includes('follows'), 'Follows table exists');
assert.ok(tableNames.includes('comments'), 'Comments table exists');
assert.ok(tableNames.includes('notifications'), 'Notifications table exists');
assert.ok(tableNames.includes('reposts'), 'Reposts table exists');
assert.ok(tableNames.includes('playlist_collaborators'), 'Playlist collaborators table exists');
assert.ok(tableNames.includes('reviews'), 'Reviews table exists');
assert.ok(tableNames.includes('strikes'), 'Strikes table exists');
console.log('  OK - All ' + tableNames.length + ' database tables exist');

// Test helpers
console.log('Testing helpers...');
const helpersFactory = require(path.join(__dirname, '..', 'views', 'helpers'));
const helpers = helpersFactory(db, config);
assert.ok(typeof helpers.escapeHtml === 'function', 'escapeHtml is a function');
assert.ok(typeof helpers.fmtDur === 'function', 'fmtDur is a function');
assert.ok(typeof helpers.fmtDate === 'function', 'fmtDate is a function');
assert.ok(typeof helpers.songItem === 'function', 'songItem is a function');
assert.ok(typeof helpers.userBadge === 'function', 'userBadge is a function');
assert.ok(typeof helpers.isPremium === 'function', 'isPremium is a function');
assert.ok(typeof helpers.isVerified === 'function', 'isVerified is a function');
assert.ok(typeof helpers.getUploaderBadges === 'function', 'getUploaderBadges is a function');
assert.ok(typeof helpers.isLiked === 'function', 'isLiked is a function');
assert.ok(typeof helpers.getAllowedQualities === 'function', 'getAllowedQualities is a function');
assert.ok(Array.isArray(helpers.GENRES), 'GENRES is an array');
console.log('  OK - All helper functions exist');

// Test helper functions
assert.strictEqual(helpers.escapeHtml('<script>'), '&lt;script&gt;', 'escapeHtml escapes <');
assert.strictEqual(helpers.escapeHtml('&'), '&amp;', 'escapeHtml escapes &');
assert.strictEqual(helpers.fmtDur(125), '2:05', 'fmtDur formats correctly');
assert.strictEqual(helpers.fmtDur(0), '', 'fmtDur handles zero');
assert.strictEqual(helpers.fmtDur(null), '', 'fmtDur handles null');
assert.strictEqual(helpers.isPremium({ premium: 1 }), true, 'isPremium detects premium');
assert.strictEqual(helpers.isPremium({ premium: 0 }), false, 'isPremium detects non-premium');
assert.strictEqual(helpers.isPremium(null), null, 'isPremium handles null');
assert.strictEqual(helpers.isVerified({ verified: 1 }), true, 'isVerified detects verified');
assert.strictEqual(helpers.isVerified({ verified: 0 }), false, 'isVerified detects non-verified');
assert.strictEqual(helpers.isVerified(null), null, 'isVerified handles null');
assert.ok(Array.isArray(helpers.GENRES), 'GENRES is an array');
assert.ok(helpers.GENRES.length > 10, 'GENRES has many genres');
assert.ok(helpers.GENRES.includes('Pop'), 'GENRES includes Pop');
assert.ok(helpers.GENRES.includes('Rock'), 'GENRES includes Rock');
console.log('  OK - Helper function logic is correct');

// Test theme config
console.log('Testing theme config...');
const themeKeys = Object.keys(config.themes);
assert.ok(themeKeys.length >= 5, 'At least 5 themes');
assert.ok(config.themes.dark, 'Dark theme exists');
assert.ok(config.themes.light, 'Light theme exists');
assert.ok(config.themes.dark.bg, 'Dark theme has bg');
assert.ok(config.themes.dark.text, 'Dark theme has text');
console.log('  OK - ' + themeKeys.length + ' themes configured');

// Test streaming config
console.log('Testing streaming config...');
const qualityKeys = Object.keys(config.streaming).filter(k => k !== 'default_quality');
assert.ok(qualityKeys.length >= 2, 'At least 2 quality levels');
assert.ok(config.streaming.default_quality, 'Default quality set');
console.log('  OK - ' + qualityKeys.length + ' quality levels configured');

// Clean up
db.close();

console.log('\nAll tests passed!');
