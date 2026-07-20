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
let isPiP = false;

async function loadMedia(id) {
  let all = window._nextflixMedia;
  if (!all || !all.length) {
    const resp = await NextflixAPI.fetch('/media');
    all = (resp && resp.items) || [];
  }
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
  document.getElementById('playerInfoTitle').textContent = item.title;
  const metaEl = document.getElementById('playerInfoMeta');
  const parts = [];
  if (item.year) parts.push(item.year);
  if (item.rating) parts.push(item.rating);
  if (item.media_type) parts.push(item.media_type.toUpperCase());
  if (item.duration_seconds) {
    const h = Math.floor(item.duration_seconds / 3600);
    const m = Math.floor((item.duration_seconds % 3600) / 60);
    parts.push(h + 'h ' + m + 'm');
  }
  metaEl.textContent = parts.join(' · ');
  document.getElementById('playerInfoDesc').textContent = item.overview || '';
  await loadTracks(id);
  initPlayer(item);
}

async function loadTracks(id) {
  const [subs, audios] = await Promise.all([
    NextflixAPI.fetch('/media/' + id + '/subtitles'),
    NextflixAPI.fetch('/media/' + id + '/audio'),
  ]);
  window._extSubs = subs || [];
  window._extAudios = audios || [];
}

function onSubtitleChange(value) {
  const video = document.getElementById('video');
  const oldTrack = video.querySelector('track[data-subtitle]');
  if (oldTrack) oldTrack.remove();
  if (hlsInstance && hlsInstance.subtitleTrack !== -1) {
    hlsInstance.subtitleTrack = -1;
  }
  if (!value) return;
  if (value.startsWith('hls-')) {
    if (hlsInstance) hlsInstance.subtitleTrack = parseInt(value.replace('hls-', ''), 10);
    return;
  }
  const trackEl = document.createElement('track');
  trackEl.setAttribute('data-subtitle', '');
  trackEl.kind = 'subtitles';
  trackEl.label = 'Subtitles';
  trackEl.src = NextflixAPI.API + '/subtitle/' + value + '/file?token=' + NextflixAPI.getToken();
  trackEl.addEventListener('load', function onLoad() {
    this.track.mode = 'showing';
  });
  video.appendChild(trackEl);
}

