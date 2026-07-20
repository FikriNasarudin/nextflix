/* ===== Login (guarded — elements only exist in index.html) ===== */
function showLogin() {
  var el = document.getElementById('loginOverlay');
  if (el) el.style.display = 'flex';
  el = document.getElementById('app');
  if (el) el.style.display = 'none';
}

function hideLogin() {
  var el = document.getElementById('loginOverlay');
  if (el) el.style.display = 'none';
  el = document.getElementById('app');
  if (el) el.style.display = 'block';
}

/* ===== Login (guarded — elements only exist in index.html) ===== */
var loginBtn = document.getElementById('loginBtn');
if (loginBtn) {
  document.getElementById('btnLogout').addEventListener('click', function(e) {
    e.preventDefault();
    NextflixAPI.clearToken();
    window.location.href = '/';
  });

  loginBtn.addEventListener('click', async function() {
    var user = document.getElementById('loginUser').value;
    var pass = document.getElementById('loginPass').value;
    document.getElementById('loginError').textContent = '';
    try {
      var res = await fetch(NextflixAPI.API + '/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: user, password: pass }),
      });
      if (!res.ok) { document.getElementById('loginError').textContent = 'Invalid credentials'; return; }
      var data = await res.json();
      NextflixAPI.setToken(data.token);
      if (data.profiles && data.profiles.length) {
        document.getElementById('navProfile').textContent = data.profiles[0].name;
      }
      if (data.role === 'admin') {
        document.getElementById('btnAdmin').style.display = 'inline-block';
      }
      document.getElementById('btnLogout').style.display = 'inline-block';
      hideLogin();
      loadAll();
    } catch(e) { document.getElementById('loginError').textContent = 'Network error'; }
  });
}

/* ===== State ===== */
let allMedia = [];
let allLibraries = [];
let allCollections = [];
let billboardTimer = null;
let billboardIndex = 0;
let billboardItems = [];

/* ===== Load All Data ===== */
async function loadAll() {
  // Skip on player page — sections don't exist here
  if (!document.getElementById('app')) return;

  const [media, progress, trending, libraries, collections, recommendations] = await Promise.all([
    NextflixAPI.fetch('/media'),
    NextflixAPI.fetch('/progress', { skipCache: true }),
    NextflixAPI.fetch('/trending'),
    NextflixAPI.fetch('/libraries'),
    NextflixAPI.fetch('/collections'),
    NextflixAPI.fetch('/recommendations'),
  ]);
  if (!media) return;
  allMedia = media;
  window._nextflixMedia = media;
  allLibraries = libraries || [];
  allCollections = collections || [];

  window._lastProgress = progress || [];
  window._lastTrending = trending || [];
  window._lastBecause = (recommendations && recommendations.because_you_watched) || [];

  var sh = document.getElementById('skeletonHero');
  if (sh) sh.style.display = 'none';
  var sr = document.getElementById('skeletonRow');
  if (sr) sr.style.display = 'none';

  renderContinueWatching(window._lastProgress);
  renderBecauseYouWatched(window._lastBecause);
  renderNewlyAdded(allMedia);
  renderTrending(window._lastTrending);
  renderCollections(allCollections);
  initCarousels();

  storeHomeSectionStates();

  // Delegated navigation handler — full page nav on player page
  function isPlayerPage() { return !!document.getElementById('playerContainer'); }
  document.addEventListener('click', function(e) {
    var btn = e.target.closest('[data-filter], [data-nav]');
    if (!btn) return;
    if (isPlayerPage()) {
      var href = btn.getAttribute('href') || btn.dataset.nav;
      if (href) { e.preventDefault(); window.location.href = href; return; }
      window.location.href = '/';
      return;
    }
    if (btn.hasAttribute('data-filter')) showPage(btn.dataset.filter);
  });

  NextflixRouter.addRoute('/', function() { renderHomeView(); });
  NextflixRouter.addRoute('/detail/:id', function(params) { renderDetailPage(params); });
  NextflixRouter.addRoute('/browse/:section', function(params) { renderBrowsePage(params); });
  NextflixRouter.addRoute('/collections', function() { renderCollectionsPage(); });
  NextflixRouter.init();
  NextflixRouter.handlePath(window.location.pathname);
}

