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

document.getElementById('btnLogout').addEventListener('click', (e) => {
  e.preventDefault();
  clearToken();
  window.location.href = '/';
});

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
    if (data.role === 'admin') {
      const a = document.createElement('button');
      a.className = 'nav-link';
      a.textContent = 'Admin';
      a.addEventListener('click', () => { window.location.href = '/admin'; });
      document.getElementById('navLinks').appendChild(a);
    }
    document.getElementById('btnLogout').style.display = 'inline-block';
    hideLogin();
    loadAll();
  } catch { document.getElementById('loginError').textContent = 'Network error'; }
});

/* ===== State ===== */
let allMedia = [];
let billboardTimer = null;
let billboardIndex = 0;
let billboardItems = [];

/* ===== Load All Data ===== */
async function loadAll() {
  const [mediaRes, progressRes, trendingRes, libRes, collRes] = await Promise.all([
    apiFetch('/media'),
    apiFetch('/progress'),
    apiFetch('/trending'),
    apiFetch('/libraries'),
    apiFetch('/collections'),
  ]);
  if (!mediaRes) return;
  const media = await mediaRes.json();
  allMedia = media;
  const progress = progressRes ? await progressRes.json() : [];
  const trending = trendingRes ? await trendingRes.json() : [];
  const libraries = libRes ? await libRes.json() : [];
  const collections = collRes ? await collRes.json() : [];

  document.getElementById('skeletonHero').style.display = 'none';
  document.getElementById('skeletonRow').style.display = 'none';

  initBillboard(media);
  renderContinueWatching(progress);
  renderCollections(collections);
  renderFilters(libraries);
  renderGrid(media);
  renderTrending(trending);
  initCarousels();
  initNavFilters();
}

/* ===== Billboard Hero ===== */
function initBillboard(media) {
  const withBackdrop = media.filter(m => m.backdrop_path || m.poster_path);
  if (!withBackdrop.length) return;
  billboardItems = withBackdrop.slice(0, 8);
  renderBillboard(0);
  renderBillboardDots();
  if (billboardItems.length > 1) {
    billboardTimer = setInterval(() => {
      billboardIndex = (billboardIndex + 1) % billboardItems.length;
      renderBillboard(billboardIndex);
      updateBillboardDots();
    }, 8000);
  }
}

function renderBillboard(index) {
  const item = billboardItems[index];
  if (!item) return;
  billboardIndex = index;
  const hero = document.getElementById('hero');
  const backdrop = document.getElementById('heroBackdrop');
  const imgUrl = item.backdrop_path
    ? 'https://image.tmdb.org/t/p/original' + item.backdrop_path
    : item.poster_path
      ? (item.poster_path.startsWith('/') ? 'https://image.tmdb.org/t/p/w1280' + item.poster_path : item.poster_path)
      : '';
  backdrop.style.backgroundImage = imgUrl ? `url(${imgUrl})` : '';
  document.getElementById('heroTitle').textContent = item.title;
  const meta = [];
  if (item.media_type) meta.push(item.media_type.toUpperCase());
  if (item.rating) meta.push(item.rating);
  if (item.year) meta.push(item.year);
  if (item.duration_seconds) {
    const h = Math.floor(item.duration_seconds / 3600);
    const m = Math.floor((item.duration_seconds % 3600) / 60);
    meta.push(h + 'h ' + m + 'm');
  }
  document.getElementById('heroMeta').textContent = meta.join(' · ');
  document.getElementById('heroOverview').textContent = item.overview || '';
  document.getElementById('heroPlay').onclick = (e) => { e.stopPropagation(); playMedia(item); };
  document.getElementById('heroInfo').onclick = (e) => { e.stopPropagation(); openDetail(item); };
}

function renderBillboardDots() {
  const dots = document.getElementById('heroDots');
  dots.innerHTML = '';
  billboardItems.forEach((_, i) => {
    const dot = document.createElement('button');
    dot.className = 'hero-dot' + (i === 0 ? ' active' : '');
    dot.onclick = () => { billboardIndex = i; renderBillboard(i); updateBillboardDots(); if (billboardTimer) { clearInterval(billboardTimer); billboardTimer = setInterval(() => { billboardIndex = (billboardIndex + 1) % billboardItems.length; renderBillboard(billboardIndex); updateBillboardDots(); }, 8000); } };
    dots.appendChild(dot);
  });
}

function updateBillboardDots() {
  document.querySelectorAll('.hero-dot').forEach((d, i) => d.classList.toggle('active', i === billboardIndex));
}

