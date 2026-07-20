const API = '/api/v1';
let VIDEO_ID = null;
let DURATION = 0;
let hlsInstance = null;
let currentItem = null;
let showEpisodes = [];
let autoHideTimer = null;
let isSeeking = false;
let thumbnailData = null;
let preloadHlsInstance = null;
let preloadNextEp = null;

function getToken() { return localStorage.getItem('token'); }

function showToast(msg, type) {
  let t = document.getElementById('toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    t.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);z-index:9999;padding:10px 20px;border-radius:6px;font-size:.85rem;transition:opacity .3s;max-width:90vw;text-align:center';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.style.background = type === 'error' ? '#e74c3c' : '#2ecc71';
  t.style.color = '#fff';
  t.style.opacity = '1';
  clearTimeout(t._hide);
  t._hide = setTimeout(function(){ t.style.opacity = '0'; }, 4000);
}

async function apiFetch(path, opts) {
  const token = getToken();
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const res = await fetch(API + path, { ...opts, headers });
  if (res.status === 401) { window.location.href = '/'; return null; }
  return res;
}

function getParams() {
  const p = new URLSearchParams(window.location.search);
  return { id: p.get('id') };
}

async function loadMedia(id) {
  const all = window._nextflixMedia || (await (await apiFetch('/media')).json());
  const item = all.find(m => m.id == id);
  if (!item) { document.getElementById('playerTitle').textContent = 'Not found'; return; }
  currentItem = item;
  VIDEO_ID = item.id;
  DURATION = item.duration_seconds;
  showEpisodes = all.filter(m =>
    m.show_name === item.show_name &&
    m.season_number > 0 &&
    m.episode_number > 0
  ).sort((a, b) => a.season_number - b.season_number || a.episode_number - b.episode_number);

  document.getElementById('playerTitle').textContent = item.title;
  const meta = document.getElementById('playerMeta');
  const parts = [];
  if (item.media_type) parts.push(item.media_type.toUpperCase());
  if (item.rating) parts.push(item.rating);
  if (item.duration_seconds) {
    const h = Math.floor(item.duration_seconds / 3600);
    const m = Math.floor((item.duration_seconds % 3600) / 60);
    parts.push(h + 'h ' + m + 'm');
  }
  meta.innerHTML = '<h2>' + item.title + '</h2><div class="meta-line">' + parts.join(' · ') + '</div><p>' + (item.overview || '') + '</p>';
  loadTracks(id);
  initPlayer(item);
}

async function loadTracks(id) {
  const [subRes, audioRes] = await Promise.all([
    apiFetch('/media/' + id + '/subtitles'),
    apiFetch('/media/' + id + '/audio'),
  ]);
  window._extSubs = subRes ? await subRes.json() : [];
  window._extAudios = audioRes ? await audioRes.json() : [];
}

function onSubtitleChange(value) {
  const video = document.getElementById('video');
  if (value.startsWith('hls-')) {
    if (hlsInstance) hlsInstance.subtitleTrack = parseInt(value.replace('hls-', ''), 10);
  } else if (value) {
    let trackEl = video.querySelector('track[data-subtitle]');
    if (!trackEl) {
      trackEl = document.createElement('track');
      trackEl.setAttribute('data-subtitle', '');
      trackEl.kind = 'subtitles';
      trackEl.label = 'Subtitles';
      video.appendChild(trackEl);
    }
    trackEl.src = API + '/subtitle/' + value + '/file';
    trackEl.track.mode = 'showing';
  }
}

function onAudioChange(value) {
  if (value.startsWith('hls-') && hlsInstance) {
    hlsInstance.audioTrack = parseInt(value.replace('hls-', ''), 10);
  }
}

function cancelPreload() {
  if (preloadHlsInstance) { preloadHlsInstance.destroy(); preloadHlsInstance = null; }
  preloadNextEp = null;
}

function switchEpisode(ep) {
  cancelPreload();
  currentItem = ep;
  VIDEO_ID = ep.id;
  DURATION = ep.duration_seconds;
  document.getElementById('playerTitle').textContent = ep.title;
  document.getElementById('playerMeta').querySelector('h2').textContent = ep.title;
  document.getElementById('playerMeta').querySelector('p').textContent = ep.overview || '';
  const drawer = document.getElementById('episodeDrawer');
  if (drawer) drawer.style.display = 'none';

  if (hlsInstance) { hlsInstance.destroy(); hlsInstance = null; }

  if (preloadHlsInstance && preloadNextEp && preloadNextEp.id === ep.id) {
    hlsInstance = preloadHlsInstance;
    preloadHlsInstance = null;
    preloadNextEp = null;
    const video = document.getElementById('video');
    hlsInstance.attachMedia(video);
    video.play();
    loadThumbnails(ep.id);
    return;
  }

  playSource();
}

function initPlayer(item) {
  const video = document.getElementById('video');
  const subSelect = document.getElementById('subtitleSelect');
  const audioSelect = document.getElementById('audioSelect');
  const episodesBtn = document.getElementById('episodesBtn');
  const drawer = document.getElementById('episodeDrawer');
  const drawerClose = document.getElementById('drawerClose');
  const drawerSeasonSelect = document.getElementById('drawerSeasonSelect');
  const drawerEpisodeList = document.getElementById('drawerEpisodeList');

  video.controls = false;

  subSelect.addEventListener('change', () => onSubtitleChange(subSelect.value));
  audioSelect.addEventListener('change', () => onAudioChange(audioSelect.value));

  const isTV = item.media_type === 'tv' && item.show_name && showEpisodes.length > 0;

  if (isTV) {
    episodesBtn.style.display = 'inline-block';
    episodesBtn.onclick = () => {
      drawer.style.display = 'block';
      populateDrawer();
    };
    drawerClose.onclick = () => { drawer.style.display = 'none'; };
    drawer.addEventListener('click', (e) => {
      if (e.target === drawer) drawer.style.display = 'none';
    });
  }

  function populateDrawer() {
    const seasons = [...new Set(showEpisodes.map(m => m.season_number))].sort((a, b) => a - b);
    drawerSeasonSelect.innerHTML = seasons.map(s => `<option value="${s}">Season ${s}</option>`).join('');
    function renderSeason(seasonNum) {
      const eps = showEpisodes.filter(m => m.season_number === seasonNum);
      drawerEpisodeList.innerHTML = eps.map(ep => {
        const epPoster = ep.poster_path
          ? (ep.poster_path.startsWith('/') ? 'https://image.tmdb.org/t/p/w200' + ep.poster_path : ep.poster_path)
          : '';
        return `
          <div class="episode-item" data-id="${ep.id}">
            <img class="episode-thumb" src="${epPoster || ''}" alt="" onerror="this.classList.add('skeleton');this.src=''" loading="lazy">
            <div class="episode-info">
              <div class="episode-num">S${ep.season_number} · E${ep.episode_number}</div>
              <div class="episode-name">${ep.episode_title || ep.title}</div>
            </div>
          </div>
        `;
      }).join('');
      drawerEpisodeList.querySelectorAll('.episode-item').forEach(el => {
        el.addEventListener('click', () => {
          const found = showEpisodes.find(m => m.id == el.dataset.id);
          if (found) switchEpisode(found);
        });
      });
    }
    drawerSeasonSelect.onchange = () => renderSeason(parseInt(drawerSeasonSelect.value));
    renderSeason(seasons[0] || (showEpisodes.length ? showEpisodes[0].season_number : 1));
  }

  function populateTracks() {
    if (window._extSubs && window._extSubs.length) {
      subSelect.style.display = 'inline-block';
      window._extSubs.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s.id;
        opt.textContent = (s.language || 'und').toUpperCase() + (s.is_forced ? ' (forced)' : '');
        subSelect.appendChild(opt);
      });
    }
    if (window._extAudios && window._extAudios.length > 1) {
      audioSelect.style.display = 'inline-block';
      window._extAudios.forEach((a, i) => {
        const opt = document.createElement('option');
        opt.value = 'ext-' + i;
        opt.textContent = (a.language || 'und').toUpperCase() + ' - ' + (a.title || a.codec) + (a.is_default ? ' (default)' : '');
        if (a.is_default) opt.selected = true;
        audioSelect.appendChild(opt);
      });
    }
  }

  function playHLS() {
    if (hlsInstance) { hlsInstance.destroy(); hlsInstance = null; }
    const url = API + '/hls/' + item.id + '/index.m3u8?token=' + getToken();
    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = url;
      populateTracks();
      video.play();
    } else if (window.Hls) {
      hlsInstance = new Hls();
      hlsInstance.loadSource(url);
      hlsInstance.attachMedia(video);
      hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => {
        if (hlsInstance.subtitleTracks && hlsInstance.subtitleTracks.length) {
          subSelect.style.display = 'inline-block';
          hlsInstance.subtitleTracks.forEach((t, i) => {
            const opt = document.createElement('option');
            opt.value = 'hls-' + i;
            opt.textContent = (t.lang || 'und').toUpperCase() + ' (embedded)';
            subSelect.appendChild(opt);
          });
        }
        if (hlsInstance.audioTracks && hlsInstance.audioTracks.length > 1) {
          audioSelect.style.display = 'inline-block';
          hlsInstance.audioTracks.forEach((t, i) => {
            const opt = document.createElement('option');
            opt.value = 'hls-' + i;
            opt.textContent = (t.lang || 'und').toUpperCase() + ' (embedded)';
            audioSelect.appendChild(opt);
          });
        }
        populateTracks();
        video.play();
      });
      hlsInstance.on(Hls.Events.ERROR, (event, data) => {
        if (data.fatal) {
          console.warn('HLS fatal error, trying next source');
          hlsInstance.destroy();
          hlsInstance = null;
          trySource();
        }
      });
    }
  }

  function playSource() {
    if (hlsInstance) { hlsInstance.destroy(); hlsInstance = null; }

    let retries = 0;
    const modes = item.hls_path ? ['hls', 'remux', 'direct'] : ['direct', 'remux'];

    function trySource() {
      if (retries >= modes.length) {
        console.warn('playSource: all sources failed for', item.id);
        showToast('No playable source found. The file format may not be supported.', 'error');
        return;
      }
      const mode = modes[retries];
      retries++;

      if (mode === 'hls') {
        playHLS();
        return;
      }
      video.src = (mode === 'direct' ? API + '/stream/' + item.id : API + '/remux/' + item.id) + '?token=' + getToken();
      populateTracks();
      video.play().catch((e) => {
        if (retries >= modes.length) showToast('Playback failed: ' + e.message, 'error');
      });
    }

    video.onerror = function(e) {
      console.error('playSource: source error', video.error ? 'code=' + video.error.code + ' msg=' + video.error.message : 'unknown');
      trySource();
    };
    trySource();
  }

  setupCustomControls(video);
  setupKeyboardShortcuts(video);
  loadThumbnails(item.id);

  playSource();

  video.onended = () => {
    if (isTV) triggerNextEpisode(item);
    else triggerMovieEnd(item);
  };

  setInterval(async () => {
    if (!VIDEO_ID || !video.currentTime) return;
    const isFinished = video.currentTime / DURATION >= 0.9;
    await apiFetch('/progress', {
      method: 'PUT',
      body: JSON.stringify({
        media_id: VIDEO_ID,
        position_seconds: Math.floor(video.currentTime),
        duration_seconds: DURATION,
        is_finished: isFinished,
      }),
    });
  }, 10000);
}

