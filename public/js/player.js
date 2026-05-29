const playerBar = document.getElementById('playerBar');
const playBtn = document.getElementById('playBtn');
const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');
const shuffleBtn = document.getElementById('shuffleBtn');
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
const sidebarUploader = document.getElementById('sidebarUploader');
const nowPlayingSidebar = document.getElementById('nowPlayingSidebar');
const shareBtn = document.getElementById('shareBtn');

let audio = null;
let currentSongId = null;
let currentQuality = qualitySelect ? qualitySelect.value : 'standard';
let playlist = [];
let currentIndex = -1;
let shuffleMode = false;
let autoplayMode = true;

async function updateLikeCount(songId) {
  try {
    const r = await fetch('/api/likes/count/' + songId);
    const d = await r.json();
    const btn = document.querySelector(`.like-btn[data-id="${songId}"]`);
    if (btn) {
      const liked = btn.classList.contains('liked');
      btn.textContent = liked ? '♥ ' + d.count : '♡ ' + d.count;
    }
  } catch (e) {}
}

async function updatePlayCount(songId) {
  try {
    const r = await fetch('/song/' + songId + '/data');
    const d = await r.json();
    const item = document.querySelector(`.song-item[data-id="${songId}"]`);
    if (item) {
      const playsSpan = item.querySelector('.song-meta span:last-child');
      if (playsSpan) playsSpan.textContent = d.plays + ' plays';
    }
  } catch (e) {}
}

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
  const hasIcon = songData.icon && songData.icon.trim();
  const iconWrap = document.querySelector('.sidebar-icon-wrap');
  if (hasIcon) {
    iconWrap.innerHTML = '<img src="/uploads/' + songData.icon + '" class="sidebar-icon-img" alt="Icon">';
  } else {
    iconWrap.innerHTML = '<div class="sidebar-icon-placeholder">🎵</div>';
  }
  const sidebarTitle = document.querySelector('.sidebar-title');
  const sidebarArtist = document.querySelector('.sidebar-artist');
  const shareBtn = document.getElementById('shareBtn');
  const reportBtn = document.getElementById('reportBtn');
  sidebarTitle.textContent = songData.title || 'Title';
  sidebarArtist.textContent = songData.artist || 'Artist';
  nowPlayingSidebar.style.display = 'block';
  if (shareBtn) {
    shareBtn.onclick = () => {
      const url = window.location.origin + '/share/song/' + songData.id;
      navigator.clipboard.writeText(url).then(() => { shareBtn.textContent = '✓ Copied'; setTimeout(() => { shareBtn.textContent = '🔗'; }, 2000); }).catch(() => {});
    };
  }
  if (reportBtn) {
    reportBtn.onclick = () => {
      window.loadPage('/copyright?song_id=' + songData.id);
    };
  }
}

function updateSidebarFromActive() {
  const active = document.querySelector('.song-item.active');
  if (active) {
    updateSidebar({
      id: active.dataset.id,
      title: active.dataset.title,
      artist: active.dataset.artist,
      uploader: active.dataset.uploader,
      icon: active.dataset.icon || '',
      premiumBadge: '',
      verifiedBadge: ''
    });
  }
}

