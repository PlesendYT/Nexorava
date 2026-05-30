module.exports = (db, config) => {
  const escapeHtml = (t) => {
    if (!t) return '';
    return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  };

  const fmtDur = (s) => {
    if (!s) return '';
    const m = Math.floor(s / 60), sec = Math.floor(s % 60);
    return m + ':' + (sec < 10 ? '0' : '') + sec;
  };

  const fmtDate = (d) => {
    return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const isPremium = (user) => user && user.premium === 1;
  const isVerified = (user) => user && user.verified === 1;

  const userBadge = (user) => {
    if (!user) return '';
    let html = escapeHtml(user.username);
    if (isPremium(user)) html += ' <span class="badge badge-premium" title="Premium">' + config.premium.badge + '</span>';
    if (isVerified(user)) html += ' <span class="badge badge-verified" title="Verified">' + config.verified.badge + '</span>';
    return html;
  };

  const getUploaderBadges = (s) => {
    const prem = config.debug.force_premium || config.debug.premium_user_ids.includes(s.user_id) || s.uploader_premium === 1;
    const ver = config.debug.force_verified || config.debug.verified_user_ids.includes(s.user_id) || s.uploader_verified === 1;
    return (prem ? '<span class="badge badge-premium badge-sm">' + config.premium.badge + '</span>' : '') +
           (ver ? '<span class="badge badge-verified badge-sm">' + config.verified.badge + '</span>' : '');
  };

  const isLiked = (userId, songId) => {
    if (!userId) return false;
    return !!db.prepare('SELECT id FROM likes WHERE user_id = ? AND song_id = ?').get(userId, songId);
  };

  const getAllowedQualities = (user) => {
    return isPremium(user) ? config.premium.allowed_qualities : config.free.allowed_qualities;
  };

  const isAdmin = (user) => {
    return user && config.admin && config.admin.admin_user_ids.includes(user.id);
  };

  const adminBadge = (user) => {
    if (!isAdmin(user)) return '';
    const badge = config.admin && config.admin.badge ? config.admin.badge : '🛡️';
    return ' <span class="badge badge-admin" title="Admin">' + badge + '</span>';
  };

  const userBadgeFull = (user) => {
    return userBadge(user) + adminBadge(user);
  };

  const GENRES = ['Pop','Rock','Hip Hop','Electronic','Jazz','Classical','R&B','Country','Metal','Folk','Blues','Reggae','Latin','Indie','Ambient','Nightcore','Techno','Phonk','Other'];

  const songItem = (s, extraMeta = '', userForLikes = null, userAlbums = [], userPlaylists = []) => {
    const q = s.bitrate ? '<span class="quality-badge">' + s.bitrate + 'kbps</span>' : '';
    const ub = getUploaderBadges(s);
    const userForLikeCount = userForLikes || null;
    const liked = userForLikeCount ? isLiked(userForLikeCount.id, s.id) : false;
    const likeCount = db.prepare('SELECT COUNT(*) AS c FROM likes WHERE song_id = ?').get(s.id).c;
    const h = liked ? '\u2665 ' + likeCount : '\u2661 ' + likeCount;
    const hc = liked ? 'liked' : '';
    const iconUrl = s.icon ? '/uploads/' + s.icon : 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50" fill="%231db954"/><text x="50" y="65" text-anchor="middle" font-size="50" fill="white">\u266B</text></svg>';
    return '<div class="song-item" data-id="' + s.id + '" data-title="' + escapeHtml(s.title) + '" data-artist="' + escapeHtml(s.artist) + '" data-uploader="' + escapeHtml(s.uploader_name || s.uploader || '') + '" data-file="/uploads/' + s.filename + '" data-duration="' + (s.duration || 0) + '" data-icon="' + (s.icon || '') + '" data-genre="' + escapeHtml(s.genre || '') + '">' +
      '<div class="song-icon-wrapper">' +
        '<img class="song-icon" src="' + iconUrl + '" alt="">' +
        '<button class="song-play-btn-preview" onclick="playPreview(event, ' + s.id + ', \'/uploads/' + s.filename + '\', \'' + escapeHtml(s.title) + '\', \'' + escapeHtml(s.artist) + '\')">\u25B6</button>' +
      '</div>' +
      '<div class="song-play-btn" onclick="playSongFull(event, ' + s.id + ', \'' + escapeHtml(s.title) + '\', \'' + escapeHtml(s.artist) + '\', \'/uploads/' + s.filename + '\', \'' + escapeHtml(s.genre || '') + '\')">\u25B6</div>' +
      '<div class="song-info"><strong>' + escapeHtml(s.title) + '</strong><span><a href="/artist/' + escapeHtml(s.uploader_name || s.uploader || '') + '" class="artist-link">' + escapeHtml(s.artist) + '</a></span></div>' +
      '<div class="song-meta">' + q + (s.genre ? '<span class="genre-tag">' + escapeHtml(s.genre) + '</span>' : '') + '<span class="song-uploader"><a href="/artist/' + escapeHtml(s.uploader_name || s.uploader || '') + '" class="artist-link">' + escapeHtml(s.uploader_name || s.uploader || '') + '</a> ' + ub + '</span><span>' + s.plays + ' plays</span>' + extraMeta + '</div>' +
      '<div class="song-actions">' +
        (userForLikeCount ? '<button class="like-btn ' + hc + '" data-id="' + s.id + '" title="Like">' + h + '</button>' : '') +
        '<button class="btn btn-sm btn-share" title="Share" onclick="copySongLink(' + s.id + ', \'' + escapeHtml(s.title) + '\')">\uD83D\uDD17</button>' +
        (userAlbums.length > 0 ? '<div class="dropdown song-dropdown"><button class="btn btn-sm btn-add" title="Add to Album">+ Album</button><div class="dropdown-menu">' + userAlbums.map(a => '<a href="#" onclick="addToAlbum(' + s.id + ', ' + a.id + '); return false;">' + escapeHtml(a.title) + '</a>').join('') + '</div></div>' : '') +
        (userPlaylists.length > 0 ? '<div class="dropdown song-dropdown"><button class="btn btn-sm btn-add" title="Add to Playlist">+ Playlist</button><div class="dropdown-menu">' + userPlaylists.map(p => '<a href="#" onclick="addToPlaylist(' + s.id + ', ' + p.id + '); return false;">' + escapeHtml(p.title) + '</a>').join('') + '</div></div>' : '') +
      '</div>' +
    '</div>';
  };

  return { escapeHtml, fmtDur, fmtDate, isPremium, isVerified, isAdmin, userBadge, adminBadge, userBadgeFull, getUploaderBadges, isLiked, songItem, getAllowedQualities, GENRES };
};
