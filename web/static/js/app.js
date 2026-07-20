const API = '/api/v1';

function getToken() { return localStorage.getItem('token'); }
function setToken(t) { localStorage.setItem('token', t); }
function clearToken() { localStorage.removeItem('token'); }

async function apiFetch(path, opts) {
  const token = getToken();
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const res = await fetch(API + path, { ...opts, headers });
  if (res.status === 401) { clearToken(); showLogin(); return null; }
  return res;
}

function showLogin() {
  document.getElementById('loginOverlay').style.display = 'flex';
  document.getElementById('app').style.display = 'none';
}

function hideLogin() {
  document.getElementById('loginOverlay').style.display = 'none';
  document.getElementById('app').style.display = 'block';
}

document.getElementById('loginBtn').addEventListener('click', async () => {
  const user = document.getElementById('loginUser').value;
  const pass = document.getElementById('loginPass').value;
  document.getElementById('loginError').textContent = '';
  try {
    const res = await fetch(API + '/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: user, password: pass }),
    });
    if (!res.ok) { document.getElementById('loginError').textContent = 'Invalid credentials'; return; }
    const data = await res.json();
    setToken(data.token);
    if (data.profiles && data.profiles.length) {
      document.getElementById('navProfile').textContent = data.profiles[0].name;
    }
    hideLogin();
    loadAll();
  } catch { document.getElementById('loginError').textContent = 'Network error'; }
});

let allMedia = [];
let selectedMediaId = null;

async function loadAll() {
  const [mediaRes, progressRes, trendingRes] = await Promise.all([
    apiFetch('/media'),
    apiFetch('/progress'),
    apiFetch('/trending'),
  ]);
  if (!mediaRes) return;
  const media = await mediaRes.json();
  allMedia = media;
  const progress = progressRes ? await progressRes.json() : [];
  const trending = trendingRes ? await trendingRes.json() : [];

  renderHero(media);
  renderContinueWatching(progress);
  renderGrid(media);
  renderTrending(trending);
}

function renderHero(media) {
  if (!media.length) return;
  const item = media[Math.floor(Math.random() * media.length)];
  selectedMediaId = item.id;
  const hero = document.getElementById('hero');
  const backdrop = document.getElementById('heroBackdrop');
  if (item.backdrop_path) {
    backdrop.style.backgroundImage = `url(https://image.tmdb.org/t/p/original${item.backdrop_path})`;
  }
  document.getElementById('heroTitle').textContent = item.title;
  document.getElementById('heroOverview').textContent = '';
  document.getElementById('heroPlay').onclick = () => { window.location.href = '/player.html?id=' + item.id; };
}

function renderContinueWatching(progress) {
  const container = document.getElementById('continueContainer');
  const section = document.getElementById('continueRow');
  if (!progress.length) { section.style.display = 'none'; return; }
  section.style.display = 'block';
  container.innerHTML = '';
  progress.forEach(p => {
    const pct = p.duration_seconds ? Math.min(100, (p.position_seconds / p.duration_seconds) * 100) : 0;
    const card = createCard(p.media_id, p.title, p.poster_path, pct, false);
    container.appendChild(card);
  });
}

function renderGrid(media) {
  const grid = document.getElementById('mediaGrid');
  grid.innerHTML = '';
  media.forEach(m => {
    const card = createCard(m.id, m.title, m.poster_path, 0, false);
    grid.appendChild(card);
  });
}

function renderTrending(trending) {
  const container = document.getElementById('trendingContainer');
  const section = document.getElementById('trendingRow');
  if (!trending.length) { section.style.display = 'none'; return; }
  section.style.display = 'block';
  container.innerHTML = '';
  trending.forEach(t => {
    const card = createCard(null, t.title, t.poster_path, 0, true);
    const rank = document.createElement('div');
    rank.className = 'card-rank';
    rank.textContent = t.rank;
    card.appendChild(rank);
    container.appendChild(card);
  });
}

function createCard(id, title, poster, progressPct, isTrending) {
  const div = document.createElement('div');
  div.className = 'card';
  div.dataset.id = id;

  if (id) {
    div.addEventListener('click', () => { window.location.href = '/player.html?id=' + id; });
  }

  const img = document.createElement('img');
  img.className = 'card-poster';
  img.loading = 'lazy';
  img.alt = title;
  if (poster) {
    img.src = poster.startsWith('/') ? 'https://image.tmdb.org/t/p/w342' + poster : poster;
  } else {
    img.style.background = '#333';
  }
  div.appendChild(img);

  if (!isTrending) {
    const titleEl = document.createElement('div');
    titleEl.className = 'card-title';
    titleEl.textContent = title;
    div.appendChild(titleEl);
  }

  if (progressPct > 0) {
    const bar = document.createElement('div');
    bar.className = 'card-progress';
    const fill = document.createElement('div');
    fill.className = 'card-progress-fill';
    fill.style.width = progressPct + '%';
    bar.appendChild(fill);
    div.appendChild(bar);
  }

  const preview = document.createElement('div');
  preview.className = 'card-preview';
  div.appendChild(preview);

  let hoverTimer = null;
  let iframe = null;

  div.addEventListener('mouseenter', () => {
    const item = allMedia.find(m => m.id === id);
    if (item && item.trailer_youtube_id) {
      hoverTimer = setTimeout(() => {
        iframe = document.createElement('iframe');
        iframe.src = 'https://www.youtube.com/embed/' + item.trailer_youtube_id + '?autoplay=1&mute=1&controls=0&loop=1';
        iframe.allow = 'autoplay';
        preview.appendChild(iframe);
      }, 1200);
    }
  });

  div.addEventListener('mouseleave', () => {
    if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null; }
    if (iframe) { preview.removeChild(iframe); iframe = null; }
  });

  return div;
}

const token = getToken();
if (token) { hideLogin(); loadAll(); } else { showLogin(); }