/* ===== Drag-to-Scroll Carousels ===== */
function initCarousels() {
  document.querySelectorAll('.row').forEach(row => {
    let isDown = false, startX = 0, scrollLeft = 0;
    row.addEventListener('mousedown', (e) => { isDown = true; startX = e.pageX - row.offsetLeft; scrollLeft = row.scrollLeft; });
    row.addEventListener('mouseleave', () => { isDown = false; });
    row.addEventListener('mouseup', () => { isDown = false; });
    row.addEventListener('mousemove', (e) => { if (!isDown) return; e.preventDefault(); const x = e.pageX - row.offsetLeft; row.scrollLeft = scrollLeft - (x - startX) * 1.5; });
  });
}

/* ===== Nav Filters ===== */
function initNavFilters() {
  document.querySelectorAll('.nav-link[data-filter], .bottom-nav-item[data-filter]').forEach(el => {
    el.addEventListener('click', () => {
      const filter = el.dataset.filter;
      document.querySelectorAll('.nav-link[data-filter]').forEach(l => l.classList.toggle('active', l.dataset.filter === filter));
      document.querySelectorAll('.bottom-nav-item[data-filter]').forEach(l => l.classList.toggle('active', l.dataset.filter === filter));
      if (filter === 'all') {
        renderGrid(allMedia);
      } else {
        renderGrid(allMedia.filter(m => m.media_type === filter));
      }
    });
  });
}

/* ===== Continue Watching ===== */
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

/* ===== Collections ===== */
function renderCollections(collections) {
  const section = document.getElementById('collectionsRow');
  const container = document.getElementById('collectionsContainer');
  if (!collections || !collections.length) { section.style.display = 'none'; return; }
  section.style.display = 'block';
  container.innerHTML = '';
  collections.forEach(c => {
    const div = document.createElement('div');
    div.className = 'card collection-card';
    const img = document.createElement('img');
    img.className = 'card-poster';
    img.loading = 'lazy';
    img.alt = c.name;
    if (c.poster_path) {
      img.src = c.poster_path.startsWith('/') ? 'https://image.tmdb.org/t/p/w342' + c.poster_path : c.poster_path;
    } else {
      img.style.background = '#333';
    }
    div.appendChild(img);
    const title = document.createElement('div');
    title.className = 'card-title';
    title.textContent = c.name;
    div.appendChild(title);
    div.addEventListener('click', () => showCollection(c));
    container.appendChild(div);
  });
  initCarousels();
}

async function showCollection(coll) {
  const res = await apiFetch('/collections/' + coll.id + '/items');
  const items = res ? await res.json() : [];
  document.getElementById('collectionsRow').scrollIntoView({ behavior: 'smooth' });
  renderGrid(items);
}

/* ===== Filters ===== */
function renderFilters(libraries) {
  const bar = document.getElementById('filterBar');
  bar.innerHTML = '';
  const allBtn = document.createElement('button');
  allBtn.className = 'filter-btn active';
  allBtn.textContent = 'All';
  allBtn.onclick = () => setFilter(null);
  bar.appendChild(allBtn);
  libraries.forEach(lib => {
    const btn = document.createElement('button');
    btn.className = 'filter-btn';
    btn.textContent = lib.name;
    btn.dataset.libraryId = lib.id;
    btn.onclick = () => setFilter(lib.id);
    bar.appendChild(btn);
  });
}

function setFilter(libraryId) {
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.classList.toggle('active', String(btn.dataset.libraryId) === String(libraryId) || (!btn.dataset.libraryId && !libraryId));
  });
  const filtered = libraryId ? allMedia.filter(m => m.library_id == libraryId) : allMedia;
  renderGrid(filtered);
}

/* ===== Grid ===== */
function renderGrid(media) {
  const grid = document.getElementById('mediaGrid');
  grid.innerHTML = '';
  if (!media.length) {
    grid.innerHTML = '<div class="empty-state"><p>No media yet</p><p style="font-size:.8rem;color:var(--muted)">Add files to your media directories or check the scanner logs.</p></div>';
    return;
  }
  media.forEach(m => {
    const card = createCard(m.id, m.title, m.poster_path, 0, false);
    grid.appendChild(card);
  });
}

/* ===== Trending ===== */
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
  initCarousels();
}

