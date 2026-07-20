const API = '/api/v1';
let CURRENT_QUALITY = '480p';
let VIDEO_ID = null;
let DURATION = 0;
let hlsInstance = null;

function getToken() { return localStorage.getItem('token'); }

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
  const res = await apiFetch('/media');
  if (!res) return;
  const all = await res.json();
  const item = all.find(m => m.id == id);
  if (!item) { document.getElementById('playerTitle').textContent = 'Not found'; return; }
  VIDEO_ID = item.id;
  DURATION = item.duration_seconds;
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

function initPlayer(item) {
  const video = document.getElementById('video');
  const qualityBtn = document.getElementById('qualityBtn');
  const subSelect = document.getElementById('subtitleSelect');
  const audioSelect = document.getElementById('audioSelect');

  subSelect.addEventListener('change', () => onSubtitleChange(subSelect.value));
  audioSelect.addEventListener('change', () => onAudioChange(audioSelect.value));

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

  function playSource() {
    if (hlsInstance) { hlsInstance.destroy(); hlsInstance = null; }
    let url;
    if (CURRENT_QUALITY === '480p') {
      url = API + '/hls/' + item.id + '/480p.m3u8';
      if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = url;
        populateTracks();
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
        });
      } else {
        video.src = API + '/stream/' + item.id;
        populateTracks();
      }
    } else {
      video.src = API + '/stream/' + item.id;
      populateTracks();
    }
    video.play();
  }

  qualityBtn.addEventListener('click', () => {
    CURRENT_QUALITY = CURRENT_QUALITY === '480p' ? '1080p' : '480p';
    qualityBtn.textContent = CURRENT_QUALITY;
    playSource();
  });

  playSource();

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

const token = getToken();
if (!token) { window.location.href = '/'; } else {
  const params = getParams();
  if (params.id) loadMedia(params.id);
}