function formatTime(s) {
  s = Math.floor(s);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return m + ':' + (sec < 10 ? '0' : '') + sec;
}

function showControls() {
  document.getElementById('controlBar').classList.remove('pc-hidden');
  document.getElementById('playerTopControls').classList.remove('pc-hidden');
}

function hideControls() {
  const video = document.getElementById('video');
  if (video.paused) return;
  document.getElementById('controlBar').classList.add('pc-hidden');
  document.getElementById('playerTopControls').classList.add('pc-hidden');
}

function setupCustomControls(video) {
  const playBtn = document.getElementById('pcPlay');
  const progress = document.getElementById('pcProgress');
  const timeEl = document.getElementById('pcTime');
  const volBtn = document.getElementById('pcVolBtn');
  const volSlider = document.getElementById('pcVolume');
  const speedSelect = document.getElementById('pcSpeed');
  const fsBtn = document.getElementById('pcFs');

  function updatePlayIcon() {
    playBtn.textContent = video.paused ? '▶' : '⏸';
  }

  function updateTime() {
    if (isSeeking) return;
    const cur = video.currentTime || 0;
    const dur = video.duration || 0;
    progress.value = dur ? (cur / dur) * 100 : 0;
    timeEl.textContent = formatTime(cur) + ' / ' + formatTime(dur);
  }

  function updateVolIcon() {
    volBtn.textContent = video.muted || video.volume === 0 ? '🔇' : '🔊';
  }

  playBtn.addEventListener('click', () => {
    video.paused ? video.play() : video.pause();
  });

  video.addEventListener('play', () => {
    updatePlayIcon();
    showControls();
    clearTimeout(autoHideTimer);
    autoHideTimer = setTimeout(hideControls, 3000);
  });

  video.addEventListener('pause', () => {
    updatePlayIcon();
    showControls();
    clearTimeout(autoHideTimer);
  });

  progress.addEventListener('mousedown', () => { isSeeking = true; });
  progress.addEventListener('input', () => {
    if (!video.duration) return;
    video.currentTime = (progress.value / 100) * video.duration;
    timeEl.textContent = formatTime(video.currentTime) + ' / ' + formatTime(video.duration);
  });
  progress.addEventListener('change', () => { isSeeking = false; });
  progress.addEventListener('mouseup', () => { isSeeking = false; });

  video.addEventListener('timeupdate', updateTime);
  video.addEventListener('loadedmetadata', () => {
    progress.max = 100;
    updateTime();
  });

  volBtn.addEventListener('click', () => {
    video.muted = !video.muted;
    updateVolIcon();
  });

  volSlider.addEventListener('input', () => {
    video.volume = parseFloat(volSlider.value);
    video.muted = video.volume === 0;
    updateVolIcon();
  });
  video.addEventListener('volumechange', () => {
    volSlider.value = video.muted ? 0 : video.volume;
    updateVolIcon();
  });

  speedSelect.addEventListener('change', () => {
    video.playbackRate = parseFloat(speedSelect.value);
  });

  fsBtn.addEventListener('click', () => {
    const container = document.getElementById('playerContainer');
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      container.requestFullscreen();
    }
  });

  document.addEventListener('fullscreenchange', () => {
    fsBtn.textContent = document.fullscreenElement ? '✕' : '⛶';
  });

  video.addEventListener('mousemove', () => {
    showControls();
    clearTimeout(autoHideTimer);
    if (!video.paused) autoHideTimer = setTimeout(hideControls, 3000);
  });

  video.addEventListener('mouseleave', () => {
    if (!video.paused) hideControls();
  });
}

