const API = '/api/v1';

function getToken() { return localStorage.getItem('token'); }
function setToken(t) { localStorage.setItem('token', t); }
function clearToken() { localStorage.removeItem('token'); }

function showToast(msg, type) {
  var t = document.getElementById('toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; t.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);z-index:9999;padding:10px 20px;border-radius:6px;font-size:.85rem;transition:opacity .3s;max-width:90vw;text-align:center'; document.body.appendChild(t); }
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
      document.getElementById('btnAdmin').style.display = 'inline-block';
    }
    document.getElementById('btnLogout').style.display = 'inline-block';
    hideLogin();
    loadAll();
  } catch { document.getElementById('loginError').textContent = 'Network error'; }
});

/* ===== State ===== */
let allMedia = [];
let allLibraries = [];
let allCollections = [];
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
  window._nextflixMedia = media;
  const progress = progressRes ? await progressRes.json() : [];
  const trending = trendingRes ? await trendingRes.json() : [];
  const libraries = libRes ? await libRes.json() : [];
  const collections = collRes ? await collRes.json() : [];
  allLibraries = libraries;
  allCollections = collections;

  document.getElementById('skeletonHero').style.display = 'none';
  document.getElementById('skeletonRow').style.display = 'none';

  renderContinueWatching(progress);
  renderCollections(collections);
  renderTrending(trending);
  initCarousels();
  showPage('all');
}

