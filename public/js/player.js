const playerBar = document.getElementById('playerBar');
const playBtn = document.getElementById('playBtn');
const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');
const shuffleBtn = document.getElementById('shuffleBtn');
const repeatBtn = document.getElementById('repeatBtn');
const queueBtn = document.getElementById('queueBtn');
const progressBar = document.getElementById('progressBar');
const volumeBar = document.getElementById('volumeBar');
const currentTimeEl = document.getElementById('currentTime');
const totalTimeEl = document.getElementById('totalTime');
const playerTitle = document.getElementById('playerTitle');
const playerArtist = document.getElementById('playerArtist');
const qualitySelect = document.getElementById('qualitySelect');
const sidebarIcon = document.getElementById('sidebarIcon');
const sidebarTitle = document.getElementById('sidebarTitle');
const sidebarArtist = document.getElementById('sidebarArtist');
const nowPlayingSidebar = document.getElementById('nowPlayingSidebar');
const shareBtn = document.getElementById('shareBtn');
const queuePanel = document.getElementById('queuePanel');
const queueList = document.getElementById('queueList');
const visualizer = document.getElementById('visualizer');
const audioControlsToggle = document.getElementById('audioControlsToggle');

let audio = null;
let audioContext = null;
let analyser = null;
let source = null;
let currentSongId = null;
let currentQuality = qualitySelect ? qualitySelect.value : 'standard';
let playlist = [];
let currentIndex = -1;
let shuffleMode = false;
let repeatMode = 0; // 0=none, 1=all, 2=one
let autoplayMode = true;
let crossfadeEnabled = false;
let crossfadeDuration = 3; // seconds
let isTransitioning = false;
let visualizerAnimId = null;

const REPEAT_ICONS = ['\uD83D\uDD01', '\uD83D\uDD01', '\uD83D\uDD04']; // repeat, repeat, repeat one
const REPEAT_TITLES = ['No Repeat', 'Repeat All', 'Repeat One'];

function escapeHtmlJS(str) {
  if (!str) return '';
  const d = document.createElement('div');
  d.appendChild(document.createTextNode(str));
  return d.innerHTML;
}

// ---- Audio Visualizer ----
function initVisualizer() {
  if (!visualizer || !audio) return;
  try {
    if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)();
    if (audioContext.state === 'suspended') audioContext.resume();
    if (source) source.disconnect();
    if (analyser) analyser.disconnect();
    source = audioContext.createMediaElementSource(audio);
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 128;
    source.connect(analyser);
    analyser.connect(audioContext.destination);
    drawVisualizer();
  } catch (e) { /* Visualizer not supported */ }
}

function drawVisualizer() {
  if (!analyser || !visualizer) return;
  const ctx = visualizer.getContext('2d');
  const w = visualizer.width = visualizer.clientWidth || 200;
  const h = visualizer.height = visualizer.clientHeight || 40;
  const bufferLength = analyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);
  
  function draw() {
    visualizerAnimId = requestAnimationFrame(draw);
    analyser.getByteFrequencyData(dataArray);
    ctx.clearRect(0, 0, w, h);
    const barWidth = (w / bufferLength) * 2.5;
    let x = 0;
    for (let i = 0; i < bufferLength; i++) {
      const barHeight = (dataArray[i] / 255) * h;
      ctx.fillStyle = '#1db954';
      ctx.fillRect(x, h - barHeight, barWidth, barHeight);
      x += barWidth + 1;
    }
  }
  draw();
}

function stopVisualizer() {
  if (visualizerAnimId) {
    cancelAnimationFrame(visualizerAnimId);
    visualizerAnimId = null;
  }
  if (visualizer) {
    const ctx = visualizer.getContext('2d');
    if (ctx) ctx.clearRect(0, 0, visualizer.width, visualizer.height);
  }
  if (source) { try { source.disconnect(); } catch(e) {} source = null; }
  if (analyser) { try { analyser.disconnect(); } catch(e) {} analyser = null; }
}