function setupKeyboardShortcuts(video) {
  document.addEventListener('keydown', (e) => {
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;

    switch (e.code) {
      case 'Space':
      case 'KeyK':
        e.preventDefault();
        video.paused ? video.play() : video.pause();
        break;
      case 'KeyF':
        e.preventDefault();
        document.getElementById('pcFs').click();
        break;
      case 'KeyM':
        e.preventDefault();
        video.muted = !video.muted;
        document.getElementById('pcVolBtn').textContent = video.muted ? '🔇' : '🔊';
        break;
      case 'ArrowLeft':
        e.preventDefault();
        video.currentTime = Math.max(0, video.currentTime - 10);
        break;
      case 'ArrowRight':
        e.preventDefault();
        video.currentTime = Math.min(video.duration, video.currentTime + 10);
        break;
      case 'ArrowUp':
        e.preventDefault();
        video.volume = Math.min(1, video.volume + 0.1);
        document.getElementById('pcVolume').value = video.volume;
        document.getElementById('pcVolBtn').textContent = video.muted ? '🔇' : '🔊';
        break;
      case 'ArrowDown':
        e.preventDefault();
        video.volume = Math.max(0, video.volume - 0.1);
        document.getElementById('pcVolume').value = video.volume;
        document.getElementById('pcVolBtn').textContent = video.muted ? '🔇' : '🔊';
        break;
      case 'KeyL': {
        e.preventDefault();
        const speeds = [1, 1.25, 1.5, 2, 0.5];
        const cur = video.playbackRate;
        let next = speeds[0];
        for (const s of speeds) {
          if (s > cur + 0.01) { next = s; break; }
        }
        video.playbackRate = next;
        document.getElementById('pcSpeed').value = next;
        showToast(next + 'x', 'info');
        break;
      }
      case 'Escape':
        if (document.fullscreenElement) document.exitFullscreen();
        break;
    }

    if (e.code.startsWith('Digit')) {
      const pct = parseInt(e.code.slice(-1)) * 10;
      video.currentTime = (pct / 100) * video.duration;
    }
  });
}