function onAudioChange(value) {
  const video = document.getElementById('video');
  if (!value) return;
  if (value.startsWith('hls-')) {
    if (hlsInstance) hlsInstance.audioTrack = parseInt(value.replace('hls-', ''), 10);
    return;
  }
  if (!value.startsWith('ext-')) return;
  const idx = parseInt(value.replace('ext-', ''), 10);
  const track = window._extAudios && window._extAudios[idx];
  if (!track) return;
  if (video.audioTracks && video.audioTracks.length > 1) {
    for (let i = 0; i < video.audioTracks.length; i++) {
      video.audioTracks[i].enabled = (i === track.stream_index);
    }
    return;
  }
  if (hlsInstance && hlsInstance.audioTracks && hlsInstance.audioTracks.length > 1) {
    const lang = (track.language || '').toLowerCase();
    const title = (track.title || '').toLowerCase();
    for (let i = 0; i < hlsInstance.audioTracks.length; i++) {
      const at = hlsInstance.audioTracks[i];
      if (at.lang === lang || (at.name && at.name.toLowerCase() === title)) {
        hlsInstance.audioTrack = i;
        return;
      }
    }
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
  document.getElementById('playerInfoTitle').textContent = ep.title;
  const metaEl = document.getElementById('playerInfoMeta');
  const parts = [];
  if (ep.year) parts.push(ep.year);
  if (ep.rating) parts.push(ep.rating);
  if (ep.duration_seconds) {
    const h = Math.floor(ep.duration_seconds / 3600);
    const m = Math.floor((ep.duration_seconds % 3600) / 60);
    parts.push(h + 'h ' + m + 'm');
  }
  metaEl.textContent = parts.join(' · ');
  document.getElementById('playerInfoDesc').textContent = ep.overview || '';
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
        const epPoster = NextflixAPI.imageUrl(ep.poster_path, ep.id, 'poster', 'w200');
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

  function syncSpeedSelects(val) {
    document.getElementById('pcSpeed').value = val;
    const dup = document.getElementById('pcSpeedDup');
    if (dup) dup.value = val;
  }

  function populateTracks() {
    while (subSelect.options.length > 1) subSelect.remove(1);
    while (audioSelect.options.length > 1) audioSelect.remove(1);
    const subEmpty = document.getElementById('subtitleEmpty');
    const audioEmpty = document.getElementById('audioEmpty');
    if (window._extSubs && window._extSubs.length) {
      subSelect.style.display = 'block';
      if (subEmpty) subEmpty.style.display = 'none';
      window._extSubs.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s.id;
        opt.textContent = (s.language || 'und').toUpperCase() + (s.is_forced ? ' (forced)' : '');
        subSelect.appendChild(opt);
      });
    } else {
      if (subEmpty) subEmpty.style.display = 'block';
    }
    if (window._extAudios && window._extAudios.length > 1) {
      audioSelect.style.display = 'block';
      if (audioEmpty) audioEmpty.style.display = 'none';
      window._extAudios.forEach((a, i) => {
        const opt = document.createElement('option');
        opt.value = 'ext-' + i;
        opt.textContent = (a.language || 'und').toUpperCase() + ' - ' + (a.title || a.codec) + (a.is_default ? ' (default)' : '');
        if (a.is_default) opt.selected = true;
        audioSelect.appendChild(opt);
      });
    } else {
      if (audioEmpty) audioEmpty.style.display = 'block';
    }
  }

  function playHLS() {
    if (hlsInstance) { hlsInstance.destroy(); hlsInstance = null; }
    const url = NextflixAPI.API + '/hls/' + item.id + '/index.m3u8?token=' + NextflixAPI.getToken();
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
          subSelect.style.display = 'block';
          hlsInstance.subtitleTracks.forEach((t, i) => {
            const opt = document.createElement('option');
            opt.value = 'hls-' + i;
            opt.textContent = (t.lang || 'und').toUpperCase() + ' (embedded)';
            subSelect.appendChild(opt);
          });
        }
        if (hlsInstance.audioTracks && hlsInstance.audioTracks.length > 1) {
          audioSelect.style.display = 'block';
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
    let tryGeneration = 0;
    const modes = item.hls_path
      ? (NextflixAPI.isSlowConnection() ? ['hls', 'remux'] : ['direct', 'remux', 'hls'])
      : (NextflixAPI.isSlowConnection() ? ['remux'] : ['direct', 'remux']);

    function trySource() {
      if (retries >= modes.length) {
        console.warn('playSource: all sources failed for', item.id);
        NextflixAPI.showToast('No playable source found. The file format may not be supported.', 'error');
        return;
      }
      const mode = modes[retries];
      retries++;

      if (mode === 'hls') {
        playHLS();
        return;
      }

      const gen = ++tryGeneration;
      const url = (mode === 'direct' ? NextflixAPI.API + '/stream/' + item.id : NextflixAPI.API + '/remux/' + item.id) + '?token=' + NextflixAPI.getToken();

      video.onerror = null;
      video.src = url;
      video.onerror = function(e) {
        if (gen !== tryGeneration) return;
        console.error('playSource: source error', video.error ? 'code=' + video.error.code + ' msg=' + video.error.message : 'unknown');
        trySource();
      };
      populateTracks();
      video.play().catch((e) => {
        if (retries >= modes.length) NextflixAPI.showToast('Playback failed: ' + e.message, 'error');
      });
    }

    trySource();
  }

  try { setupCenterPlay(video); } catch (e) { console.warn('centerPlay:', e); }
  try { setupCustomControls(video); } catch (e) { console.warn('customControls:', e); }
  try { setupKeyboardShortcuts(video); } catch (e) { console.warn('keyboard:', e); }
  try { setupSettingsDrawer(); } catch (e) { console.warn('settings:', e); }
  try { setupDoubleTapSeek(video); } catch (e) { console.warn('doubleTap:', e); }
  try { setupAutoFullscreen(video); } catch (e) { console.warn('autoFS:', e); }
  try { setupSkipIntro(video, item); } catch (e) { console.warn('skipIntro:', e); }
  try { setupAspectRatio(video); } catch (e) { console.warn('ratio:', e); }
  loadThumbnails(item.id);

  // Show next episode button in controls for TV
  const nextEpBtn = document.getElementById('pcNextEp');
  if (isTV && nextEpBtn) {
    nextEpBtn.style.display = 'flex';
    nextEpBtn.addEventListener('click', () => {
      const idx = showEpisodes.findIndex(ep => ep.id === item.id);
      const nextEp = idx >= 0 && idx < showEpisodes.length - 1 ? showEpisodes[idx + 1] : null;
      if (nextEp) switchEpisode(nextEp);
    });
  }

  playSource();

  video.onended = () => {
    if (isTV) triggerNextEpisode(item);
    else triggerMovieEnd(item);
  };

  let saveTimer = null;
  video.addEventListener('timeupdate', () => {
    if (!VIDEO_ID || !video.currentTime) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      const isFinished = video.currentTime / DURATION >= 0.9;
      await NextflixAPI.fetch('/progress', {
        method: 'PUT',
        body: JSON.stringify({
          media_id: VIDEO_ID,
          position_seconds: Math.floor(video.currentTime),
          duration_seconds: DURATION,
          is_finished: isFinished,
        }),
      });
    }, 2000);
  });
}