// ---- Queue Management ----
function buildPlaylist() {
  playlist = [];
  document.querySelectorAll('.song-item').forEach(el => {
    playlist.push({
      id: el.dataset.id,
      title: el.dataset.title,
      artist: el.dataset.artist,
      file: el.dataset.file,
      genre: el.dataset.genre || ''
    });
  });
  renderQueue();
}

function renderQueue() {
  if (!queueList) return;
  queueList.innerHTML = '';
  playlist.forEach((s, i) => {
    const div = document.createElement('div');
    div.className = 'queue-item' + (i === currentIndex ? ' active' : '');
    div.draggable = true;
    div.dataset.index = i;
    div.innerHTML = '<span class="queue-pos">' + (i + 1) + '</span><span class="queue-title">' + escapeHtmlJS(s.title) + '</span><span class="queue-artist">' + escapeHtmlJS(s.artist) + '</span><button class="queue-remove" data-index="' + i + '">\u2716</button>';
    div.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', i); div.classList.add('dragging'); });
    div.addEventListener('dragend', () => { div.classList.remove('dragging'); });
    div.addEventListener('dragover', (e) => { e.preventDefault(); div.classList.add('drag-over'); });
    div.addEventListener('dragleave', () => { div.classList.remove('drag-over'); });
    div.addEventListener('drop', (e) => {
      e.preventDefault();
      div.classList.remove('drag-over');
      const fromIdx = parseInt(e.dataTransfer.getData('text/plain'));
      const toIdx = i;
      if (fromIdx !== toIdx) {
        const [item] = playlist.splice(fromIdx, 1);
        playlist.splice(toIdx, 0, item);
        if (currentIndex === fromIdx) currentIndex = toIdx;
        else if (currentIndex > fromIdx && currentIndex <= toIdx) currentIndex--;
        else if (currentIndex < fromIdx && currentIndex >= toIdx) currentIndex++;
        renderQueue();
      }
    });
    div.querySelector('.queue-remove')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(e.target.dataset.index);
      playlist.splice(idx, 1);
      if (idx < currentIndex) currentIndex--;
      else if (idx === currentIndex) { if (audio) { audio.pause(); audio = null; playBtn.textContent = '\u25B6'; playerBar.style.display = 'none'; } currentIndex = -1; }
      renderQueue();
    });
    div.addEventListener('click', () => {
      if (i !== currentIndex) {
        currentIndex = i;
        const s = playlist[i];
        playSong(s.id, s.title, s.artist, s.file, s.genre || '');
      }
    });
    queueList.appendChild(div);
  });
}

function toggleQueue() {
  if (!queuePanel) return;
  queuePanel.classList.toggle('open');
  if (queuePanel.classList.contains('open')) renderQueue();
}

// ---- Crossfade ----
function crossfadeTo(nextFile, nextId, nextTitle, nextArtist, nextGenre) {
  if (!audio || !crossfadeEnabled || isTransitioning) {
    playSongDirect(nextId, nextTitle, nextArtist, nextFile, nextGenre);
    return;
  }
  isTransitioning = true;
  const currentAudio = audio;
  const fadeInterval = 50;
  const steps = (crossfadeDuration * 1000) / fadeInterval;
  let step = 0;
  
  const fadeOut = setInterval(() => {
    step++;
    if (currentAudio && currentAudio.volume !== undefined) {
      currentAudio.volume = Math.max(0, volumeBar.value * (1 - step / steps));
    }
    if (step >= steps) {
      clearInterval(fadeOut);
      if (currentAudio) { currentAudio.pause(); currentAudio.src = ''; }
      playSongDirect(nextId, nextTitle, nextArtist, nextFile, nextGenre);
      if (audio) audio.volume = 0;
      let inStep = 0;
      const fadeIn = setInterval(() => {
        inStep++;
        if (audio) audio.volume = Math.min(volumeBar.value, (inStep / steps) * volumeBar.value);
        if (inStep >= steps) { clearInterval(fadeIn); if (audio) audio.volume = volumeBar.value; isTransitioning = false; }
      }, fadeInterval);
    }
  }, fadeInterval);
}