async function loadThumbnails(mediaId) {
  try {
    const head = await fetch(API + '/hls/' + mediaId + '/thumbs.vtt', { method: 'HEAD' });
    if (!head.ok) return;
    const vtt = await fetch(API + '/hls/' + mediaId + '/thumbs.vtt').then(r => r.text());
    thumbnailData = parseVTT(vtt);
    if (!thumbnailData.length) return;

    const progress = document.getElementById('pcProgress');
    progress.addEventListener('mousemove', (e) => showThumbnail(e));
    progress.addEventListener('mouseleave', hideThumbnail);
  } catch (e) {
    // thumbnails unavailable
  }
}

function parseVTT(vtt) {
  const frames = [];
  const lines = vtt.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const timeMatch = lines[i].match(/(\d{2}):(\d{2}):(\d{2})\.\d+\s+-->\s+(\d{2}):(\d{2}):(\d{2})\.\d+/);
    if (timeMatch) {
      const start = +timeMatch[1]*3600 + +timeMatch[2]*60 + +timeMatch[3];
      const end = +timeMatch[4]*3600 + +timeMatch[5]*60 + +timeMatch[6];
      if (i + 1 < lines.length) {
        const xyMatch = lines[i + 1].match(/sprite\.jpg#xywh=(\d+),(\d+),(\d+),(\d+)/);
        if (xyMatch) {
          frames.push({ start, end, x: +xyMatch[1], y: +xyMatch[2], w: +xyMatch[3], h: +xyMatch[4] });
        }
      }
    }
  }
  return frames;
}