/* ===== Home Section State ===== */
function storeHomeSectionStates() {
  var hero = document.getElementById('hero');
  if (!hero) return;
  window._homeSectionStates = {
    heroDisplay: hero.style.display,
    continueDisplay: (document.getElementById('continueRow') || {}).style && document.getElementById('continueRow').style.display,
    becauseDisplay: (document.getElementById('becauseRow') || {}).style && document.getElementById('becauseRow').style.display,
    newlyDisplay: (document.getElementById('newlyAddedRow') || {}).style && document.getElementById('newlyAddedRow').style.display,
    trendingDisplay: (document.getElementById('trendingRow') || {}).style && document.getElementById('trendingRow').style.display,
    collectionsDisplay: (document.getElementById('collectionsRow') || {}).style && document.getElementById('collectionsRow').style.display,
  };
}

function hideHomeSections() {
  storeHomeSectionStates();
  var el;
  el = document.getElementById('hero'); if (el) el.style.display = 'none';
  el = document.getElementById('skeletonHero'); if (el) el.style.display = 'none';
  el = document.getElementById('skeletonRow'); if (el) el.style.display = 'none';
  el = document.getElementById('continueRow'); if (el) el.style.display = 'none';
  el = document.getElementById('becauseRow'); if (el) el.style.display = 'none';
  el = document.getElementById('newlyAddedRow'); if (el) el.style.display = 'none';
  el = document.getElementById('trendingRow'); if (el) el.style.display = 'none';
  el = document.getElementById('collectionsRow'); if (el) el.style.display = 'none';
}

function restoreHomeSections() {
  if (!window._homeSectionStates) return;
  var el;
  el = document.getElementById('hero'); if (el) el.style.display = window._homeSectionStates.heroDisplay;
  el = document.getElementById('continueRow'); if (el) el.style.display = window._homeSectionStates.continueDisplay;
  el = document.getElementById('becauseRow'); if (el) el.style.display = window._homeSectionStates.becauseDisplay;
  el = document.getElementById('newlyAddedRow'); if (el) el.style.display = window._homeSectionStates.newlyDisplay;
  el = document.getElementById('trendingRow'); if (el) el.style.display = window._homeSectionStates.trendingDisplay;
  el = document.getElementById('collectionsRow'); if (el) el.style.display = window._homeSectionStates.collectionsDisplay;
}