function playSongDirect(id, title, artist, file, genre) {
  if (audio) { audio.pause(); audio.src = ''; audio = null; }
  stopVisualizer();
  
  const url = streamUrl(file, currentQuality);
  audio = new Audio(url);
  audio.volume = volumeBar.value;
  currentSongId = id;
  
  playerTitle.textContent = title;
  playerArtist.textContent = artist;
  playerBar.style.display = 'block';
  playBtn.textContent = '\u23F8';
  
  document.querySelectorAll('.song-item.active').forEach(el => el.classList.remove('active'));
  const activeItem = document.querySelector('.song-item[data-id="' + id + '"]');
  if (activeItem) {
    activeItem.classList.add('active');
    updateSidebar({
      id: activeItem.dataset.id,
      title: activeItem.dataset.title,
      artist: activeItem.dataset.artist,
      uploader: activeItem.dataset.uploader || '',
      icon: activeItem.dataset.icon || '',
      genre: activeItem.dataset.genre || ''
    });
    updateLikeCount(id);
  }
  
  if (activeItem && activeItem.dataset.duration && activeItem.dataset.duration > 0) {
    totalTimeEl.textContent = formatTime(activeItem.dataset.duration);
    progressBar.max = activeItem.dataset.duration;
  }
  
  audio.addEventListener('loadedmetadata', () => {
    totalTimeEl.textContent = formatTime(audio.duration);
    progressBar.max = audio.duration || 100;
    progressBar.value = 0;
    progressBar.style.background = 'linear-gradient(to right, var(--accent) 0%, var(--bg4) 0%)';
  });
  
  audio.addEventListener('timeupdate', () => {
    if (audio && audio.duration) {
      const pct = (audio.currentTime / audio.duration) * 100;
      progressBar.value = audio.currentTime;
      progressBar.style.background = 'linear-gradient(to right, var(--accent) ' + pct + '%, var(--bg4) ' + pct + '%)';
      currentTimeEl.textContent = formatTime(audio.currentTime);
    }
  });
  
  audio.addEventListener('ended', () => {
    playBtn.textContent = '\u25B6';
    handleSongEnd(genre);
  });
  
  audio.addEventListener('error', () => {
    playBtn.textContent = '\u25B6';
  });
  
  audio.play().catch(() => { playBtn.textContent = '\u25B6'; });
  
  const csrf = document.getElementById('csrfToken')?.value || '';
  fetch('/song/' + id + '/play', { method: 'POST', headers:{'X-CSRF-Token':csrf, 'Content-Type':'application/json'}, body:'{}' }).then(() => updatePlayCount(id)).catch(() => {});
  
  setTimeout(() => initVisualizer(), 100);
}

function playSong(id, title, artist, file, genre) {
  if (crossfadeEnabled && audio && !audio.paused) {
    crossfadeTo(file, id, title, artist, genre);
  } else {
    playSongDirect(id, title, artist, file, genre);
  }
}

function handleSongEnd(genre) {
  if (repeatMode === 2 && currentIndex >= 0) {
    const s = playlist[currentIndex];
    playSong(s.id, s.title, s.artist, s.file, s.genre || '');
    return;
  }
  if (currentIndex < playlist.length - 1 || shuffleMode || repeatMode === 1) {
    nextSong();
  } else if (autoplayMode && genre) {
    playAutoplaySuggestion(currentSongId, genre);
  }
  // Radio mode auto-fetch
  if (radioMode && currentSongId) {
    fetchRadioSongs(currentSongId);
  }
}

// ---- playSongFull (from song detail page) ----
function playSongFull(event, id, title, artist, file, genre, uploader, icon) {
  if (event) event.preventDefault();
  playSong(id, title, artist, file, genre);
  updateSidebar({ id, title, artist, uploader: uploader || artist, icon: icon || '', genre: genre || '' });
}