function formatTime(s) {
  s = Math.floor(s);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return m + ':' + (sec < 10 ? '0' : '') + sec;
}

function showControls() {
  document.getElementById('controlBar').classList.remove('pc-hidden');
  document.getElementById('playerTopOverlay').classList.add('visible');
  document.getElementById('playerInfoOverlay').classList.add('visible');
}

function hideControls() {
  const video = document.getElementById('video');
  if (video.paused) return;
  document.getElementById('controlBar').classList.add('pc-hidden');
  document.getElementById('playerTopOverlay').classList.remove('visible');
  document.getElementById('playerInfoOverlay').classList.remove('visible');
}

function setupCenterPlay(video) {
  const overlay = document.getElementById('pcCenterPlay');
  if (!overlay) return;

  overlay.addEventListener('click', () => {
    video.paused ? video.play() : video.pause();
  });

  function update() {
    if (video.paused) {
      overlay.classList.add('pc-center-show');
    } else {
      overlay.classList.remove('pc-center-show');
    }
  }

  video.addEventListener('play', update);
  video.addEventListener('pause', update);
  // Initial state
  update();
}

function updateProgressBar(video) {
  const played = document.getElementById('pcProgressPlayed');
  const buffer = document.getElementById('pcProgressBuffer');
  if (!video.duration) return;
  const pct = (video.currentTime / video.duration) * 100;
  if (played) played.style.width = pct + '%';
  // Buffer progress
  if (buffer && video.buffered.length > 0) {
    const bufferedEnd = video.buffered.end(video.buffered.length - 1);
    buffer.style.width = (bufferedEnd / video.duration) * 100 + '%';
  }
}