/* ===== Billboard Hero ===== */
function initBillboard(media) {
  const withBackdrop = media.filter(m => m.backdrop_path || m.poster_path);
  if (!withBackdrop.length) return;
  billboardItems = withBackdrop.slice(0, 8);
  renderBillboard(0);
  renderBillboardDots();
  if (billboardTimer) { clearInterval(billboardTimer); billboardTimer = null; }
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

/* ===== Carousel Arrows & Drag-to-Scroll ===== */
function wrapRowWithArrows(row) {
  if (row.parentElement.classList.contains('row-wrapper')) return;
  const wrapper = document.createElement('div');
  wrapper.className = 'row-wrapper';
  row.parentNode.insertBefore(wrapper, row);
  wrapper.appendChild(row);

  const left = document.createElement('button');
  left.className = 'row-arrow row-arrow-left';
  left.innerHTML = '‹';
  left.setAttribute('aria-label', 'Scroll left');
  left.addEventListener('click', () => row.scrollBy({ left: -row.clientWidth, behavior: 'smooth' }));

  const right = document.createElement('button');
  right.className = 'row-arrow row-arrow-right';
  right.innerHTML = '›';
  right.setAttribute('aria-label', 'Scroll right');
  right.addEventListener('click', () => row.scrollBy({ left: row.clientWidth, behavior: 'smooth' }));

  wrapper.appendChild(left);
  wrapper.appendChild(right);
}

function initCarousels() {
  document.querySelectorAll('.row').forEach(row => {
    if (row.dataset.carouselInited) return;
    row.dataset.carouselInited = '1';

    wrapRowWithArrows(row);

    let isDown = false, startX = 0, scrollLeft = 0;
    row.addEventListener('mousedown', (e) => { isDown = true; startX = e.pageX - row.offsetLeft; scrollLeft = row.scrollLeft; });
    row.addEventListener('mouseleave', () => { isDown = false; });
    row.addEventListener('mouseup', () => { isDown = false; });
    row.addEventListener('mousemove', (e) => { if (!isDown) return; e.preventDefault(); const x = e.pageX - row.offsetLeft; row.scrollLeft = scrollLeft - (x - startX) * 1.5; });
  });
}

/* ===== Page Navigation ===== */
function showPage(page) {
  document.querySelectorAll('.nav-link[data-filter]').forEach(l => l.classList.toggle('active', l.dataset.filter === page));
  document.querySelectorAll('.bottom-nav-item[data-filter]').forEach(l => l.classList.toggle('active', l.dataset.filter === page));

  const hero = document.getElementById('hero');
  const content = document.getElementById('pageContent');
  content.innerHTML = '';

  hero.style.display = 'flex';

  if (page === 'all') {
    renderHomePage();
  } else if (page === 'movie') {
    renderMoviesPage();
  } else if (page === 'tv') {
    renderTVPage();
  }
  initCarousels();
}

function renderHomePage() {
  initBillboard(allMedia);

  const content = document.getElementById('pageContent');
  content.innerHTML = `
    <section class="row-section" id="homeFilterSection">
      <h2 class="row-title">All Media</h2>
      <div class="filter-bar" id="filterBar"></div>
      <div class="grid" id="mediaGrid"></div>
    </section>
  `;
  renderFilters(allLibraries);
  renderGrid(allMedia);
}

function renderMoviesPage() {
  const movies = allMedia.filter(m => m.media_type === 'movie');
  initBillboard(movies);

  const content = document.getElementById('pageContent');
  content.innerHTML = `
    <section class="row-section">
      <h2 class="row-title">Movies</h2>
      <div class="grid" id="mediaGrid"></div>
    </section>
  `;
  renderGrid(movies);
}

function renderTVPage() {
  const tv = allMedia.filter(m => m.media_type === 'tv');
  initBillboard(tv);

  const content = document.getElementById('pageContent');
  content.innerHTML = `
    <section class="row-section">
      <h2 class="row-title">TV Shows</h2>
      <div class="grid" id="mediaGrid"></div>
    </section>
  `;
  renderGrid(tv);
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
}

async function showCollection(coll) {
  const res = await apiFetch('/collections/' + coll.id + '/items');
  const items = res ? await res.json() : [];
  document.getElementById('collectionsRow').scrollIntoView({ behavior: 'smooth' });
  showPage('all');
  const content = document.getElementById('pageContent');
  content.innerHTML = `
    <section class="row-section">
      <h2 class="row-title">${coll.name}</h2>
      <div class="grid" id="mediaGrid"></div>
    </section>
  `;
  renderGrid(items);
}

/* ===== Filters ===== */
function renderFilters(libraries) {
  const bar = document.getElementById('filterBar');
  if (!bar) return;
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
  const btns = document.querySelectorAll('.filter-btn');
  if (!btns.length) return;
  btns.forEach(btn => {
    btn.classList.toggle('active', String(btn.dataset.libraryId) === String(libraryId) || (!btn.dataset.libraryId && !libraryId));
  });
  const filtered = libraryId ? allMedia.filter(m => m.library_id == libraryId) : allMedia;
  renderGrid(filtered);
}

/* ===== Grid ===== */
function renderGrid(media) {
  const grid = document.getElementById('mediaGrid');
  if (!grid) return;
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
}

/* ===== Card ===== */
function createCard(id, title, poster, progressPct, isTrending) {
  const div = document.createElement('div');
  div.className = 'card';
  div.dataset.id = id;
  const item = id ? (allMedia.find(m => m.id === id) || null) : null;

  if (id) {
    div.addEventListener('click', (e) => {
      if (e.target.closest('.card-hover-actions') || e.target.closest('.card-hover-action') || e.target.closest('.card-hover-action-play')) return;
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

  if (item) {
    const info = document.createElement('span');
    info.className = 'card-info';
    if (item.media_type === 'movie') {
      const parts = [];
      if (item.year) parts.push(item.year);
      if (item.duration_seconds) {
        const h = Math.floor(item.duration_seconds / 3600);
        const m = Math.floor((item.duration_seconds % 3600) / 60);
        parts.push(h + 'h ' + m + 'm');
      }
      info.textContent = parts.join(' ');
    } else if (item.media_type === 'tv') {
      const eps = allMedia.filter(m => m.show_name === item.show_name && m.episode_number > 0);
      if (eps.length) info.textContent = eps.length + ' ep' + (eps.length > 1 ? 's' : '');
    }
    if (info.textContent) div.appendChild(info);
  }

  if (item && item.hls_path) {
    const hlsBadge = document.createElement('span');
    hlsBadge.className = 'card-badge-480p';
    hlsBadge.textContent = 'HD';
    div.appendChild(hlsBadge);
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

  /* ===== Hover Expansion Content ===== */
  const hoverContent = document.createElement('div');
  hoverContent.className = 'card-hover-content';

  const actions = document.createElement('div');
  actions.className = 'card-hover-actions';
  const playBtn = document.createElement('button');
  playBtn.className = 'card-hover-action-play';
  playBtn.innerHTML = '▶';
  playBtn.title = 'Play';
  playBtn.addEventListener('click', (e) => { e.stopPropagation(); if (item) playMedia(item); });
  actions.appendChild(playBtn);
  const addBtn = document.createElement('button');
  addBtn.className = 'card-hover-action';
  addBtn.textContent = '+';
  addBtn.title = 'Add to List';
  actions.appendChild(addBtn);
  const likeBtn = document.createElement('button');
  likeBtn.className = 'card-hover-action';
  likeBtn.innerHTML = '👍';
  likeBtn.title = 'Like';
  actions.appendChild(likeBtn);
  hoverContent.appendChild(actions);

  if (item) {
    const meta = document.createElement('div');
    meta.className = 'card-hover-meta';
    const match = document.createElement('span');
    match.className = 'match';
    const matchPct = item.rating ? Math.min(99, parseInt(item.rating) || 90) : 95;
    match.textContent = matchPct + '% Match';
    meta.appendChild(match);
    if (item.container === 'mp4' || item.container === 'webm') {
      const hd = document.createElement('span');
      hd.className = 'hd';
      hd.textContent = 'HD';
      meta.appendChild(hd);
    }
    if (item.media_type === 'tv' && item.season_number > 0) {
      const seasons = document.createElement('span');
      seasons.textContent = (item.season_number > 1 ? item.season_number + ' Seasons' : '1 Season') + (item.episode_number ? ' · ' + item.episode_number + ' ep' : '');
      meta.appendChild(seasons);
    } else if (item.media_type === 'movie' && item.duration_seconds) {
      const h = Math.floor(item.duration_seconds / 3600);
      const m = Math.floor((item.duration_seconds % 3600) / 60);
      const dur = document.createElement('span');
      dur.textContent = h + 'h ' + m + 'm';
      meta.appendChild(dur);
    }
    hoverContent.appendChild(meta);

    if (item.tags && item.tags.length) {
      const genres = document.createElement('div');
      genres.className = 'card-hover-genres';
      item.tags.forEach(t => {
        const g = document.createElement('span');
        g.className = 'card-hover-genre';
        g.textContent = t;
        genres.appendChild(g);
      });
      hoverContent.appendChild(genres);
    }
  }

  div.appendChild(hoverContent);

  /* ===== YouTube Trailer Preview on Expanded Card ===== */
  const preview = document.createElement('div');
  preview.className = 'card-preview';
  preview.style.display = 'none';
  div.appendChild(preview);

  let expandTimer = null;
  let trailerTimer = null;
  let trailerIframe = null;
  let isExpanded = false;

  function doExpand() {
    if (isExpanded) return;
    isExpanded = true;
    const rect = div.getBoundingClientRect();
    const vw = window.innerWidth;
    if (rect.left < vw * 0.2) div.style.transformOrigin = 'center left';
    else if (rect.right > vw * 0.8) div.style.transformOrigin = 'center right';
    else div.style.transformOrigin = 'center center';
    div.classList.add('card-expanded');

    if (item && item.trailer_youtube_id && !trailerIframe) {
      trailerTimer = setTimeout(() => {
        trailerIframe = document.createElement('iframe');
        trailerIframe.src = 'https://www.youtube.com/embed/' + item.trailer_youtube_id + '?autoplay=1&mute=1&controls=0&loop=1&playlist=' + item.trailer_youtube_id;
        trailerIframe.allow = 'autoplay';
        trailerIframe.style.cssText = 'width:100%;height:100%;border:none;pointer-events:none;';
        preview.style.display = 'block';
        preview.appendChild(trailerIframe);
      }, 300);
    }
  }

  function doCollapse() {
    isExpanded = false;
    div.classList.remove('card-expanded');
    div.style.transformOrigin = '';
    if (trailerTimer) { clearTimeout(trailerTimer); trailerTimer = null; }
    if (trailerIframe) { preview.removeChild(trailerIframe); trailerIframe = null; preview.style.display = 'none'; }
  }

  div.addEventListener('mouseenter', () => {
    expandTimer = setTimeout(doExpand, 400);
  });
  div.addEventListener('mouseleave', () => {
    if (expandTimer) { clearTimeout(expandTimer); expandTimer = null; }
    setTimeout(doCollapse, 100);
  });

  return div;
}

/* ===== Detail Modal ===== */
let selectedEpisode = null;

function openDetail(item) {
  const modal = document.getElementById('detailModal');
  const backdrop = document.getElementById('detailBackdrop');
  const body = document.getElementById('detailBody');
  selectedEpisode = null;

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

  const posterUrl = item.poster_path
    ? (item.poster_path.startsWith('/') ? 'https://image.tmdb.org/t/p/w342' + item.poster_path : item.poster_path)
    : '';

  if (item.hls_path) meta.push('HD');

  const isTV = item.media_type === 'tv';

  body.innerHTML = `
    <div class="detail-layout">
      <div class="detail-poster-col">
        <img class="detail-poster" id="detailPoster" src="${posterUrl}" alt="${item.title}" onerror="this.style.display='none'">
      </div>
      <div class="detail-info-col">
        <h2 class="detail-title">${item.title}</h2>
        <p class="detail-meta">${meta.join(' · ')}</p>
        <p class="detail-overview" id="detailOverview">${item.overview || 'No overview available.'}</p>
        <div class="detail-buttons">
          <button class="detail-play" id="detailPlayBtn">▶ Play</button>
        </div>
        ${isTV ? `<div id="detailEpisodes"><select class="detail-season-select" id="seasonSelect"></select><div class="episode-list" id="episodeList"></div></div>` : ''}
      </div>
    </div>
    <div id="moreLikeThis"></div>
  `;

  const playTarget = isTV ? findFirstEpisode(item) : item;
  document.getElementById('detailPlayBtn').onclick = () => {
    if (selectedEpisode) playMedia(selectedEpisode);
    else if (playTarget) playMedia(playTarget);
    else playMedia(item);
  };

  modal.classList.add('open');

  if (isTV) {
    loadEpisodes(item);
  }

  renderMoreLikeThis(item);
}

function findFirstEpisode(item) {
  const eps = allMedia.filter(m =>
    m.show_name === item.show_name &&
    m.episode_number > 0
  ).sort((a, b) => a.season_number - b.season_number || a.episode_number - b.episode_number);
  return eps[0] || null;
}

function renderMoreLikeThis(item) {
  const container = document.getElementById('moreLikeThis');
  const similar = allMedia
    .filter(m => m.id !== item.id && m.media_type === item.media_type)
    .sort(() => Math.random() - 0.5)
    .slice(0, 6);
  if (!similar.length) { container.innerHTML = ''; return; }
  container.innerHTML = `
    <h3 class="detail-section-title">More Like This</h3>
    <div class="row" id="moreLikeThisRow"></div>
  `;
  const row = document.getElementById('moreLikeThisRow');
  similar.forEach(m => {
    const card = createCard(m.id, m.title, m.poster_path, 0, false);
    row.appendChild(card);
  });
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
  selectedEpisode = null;
}

function loadEpisodes(item) {
  const seasonSelect = document.getElementById('seasonSelect');
  const episodeList = document.getElementById('episodeList');
  if (!seasonSelect || !episodeList) return;

  const all = allMedia.filter(m =>
    m.show_name === item.show_name &&
    m.season_number > 0 &&
    m.episode_number > 0
  ).sort((a, b) => a.season_number - b.season_number || a.episode_number - b.episode_number);

  const seasons = [...new Set(all.map(m => m.season_number))].sort((a, b) => a - b);
  seasonSelect.innerHTML = seasons.map(s => `<option value="${s}">Season ${s}</option>`).join('');

  function renderSeason(seasonNum) {
    const eps = all.filter(m => m.season_number === seasonNum);
    episodeList.innerHTML = eps.map(ep => {
      const epPoster = ep.poster_path
        ? (ep.poster_path.startsWith('/') ? 'https://image.tmdb.org/t/p/w200' + ep.poster_path : ep.poster_path)
        : '';
      return `
        <div class="episode-item" data-id="${ep.id}">
          <img class="episode-thumb" src="${epPoster || ''}" alt="" onerror="this.classList.add('skeleton');this.src=''" loading="lazy">
          <div class="episode-info">
            <div class="episode-num">Episode ${ep.episode_number}</div>
            <div class="episode-name">${ep.episode_title || ep.title}</div>
            <div class="episode-desc">${ep.overview || ''}</div>
          </div>
        </div>
      `;
    }).join('');
    episodeList.querySelectorAll('.episode-item').forEach(el => {
      el.addEventListener('click', () => {
        const found = allMedia.find(m => m.id == el.dataset.id);
        if (!found) return;
        selectedEpisode = found;
        episodeList.querySelectorAll('.episode-item').forEach(e => e.classList.remove('episode-active'));
        el.classList.add('episode-active');

        const poster = document.getElementById('detailPoster');
        const epPoster = found.poster_path
          ? (found.poster_path.startsWith('/') ? 'https://image.tmdb.org/t/p/w342' + found.poster_path : found.poster_path)
          : '';
        if (epPoster) poster.src = epPoster;

        const overview = document.getElementById('detailOverview');
        if (found.overview) overview.textContent = found.overview;

        const playBtn = document.getElementById('detailPlayBtn');
        playBtn.onclick = () => playMedia(found);
      });
    });
  }

  seasonSelect.onchange = () => renderSeason(parseInt(seasonSelect.value));
  if (seasons.length) renderSeason(seasons[0]);
}

let overlayHlsInstance = null;

/* ===== Overlay Player ===== */
function playMedia(item) {
  closeDetail();
  const overlay = document.getElementById('playerOverlay');
  const video = document.getElementById('overlayVideo');
  const title = document.getElementById('playerOverlayTitle');
  title.textContent = item.title;
  overlay.style.display = 'flex';

  let retries = 0;
  const modes = ['direct', 'remux', 'hls'];

  function trySource() {
    if (retries >= modes.length) {
      console.warn('playMedia: all sources failed for', item.id);
      showToast('No playable source found. The file format may not be supported.', 'error');
      return;
    }
    const mode = modes[retries];
    retries++;

    if (mode === 'hls') {
      playOverlayHLS(item.id, video);
      return;
    }
    video.src = (mode === 'direct' ? API + '/stream/' + item.id : API + '/remux/' + item.id) + '?token=' + getToken();
    video.play().catch((e) => {
      if (retries >= modes.length) showToast('Playback failed: ' + e.message, 'error');
    });
  }

  function playOverlayHLS(id, v) {
    if (overlayHlsInstance) { overlayHlsInstance.destroy(); overlayHlsInstance = null; }
    const url = API + '/hls/' + id + '/index.m3u8?token=' + getToken();
    if (v.canPlayType('application/vnd.apple.mpegurl')) {
      v.src = url;
      v.play();
    } else if (window.Hls) {
      overlayHlsInstance = new Hls();
      overlayHlsInstance.loadSource(url);
      overlayHlsInstance.attachMedia(v);
      overlayHlsInstance.on(Hls.Events.MANIFEST_PARSED, () => v.play());
      overlayHlsInstance.on(Hls.Events.ERROR, (event, data) => {
        if (data.fatal) {
          console.warn('Overlay HLS fatal error, trying next source');
          overlayHlsInstance.destroy();
          overlayHlsInstance = null;
          trySource();
        }
      });
    } else {
      trySource();
    }
  }

  video.onerror = function(e) {
    console.error('playMedia: source error', video.error ? 'code=' + video.error.code + ' msg=' + video.error.message : 'unknown');
    trySource();
  };
  trySource();
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

document.getElementById('btnAdmin').addEventListener('click', () => { window.location.href = '/admin'; });

/* ===== Init ===== */
const token = getToken();
if (token) {
  document.getElementById('btnLogout').style.display = 'inline-block';
  document.querySelector('.nav-link[data-filter="all"]').classList.add('active');
  document.querySelector('.bottom-nav-item[data-filter="all"]').classList.add('active');
  hideLogin();
  loadAll();
  apiFetch('/auth/me').then(r => { if (r) r.json().then(d => { if (d.role === 'admin') document.getElementById('btnAdmin').style.display = 'inline-block'; })}).catch(() => {});
} else {
  showLogin();
}