// ---- Existing functions preserved ----
function formatTime(seconds) {
  if (isNaN(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return m + ':' + (s < 10 ? '0' : '') + s;
}

function streamUrl(file, quality) {
  if (quality === 'original') return file;
  return file + '?q=' + quality;
}

function updateSidebar(songData) {
  if (!nowPlayingSidebar) return;
  const iconWrap = document.querySelector('.sidebar-icon-wrap');
  if (iconWrap) {
    if (songData.icon && songData.icon.trim()) {
      iconWrap.innerHTML = '<img src="/uploads/' + songData.icon + '" class="sidebar-icon-img" alt="Icon">';
    } else {
      iconWrap.innerHTML = '<div class="sidebar-icon-placeholder">\uD83C\uDFB5</div>';
    }
  }
  const st = document.querySelector('.sidebar-title');
  const sa = document.querySelector('.sidebar-artist');
  if (st) st.textContent = songData.title || 'Title';
  if (sa) sa.textContent = songData.artist || 'Artist';
  nowPlayingSidebar.style.display = 'block';
  if (shareBtn) {
    shareBtn.onclick = () => {
      const url = window.location.origin + '/share/song/' + songData.id;
      navigator.clipboard.writeText(url).then(() => { shareBtn.textContent = '\u2713'; setTimeout(() => { shareBtn.textContent = '\uD83D\uDD17'; }, 2000); }).catch(() => {});
    };
  }
  const reportBtn = document.getElementById('reportBtn');
  if (reportBtn) {
    reportBtn.onclick = () => { if (window.loadPage) window.loadPage('/copyright?song_id=' + songData.id); };
  }
  renderQueue();
}

function updateSidebarFromActive() {
  const active = document.querySelector('.song-item.active');
  if (active) {
    updateSidebar({
      id: active.dataset.id,
      title: active.dataset.title,
      artist: active.dataset.artist,
      uploader: active.dataset.uploader || '',
      icon: active.dataset.icon || ''
    });
  }
}

async function updateLikeCount(songId) {
  try {
    const r = await fetch('/api/likes/count/' + songId);
    const d = await r.json();
    const btn = document.querySelector('.like-btn[data-id="' + songId + '"]');
    if (btn) {
      const liked = btn.classList.contains('liked');
      btn.textContent = liked ? '\u2665 ' + d.count : '\u2661 ' + d.count;
    }
  } catch (e) {}
}

async function updatePlayCount(songId) {
  try {
    const r = await fetch('/song/' + songId + '/data');
    const d = await r.json();
    const item = document.querySelector('.song-item[data-id="' + songId + '"]');
    if (item) {
      const playsSpan = item.querySelector('.song-meta span:last-child');
      if (playsSpan) playsSpan.textContent = d.plays + ' plays';
    }
  } catch (e) {}
}

function togglePlay() {
  if (!audio) {
    const first = document.querySelector('.song-item');
    if (first) {
      buildPlaylist();
      const idx = playlist.findIndex(s => s.id == first.dataset.id);
      if (idx >= 0) currentIndex = idx;
      playSong(first.dataset.id, first.dataset.title, first.dataset.artist, first.dataset.file, first.dataset.genre || '');
    }
    return;
  }
  if (audio.paused) {
    audio.play().then(() => { playBtn.textContent = '\u23F8'; if (audioContext && audioContext.state === 'suspended') audioContext.resume(); }).catch(() => {});
  } else {
    audio.pause();
    playBtn.textContent = '\u25B6';
  }
}

function nextSong() {
  if (playlist.length === 0) return;
  if (shuffleMode) {
    let next = Math.floor(Math.random() * playlist.length);
    while (next === currentIndex && playlist.length > 1) next = Math.floor(Math.random() * playlist.length);
    currentIndex = next;
  } else {
    currentIndex = (currentIndex + 1) % playlist.length;
  }
  const s = playlist[currentIndex];
  playSong(s.id, s.title, s.artist, s.file, s.genre || '');
}

function prevSong() {
  if (playlist.length === 0) return;
  if (audio && audio.currentTime > 3) {
    audio.currentTime = 0;
    return;
  }
  if (shuffleMode) {
    let next = Math.floor(Math.random() * playlist.length);
    while (next === currentIndex && playlist.length > 1) next = Math.floor(Math.random() * playlist.length);
    currentIndex = next;
  } else {
    currentIndex = (currentIndex - 1 + playlist.length) % playlist.length;
  }
  const s = playlist[currentIndex];
  playSong(s.id, s.title, s.artist, s.file, s.genre || '');
}

async function playAutoplaySuggestion(songId, genre) {
  try {
    const r = await fetch('/api/suggestions/' + songId);
    const suggestions = await r.json();
    if (suggestions.length > 0) {
      const s = suggestions[0];
      window.buildPlaylist();
      playlist.push({ id: s.id, title: s.title, artist: s.artist, file: s.file, genre: s.genre || '' });
      currentIndex = playlist.length - 1;
      playSong(s.id, s.title, s.artist, s.file, s.genre || '');
    }
  } catch (e) {}
}

// ---- Event Handlers ----
document.getElementById('mainContent')?.addEventListener('click', (e) => {
  const item = e.target.closest('.song-item');
  if (item && !e.target.closest('.like-btn') && !e.target.closest('form') && !e.target.closest('a') && !e.target.closest('.song-dropdown')) {
    buildPlaylist();
    currentIndex = playlist.findIndex(s => s.id == item.dataset.id);
    playSong(item.dataset.id, item.dataset.title, item.dataset.artist, item.dataset.file, item.dataset.genre || '');
  }
});

// Like handling
let lastLikeTime = 0;
const LIKE_COOLDOWN = 2000;

document.getElementById('mainContent')?.addEventListener('click', async (e) => {
  const btn = e.target.closest('.like-btn');
  if (btn) {
    e.stopPropagation();
    const now = Date.now();
    if (now - lastLikeTime < LIKE_COOLDOWN) {
      btn.textContent = '\u23F3 Wait';
      setTimeout(() => {
        const liked = btn.classList.contains('liked');
        const c = btn.textContent.match(/\d+/)?.[0] || '0';
        btn.textContent = liked ? '\u2665 ' + c : '\u2661 ' + c;
      }, 1000);
      return;
    }
    lastLikeTime = now;
    const id = btn.dataset.id;
    try {
      const csrf = document.getElementById('csrfToken')?.value || '';
      const r = await fetch('/song/' + id + '/like', { method: 'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({_csrf:csrf}) });
      const d = await r.json();
      btn.textContent = d.liked ? '\u2665 ' + (d.likeCount || 0) : '\u2661 ' + (d.likeCount || 0);
      btn.classList.toggle('liked', d.liked);
    } catch (err) {
      btn.textContent = '\u274C Error';
      setTimeout(() => {
        const liked = btn.classList.contains('liked');
        const c = btn.textContent.match(/\d+/)?.[0] || '0';
        btn.textContent = liked ? '\u2665 ' + c : '\u2661 ' + c;
      }, 1000);
    }
  }
});

// Follow handling
document.getElementById('mainContent')?.addEventListener('click', async (e) => {
  const btn = e.target.closest('.follow-btn');
  if (btn) {
    const id = btn.dataset.id;
    const csrf = document.getElementById('csrfToken')?.value || '';
    const r = await fetch('/follow/' + id, { method: 'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({_csrf:csrf}) });
    const d = await r.json();
    btn.textContent = d.following ? 'Unfollow' : 'Follow';
    btn.dataset.following = d.following;
  }
});

// ---- Controls binding ----
playBtn?.addEventListener('click', togglePlay);
prevBtn?.addEventListener('click', prevSong);
nextBtn?.addEventListener('click', nextSong);

if (shuffleBtn) {
  shuffleBtn.addEventListener('click', () => {
    shuffleMode = !shuffleMode;
    shuffleBtn.style.color = shuffleMode ? '#1db954' : '';
    shuffleBtn.title = shuffleMode ? 'Shuffle On' : 'Shuffle Off';
    shuffleBtn.style.opacity = shuffleMode ? '1' : '0.6';
  });
}

if (repeatBtn) {
  repeatBtn.addEventListener('click', () => {
    repeatMode = (repeatMode + 1) % 3;
    repeatBtn.textContent = REPEAT_ICONS[repeatMode];
    repeatBtn.title = REPEAT_TITLES[repeatMode];
    repeatBtn.style.color = repeatMode > 0 ? '#1db954' : '';
    repeatBtn.style.opacity = repeatMode > 0 ? '1' : '0.6';
  });
}

const radioBtn = document.getElementById('radioBtn');
if (radioBtn) {
  radioBtn.addEventListener('click', toggleRadio);
}

const saveQueueBtn = document.getElementById('saveQueueBtn');
if (saveQueueBtn) {
  saveQueueBtn.addEventListener('click', saveQueueAsPlaylist);
}

if (queueBtn) {
  queueBtn.addEventListener('click', toggleQueue);
}

if (audioControlsToggle) {
  audioControlsToggle.addEventListener('click', toggleAudioControls);
}

progressBar?.addEventListener('input', () => {
  if (audio && audio.duration) audio.currentTime = progressBar.value;
});

volumeBar?.addEventListener('input', () => {
  if (audio) audio.volume = volumeBar.value;
});

if (qualitySelect) {
  qualitySelect.addEventListener('change', () => {
    currentQuality = qualitySelect.value;
    if (audio && currentSongId) {
      const idx = playlist.findIndex(s => s.id == currentSongId);
      if (idx >= 0) {
        const s = playlist[idx];
        playSong(s.id, s.title, s.artist, s.file, s.genre || '');
      }
    }
  });
}

document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
  if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
});

// ---- Copy song link ----
function copySongLink(songId, songTitle) {
  const url = window.location.origin + '/share/song/' + songId;
  navigator.clipboard.writeText(url).then(() => {       showToast('Song link copied: ' + songTitle, 'success');     }).catch(() => { showToast('Failed to copy', 'error'); });
}

// ---- Live updates ----
let prevUnread = 0;

function startLiveUpdates() {
  setInterval(() => {
    document.querySelectorAll('.like-btn').forEach(btn => {
      const id = btn.dataset.id;
      if (id) {
        fetch('/api/likes/count/' + id).then(r => r.json()).then(d => {
          const liked = btn.classList.contains('liked');
          btn.textContent = liked ? '\u2665 ' + d.count : '\u2661 ' + d.count;
        }).catch(() => {});
      }
    });
    const notifBtn = document.getElementById('notifBtn');
    if (notifBtn) {
      fetch('/api/notifications').then(r => r.json()).then(d => {
        if (d.unread > 0) {
          if (d.unread > prevUnread && d.notifications && d.notifications.length) {
            const latest = d.notifications[0];
            if (latest.type === 'upload') showToast(latest.message, 'info');
          }
          notifBtn.textContent = '\uD83D\uDD14 ' + d.unread;
          notifBtn.style.color = '#1db954';
        } else {
          notifBtn.textContent = '\uD83D\uDD14';
          notifBtn.style.color = '';
        }
        prevUnread = d.unread;
      }).catch(() => {});
    }
  }, 30000);
}

// ---- Notification panel ----
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('#notifBtn');
  if (btn) {
    e.stopPropagation();
    const panel = document.getElementById('notifPanel');
    if (!panel) return;
    if (panel.style.display === 'block') { panel.style.display = 'none'; return; }
    try {
      const r = await fetch('/api/notifications');
      const d = await r.json();
      panel.innerHTML = '<div class="notif-header"><strong>Notifications</strong></div>' +
        (d.notifications.length ? d.notifications.map(n =>
          '<div class="notif-item' + (n.is_read ? '' : ' unread') + '">' + escapeHtmlJS(n.message) + '<br><small>' + formatTimeAgo(n.created_at) + '</small></div>'
        ).join('') : '<div class="notif-item">No notifications</div>');
      panel.style.display = 'block';
      const csrf = document.getElementById('csrfToken')?.value || '';
      fetch('/api/notifications/read', { method: 'POST', headers:{'X-CSRF-Token':csrf} });
      btn.textContent = '\uD83D\uDD14';
      btn.style.color = '';
    } catch (e) {}
  }
  if (!e.target.closest('#notifPanel') && !e.target.closest('#notifBtn')) {
    const p = document.getElementById('notifPanel');
    if (p) p.style.display = 'none';
  }
});

function formatTimeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + 'm ago';
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + 'h ago';
  return Math.floor(hrs / 24) + 'd ago';
}

// ---- Init ----
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startLiveUpdates);
} else {
  startLiveUpdates();
}

