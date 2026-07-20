const API = '/api/v1/admin';

function token() { return localStorage.getItem('token'); }
function auth() { return { 'Authorization': 'Bearer ' + token(), 'Content-Type': 'application/json' }; }

async function api(path, opts) {
  const res = await fetch(API + path, { ...opts, headers: auth() });
  if (res.status === 401) { window.location.href = '/'; return null; }
  if (res.status === 204) return null;
  return res.json();
}

function toast(msg, type) {
  const t = document.createElement('div');
  t.className = 'toast toast-' + type;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

function modal(title, bodyHtml, onSubmit) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay open';
  overlay.innerHTML = `<div class="modal-box"><h2>${title}</h2><div class="modal-body">${bodyHtml}</div><div class="modal-actions"><button class="btn btn-outline" id="modalCancel">Cancel</button><button class="btn btn-primary" id="modalSubmit">Save</button></div></div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('#modalCancel').onclick = () => overlay.remove();
  overlay.querySelector('#modalSubmit').onclick = async () => {
    await onSubmit();
    overlay.remove();
  };
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  return overlay;
}

function formData(container) {
  const data = {};
  container.querySelectorAll('[name]').forEach(el => {
    if (el.type === 'checkbox') data[el.name] = el.checked;
    else data[el.name] = el.value;
  });
  return data;
}

async function loadSection(section) {
  const el = document.getElementById('adminContent');
  document.querySelectorAll('.admin-nav-link').forEach(a => a.classList.toggle('active', a.dataset.section === section));

  switch (section) {
    case 'dashboard': renderDashboard(el); break;
    case 'users': renderUsers(el); break;
    case 'libraries': renderLibraries(el); break;
    case 'tags': renderTags(el); break;
    case 'media': renderMedia(el); break;
    case 'collections': renderCollections(el); break;
    case 'settings': renderSettings(el); break;
    default: el.innerHTML = '<h1>Not found</h1>';
  }
}

async function renderDashboard(el) {
  const [users, libs, media, activity, settings] = await Promise.all([
    api('/users'), api('/libraries'), api('/media'),
    api('/activity'), api('/settings'),
  ]);
  const mediaDir = (settings||{}).scanner_media_dir || '—';
  el.innerHTML = `
    <h1>Dashboard</h1>
    <div class="card-stats">
      <div class="stat-card"><div class="stat-value">${users ? users.length : 0}</div><div class="stat-label">Users</div></div>
      <div class="stat-card"><div class="stat-value">${libs ? libs.length : 0}</div><div class="stat-label">Libraries</div></div>
      <div class="stat-card"><div class="stat-value">${media ? media.length : 0}</div><div class="stat-label">Media Items</div></div>
      <div class="stat-card"><div class="stat-value" style="font-size:1rem">v0.1.0</div><div class="stat-label">Version</div></div>
    </div>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:8px">
      <div style="font-size:.85rem;color:var(--muted)">Media dir: <code style="color:var(--text)">${mediaDir}</code></div>
      <button class="btn btn-primary" id="scanBtn">⟳ Scan Libraries</button>
    </div>
    <h2 style="font-size:1.1rem;font-weight:600;margin-bottom:12px">Recent Activity</h2>
    <div class="activity-feed" id="activityFeed">
      ${(activity||[]).map(a => `
        <div class="activity-item">
          <span class="activity-time">${a.created_at || ''}</span>
          <span class="activity-type">${a.type}</span>
          <span class="activity-msg">${a.message}</span>
        </div>
      `).join('') || '<div style="color:var(--muted);padding:12px 0">No activity yet</div>'}
    </div>`;

  document.getElementById('scanBtn').onclick = async () => {
    const btn = document.getElementById('scanBtn');
    btn.textContent = '⟳ Scanning...';
    btn.disabled = true;
    await fetch('/api/v1/admin/scan', { method: 'POST', headers: { 'Authorization': 'Bearer ' + token() } });
    setTimeout(() => { btn.textContent = '⟳ Scan Libraries'; btn.disabled = false; renderDashboard(el); }, 3000);
  };
}

function renderUserRows(users, filter) {
  const tbody = document.getElementById('userTableBody');
  const filtered = filter ? users.filter(u => u.username.toLowerCase().includes(filter.toLowerCase())) : users;
  tbody.innerHTML = filtered.map(u => `
    <tr>
      <td>${u.id}</td>
      <td>${u.username}</td>
      <td><span class="tag-badge">${u.role}</span></td>
      <td>${u.is_active ? '✔' : '✘'}</td>
      <td>
        <button class="btn btn-sm btn-outline" onclick="editUser(${u.id})">Edit</button>
        <button class="btn btn-sm btn-outline" onclick="viewProfiles(${u.id})">Profiles</button>
        <button class="btn btn-sm btn-danger" onclick="deleteUser(${u.id})">Del</button>
      </td>
    </tr>
  `).join('');
  if (!filtered.length) tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:20px">No users found</td></tr>';
}

async function renderUsers(el) {
  const users = await api('/users') || [];
  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
      <h1>Users</h1>
      <div style="display:flex;gap:8px;align-items:center">
        <input id="userSearch" placeholder="Search users..." style="padding:8px 12px;border:1px solid #333;border-radius:4px;background:#2a2a2a;color:var(--text);font-size:.85rem;width:200px">
        <button class="btn btn-primary" id="addUserBtn">+ Add User</button>
      </div>
    </div>
    <table class="admin-table"><thead><tr><th>ID</th><th>Username</th><th>Role</th><th>Active</th><th>Actions</th></tr></thead><tbody id="userTableBody">
    </tbody></table>`;
  renderUserRows(users, '');
  document.getElementById('userSearch').addEventListener('input', e => renderUserRows(users, e.target.value));
  document.getElementById('addUserBtn').onclick = () => {
    modal('Add User', `
      <div class="form-row"><label>Username</label><input name="username" placeholder="Username"></div>
      <div class="form-row"><label>Password</label><input name="password" type="password" placeholder="Password"></div>
      <div class="form-row"><label>Role</label><select name="role"><option value="user">User</option><option value="admin">Admin</option></select></div>
    `, async () => {
      const f = document.querySelector('.modal-body');
      const d = formData(f);
      if (!d.username || !d.password) { toast('Username and password required', 'error'); return; }
      await api('/users', { method: 'POST', body: JSON.stringify(d) });
      toast('User created', 'success');
      renderUsers(el);
    });
  };
}