function setupCustomControls(video) {
  const playBtn = document.getElementById('pcPlay');
  const progress = document.getElementById('pcProgress');
  const progressTrack = document.getElementById('pcProgressTrack');
  const timeEl = document.getElementById('pcTime');
  const volBtn = document.getElementById('pcVolBtn');
  const volSlider = document.getElementById('pcVolume');
  const speedSelect = document.getElementById('pcSpeed');
  const speedDup = document.getElementById('pcSpeedDup');
  const fsBtn = document.getElementById('pcFs');
  const rewindBtn = document.getElementById('pcRewind');
  const forwardBtn = document.getElementById('pcForward');
  const pipBtn = document.getElementById('pcPip');

  const playIcon = document.getElementById('pcPlayIcon');

  function setPlayIcon(playing) {
    if (playIcon) {
      playIcon.setAttribute('d', playing ? 'M7 4l13 8-13 8V4z' : 'M6 4h4v16H6V4zm8 0h4v16h-4V4z');
    } else {
      playBtn.textContent = playing ? '▶' : '⏸';
    }
  }

  function updatePlayIcon() {
    setPlayIcon(video.paused);
  }

  function formatEndTime(cur, dur) {
    if (!dur || dur === Infinity) return '';
    var remaining = dur - cur;
    if (remaining <= 0) return '';
    var end = new Date(Date.now() + remaining * 1000);
    return ' · Ends ' + end.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  function updateTime() {
    if (isSeeking) return;
    if (video.ended) {
      timeEl.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      return;
    }
    const cur = video.currentTime || 0;
    const dur = video.duration || 0;
    if (progress) progress.value = dur ? (cur / dur) * 100 : 0;
    timeEl.textContent = formatTime(cur) + ' / ' + formatTime(dur) + formatEndTime(cur, dur);
    updateProgressBar(video);
  }

  function updateVolIcon() {
    const volIcon = document.getElementById('pcVolIcon');
    if (video.muted || video.volume === 0) {
      if (volIcon) {
        volIcon.innerHTML = '<path d="M3 9v6h4l5 5V4L7 9H3zm13 0l-1.5 1.5L16.5 12l-1.5 1.5L16.5 15l1.5-1.5L19.5 15l1.5-1.5L19.5 12l1.5-1.5L19.5 9 18 10.5 16.5 9z"/>';
      } else {
        volBtn.textContent = '🔇';
      }
    } else {
      if (volIcon) {
        volIcon.innerHTML = '<path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 8.5v7a4.49 4.49 0 0 0 2.5-3.5zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>';
      } else {
        volBtn.textContent = '🔊';
      }
    }
  }

  if (playBtn) {
    playBtn.addEventListener('click', () => {
      video.paused ? video.play() : video.pause();
    });
  }

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

  if (rewindBtn) {
    rewindBtn.addEventListener('click', () => {
      video.currentTime = Math.max(0, video.currentTime - 10);
    });
  }

  if (forwardBtn) {
    forwardBtn.addEventListener('click', () => {
      video.currentTime = Math.min(video.duration, video.currentTime + 10);
    });
  }

  if (progress) {
    progress.addEventListener('mousedown', () => { isSeeking = true; });
    progress.addEventListener('input', () => {
      if (!video.duration) return;
      video.currentTime = (progress.value / 100) * video.duration;
      timeEl.textContent = formatTime(video.currentTime) + ' / ' + formatTime(video.duration);
    });
    progress.addEventListener('change', () => { isSeeking = false; });
    progress.addEventListener('mouseup', () => { isSeeking = false; });
  }

  video.addEventListener('timeupdate', updateTime);
  video.addEventListener('loadedmetadata', () => {
    if (progress) progress.max = 100;
    updateTime();
    updateProgressBar(video);
  });

  video.addEventListener('progress', () => updateProgressBar(video));

  if (volBtn) {
    volBtn.addEventListener('click', () => {
      video.muted = !video.muted;
      updateVolIcon();
    });
  }

  if (volSlider) {
    volSlider.addEventListener('input', () => {
      video.volume = parseFloat(volSlider.value);
      video.muted = video.volume === 0;
      updateVolIcon();
    });
  }
  video.addEventListener('volumechange', () => {
    if (volSlider) volSlider.value = video.muted ? 0 : video.volume;
    updateVolIcon();
  });

  if (speedSelect) {
    speedSelect.addEventListener('change', () => {
      video.playbackRate = parseFloat(speedSelect.value);
      if (speedDup) speedDup.value = speedSelect.value;
    });
  }
  if (speedDup) {
    speedDup.addEventListener('change', () => {
      video.playbackRate = parseFloat(speedDup.value);
      if (speedSelect) speedSelect.value = speedDup.value;
    });
  }

  if (fsBtn) {
    fsBtn.addEventListener('click', () => {
      const container = document.getElementById('playerContainer');
      if (document.fullscreenElement) {
        document.exitFullscreen();
      } else {
        container.requestFullscreen();
      }
    });
  }

  document.addEventListener('fullscreenchange', () => {
    const icon = document.getElementById('pcFsIcon');
    if (document.fullscreenElement) {
      if (icon) icon.innerHTML = '<path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z"/>';
      else if (fsBtn) fsBtn.textContent = '✕';
    } else {
      if (icon) icon.innerHTML = '<path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/>';
      else if (fsBtn) fsBtn.textContent = '⛶';
    }
  });

  video.addEventListener('mousemove', () => {
    showControls();
    clearTimeout(autoHideTimer);
    if (!video.paused) autoHideTimer = setTimeout(hideControls, 3000);
  });

  video.addEventListener('mouseleave', () => {
    if (!video.paused) hideControls();
  });

  if (pipBtn) {
    pipBtn.addEventListener('click', async () => {
      try {
        if (document.pictureInPictureElement) {
          await document.exitPictureInPicture();
        } else {
          await video.requestPictureInPicture();
        }
      } catch (e) {
        NextflixAPI.showToast('PiP not supported', 'error');
      }
    });
    video.addEventListener('enterpictureinpicture', () => { if (pipBtn) pipBtn.classList.add('active'); });
    video.addEventListener('leavepictureinpicture', () => { if (pipBtn) pipBtn.classList.remove('active'); });
  }
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
        break;
      case 'KeyS': {
        e.preventDefault();
        const skipBtn = document.getElementById('skipIntroBtn');
        if (skipBtn && skipBtn.classList.contains('visible')) {
          skipBtn.click();
        }
        break;
      }
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
        break;
      case 'ArrowDown':
        e.preventDefault();
        video.volume = Math.max(0, video.volume - 0.1);
        document.getElementById('pcVolume').value = video.volume;
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
        const dup = document.getElementById('pcSpeedDup');
        if (dup) dup.value = next;
        NextflixAPI.showToast(next + 'x', 'info');
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

function setupDoubleTapSeek(video) {
  let lastTap = 0;
  let lastTapX = 0;

  video.addEventListener('touchend', (e) => {
    const now = Date.now();
    const touch = e.changedTouches[0];
    const x = touch.clientX;
    const timeSince = now - lastTap;

    if (timeSince < 350 && Math.abs(x - lastTapX) < 40) {
      e.preventDefault();
      const rect = video.getBoundingClientRect();
      const relX = (x - rect.left) / rect.width;
      if (relX < 0.4) {
        video.currentTime = Math.max(0, video.currentTime - 10);
        showSeekIndicator('−10s');
      } else if (relX > 0.6) {
        video.currentTime = Math.min(video.duration, video.currentTime + 10);
        showSeekIndicator('+10s');
      }
      lastTap = 0;
      return;
    }

    lastTap = now;
    lastTapX = x;
  });
}

function showSeekIndicator(text) {
  const el = document.createElement('div');
  el.textContent = text;
  el.style.cssText = 'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);z-index:20;color:#fff;font-size:1.5rem;font-weight:700;background:rgba(0,0,0,.5);padding:8px 16px;border-radius:6px;pointer-events:none;transition:opacity .4s ease;';
  document.getElementById('playerContainer').appendChild(el);
  requestAnimationFrame(() => {
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 500);
  });
}

function setupSettingsDrawer() {
  const btn = document.getElementById('pcSettingsBtn');
  const overlay = document.getElementById('settingsOverlay');
  const closeBtn = document.getElementById('settingsClose');
  const drawer = document.getElementById('settingsDrawer');
  if (!btn || !overlay) return;

  function open() { overlay.style.display = 'flex'; }
  function close() { overlay.style.display = 'none'; }

  btn.addEventListener('click', open);
  if (closeBtn) closeBtn.addEventListener('click', close);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
}

function setupAutoFullscreen(video) {
  var container = document.getElementById('playerContainer');
  var isMobile = window.innerWidth < 768 || ('ontouchstart' in window);
  var fsAttempted = false;

  function enterFS() {
    if (!container || document.fullscreenElement || fsAttempted) return;
    fsAttempted = true;
    container.requestFullscreen().then(function() {
      if (isMobile && screen.orientation && screen.orientation.lock) {
        screen.orientation.lock('landscape').catch(function(){});
      }
    }).catch(function(){});
  }

  // Try on page load (may be blocked without gesture)
  enterFS();

  // Try again on play (user gesture — will succeed)
  video.addEventListener('play', function onPlay() {
    if (!document.fullscreenElement) {
      fsAttempted = false;
      enterFS();
    }
  });

  document.addEventListener('fullscreenchange', function onFSChange() {
    if (!document.fullscreenElement) {
      video.pause();
      if (screen.orientation && screen.orientation.unlock) screen.orientation.unlock();
    }
  });
}

function setupSkipIntro(video, item) {
  const btn = document.getElementById('skipIntroBtn');
  if (!btn) return;
  const isTV = item.media_type === 'tv' && item.show_name && showEpisodes.length > 0;
  if (!isTV) return;

  const introEnd = 85;
  let introActive = false;

  function update() {
    const ct = video.currentTime;
    if (ct > 10 && ct < introEnd && !introActive) {
      introActive = true;
      btn.classList.add('visible');
    } else if (ct >= introEnd && introActive) {
      introActive = false;
      btn.classList.remove('visible');
    }
  }

  btn.addEventListener('click', () => {
    video.currentTime = introEnd;
    btn.classList.remove('visible');
    introActive = false;
  });

  video.addEventListener('timeupdate', update);
}

function setupAspectRatio(video) {
  const btn = document.getElementById('pcRatio');
  if (!btn) return;

  const modes = ['contain', 'fill', 'cover', 'scale-down'];
  let currentIdx = 0;

  function applyMode(idx) {
    currentIdx = idx;
    video.style.objectFit = modes[idx];
    if (idx === 0) {
      btn.classList.remove('pc-ratio-active');
      btn.title = 'Aspect Ratio: Fit';
    } else {
      btn.classList.add('pc-ratio-active');
      btn.title = 'Aspect Ratio: ' + modes[idx].charAt(0).toUpperCase() + modes[idx].slice(1);
    }
  }

  btn.addEventListener('click', () => {
    currentIdx = (currentIdx + 1) % modes.length;
    applyMode(currentIdx);
  });
}

async function loadThumbnails(mediaId) {
  try {
    const head = await fetch(NextflixAPI.API + '/hls/' + mediaId + '/thumbs.vtt?token=' + NextflixAPI.getToken(), { method: 'HEAD' });
    if (!head.ok) return;
    const vtt = await fetch(NextflixAPI.API + '/hls/' + mediaId + '/thumbs.vtt?token=' + NextflixAPI.getToken()).then(r => r.text());
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
  const spriteUrl = NextflixAPI.API + '/hls/' + VIDEO_ID + '/sprite.jpg?token=' + NextflixAPI.getToken();
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
    preloadHlsInstance.loadSource(NextflixAPI.API + '/hls/' + nextEp.id + '/index.m3u8?token=' + NextflixAPI.getToken());
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
    img.src = NextflixAPI.imageUrl(m.poster_path, m.id);
    if (!m.poster_path) img.style.background = '#333';
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

  backBtn.onclick = () => { if (window.hidePlayerOverlay) window.hidePlayerOverlay(); else window.location.href = '/'; };
  overlay.style.display = 'flex';
}

window.NextflixPlayer = {
  currentId: null,
  isActive: false,

  load: function(id) {
    this.currentId = id;
    this.isActive = true;
    loadMedia(id);
  },

  dismiss: function() {
    this.isActive = false;
    var video = document.getElementById('video');
    if (video) video.pause();
  },

  resume: function() {
    this.isActive = true;
    var video = document.getElementById('video');
    if (video) video.play();
  },

  destroy: function() {
    this.isActive = false;
    if (hlsInstance) { hlsInstance.destroy(); hlsInstance = null; }
    var video = document.getElementById('video');
    if (video) { video.pause(); video.removeAttribute('src'); }
    this.currentId = null;
  }
};