// File input handlers
document.getElementById('audioFile')?.addEventListener('change', function() {
  const n = document.getElementById('fileName');
  if (n) n.textContent = this.files[0] ? this.files[0].name : 'No file selected';
});
document.getElementById('iconFile')?.addEventListener('change', function() {
  const n = document.getElementById('iconName');
  if (n) n.textContent = this.files[0] ? this.files[0].name : 'No file selected';
});

// Export for inline scripts
window.playSong = playSong;
window.buildPlaylist = buildPlaylist;
window.updateSidebarFromActive = updateSidebarFromActive;
window.formatTime = formatTime;

// ---- Toast Notification System ----
function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) return;
  const el = document.createElement('div');
  el.className = 'toast toast-' + type;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => { if (el.parentNode) el.remove(); }, 4000);
}
window.showToast = showToast;

// ---- Audio Controls (Speed, Gain, Equalizer) ----
let playbackSpeed = 1.0;
let volumeGain = 1.0;
let equalizerBands = { 60: 0, 170: 0, 310: 0, 600: 0, 1000: 0, 3000: 0, 6000: 0, 12000: 0, 14000: 0, 16000: 0 };

function toggleAudioControls() {
  const panel = document.getElementById('audioControlsPanel');
  if (panel) panel.classList.toggle('open');
}