window.editUser = async (id) => {
  const u = await api('/users/' + id);
  modal('Edit User', `
    <div class="form-row"><label>Username</label><input name="username" value="${u.username}"></div>
    <div class="form-row"><label>Password (leave blank to keep)</label><input name="password" type="password" placeholder="New password"></div>
    <div class="form-row"><label>Role</label><select name="role"><option value="user" ${u.role==='user'?'selected':''}>User</option><option value="admin" ${u.role==='admin'?'selected':''}>Admin</option></select></div>
    <div class="form-row"><label><input name="is_active" type="checkbox" ${u.is_active?'checked':''}> Active</label></div>
  `, async () => {
    const d = formData(document.querySelector('.modal-body'));
    const body = { username: d.username, role: d.role, is_active: d.is_active === true || d.is_active === 'true' };
    if (d.password) body.password = d.password;
    await api('/users/' + id, { method: 'PUT', body: JSON.stringify(body) });
    toast('User updated', 'success');
    renderUsers(document.getElementById('adminContent'));
  });
};

window.deleteUser = async (id) => {
  if (!confirm('Delete user and all profiles?')) return;
  await api('/users/' + id, { method: 'DELETE' });
  toast('User deleted', 'success');
  renderUsers(document.getElementById('adminContent'));
};

window.viewProfiles = async (uid) => {
  const profiles = await api('/users/' + uid + '/profiles') || [];
  const [libraries, access] = await Promise.all([
    api('/libraries'),
    profiles.length ? api('/profiles/' + profiles[0].id + '/libraries') : null,
  ]);

  const el = document.getElementById('adminContent');
  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
      <h1>Profiles <span style="font-size:.9rem;color:var(--muted)">(User #${uid})</span></h1>
      <div><button class="btn btn-outline" onclick="loadSection('users')">← Back</button>
      <button class="btn btn-primary" id="addProfileBtn">+ Add Profile</button></div>
    </div>
    <table class="admin-table"><thead><tr><th>ID</th><th>Name</th><th>Kid</th><th>Max Rating</th><th>Library Access</th><th>Actions</th></tr></thead><tbody>
      ${profiles.map(p => `
        <tr>
          <td>${p.id}</td>
          <td>${p.name}</td>
          <td>${p.is_kid ? '✔' : ''}</td>
          <td>${p.max_rating || '—'}</td>
          <td>
            <div class="access-grid">
              ${(libraries||[]).map(l => `<span class="access-chip ${(access&&access.library_ids||[]).includes(l.id)?'selected':''}" onclick="toggleLibraryAccess(${p.id},${l.id},this)">${l.name}</span>`).join('')}
            </div>
          </td>
          <td>
            <button class="btn btn-sm btn-outline" onclick="editProfile(${p.id})">Edit</button>
            <button class="btn btn-sm btn-danger" onclick="deleteProfile(${p.id})">Del</button>
          </td>
        </tr>
      `).join('')}
    </tbody></table>`;

  document.getElementById('addProfileBtn').onclick = () => {
    modal('Add Profile', `
      <div class="form-row"><label>Name</label><input name="name" placeholder="Profile name"></div>
      <div class="form-row"><label>Max Rating (PG-13, R, etc.)</label><input name="max_rating" placeholder="Leave empty for no limit"></div>
      <div class="form-row"><label><input name="is_kid" type="checkbox"> Kids profile</label></div>
    `, async () => {
      const d = formData(document.querySelector('.modal-body'));
      if (!d.name) { toast('Name required', 'error'); return; }
      await api('/users/' + uid + '/profiles', { method: 'POST', body: JSON.stringify({ name: d.name, max_rating: d.max_rating, is_kid: !!d.is_kid }) });
      toast('Profile created', 'success');
      viewProfiles(uid);
    });
  };
};

window.triggerScan = async () => {
  await fetch('/api/v1/admin/scan', { method: 'POST', headers: { 'Authorization': 'Bearer ' + token() } });
  toast('Scan started', 'success');
};

window.toggleLibraryAccess = async (pid, lid, el) => {
  const isSelected = el.classList.toggle('selected');
  const access = await api('/profiles/' + pid + '/libraries') || { library_ids: [] };
  let ids = access.library_ids || [];
  if (isSelected) ids.push(lid); else ids = ids.filter(i => i !== lid);
  await api('/profiles/' + pid + '/libraries', { method: 'PUT', body: JSON.stringify({ library_ids: ids }) });
};

window.editProfile = async (id) => {
  // profiles are fetched via users route, so let's just do a simple form
  modal('Edit Profile', `
    <div class="form-row"><label>Name</label><input name="name" placeholder="Profile name"></div>
    <div class="form-row"><label>Max Rating</label><input name="max_rating" placeholder="e.g. PG-13"></div>
    <div class="form-row"><label><input name="is_kid" type="checkbox"> Kids profile</label></div>
  `, async () => {
    const d = formData(document.querySelector('.modal-body'));
    await api('/profiles/' + id, { method: 'PUT', body: JSON.stringify(d) });
    toast('Profile updated', 'success');
  });
};

window.deleteProfile = async (id) => {
  if (!confirm('Delete profile?')) return;
  await api('/profiles/' + id, { method: 'DELETE' });
  toast('Profile deleted', 'success');
  viewProfiles(document.querySelector('[data-section="users"]').id);
};

async function renderLibraries(el) {
  const [libs, media] = await Promise.all([api('/libraries') || [], api('/media') || []]);
  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
      <h1>Libraries</h1>
      <button class="btn btn-primary" id="addLibBtn">+ Add Library</button>
    </div>
    <table class="admin-table"><thead><tr><th>ID</th><th>Name</th><th>Description</th><th>Dir</th><th>Media</th><th>Actions</th></tr></thead><tbody>
      ${libs.map(l => `<tr>
        <td>${l.id}</td>
        <td>${l.name}</td>
        <td>${l.description || ''}</td>
        <td>${l.library_dir || '—'}</td>
        <td>${(media||[]).filter(m => m.library_id === l.id).length}</td>
        <td>
          <button class="btn btn-sm btn-outline" onclick="editLib(${l.id})">Edit</button>
          <button class="btn btn-sm btn-outline" onclick="triggerScan()">Scan</button>
          <button class="btn btn-sm btn-danger" onclick="deleteLib(${l.id})">Del</button>
        </td>
      </tr>`).join('')}
    </tbody></table>`;

  document.getElementById('addLibBtn').onclick = () => {
    modal('Add Library', `
      <div class="form-row"><label>Name</label><input name="name" placeholder="Library name"></div>
      <div class="form-row"><label>Directory</label><input name="library_dir" placeholder="e.g. Movies (subdir under media dir)"></div>
      <div class="form-row"><label>Description</label><input name="description" placeholder="Optional description"></div>
    `, async () => {
      const d = formData(document.querySelector('.modal-body'));
      if (!d.name) { toast('Name required', 'error'); return; }
      await api('/libraries', { method: 'POST', body: JSON.stringify(d) });
      toast('Library created', 'success');
      renderLibraries(el);
    });
  };
}

window.editLib = async (id) => {
  const libs = await api('/libraries');
  const l = (libs||[]).find(x => x.id === id);
  if (!l) return;
  modal('Edit Library', `
    <div class="form-row"><label>Name</label><input name="name" value="${l.name}"></div>
    <div class="form-row"><label>Directory</label><input name="library_dir" value="${l.library_dir||''}" placeholder="e.g. Movies"></div>
    <div class="form-row"><label>Description</label><input name="description" value="${l.description||''}" placeholder="Description"></div>
  `, async () => {
    const d = formData(document.querySelector('.modal-body'));
    await api('/libraries/' + id, { method: 'PUT', body: JSON.stringify(d) });
    toast('Library updated', 'success');
    renderLibraries(document.getElementById('adminContent'));
  });
};

window.deleteLib = async (id) => {
  if (!confirm('Delete library?')) return;
  await api('/libraries/' + id, { method: 'DELETE' });
  toast('Library deleted', 'success');
  renderLibraries(document.getElementById('adminContent'));
};

async function renderTags(el) {
  const tags = await api('/tags') || [];
  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
      <h1>Tags</h1>
      <button class="btn btn-primary" id="addTagBtn">+ Add Tag</button>
    </div>
    <table class="admin-table"><thead><tr><th>ID</th><th>Name</th><th>TMDB Genre ID</th><th>Actions</th></tr></thead><tbody>
      ${tags.map(t => `<tr>
        <td>${t.id}</td>
        <td><span class="tag-badge">${t.name}</span></td>
        <td>${t.tmdb_genre_id || '-'}</td>
        <td>
          <button class="btn btn-sm btn-outline" onclick="editTag(${t.id})">Edit</button>
          <button class="btn btn-sm btn-danger" onclick="deleteTag(${t.id})">Del</button>
        </td>
      </tr>`).join('')}
    </tbody></table>`;

  document.getElementById('addTagBtn').onclick = () => {
    modal('Add Tag', `
      <div class="form-row"><label>Name</label><input name="name" placeholder="Tag name"></div>
    `, async () => {
      const d = formData(document.querySelector('.modal-body'));
      if (!d.name) { toast('Name required', 'error'); return; }
      await api('/tags', { method: 'POST', body: JSON.stringify(d) });
      toast('Tag created', 'success');
      renderTags(el);
    });
  };
}

window.editTag = async (id) => {
  modal('Edit Tag', `
    <div class="form-row"><label>Name</label><input name="name" placeholder="Tag name"></div>
  `, async () => {
    const d = formData(document.querySelector('.modal-body'));
    await api('/tags/' + id, { method: 'PUT', body: JSON.stringify(d) });
    toast('Tag updated', 'success');
    renderTags(document.getElementById('adminContent'));
  });
};

window.deleteTag = async (id) => {
  if (!confirm('Delete tag?')) return;
  await api('/tags/' + id, { method: 'DELETE' });
  toast('Tag deleted', 'success');
  renderTags(document.getElementById('adminContent'));
};

async function renderMedia(el) {
  const [media, tags, libraries] = await Promise.all([
    api('/media'), api('/tags'), api('/libraries'),
  ]);
  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
      <h1>Media</h1>
      <input id="mediaSearch" placeholder="Search media..." style="padding:8px 12px;border:1px solid #333;border-radius:4px;background:#2a2a2a;color:var(--text);font-size:.85rem;width:240px">
    </div>
    <table class="admin-table"><thead><tr><th>ID</th><th>Title</th><th>Library</th><th>Rating</th><th>Duration</th><th>Tags</th><th>Actions</th></tr></thead><tbody id="mediaTableBody">
    </tbody></table>`;
  renderMediaRows(media || [], libraries || [], '');
  document.getElementById('mediaSearch').addEventListener('input', e => renderMediaRows(media || [], libraries || [], e.target.value));

}

function renderMediaRows(media, libraries, filter) {
  const tbody = document.getElementById('mediaTableBody');
  const filtered = filter ? media.filter(m => m.title.toLowerCase().includes(filter.toLowerCase())) : media;
  tbody.innerHTML = filtered.map(m => `
    <tr>
      <td>${m.id}</td>
      <td>${m.title}</td>
      <td>${(libraries||[]).find(l=>l.id===m.library_id)?.name || '—'}</td>
      <td>${m.rating || '—'}</td>
      <td>${Math.floor(m.duration_seconds/60)}m</td>
      <td id="mediaTags${m.id}">Loading...</td>
      <td>
        <button class="btn btn-sm btn-outline" onclick="editMedia(${m.id})">Edit</button>
      </td>
    </tr>
  `).join('');
  if (!filtered.length) tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--muted);padding:20px">No media found</td></tr>';

  for (const m of filtered) {
    api('/media/' + m.id + '/tags').then(mt => {
      const el = document.getElementById('mediaTags' + m.id);
      if (el) el.innerHTML = (mt||[]).map(t => `<span class="tag-badge">${t.name}</span>`).join('');
    });
  }
}