function showThumbnail(e) {
  const video = document.getElementById('video');
  if (!video.duration || !thumbnailData) return;
  const rect = e.target.getBoundingClientRect();
  const pct = (e.clientX - rect.left) / rect.width;
  const time = pct * video.duration;
  const frame = thumbnailData.find(f => time >= f.start && time < f.end);
  if (!frame) { hideThumbnail(); return; }
  const thumb = document.getElementById('pcThumbnail');
  const img = document.getElementById('pcThumbnailImg');
  const spriteUrl = API + '/hls/' + VIDEO_ID + '/sprite.jpg';
  img.style.objectFit = 'none';
  img.style.objectPosition = '-' + frame.x + 'px -' + frame.y + 'px';
  img.style.width = frame.w + 'px';
  img.style.height = frame.h + 'px';
  img.src = spriteUrl;
  document.getElementById('pcThumbTime').textContent = formatTime(time);
  thumb.style.left = Math.max(0, Math.min(rect.width - 160, e.clientX - rect.left - 80)) + 'px';
  thumb.style.display = 'block';
}

function hideThumbnail() {
  document.getElementById('pcThumbnail').style.display = 'none';
}

function triggerNextEpisode(item) {
  const idx = showEpisodes.findIndex(ep => ep.id === item.id);
  const nextEp = idx >= 0 && idx < showEpisodes.length - 1 ? showEpisodes[idx + 1] : null;
  if (!nextEp) return;

  cancelPreload();

  if (nextEp.hls_path && window.Hls) {
    preloadNextEp = nextEp;
    preloadHlsInstance = new Hls();
    preloadHlsInstance.loadSource(API + '/hls/' + nextEp.id + '/index.m3u8');
  }

  const overlay = document.getElementById('nextEpisodeOverlay');
  const timerEl = document.getElementById('nextEpisodeTimer');
  const titleEl = document.getElementById('nextEpisodeTitle');
  const cancelBtn = document.getElementById('nextEpisodeCancel');
  let countdown = 8;

  titleEl.textContent = nextEp.title;
  timerEl.textContent = 'Next episode in ' + countdown + 's';
  overlay.style.display = 'flex';

  const timer = setInterval(() => {
    countdown--;
    timerEl.textContent = 'Next episode in ' + countdown + 's';
    if (countdown <= 0) {
      clearInterval(timer);
      overlay.style.display = 'none';
      switchEpisode(nextEp);
    }
  }, 1000);

  cancelBtn.onclick = () => {
    clearInterval(timer);
    overlay.style.display = 'none';
    cancelPreload();
  };
}

function triggerMovieEnd(item) {
  const overlay = document.getElementById('movieEndOverlay');
  const row = document.getElementById('movieEndRow');
  const backBtn = document.getElementById('movieEndBack');

  const all = window._nextflixMedia || [];
  const similar = all
    .filter(m => m.id !== item.id && m.media_type === item.media_type)
    .sort(() => Math.random() - 0.5)
    .slice(0, 6);

  row.innerHTML = '';
  similar.forEach(m => {
    const card = document.createElement('div');
    card.className = 'card';
    const img = document.createElement('img');
    img.className = 'card-poster';
    img.loading = 'lazy';
    img.alt = m.title;
    if (m.poster_path) {
      img.src = m.poster_path.startsWith('/') ? 'https://image.tmdb.org/t/p/w342' + m.poster_path : m.poster_path;
    } else {
      img.style.background = '#333';
    }
    card.appendChild(img);
    const title = document.createElement('div');
    title.className = 'card-title';
    title.textContent = m.title;
    card.appendChild(title);
    card.addEventListener('click', () => {
      overlay.style.display = 'none';
      switchEpisode(m);
    });
    row.appendChild(card);
  });

  backBtn.onclick = () => { window.location.href = '/'; };
  overlay.style.display = 'flex';
}

const token = getToken();
if (!token) { window.location.href = '/'; } else {
  const params = getParams();
  if (params.id) loadMedia(params.id);
}