/* ===== Card ===== */
function createCard(id, title, poster, progressPct, isTrending) {
  const div = document.createElement('div');
  div.className = 'card';
  div.dataset.id = id;
  const item = allMedia.find(m => m.id === id);

  if (id) {
    div.addEventListener('click', (e) => {
      if (e.target.closest('.card-preview')) return;
      const found = allMedia.find(m => m.id === id);
      if (found) openDetail(found);
    });
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
  img.onerror = function() {
    if (!this.dataset.fallback) {
      this.dataset.fallback = '1';
      this.src = API + '/image/local/poster/' + id;
    }
  };
  div.appendChild(img);

  const overlay = document.createElement('div');
  overlay.className = 'card-overlay';
  overlay.innerHTML = '<span class="card-play-icon">▶</span>';
  div.appendChild(overlay);

  if (item && item.rating) {
    const badge = document.createElement('span');
    badge.className = 'card-rating';
    badge.textContent = item.rating;
    div.appendChild(badge);
  }

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

/* ===== Detail Modal ===== */
function openDetail(item) {
  const modal = document.getElementById('detailModal');
  const backdrop = document.getElementById('detailBackdrop');
  const body = document.getElementById('detailBody');

  const imgUrl = item.backdrop_path
    ? 'https://image.tmdb.org/t/p/original' + item.backdrop_path
    : item.poster_path
      ? (item.poster_path.startsWith('/') ? 'https://image.tmdb.org/t/p/w1280' + item.poster_path : '')
      : '';
  backdrop.style.backgroundImage = imgUrl ? `url(${imgUrl})` : '';

  const meta = [];
  if (item.media_type) meta.push(item.media_type.toUpperCase());
  if (item.rating) meta.push(item.rating);
  if (item.year) meta.push(item.year);
  if (item.duration_seconds) {
    const h = Math.floor(item.duration_seconds / 3600);
    const m = Math.floor((item.duration_seconds % 3600) / 60);
    meta.push(h + 'h ' + m + 'm');
  }

  let extra = '';
  if (item.media_type === 'tv' && item.show_name) {
    extra = `<div id="detailEpisodes"><select class="detail-season-select" id="seasonSelect"></select><div class="episode-list" id="episodeList"></div></div>`;
  }

  body.innerHTML = `
    <h2 class="detail-title">${item.title}</h2>
    <p class="detail-meta">${meta.join(' · ')}</p>
    <p class="detail-overview">${item.overview || 'No overview available.'}</p>
    <div class="detail-buttons">
      <button class="detail-play" id="detailPlayBtn">▶ Play</button>
    </div>
    ${extra}
  `;

  document.getElementById('detailPlayBtn').onclick = () => playMedia(item);

  modal.classList.add('open');

  if (item.media_type === 'tv' && item.show_name) {
    loadEpisodes(item, body);
  }
}

document.getElementById('detailClose').onclick = () => closeDetail();
document.getElementById('detailModal').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeDetail();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeDetail();
});

function closeDetail() {
  document.getElementById('detailModal').classList.remove('open');
}

async function loadEpisodes(item, body) {
  const seasonSelect = document.getElementById('seasonSelect');
  const episodeList = document.getElementById('episodeList');
  if (!seasonSelect || !episodeList) return;

  const all = allMedia.filter(m =>
    m.show_name === item.show_name &&
    m.season_number > 0 &&
    m.episode_number > 0
  );

  const seasons = [...new Set(all.map(m => m.season_number))].sort((a, b) => a - b);
  seasonSelect.innerHTML = seasons.map(s => `<option value="${s}">Season ${s}</option>`).join('');

  function renderSeason(seasonNum) {
    const eps = all.filter(m => m.season_number === seasonNum).sort((a, b) => a.episode_number - b.episode_number);
    episodeList.innerHTML = eps.map(ep => `
      <div class="episode-item" data-id="${ep.id}">
        <div class="episode-thumb skeleton"></div>
        <div class="episode-info">
          <div class="episode-num">Episode ${ep.episode_number}</div>
          <div class="episode-name">${ep.episode_title || ep.title}</div>
          <div class="episode-desc">${ep.overview || ''}</div>
        </div>
      </div>
    `).join('');
    episodeList.querySelectorAll('.episode-item').forEach(el => {
      el.addEventListener('click', () => {
        const found = allMedia.find(m => m.id == el.dataset.id);
        if (found) playMedia(found);
      });
    });
  }

  seasonSelect.onchange = () => renderSeason(parseInt(seasonSelect.value));
  renderSeason(seasons[0] || 1);
}

/* ===== Overlay Player ===== */
function playMedia(item) {
  closeDetail();
  const overlay = document.getElementById('playerOverlay');
  const video = document.getElementById('overlayVideo');
  const title = document.getElementById('playerOverlayTitle');
  title.textContent = item.title;
  video.src = API + '/stream/' + item.id;
  overlay.style.display = 'flex';
  video.play();

  video.onerror = () => {
    video.src = API + '/hls/' + item.id + '/480p.m3u8';
    video.play();
  };

  video.onended = () => {
    closePlayer();
  };
}

document.getElementById('playerOverlayClose').onclick = closePlayer;

function closePlayer() {
  const overlay = document.getElementById('playerOverlay');
  const video = document.getElementById('overlayVideo');
  video.pause();
  video.src = '';
  overlay.style.display = 'none';
}

document.getElementById('playerOverlay').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closePlayer();
});

/* ===== Init ===== */
const token = getToken();
if (token) {
  document.getElementById('btnLogout').style.display = 'inline-block';
  document.querySelector('.nav-link[data-filter="all"]').classList.add('active');
  document.querySelector('.bottom-nav-item[data-filter="all"]').classList.add('active');
  hideLogin();
  loadAll();
} else {
  showLogin();
}