window.editMedia = async (id) => {
  const [media, allTags, allLibs, curTags] = await Promise.all([
    api('/media'), api('/tags'), api('/libraries'), api('/media/' + id + '/tags'),
  ]);
  const m = media.find(x => x.id === id);
  const curTagIds = (curTags||[]).map(t => t.id);

  modal('Edit Media: ' + m.title, `
    <div class="form-row"><label>Title</label><input name="title" value="${m.title}"></div>
    <div class="form-row"><label>Library</label><select name="library_id">
      <option value="">None</option>
      ${(allLibs||[]).map(l => `<option value="${l.id}" ${l.id===m.library_id?'selected':''}>${l.name}</option>`).join('')}
    </select></div>
    <div class="form-row"><label>Rating</label><input name="rating" value="${m.rating||''}"></div>
    <div class="form-row"><label>Tags</label><div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:4px">
      ${(allTags||[]).map(t => `<span class="access-chip ${curTagIds.includes(t.id)?'selected':''}" data-tag-id="${t.id}" onclick="this.classList.toggle('selected')">${t.name}</span>`).join('')}
    </div></div>
  `, async () => {
    const f = document.querySelector('.modal-body');
    const title = f.querySelector('[name="title"]').value;
    const libraryId = f.querySelector('[name="library_id"]').value;
    const rating = f.querySelector('[name="rating"]').value;
    const tagIds = [...f.querySelectorAll('.access-chip.selected')].map(el => parseInt(el.dataset.tagId));

    await api('/media/' + id, { method: 'PUT', body: JSON.stringify({ title, library_id: libraryId ? parseInt(libraryId) : null, rating }) });
    await api('/media/' + id + '/tags', { method: 'PUT', body: JSON.stringify({ tag_ids: tagIds }) });
    toast('Media updated', 'success');
    renderMedia(document.getElementById('adminContent'));
  });
};