function renderHomeView() {
  var el;
  el = document.getElementById('skeletonHero'); if (el) el.style.display = 'none';
  el = document.getElementById('skeletonRow'); if (el) el.style.display = 'none';
  renderContinueWatching(window._lastProgress);
  renderBecauseYouWatched(window._lastBecause);
  renderNewlyAdded(allMedia);
  renderTrending(window._lastTrending);
  renderCollections(allCollections);
  storeHomeSectionStates();
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
  document.getElementById('heroPlay').onclick = (e) => { e.stopPropagation(); window.location.href = '/watch/' + item.id; };
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
  var rows = document.querySelectorAll('.row');
  if (!rows.length) return;
  rows.forEach(row => {
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

  var hero = document.getElementById('hero');
  var content = document.getElementById('pageContent');
  if (!content) return;
  content.innerHTML = '';

  if (hero) hero.style.display = 'flex';

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

  const continueMovies = (window._lastProgress || []).filter(p => {
    const m = allMedia.find(x => x.id == p.media_id);
    return m && m.media_type === 'movie';
  });
  const becauseMovies = (window._lastBecause || []).filter(b => {
    const m = allMedia.find(x => x.id == b.media_id);
    return m && m.media_type === 'movie';
  });
  const movieTrending = (window._lastTrending || []).filter(t => t.media_type === 'movie');

  // Render into home sections (they're in the DOM but hidden)
  const continueContainer = document.getElementById('continueContainer');
  const becauseContainer = document.getElementById('becauseContainer');
  const newlyContainer = document.getElementById('newlyAddedContainer');
  const trendingContainer = document.getElementById('trendingContainer');

  document.getElementById('collectionsRow').style.display = 'none';

  if (continueMovies.length) {
    document.getElementById('continueRow').style.display = 'block';
    document.getElementById('continueRow').querySelector('.row-title').innerHTML = 'Continue Watching <span class="row-view-all" data-nav="/browse/continue">View All →</span>';
    continueContainer.innerHTML = '';
    continueMovies.forEach(p => {
      const pct = p.duration_seconds ? Math.min(100, (p.position_seconds / p.duration_seconds) * 100) : 0;
      continueContainer.appendChild(createCard(p.media_id, p.title, p.poster_path, pct, false));
    });
  } else {
    document.getElementById('continueRow').style.display = 'none';
  }

  if (becauseMovies.length) {
    document.getElementById('becauseRow').style.display = 'block';
    document.getElementById('becauseRow').querySelector('.row-title').innerHTML = 'Because You Watched <span class="row-view-all" data-nav="/browse/recommended">View All →</span>';
    becauseContainer.innerHTML = '';
    becauseMovies.forEach(b => becauseContainer.appendChild(createCard(b.media_id, b.title, b.poster_path, 0, false)));
  } else {
    document.getElementById('becauseRow').style.display = 'none';
  }

  document.getElementById('newlyAddedRow').style.display = 'block';
  document.getElementById('newlyAddedRow').querySelector('.row-title').innerHTML = 'Newly Added Movies <span class="row-view-all" data-nav="/browse/new">View All →</span>';
  newlyContainer.innerHTML = '';
  const newMovies = movies.slice(0, 15);
  newMovies.forEach(m => newlyContainer.appendChild(createCard(m.id, m.title, m.poster_path, 0, false, 'NEW')));

  if (movieTrending.length) {
    document.getElementById('trendingRow').style.display = 'block';
    document.getElementById('trendingRow').querySelector('.row-title').innerHTML = 'Top 10 Movies <span class="row-view-all" data-nav="/browse/trending">View All →</span>';
    trendingContainer.innerHTML = '';
    movieTrending.forEach((t, idx) => {
      const card = createCard(null, t.title, t.poster_path, 0, true);
      const rank = document.createElement('div');
      rank.className = 'card-rank';
      rank.textContent = idx + 1;
      card.appendChild(rank);
      trendingContainer.appendChild(card);
    });
    trendingContainer.classList.add('row-trending');
  } else {
    document.getElementById('trendingRow').style.display = 'none';
  }

  const content = document.getElementById('pageContent');
  content.innerHTML = `
    <section class="row-section">
      <h2 class="row-title">All Movies</h2>
      <div class="grid" id="mediaGrid"></div>
    </section>
  `;
  renderGrid(movies);
  initCarousels();
}

function renderTVPage() {
  const tv = allMedia.filter(m => m.media_type === 'tv');
  initBillboard(tv);

  const continueTV = (window._lastProgress || []).filter(p => {
    const m = allMedia.find(x => x.id == p.media_id);
    return m && m.media_type === 'tv';
  });
  const becauseTV = (window._lastBecause || []).filter(b => {
    const m = allMedia.find(x => x.id == b.media_id);
    return m && m.media_type === 'tv';
  });
  const tvTrending = (window._lastTrending || []).filter(t => t.media_type === 'tv');

  const continueContainer = document.getElementById('continueContainer');
  const becauseContainer = document.getElementById('becauseContainer');
  const newlyContainer = document.getElementById('newlyAddedContainer');
  const trendingContainer = document.getElementById('trendingContainer');

  document.getElementById('collectionsRow').style.display = 'none';

  if (continueTV.length) {
    document.getElementById('continueRow').style.display = 'block';
    document.getElementById('continueRow').querySelector('.row-title').innerHTML = 'Continue Watching <span class="row-view-all" data-nav="/browse/continue">View All →</span>';
    continueContainer.innerHTML = '';
    continueTV.forEach(p => {
      const pct = p.duration_seconds ? Math.min(100, (p.position_seconds / p.duration_seconds) * 100) : 0;
      continueContainer.appendChild(createCard(p.media_id, p.title, p.poster_path, pct, false));
    });
  } else {
    document.getElementById('continueRow').style.display = 'none';
  }

  if (becauseTV.length) {
    document.getElementById('becauseRow').style.display = 'block';
    document.getElementById('becauseRow').querySelector('.row-title').innerHTML = 'Because You Watched <span class="row-view-all" data-nav="/browse/recommended">View All →</span>';
    becauseContainer.innerHTML = '';
    becauseTV.forEach(b => becauseContainer.appendChild(createCard(b.media_id, b.title, b.poster_path, 0, false)));
  } else {
    document.getElementById('becauseRow').style.display = 'none';
  }

  document.getElementById('newlyAddedRow').style.display = 'block';
  document.getElementById('newlyAddedRow').querySelector('.row-title').innerHTML = 'Newly Added TV <span class="row-view-all" data-nav="/browse/new">View All →</span>';
  newlyContainer.innerHTML = '';
  const newTV = tv.slice(0, 15);
  newTV.forEach(m => newlyContainer.appendChild(createCard(m.id, m.title, m.poster_path, 0, false, 'NEW')));

  if (tvTrending.length) {
    document.getElementById('trendingRow').style.display = 'block';
    document.getElementById('trendingRow').querySelector('.row-title').innerHTML = 'Top 10 TV <span class="row-view-all" data-nav="/browse/trending">View All →</span>';
    trendingContainer.innerHTML = '';
    tvTrending.forEach((t, idx) => {
      const card = createCard(null, t.title, t.poster_path, 0, true);
      const rank = document.createElement('div');
      rank.className = 'card-rank';
      rank.textContent = idx + 1;
      card.appendChild(rank);
      trendingContainer.appendChild(card);
    });
    trendingContainer.classList.add('row-trending');
  } else {
    document.getElementById('trendingRow').style.display = 'none';
  }

  const content = document.getElementById('pageContent');
  content.innerHTML = `
    <section class="row-section">
      <h2 class="row-title">All TV Shows</h2>
      <div class="grid" id="mediaGrid"></div>
    </section>
  `;
  renderGrid(tv);
  initCarousels();
}

/* ===== Continue Watching ===== */
function renderContinueWatching(progress) {
  var section = document.getElementById('continueRow');
  var container = document.getElementById('continueContainer');
  if (!section || !container) return;
  if (!progress.length) { section.style.display = 'none'; return; }
  section.style.display = 'block';
  container.innerHTML = '';
  progress.forEach(function(p) {
    var pct = p.duration_seconds ? Math.min(100, (p.position_seconds / p.duration_seconds) * 100) : 0;
    container.appendChild(createCard(p.media_id, p.title, p.poster_path, pct, false));
  });
}

/* ===== Collections ===== */
function renderCollections(collections) {
  var section = document.getElementById('collectionsRow');
  var container = document.getElementById('collectionsContainer');
  if (!section || !container) return;
  if (!collections || !collections.length) { section.style.display = 'none'; return; }
  section.style.display = 'block';
  container.innerHTML = '';
  collections.forEach(function(c) {
    var div = document.createElement('div');
    div.className = 'card collection-card';
    var img = document.createElement('img');
    img.className = 'card-poster';
    img.loading = 'lazy';
    img.alt = c.name;
    if (c.poster_path) {
      img.src = c.poster_path.startsWith('/') ? 'https://image.tmdb.org/t/p/w342' + c.poster_path : c.poster_path;
    } else {
      img.style.background = '#333';
    }
    div.appendChild(img);
    var title = document.createElement('div');
    title.className = 'card-title';
    title.textContent = c.name;
    div.appendChild(title);
    div.addEventListener('click', function() { showCollection(c); });
    container.appendChild(div);
  });
}

async function showCollection(coll) {
  const items = await NextflixAPI.fetch('/collections/' + coll.id + '/items', { skipCache: true }) || [];
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
  var section = document.getElementById('trendingRow');
  var container = document.getElementById('trendingContainer');
  if (!section || !container) return;
  if (!trending.length) { section.style.display = 'none'; return; }
  section.style.display = 'block';
  container.innerHTML = '';
  trending.forEach(function(t) {
    var card = createCard(null, t.title, t.poster_path, 0, true);
    var rank = document.createElement('div');
    rank.className = 'card-rank';
    rank.textContent = t.rank;
    card.appendChild(rank);
    container.appendChild(card);
  });
}

/* ===== Because You Watched ===== */
function renderBecauseYouWatched(items) {
  var section = document.getElementById('becauseRow');
  var container = document.getElementById('becauseContainer');
  if (!section || !container) return;
  if (!items.length) { section.style.display = 'none'; return; }
  section.style.display = 'block';
  container.innerHTML = '';
  items.forEach(function(item) {
    container.appendChild(createCard(item.media_id, item.title, item.poster_path, 0, false));
  });
}

/* ===== Newly Added ===== */
function renderNewlyAdded(media) {
  var section = document.getElementById('newlyAddedRow');
  var container = document.getElementById('newlyAddedContainer');
  if (!section || !container) return;
  var slice = media.slice(0, 15);
  if (!slice.length) { section.style.display = 'none'; return; }
  section.style.display = 'block';
  container.innerHTML = '';
  slice.forEach(function(m) {
    container.appendChild(createCard(m.id, m.title, m.poster_path, 0, false, 'NEW'));
  });
}

/* ===== Browse Page (View All) ===== */
function renderBrowsePage(params) {
  hideHomeSections();
  const content = document.getElementById('pageContent');
  let items = [];
  let title = '';

  switch (params.section) {
    case 'continue':
      items = window._lastProgress || [];
      title = 'Continue Watching';
      content.innerHTML = makeGridPage(title);
      items.forEach(p => {
        const pct = p.duration_seconds ? Math.min(100, (p.position_seconds / p.duration_seconds) * 100) : 0;
        document.getElementById('mediaGrid').appendChild(createCard(p.media_id, p.title, p.poster_path, pct, false));
      });
      return;
    case 'recommended':
      items = window._lastBecause || [];
      title = 'Because You Watched';
      content.innerHTML = makeGridPage(title);
      items.forEach(i => document.getElementById('mediaGrid').appendChild(createCard(i.media_id, i.title, i.poster_path, 0, false)));
      return;
    case 'new':
      title = 'Newly Added';
      content.innerHTML = makeGridPage(title);
      allMedia.forEach(m => document.getElementById('mediaGrid').appendChild(createCard(m.id, m.title, m.poster_path, 0, false)));
      return;
    case 'trending':
      items = window._lastTrending || [];
      title = 'Daily Top 10';
      content.innerHTML = makeGridPage(title);
      items.forEach((t, idx) => {
        const card = createCard(null, t.title, t.poster_path, 0, true);
        const rank = document.createElement('div');
        rank.className = 'card-rank';
        rank.textContent = idx + 1;
        card.appendChild(rank);
        document.getElementById('mediaGrid').appendChild(card);
      });
      return;
    default:
      title = 'Browse';
      content.innerHTML = makeGridPage(title);
  }
  initCarousels();
}

function makeGridPage(title) {
  return `<section class="row-section"><h2 class="row-title">${title}</h2><div class="grid" id="mediaGrid"></div></section>`;
}

/* ===== Collections Page ===== */
function renderCollectionsPage() {
  hideHomeSections();
  const content = document.getElementById('pageContent');
  if (!allCollections.length) {
    content.innerHTML = '<div class="empty-state"><p>No collections yet</p></div>';
    return;
  }
  content.innerHTML = `
    <section class="row-section">
      <h2 class="row-title">All Collections</h2>
      <div class="collections-grid" id="collectionsGrid"></div>
    </section>
  `;
  const grid = document.getElementById('collectionsGrid');
  allCollections.forEach(c => {
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
    grid.appendChild(div);
  });
}

/* ===== Card ===== */
function createCard(id, title, poster, progressPct, isTrending, badge) {
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
  img.style.background = 'var(--surface)';
  if (poster) {
    img.src = poster.startsWith('/') ? 'https://image.tmdb.org/t/p/w342' + poster : poster;
  }
  img.onerror = function() {
    if (!this.dataset.fallback) {
      this.dataset.fallback = '1';
      this.src = NextflixAPI.API + '/image/local/poster/' + id;
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

  if (badge) {
    const b = document.createElement('span');
    b.className = 'card-badge-new';
    b.textContent = badge;
    div.appendChild(b);
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
  playBtn.addEventListener('click', (e) => { e.stopPropagation(); if (item) window.location.href = '/watch/' + item.id; });
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
          <button class="detail-info-btn" id="detailFullBtn">Full Details</button>
        </div>
        ${isTV ? `<div id="detailEpisodes"><select class="detail-season-select" id="seasonSelect"></select><div class="episode-list" id="episodeList"></div></div>` : ''}
      </div>
    </div>
    <div id="moreLikeThis"></div>
  `;

  const playTarget = isTV ? findFirstEpisode(item) : item;
  document.getElementById('detailPlayBtn').onclick = () => {
    const target = selectedEpisode || playTarget || item;
    window.location.href = '/watch/' + target.id;
  };
  document.getElementById('detailFullBtn').onclick = () => {
    closeDetail();
    NextflixRouter.navigate('/detail/' + item.id);
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
        playBtn.onclick = () => { window.location.href = '/watch/' + found.id; };
      });
    });
  }

  seasonSelect.onchange = () => renderSeason(parseInt(seasonSelect.value));
  if (seasons.length) renderSeason(seasons[0]);
}

/* ===== Detail Page ===== */
function renderDetailPage(params) {
  const id = parseInt(params.id);
  const item = allMedia.find(m => m.id === id);
  if (!item) { NextflixAPI.showToast('Media not found', 'error'); NextflixRouter.navigate('/'); return; }

  hideHomeSections();

  const content = document.getElementById('pageContent');

  const imgUrl = item.backdrop_path
    ? 'https://image.tmdb.org/t/p/original' + item.backdrop_path
    : item.poster_path
      ? (item.poster_path.startsWith('/') ? 'https://image.tmdb.org/t/p/w1280' + item.poster_path : '')
      : '';

  const posterUrl = item.poster_path
    ? (item.poster_path.startsWith('/') ? 'https://image.tmdb.org/t/p/w342' + item.poster_path : item.poster_path)
    : '';

  const meta = [];
  if (item.media_type) meta.push(item.media_type.toUpperCase());
  if (item.rating) meta.push(item.rating);
  if (item.year) meta.push(item.year);
  if (item.duration_seconds) {
    const h = Math.floor(item.duration_seconds / 3600);
    const m = Math.floor((item.duration_seconds % 3600) / 60);
    meta.push(h + 'h ' + m + 'm');
  }
  if (item.hls_path) meta.push('HD');

  const isTV = item.media_type === 'tv';

  content.innerHTML = `
    <div class="detail-page">
      <div class="detail-page-backdrop" style="background-image: url('${imgUrl}')">
        <button class="detail-page-back" id="detailPageBack">← Back</button>
      </div>
      <div class="detail-page-body">
        <div class="detail-page-layout">
          <div class="detail-page-poster-col">
            <img class="detail-page-poster" src="${posterUrl}" alt="${item.title}" onerror="this.style.display='none'">
          </div>
          <div class="detail-page-info-col">
            <h1 class="detail-page-title">${item.title}</h1>
            <p class="detail-page-meta">${meta.join(' · ')}</p>
            <p class="detail-page-overview">${item.overview || 'No overview available.'}</p>
            <button class="detail-page-play" id="detailPagePlay">▶ Play</button>
            ${isTV ? '<div id="detailPageEpisodes"></div>' : ''}
            <div id="detailPageMoreLikeThis"></div>
          </div>
        </div>
      </div>
    </div>
  `;

  document.getElementById('detailPageBack').onclick = () => NextflixRouter.navigate('/');
  document.getElementById('detailPagePlay').onclick = () => { window.location.href = '/watch/' + item.id; };

  document.querySelectorAll('.nav-link[data-filter]').forEach(l => l.classList.remove('active'));
  document.querySelectorAll('.bottom-nav-item[data-filter]').forEach(l => l.classList.remove('active'));

  if (isTV) {
    renderDetailPageEpisodes(item);
  }

  renderDetailPageMoreLikeThis(item);
}

function renderDetailPageEpisodes(item) {
  const container = document.getElementById('detailPageEpisodes');
  if (!container) return;

  const all = allMedia.filter(m =>
    m.show_name === item.show_name &&
    m.season_number > 0 &&
    m.episode_number > 0
  ).sort((a, b) => a.season_number - b.season_number || a.episode_number - b.episode_number);

  const seasons = [...new Set(all.map(m => m.season_number))].sort((a, b) => a - b);

  let html = '<select class="detail-season-select" id="detailPageSeasonSelect">';
  html += seasons.map(s => `<option value="${s}">Season ${s}</option>`).join('');
  html += '</select><div class="episode-list" id="detailPageEpisodeList"></div>';
  container.innerHTML = html;

  const seasonSelect = document.getElementById('detailPageSeasonSelect');
  const episodeList = document.getElementById('detailPageEpisodeList');

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
            <div class="episode-num">S${ep.season_number} · E${ep.episode_number}</div>
            <div class="episode-name">${ep.episode_title || ep.title}</div>
            <div class="episode-desc">${ep.overview || ''}</div>
          </div>
        </div>
      `;
    }).join('');
    episodeList.querySelectorAll('.episode-item').forEach(el => {
      el.addEventListener('click', () => {
        const found = allMedia.find(m => m.id == el.dataset.id);
        if (found) window.location.href = '/watch/' + found.id;
      });
    });
  }

  seasonSelect.onchange = () => renderSeason(parseInt(seasonSelect.value));
  if (seasons.length) renderSeason(seasons[0]);
}

function renderDetailPageMoreLikeThis(item) {
  const container = document.getElementById('detailPageMoreLikeThis');
  if (!container) return;
  const similar = allMedia
    .filter(m => m.id !== item.id && m.media_type === item.media_type)
    .sort(() => Math.random() - 0.5)
    .slice(0, 6);
  if (!similar.length) { container.innerHTML = ''; return; }
  container.innerHTML = `
    <h3 class="detail-section-title">More Like This</h3>
    <div class="row" id="detailPageMoreLikeThisRow"></div>
  `;
  const row = document.getElementById('detailPageMoreLikeThisRow');
  similar.forEach(m => {
    const card = createCard(m.id, m.title, m.poster_path, 0, false);
    row.appendChild(card);
  });
}

document.getElementById('btnAdmin').addEventListener('click', () => { window.location.href = '/admin'; });

/* ===== Nav Scroll Effect ===== */
document.addEventListener('scroll', () => {
  const nav = document.querySelector('.nav');
  if (!nav) return;
  nav.classList.toggle('nav-scrolled', window.scrollY > 10);
}, { passive: true });

/* ===== Init ===== */
const token = NextflixAPI.getToken();
if (token) {
  document.getElementById('btnLogout').style.display = 'inline-block';
  document.querySelector('.nav-link[data-filter="all"]').classList.add('active');
  document.querySelector('.bottom-nav-item[data-filter="all"]').classList.add('active');
  hideLogin();
  loadAll();
  NextflixAPI.fetch('/auth/me').then(d => { if (d && d.role === 'admin') document.getElementById('btnAdmin').style.display = 'inline-block'; }).catch(() => {});
} else {
  showLogin();
}