function setSpeed(val) {
  playbackSpeed = parseFloat(val);
  const display = document.getElementById('speedValue');
  if (display) display.textContent = val + 'x';
  if (audio) audio.playbackRate = playbackSpeed;
}

function setGain(val) {
  volumeGain = parseFloat(val);
  const display = document.getElementById('gainValue');
  if (display) display.textContent = Math.round(val * 100) + '%';
  if (window.audioContext && window.gainNode) {
    window.gainNode.gain.value = currentVolume * volumeGain;
  }
}

function setEqualizerBand(band, val) {
  equalizerBands[band] = parseFloat(val);
  // EQ is visual-only for now; full Web Audio EQ would require BiquadFilterNode per band
}

function resetAudioControls() {
  setSpeed(1.0);
  setGain(1.0);
  document.querySelectorAll('.eq-slider').forEach(s => { s.value = 0; });
  Object.keys(equalizerBands).forEach(k => { equalizerBands[k] = 0; });
}

// ---- Radio Mode ----
let radioMode = false;
let radioQueue = [];

function toggleRadio() {
  radioMode = !radioMode;
  const btn = document.getElementById('radioBtn');
  if (btn) {
    btn.style.color = radioMode ? '#1db954' : '';
    btn.title = radioMode ? 'Radio On' : 'Radio Off';
  }
  if (radioMode && audio && !audio.paused) {
    fetchRadioSongs(currentSongId);
  }
  showToast(radioMode ? 'Radio mode on' : 'Radio mode off', 'info');
}

