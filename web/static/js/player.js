const API = '/api/v1';
let CURRENT_QUALITY = '480p';
let VIDEO_ID = null;
let DURATION = 0;
let PROFILE_ID = null;

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
  initPlayer(item);
}

function initPlayer(item) {
  const video = document.getElementById('video');
  const qualityBtn = document.getElementById('qualityBtn');

  function playSource() {
    let url;
    if (CURRENT_QUALITY === '480p') {
      url = API + '/hls/' + item.id + '/480p.m3u8';
      if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = url;
      } else {
        if (window.Hls) {
          const hls = new Hls();
          hls.loadSource(url);
          hls.attachMedia(video);
        } else {
          video.src = API + '/stream/' + item.id;
        }
      }
    } else {
      if (window.Hls && window.Hls.isSupported()) {
        video.src = API + '/stream/' + item.id;
      } else {
        video.src = API + '/stream/' + item.id;
      }
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