async function playSong(id, title, artist, file, genre) {
  if (audio) {
    audio.pause();
    audio = null;
  }

  const url = streamUrl(file, currentQuality);
  audio = new Audio(url);
  audio.volume = volumeBar.value;
  currentSongId = id;

  playerTitle.textContent = title;
  playerArtist.textContent = artist;
  playerBar.style.display = 'block';
  playBtn.textContent = '⏸';

  document.querySelectorAll('.song-item.active').forEach(el => el.classList.remove('active'));
  const activeItem = document.querySelector(`.song-item[data-id="${id}"]`);
  if (activeItem) {
    activeItem.classList.add('active');
    const ub = activeItem.querySelector('.badge') ? activeItem.querySelector('.song-meta')?.innerHTML?.match(/<span class="badge.*?">.*?<\/span>/g)?.join('') || '' : '';
    updateSidebar({
      id: activeItem.dataset.id,
      title: activeItem.dataset.title,
      artist: activeItem.dataset.artist,
      uploader: activeItem.dataset.uploader || '',
      icon: activeItem.dataset.icon || '',
      genre: activeItem.dataset.genre || '',
      premiumBadge: '',
      verifiedBadge: ''
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
  });

  audio.addEventListener('timeupdate', () => {
    if (audio.duration) {
      progressBar.value = audio.currentTime;
      currentTimeEl.textContent = formatTime(audio.currentTime);
    }
  });

  audio.addEventListener('ended', () => {
    playBtn.textContent = '▶';
    if (currentIndex < playlist.length - 1 || shuffleMode) {
      nextSong();
    } else if (autoplayMode && genre) {
      playAutoplaySuggestion(id, genre);
    }
  });

  audio.addEventListener('error', () => {
    playBtn.textContent = '▶';
  });

  audio.play().catch(() => {
    playBtn.textContent = '▶';
  });

  fetch('/song/' + id + '/play', { method: 'POST' }).then(() => updatePlayCount(id)).catch(() => {});
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

function togglePlay() {
  if (!audio) {
    const first = document.querySelector('.song-item');
    if (first) {
      const id = first.dataset.id;
      const title = first.dataset.title;
      const artist = first.dataset.artist;
      const file = first.dataset.file;
      const genre = first.dataset.genre || '';
      buildPlaylist();
      const idx = playlist.findIndex(s => s.id == id);
      if (idx >= 0) currentIndex = idx;
      playSong(id, title, artist, file, genre);
    }
    return;
  }

  if (audio.paused) {
    audio.play().then(() => { playBtn.textContent = '⏸'; }).catch(() => {});
  } else {
    audio.pause();
    playBtn.textContent = '▶';
  }
}

function nextSong() {
  if (playlist.length === 0) return;
  if (shuffleMode) {
    currentIndex = Math.floor(Math.random() * playlist.length);
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
    currentIndex = Math.floor(Math.random() * playlist.length);
  } else {
    currentIndex = (currentIndex - 1 + playlist.length) % playlist.length;
  }
  const s = playlist[currentIndex];
  playSong(s.id, s.title, s.artist, s.file, s.genre || '');
}

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
}

document.getElementById('mainContent').addEventListener('click', (e) => {
  const item = e.target.closest('.song-item');
  if (item && !e.target.closest('.like-btn') && !e.target.closest('form') && !e.target.closest('a')) {
    const id = item.dataset.id;
    const title = item.dataset.title;
    const artist = item.dataset.artist;
    const file = item.dataset.file;
    const genre = item.dataset.genre || '';
    buildPlaylist();
    currentIndex = playlist.findIndex(s => s.id == id);
    playSong(id, title, artist, file, genre);
  }
});

document.getElementById('mainContent').addEventListener('click', async (e) => {
  const btn = e.target.closest('.like-btn');
  if (btn) {
    e.stopPropagation();
    const id = btn.dataset.id;
    const r = await fetch('/song/' + id + '/like', { method: 'POST' });
    const d = await r.json();
    btn.textContent = d.liked ? '♥' : '♡';
    btn.classList.toggle('liked', d.liked);
    updateLikeCount(id);
  }
});

document.getElementById('mainContent').addEventListener('click', async (e) => {
  const btn = e.target.closest('.follow-btn');
  if (btn) {
    const id = btn.dataset.id;
    const r = await fetch('/follow/' + id, { method: 'POST' });
    const d = await r.json();
    btn.textContent = d.following ? 'Unfollow' : 'Follow';
    btn.dataset.following = d.following;
  }
});

playBtn.addEventListener('click', togglePlay);
prevBtn.addEventListener('click', prevSong);
nextBtn.addEventListener('click', nextSong);

if (shuffleBtn) {
  shuffleBtn.addEventListener('click', () => {
    shuffleMode = !shuffleMode;
    shuffleBtn.style.color = shuffleMode ? 'var(--accent)' : '';
    shuffleBtn.title = shuffleMode ? 'Shuffle On' : 'Shuffle';
  });
}

progressBar.addEventListener('input', () => {
  if (audio && audio.duration) {
    audio.currentTime = progressBar.value;
  }
});

volumeBar.addEventListener('input', () => {
  if (audio) {
    audio.volume = volumeBar.value;
  }
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
  if (e.code === 'Space') {
    e.preventDefault();
    togglePlay();
  }
});

document.getElementById('audioFile')?.addEventListener('change', function() {
  const fileName = document.getElementById('fileName');
  fileName.textContent = this.files[0] ? this.files[0].name : 'No file selected';
});
document.getElementById('iconFile')?.addEventListener('change', function() {
  const iconName = document.getElementById('iconName');
  iconName.textContent = this.files[0] ? this.files[0].name : 'No file selected';
});