async function fetchRadioSongs(songId) {
  try {
    const r = await fetch('/api/radio/' + songId);
    const songs = await r.json();
    if (songs.length) {
      radioQueue = songs.filter(s => s.id !== currentSongId);
      if (radioQueue.length && playlist.length === 0) {
        playlist = radioQueue.map(s => ({ id: s.id, title: s.title, artist: s.uploader_name || s.artist, file: '/uploads/' + s.filename, duration: s.duration, genre: s.genre }));
        renderQueue();
      }
    }
  } catch (e) { console.error('Radio fetch error:', e); }
}

// ---- Save Queue as Playlist ----
async function saveQueueAsPlaylist() {
  if (!playlist.length) return showToast('Queue is empty', 'error');
  const name = prompt('Playlist name:');
  if (!name || !name.trim()) return;
  try {
    const csrf = document.getElementById('csrfToken')?.value || '';
    const r = await fetch('/playlist/create', {
      method: 'POST',
      headers: {'Content-Type': 'application/x-www-form-urlencoded'},
      body: 'title=' + encodeURIComponent(name.trim()) + '&description=Saved from queue&_csrf=' + encodeURIComponent(csrf)
    });
    if (!r.ok) return showToast('Failed to create playlist', 'error');
    const text = await r.text();
    showToast('Playlist created!', 'success');
  } catch (e) { showToast('Error saving queue', 'error'); }
}