async function renderCollections(el) {
  const colls = await fetch('/api/v1/collections').then(r => r.json()) || [];
  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
      <h1>Collections</h1>
      <button class="btn btn-primary" id="addCollBtn">+ Add Collection</button>
    </div>
    <table class="admin-table"><thead><tr><th>ID</th><th>Name</th><th>TMDB ID</th><th>Items</th><th>Actions</th></tr></thead><tbody>
      ${colls.map(c => `<tr>
        <td>${c.id}</td>
        <td>${c.name}</td>
        <td>${c.tmdb_collection_id || '—'}</td>
        <td>${c.item_count || 0}</td>
        <td>
          <button class="btn btn-sm btn-outline" onclick="editColl(${c.id})">Edit</button>
          <button class="btn btn-sm btn-danger" onclick="deleteColl(${c.id})">Del</button>
        </td>
      </tr>`).join('')}
    </tbody></table>`;

  document.getElementById('addCollBtn').onclick = () => {
    modal('Add Collection', `
      <div class="form-row"><label>Name</label><input name="name" placeholder="Collection name"></div>
      <div class="form-row"><label>TMDB Collection ID</label><input name="tmdb_collection_id" placeholder="Optional"></div>
      <div class="form-row"><label>Poster Path</label><input name="poster_path" placeholder="Optional"></div>
      <div class="form-row"><label>Backdrop Path</label><input name="backdrop_path" placeholder="Optional"></div>
    `, async () => {
      const d = formData(document.querySelector('.modal-body'));
      if (!d.name) { toast('Name required', 'error'); return; }
      await api('/collections', { method: 'POST', body: JSON.stringify(d) });
      toast('Collection created', 'success');
      renderCollections(el);
    });
  };
}

window.editColl = async (id) => {
  const [colls, media] = await Promise.all([
    fetch('/api/v1/collections').then(r => r.json()),
    api('/media'),
  ]);
  const c = colls.find(x => x.id === id);
  if (!c) return;
  const itemsRes = await fetch('/api/v1/collections/' + id + '/items');
  const curItems = itemsRes.ok ? await itemsRes.json() : [];
  const curIds = curItems.map(i => i.id);

  modal('Edit Collection: ' + c.name, `
    <div class="form-row"><label>Name</label><input name="name" value="${c.name}"></div>
    <div class="form-row"><label>TMDB Collection ID</label><input name="tmdb_collection_id" value="${c.tmdb_collection_id||''}"></div>
    <div class="form-row"><label>Poster Path</label><input name="poster_path" value="${c.poster_path||''}"></div>
    <div class="form-row"><label>Backdrop Path</label><input name="backdrop_path" value="${c.backdrop_path||''}"></div>
    <div class="form-row"><label>Items</label><div style="display:flex;flex-wrap:wrap;gap:4px;max-height:200px;overflow-y:auto">
      ${(media||[]).map(m => `<span class="access-chip ${curIds.includes(m.id)?'selected':''}" data-media-id="${m.id}" onclick="this.classList.toggle('selected')">${m.title}</span>`).join('')}
    </div></div>
  `, async () => {
    const f = document.querySelector('.modal-body');
    const name = f.querySelector('[name="name"]').value;
    const tmdb = f.querySelector('[name="tmdb_collection_id"]').value;
    const poster = f.querySelector('[name="poster_path"]').value;
    const backdrop = f.querySelector('[name="backdrop_path"]').value;
    const itemIds = [...f.querySelectorAll('.access-chip.selected')].map(el => parseInt(el.dataset.mediaId));

    const tmdbNum = tmdb ? parseInt(tmdb, 10) : null;
    await api('/collections/' + id, { method: 'PUT', body: JSON.stringify({ name, tmdb_collection_id: tmdbNum, poster_path: poster || null, backdrop_path: backdrop || null }) });
    await api('/collections/' + id + '/items', { method: 'PUT', body: JSON.stringify({ media_ids: itemIds }) });
    toast('Collection updated', 'success');
    renderCollections(document.getElementById('adminContent'));
  });
};

window.deleteColl = async (id) => {
  if (!confirm('Delete collection?')) return;
  await api('/collections/' + id, { method: 'DELETE' });
  toast('Collection deleted', 'success');
  renderCollections(document.getElementById('adminContent'));
};

async function renderSettings(el) {
  const settings = await api('/settings') || {};
  el.innerHTML = `
    <h1>Settings</h1>
    <div class="admin-form" id="settingsForm">
      ${Object.entries(settings).filter(([k]) => !k.startsWith('jwt_')).map(([k, v]) => `
        <div class="form-row">
          <label>${k}</label>
          <input name="${k}" value="${v}" ${k.includes('key') || k.includes('secret') ? 'type="password"' : ''}>
        </div>
      `).join('')}
      <button class="btn btn-primary" id="saveSettingsBtn">Save Settings</button>
    </div>`;

  document.getElementById('saveSettingsBtn').onclick = async () => {
    const data = {};
    document.querySelectorAll('#settingsForm input').forEach(el => data[el.name] = el.value);
    await api('/settings', { method: 'PUT', body: JSON.stringify(data) });
    toast('Settings saved', 'success');
  };
}

document.addEventListener('DOMContentLoaded', () => {
  if (!token()) { window.location.href = '/'; return; }

  const section = window.location.pathname.replace('/admin', '') || 'dashboard';
  const clean = section.replace(/^\//, '') || 'dashboard';
  loadSection(clean);

  document.querySelectorAll('.admin-nav-link').forEach(a => {
    a.addEventListener('click', e => {
      e.preventDefault();
      const sec = a.dataset.section;
      history.pushState(null, '', '/admin/' + sec);
      loadSection(sec);
    });
  });

  window.addEventListener('popstate', () => {
    const s = window.location.pathname.replace('/admin/', '') || 'dashboard';
    loadSection(s);
  });
});