// ---- Comments ----
async function postComment(event, songId) {
  event.preventDefault();
  const form = event.target;
  const text = form.text.value.trim();
  if (!text) return;
  const rating = parseInt(form.rating?.value || '0');
  const csrf = document.getElementById('csrfToken')?.value || '';
  try {
    const r = await fetch('/api/song/' + songId + '/comment', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ text, rating, _csrf: csrf })
    });
    const d = await r.json();
    if (d.ok) {
      showToast('Comment posted!', 'success');
      form.text.value = '';
      form.rating.value = '0';
      const stars = form.querySelectorAll('.star-rating .star');
      stars.forEach(s => s.classList.remove('active'));
      loadComments(songId);
    } else showToast(d.error || 'Failed to post comment', 'error');
  } catch (e) { showToast('Network error', 'error'); }
}

async function deleteComment(commentId, btn) {
  if (!confirm('Delete this comment?')) return;
  const csrf = document.getElementById('csrfToken')?.value || '';
  try {
    const r = await fetch('/api/comment/' + commentId + '/delete', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ _csrf: csrf })
    });
    const d = await r.json();
    if (d.ok) {
      btn.closest('.comment')?.remove();
      showToast('Comment deleted', 'success');
    } else showToast(d.error || 'Failed to delete', 'error');
  } catch (e) { showToast('Network error', 'error'); }
}

async function loadComments(songId) {
  try {
    const r = await fetch('/api/song/' + songId + '/comments');
    const comments = await r.json();
    const list = document.querySelector('.comments-list');
    if (!list) return;
    const header = list.closest('.admin-section')?.querySelector('h2');
    if (header) header.textContent = 'Comments (' + comments.length + ')';
    if (comments.length === 0) {
      list.innerHTML = '<p class="text-muted">No comments yet.</p>';
      return;
    }
    list.innerHTML = comments.map(c => {
      let starsHtml = '';
      if (c.rating > 0) {
        starsHtml = '<div class="comment-rating">';
        for (let i = 1; i <= 5; i++) {
          starsHtml += '<span class="star' + (i <= c.rating ? ' filled' : '') + '">★</span>';
        }
        starsHtml += '</div>';
      }
      return '<div class="comment" style="padding:12px 0;border-bottom:1px solid var(--border)">' +
        '<div class="comment-header" style="display:flex;justify-content:space-between;margin-bottom:4px">' +
        '<strong>' + escapeHtml(c.username) + '</strong>' +
        '<small style="color:var(--text3)">' + fmtDate(c.created_at) + '</small></div>' +
        starsHtml +
        '<p style="margin-bottom:6px;word-break:break-word">' + escapeHtml(c.text) + '</p>' +
        '<div class="comment-actions" style="display:flex;gap:8px">' +
        '<button class="comment-like-btn" onclick="likeComment(' + c.id + ', this)">♡ <span class="like-count">0</span></button>' +
        (c.user_id === currentUserId ? '<button class="comment-like-btn" onclick="deleteComment(' + c.id + ', this)">🗑</button>' : '') +
        '</div></div>';
    }).join('');
  } catch (e) { console.error('Failed to load comments', e); }
}

// ---- Like comment ----
function likeComment(commentId, btn) {
  const csrf = document.getElementById('csrfToken')?.value;
  fetch('/api/comment/' + commentId + '/like', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ _csrf: csrf })
  }).then(r => r.json()).then(d => {
    if (d.error) return showToast(d.error, 'error');
    btn.classList.toggle('liked', d.liked);
    const countSpan = btn.querySelector('.like-count');
    if (countSpan) countSpan.textContent = d.count;
    btn.textContent = (d.liked ? '\u2665' : '\u2661') + ' ' + d.count;
  }).catch(() => showToast('Failed to like comment', 'error'));
}
