import { useState, useEffect, useRef, useCallback } from 'react'
import videojs from 'video.js'
import 'video.js/dist/video-js.css'
import { apiFetch, getToken, tokenParam, isSlowConnection, canPlayDirect, showToast } from '../../api/client'
import EpisodeDrawer from './EpisodeDrawer'
import styles from './Player.module.css'

function getNextEpisodes(item, allMedia) {
  if (item.media_type !== 'tv' || !item.show_name) return []
  return allMedia
    .filter(m => m.media_type === 'tv' && m.show_name === item.show_name)
    .sort((a, b) => (a.season_number || 0) - (b.season_number || 0) || (a.episode_number || 0) - (b.episode_number || 0))
}

function findCurrentIndex(item, allMedia) {
  return getNextEpisodes(item, allMedia).findIndex(e => e.id === item.id)
}

function formatTime(seconds) {
  if (!seconds || isNaN(seconds)) return '00:00:00'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0')
}

function formatEndTime(remainingSeconds) {
  if (!remainingSeconds || remainingSeconds < 0 || isNaN(remainingSeconds)) return ''
  const ends = new Date(Date.now() + remainingSeconds * 1000)
  return 'Ends at ' + ends.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
}

function prefetchSegments(url, signal) {
  for (let i = 0; i < 16; i++) {
    fetch(url, {
      headers: { Range: 'bytes=' + (i * 500000) + '-' + ((i + 1) * 500000 - 1) },
      cache: 'force-cache',
      signal,
    }).catch(() => {})
  }
}

export default function PlayerOverlay({ item: initialItem, allMedia, similarItems = [], onClose, onEpisodeSelect }) {
  const videoRef = useRef(null)
  const playerRef = useRef(null)
  const containerRef = useRef(null)
  const progressRef = useRef(null)
  const playedRef = useRef(null)
  const bufferRef = useRef(null)
  const isDragging = useRef(false)
  const progressTimer = useRef(null)
  const hideTimer = useRef(null)
  const allMediaRef = useRef(allMedia)
  const onEpisodeSelectRef = useRef(onEpisodeSelect)
  const nextEpTimerRef = useRef(null)
  const audioIndexRef = useRef(null)
  const currentModeRef = useRef('')

  const [currentItem, setCurrentItem] = useState(initialItem)
  const [playing, setPlaying] = useState(true)
  const [error, setError] = useState(null)
  const [showOverlays, setShowOverlays] = useState(true)
  const [showEpisodes, setShowEpisodes] = useState(false)
  const [showSkipIntro, setShowSkipIntro] = useState(false)
  const [aspectRatio, setAspectRatio] = useState('contain')
  const [nextEpCountdown, setNextEpCountdown] = useState(null)
  const [showMovieEnd, setShowMovieEnd] = useState(false)
  const [subtitles, setSubtitles] = useState([])
  const [audioTracks, setAudioTracks] = useState([])
  const [switchingSource, setSwitchingSource] = useState(false)
  const [audioIndex, setAudioIndex] = useState(null)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(1)
  const [isMuted, setIsMuted] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [currentRes, setCurrentRes] = useState('')
  const [selectedSubIndex, setSelectedSubIndex] = useState(-1)
  audioIndexRef.current = audioIndex

  useEffect(() => { allMediaRef.current = allMedia }, [allMedia])
  useEffect(() => { onEpisodeSelectRef.current = onEpisodeSelect }, [onEpisodeSelect])

  const resetHideTimer = useCallback(() => {
    setShowOverlays(true)
    clearTimeout(hideTimer.current)
    hideTimer.current = setTimeout(() => {
      const p = playerRef.current
      if (p && p.paused()) return
      setShowOverlays(false)
    }, 3000)
  }, [])

  const updateProgress = useCallback(() => {
    const p = playerRef.current
    if (!p || isDragging.current) return
    const ct = p.currentTime()
    const dur = isFinite(p.duration()) && p.duration() > 0 ? p.duration() : (currentItem.duration_seconds || 0)
    setCurrentTime(ct)
    setDuration(dur)
    if (playedRef.current && dur > 0) {
      playedRef.current.style.width = (ct / dur * 100) + '%'
    }
    try {
      const b = p.buffered()
      if (b.length > 0 && dur > 0) {
        const be = b.end(b.length - 1)
        if (bufferRef.current) bufferRef.current.style.width = Math.min(be / dur * 100, 100) + '%'
      }
    } catch (e) {}
    try {
      const tech = p.tech(true)
      if (tech) {
        const vh = tech.el_().videoHeight || 0
        if (vh > 0) {
          if (vh <= 360) setCurrentRes('360p')
          else if (vh <= 480) setCurrentRes('480p')
          else if (vh <= 720) setCurrentRes('720p')
          else if (vh <= 1080) setCurrentRes('1080p')
          else setCurrentRes('4K')
        }
      }
    } catch (e) {}
  }, [currentItem])

  const handleProgressClick = useCallback((clientX) => {
    const el = progressRef.current
    const p = playerRef.current
    if (!el || !p) return
    const rect = el.getBoundingClientRect()
    const pos = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    const dur = isFinite(p.duration()) && p.duration() > 0 ? p.duration() : (currentItem.duration_seconds || 0)
    if (dur > 0) {
      p.currentTime(pos * dur)
    }
  }, [currentItem])

  const onProgressMouseDown = useCallback((e) => {
    e.preventDefault()
    isDragging.current = true
    handleProgressClick(e.clientX)
    const onMove = (ev) => { handleProgressClick(ev.clientX) }
    const onUp = () => {
      isDragging.current = false
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [handleProgressClick])

  const onProgressTouchStart = useCallback((e) => {
    const touch = e.touches[0]
    if (!touch) return
    isDragging.current = true
    handleProgressClick(touch.clientX)
    const onMove = (ev) => {
      ev.preventDefault()
      const t = ev.touches[0]
      if (t) handleProgressClick(t.clientX)
    }
    const onEnd = () => {
      isDragging.current = false
      document.removeEventListener('touchmove', onMove)
      document.removeEventListener('touchend', onEnd)
    }
    document.addEventListener('touchmove', onMove, { passive: false })
    document.addEventListener('touchend', onEnd)
  }, [handleProgressClick])

  const initPlayer = useCallback((item) => {
    const el = videoRef.current
    if (!el) return

    if (playerRef.current) {
      playerRef.current.dispose()
      playerRef.current = null
    }

    setSwitchingSource(true)
    setError(null)
    setShowMovieEnd(false)
    setNextEpCountdown(null)
    setShowSkipIntro(false)
    setCurrentTime(0)
    setDuration(0)
    clearInterval(nextEpTimerRef.current)

    const slow = isSlowConnection()
    const canDirect = canPlayDirect(item)
    const useHLS = !!item.hls_path
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

    const videoJsOptions = {
      autoplay: true,
      controls: false,
      fluid: false,
      fill: true,
      html5: {
        nativeAudioTracks: true,
        nativeVideoTracks: false,
        vhs: {
          overrideNative: isIOS,
          useBandwidthFromLocalStorage: true,
          limitRenditionByPlayerDimensions: true,
          maxBufferLength: 30,
          maxMaxBufferLength: 60,
        },
      },
      userActions: {
        hotkeys: true,
      },
      inactivityTimeout: 3000,
      liveui: false,
      nativeControlsForTouch: true,
      controlBar: false,
    }

    const player = videojs(el, videoJsOptions)
    playerRef.current = player
    player.fill = true

    player.ready(function () {
      const tech = this.tech(true)
      let vhs = tech && tech.vhs
      if (!vhs && this.vhs) vhs = this.vhs
      const xhr = vhs && vhs.xhr
      if (xhr) {
        const orig = xhr.beforeRequest
        xhr.beforeRequest = function (options) {
          const tk = getToken()
          if (tk && options.uri.indexOf('token=') === -1) {
            options.uri += (options.uri.indexOf('?') >= 0 ? '&' : '?') + 'token=' + encodeURIComponent(tk)
          }
          return orig ? orig(options) : options
        }
      }
    })

    let modes = []
    if (useHLS) modes.push('hls')
    if (canDirect) modes.push('direct')
    modes.push('remux')

    let currentIdx = 0
    let generation = 0

    const prefetchAbort = new AbortController()

    function trySource() {
      if (currentIdx >= modes.length) {
        setError('No playable source found for this media.')
        setSwitchingSource(false)
        return
      }
      const mode = modes[currentIdx++]
      currentModeRef.current = mode
      const gen = ++generation
      if (gen > 1) setSwitchingSource(true)

      player.off('error')
      player.off('loadedmetadata')

      player.on('error', function onErr() {
        if (gen !== generation) return
        player.off('error', onErr)
        player.off('loadedmetadata', onMeta)
        trySource()
      })

      const onMeta = function onMeta() {
        if (gen !== generation) return
        setSwitchingSource(false)
      }
      player.on('loadedmetadata', onMeta)

      let srcUrl = mode === 'hls'
        ? '/api/v1/hls/' + item.id + '/index.m3u8' + tokenParam()
        : (mode === 'direct' ? '/api/v1/stream/' : '/api/v1/remux/') + item.id + tokenParam()
      if (mode === 'remux' && audioIndexRef.current != null) {
        srcUrl += (srcUrl.indexOf('?') >= 0 ? '&' : '?') + 'audio_index=' + audioIndexRef.current
      }
      const src = { src: srcUrl, type: mode === 'hls' ? 'application/x-mpegURL' : mode === 'direct' ? 'video/' + (item.container || 'mp4') : 'video/mp4' }

      player.src(src)
      player.load()

      if (mode === 'direct' && (item.duration_seconds || 0) > 180) {
        prefetchSegments(srcUrl, prefetchAbort.signal)
      }
    }

    trySource()

    player.on('useractive', () => {
      setShowOverlays(true)
      clearTimeout(hideTimer.current)
      hideTimer.current = setTimeout(() => {
        if (player.paused()) return
        setShowOverlays(false)
      }, 3000)
    })

    player.on('userinactive', () => {
      setShowOverlays(false)
    })

    const onPlay = () => { setPlaying(true); resetHideTimer() }
    const onPause = () => setPlaying(false)
    const onEnded = () => {
      if (item.media_type === 'movie') {
        setShowMovieEnd(true)
      } else {
        startNextEpisodeCountdown(item)
      }
    }

    player.on('play', onPlay)
    player.on('pause', onPause)
    player.on('ended', onEnded)
    player.on('loadedmetadata', () => {
      setSwitchingSource(false)
      updateProgress()
    })
    player.on('timeupdate', updateProgress)
    player.on('progress', updateProgress)
    player.on('volumechange', () => {
      setVolume(player.volume())
      setIsMuted(player.muted())
    })

    progressTimer.current = setInterval(() => {
      const ct = player.currentTime()
      if (ct > 0 && item?.id) {
        apiFetch('/progress', {
          method: 'PUT',
          body: JSON.stringify({
            media_id: item.id,
            position_seconds: Math.floor(ct),
            duration_seconds: Math.floor(player.duration() || item.duration_seconds || 0),
            is_finished: false,
          }),
          skipCache: true,
        })
      }
    }, 5000)
  }, [])

  useEffect(() => {
    initPlayer(currentItem)
    return () => {
      clearInterval(progressTimer.current)
      clearTimeout(hideTimer.current)
      clearInterval(nextEpTimerRef.current)
      if (playerRef.current) {
        playerRef.current.dispose()
        playerRef.current = null
      }
    }
  }, [currentItem])

  useEffect(() => {
    if (currentModeRef.current === 'hls' && playerRef.current) {
      const tracks = playerRef.current.audioTracks()
      if (tracks && tracks.length > 0) {
        for (let i = 0; i < tracks.length; i++) {
          tracks[i].enabled = (i === audioIndex)
        }
        return
      }
    }
    if (audioIndex != null && playerRef.current) {
      initPlayer(currentItem)
    }
  }, [audioIndex])

  useEffect(() => {
    if (!currentItem?.id) return
    let cancelled = false
    apiFetch('/media/' + currentItem.id + '/subtitles').then(subs => {
      if (cancelled || !subs) return
      setSubtitles(subs)
      const p = playerRef.current
      if (!p) return
      const tk = getToken()
      const t = tk ? '?token=' + encodeURIComponent(tk) : ''
      subs.forEach(sub => {
        const url = '/api/v1/subtitle/' + sub.id + '/file' + t
        p.addRemoteTextTrack({
          kind: 'subtitles',
          src: url,
          srclang: sub.language || 'und',
          label: sub.language || 'Subtitles',
        }, false)
      })
    }).catch(() => {})
    apiFetch('/media/' + currentItem.id + '/audio').then(audios => {
      if (!cancelled && audios) setAudioTracks(audios)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [currentItem])

  useEffect(() => {
    const p = playerRef.current
    if (!p) return
    const checkSkip = () => {
      if (currentItem.media_type === 'tv' && p.currentTime() >= 10 && p.currentTime() < 85) {
        setShowSkipIntro(true)
      } else {
        setShowSkipIntro(false)
      }
    }
    p.on('timeupdate', checkSkip)
    return () => p.off('timeupdate', checkSkip)
  }, [currentItem])

  useEffect(() => {
    const handleKey = (e) => {
      const p = playerRef.current
      if (!p) return
      if (e.key === ' ' || e.key === 'k' || e.key === 'K') {
        e.preventDefault()
        if (p.paused()) { p.play() } else { p.pause() }
      }
      if (e.key === 's' || e.key === 'S') {
        e.preventDefault()
        p.currentTime(p.currentTime() + 85 - p.currentTime())
        setShowSkipIntro(false)
      }
      if (e.key === 'f' || e.key === 'F') {
        if (!document.fullscreenElement) {
          containerRef.current?.requestFullscreen?.()
        } else {
          document.exitFullscreen()
        }
      }
      if (e.key === 'm' || e.key === 'M') {
        e.preventDefault()
        p.muted(!p.muted())
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        p.currentTime(Math.max(0, p.currentTime() - 10))
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault()
        const dur = isFinite(p.duration()) ? p.duration() : (currentItem.duration_seconds || 0)
        p.currentTime(Math.min(dur, p.currentTime() + 10))
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        const v = p.volume() + 0.1
        p.volume(Math.min(1, v))
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        const v = p.volume() - 0.1
        p.volume(Math.max(0, v))
      }
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [currentItem])

  useEffect(() => {
    const handler = () => {
      setIsFullscreen(!!document.fullscreenElement)
    }
    document.addEventListener('fullscreenchange', handler)
    return () => document.removeEventListener('fullscreenchange', handler)
  }, [])

  useEffect(() => {
    const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0
    if (!isTouch) return

    let timeout
    const handler = () => {
      clearTimeout(timeout)
      timeout = setTimeout(() => {
        const el = containerRef.current
        const p = playerRef.current
        if (!el || !p || p.paused()) return
        const isLandscape = (window.screen?.orientation?.type || '').startsWith('landscape')
          || window.innerWidth > window.innerHeight
        if (isLandscape && !document.fullscreenElement) {
          el.requestFullscreen().catch(() => {})
          window.screen?.orientation?.lock?.('landscape').catch(() => {})
        } else if (!isLandscape && document.fullscreenElement) {
          document.exitFullscreen().catch(() => {})
          window.screen?.orientation?.unlock?.()
        }
      }, 300)
    }

    window.addEventListener('orientationchange', handler)
    window.addEventListener('resize', handler)
    window.screen?.orientation?.addEventListener?.('change', handler)
    return () => {
      window.removeEventListener('orientationchange', handler)
      window.removeEventListener('resize', handler)
      window.screen?.orientation?.removeEventListener?.('change', handler)
      clearTimeout(timeout)
    }
  }, [])

  const startNextEpisodeCountdown = useCallback((item) => {
    const eps = getNextEpisodes(item, allMediaRef.current)
    const idx = eps.findIndex(e => e.id === item.id)
    if (idx < 0 || idx >= eps.length - 1) return

    const next = eps[idx + 1]
    let countdown = 8
    setNextEpCountdown({ item: next, seconds: countdown })

    if (next.hls_path) {
      fetch('/api/v1/hls/' + next.id + '/index.m3u8' + tokenParam(), { cache: 'force-cache' }).catch(() => {})
    } else {
      fetch('/api/v1/stream/' + next.id + tokenParam(), { cache: 'force-cache' }).catch(() => {})
    }

    clearInterval(nextEpTimerRef.current)
    nextEpTimerRef.current = setInterval(() => {
      countdown--
      if (countdown <= 0) {
        clearInterval(nextEpTimerRef.current)
        setNextEpCountdown(null)
        setCurrentItem(next)
        window.history.replaceState(null, '', '/watch/' + next.id)
      } else {
        setNextEpCountdown({ item: next, seconds: countdown })
      }
    }, 1000)
  }, [])

  const handleSkipIntro = () => {
    const p = playerRef.current
    if (p) {
      p.currentTime(85)
      setShowSkipIntro(false)
    }
  }

  const handleReplay = () => {
    const p = playerRef.current
    if (!p) return
    p.currentTime(0)
    p.play()
    setShowMovieEnd(false)
    setPlaying(true)
  }

  const handleClose = () => {
    if (playerRef.current) playerRef.current.dispose()
    playerRef.current = null
    onClose()
  }

  const cycleAspectRatio = () => {
    const ratios = ['contain', 'cover', 'fill', '16:9', '4:3']
    const idx = ratios.indexOf(aspectRatio)
    const next = ratios[(idx + 1) % ratios.length]
    setAspectRatio(next)
    const v = videoRef.current
    if (v) {
      const objFit = next === '16:9' || next === '4:3' ? 'contain' : next
      v.style.objectFit = objFit
      if (next === '16:9') {
        v.style.aspectRatio = '16/9'
      } else if (next === '4:3') {
        v.style.aspectRatio = '4/3'
      } else {
        v.style.aspectRatio = ''
      }
    }
  }

  const togglePlay = () => {
    const p = playerRef.current
    if (!p) return
    if (p.paused()) { p.play() } else { p.pause() }
  }

  const handleSubtitleChange = (e) => {
    const idx = parseInt(e.target.value, 10)
    setSelectedSubIndex(idx)
    const p = playerRef.current
    if (!p) return
    const tracks = p.remoteTextTracks()
    for (let i = 0; i < tracks.length; i++) {
      tracks[i].mode = (i === idx) ? 'showing' : 'disabled'
    }
  }

  const handleAudioChange = (e) => {
    const v = e.target.value
    setAudioIndex(v === '' ? null : parseInt(v, 10))
  }

  const toggleMute = () => {
    const p = playerRef.current
    if (!p) return
    p.muted(!p.muted())
  }

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen?.()
    } else {
      document.exitFullscreen()
    }
  }

  const handleVolumeChange = (e) => {
    const p = playerRef.current
    if (!p) return
    p.volume(parseFloat(e.target.value))
  }

  const containerStyle = aspectRatio === '16:9' || aspectRatio === '4:3'
    ? { background: 'var(--void)' }
    : { background: 'var(--void)' }

  const isTV = currentItem.media_type === 'tv'
  const showEpsAll = getNextEpisodes(currentItem, allMedia)
  const endTimeText = formatEndTime(duration - currentTime)
  const hasTracks = subtitles.length > 0 || audioTracks.length > 1

  const handleEpisodeSelect = (ep) => {
    setShowEpisodes(false)
    setCurrentItem(ep)
    window.history.replaceState(null, '', '/watch/' + ep.id)
  }

  return (
    <div className={styles.playerOverlay + ' ' + styles.active}>
      <div className={styles.wrapper} ref={containerRef} style={containerStyle}>
        <div className={styles.videoContainer}>
          <div data-vjs-player style={{ width: '100%', height: '100%' }}>
            <video
              ref={videoRef}
              className={'video-js vjs-default-skin vjs-big-play-centered ' + styles.video}
              style={{ objectFit: aspectRatio === 'contain' || aspectRatio === 'cover' || aspectRatio === 'fill' ? aspectRatio : 'contain', width: '100%', height: '100%' }}
              playsInline
              webkit-playsinline="true"
              crossOrigin="anonymous"
            />
          </div>

          {switchingSource && (
            <div className={styles.switchOverlay}>
              <div className={styles.switchSpinner} />
              <span>Loading player…</span>
            </div>
          )}

          {error && (
            <div className={styles.switchOverlay}>
              <span>{error}</span>
              <button className={styles.qualityBtn} onClick={handleClose} style={{ marginTop: 12 }}>
                Back to Browse
              </button>
            </div>
          )}

          <div className={`${styles.topOverlay} ${showOverlays ? styles.visible : ''}`}>
            <button className={styles.back} onClick={handleClose}>
              ← Back
            </button>
            <div className={styles.topRight}>
              <span className={styles.playerTitle}>{currentItem.title}</span>
              <button className={styles.iconBtn} onClick={cycleAspectRatio} title="Aspect Ratio" aria-label="Aspect Ratio">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V5h14v14zm-4-4h2v2h-2v-2zm-4 0h2v2h-2v-2zm-2 0h-2v2h2v-2z"/></svg>
              </button>
              {isTV && (
                <button className={styles.qualityBtn} onClick={() => setShowEpisodes(true)}>
                  Episodes
                </button>
              )}
            </div>
          </div>

          <div className={`${styles.infoOverlay} ${showOverlays ? styles.visible : ''}`}>
            <h1 className={styles.infoTitle}>{currentItem.title}</h1>
            <div className={styles.infoMeta}>
              {currentItem.rating && <span>{currentItem.rating}</span>}
              {currentItem.release_date && <span>{(currentItem.release_date || '').substring(0, 4)}</span>}
              {currentItem.duration_seconds && <span>{Math.floor(currentItem.duration_seconds / 60)}m</span>}
            </div>
            {currentItem.overview && <p className={styles.infoDesc}>{currentItem.overview}</p>}
          </div>

          <div className={`${styles.controlBar} ${showOverlays ? '' : styles.controlHidden}`} onClick={resetHideTimer}>
            <div className={styles.controlRow}>
              <button className={styles.ctrlBtn} onClick={togglePlay} title={playing ? 'Pause' : 'Play'}>
                {playing ? (
                  <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z"/></svg>
                ) : (
                  <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                )}
              </button>

              <div
                className={styles.progressWrap}
                ref={progressRef}
                onMouseDown={onProgressMouseDown}
                onTouchStart={onProgressTouchStart}
              >
                <div className={styles.progressTrack}>
                  <div className={styles.progressBuffer} ref={bufferRef} />
                  <div className={styles.progressPlayed} ref={playedRef} />
                </div>
              </div>

              <span className={styles.timeDisplay}>
                {formatTime(currentTime)} / {formatTime(duration)}
              </span>
            </div>

            <div className={styles.controlRow + ' ' + styles.controlRowBottom}>
              <div className={styles.ctrlLeft}>
                {currentRes && (
                  <span className={styles.resBadge}>{currentRes}</span>
                )}
                <button className={styles.ctrlBtn} onClick={toggleMute} title={isMuted ? 'Unmute' : 'Mute'}>
                  {isMuted || volume === 0 ? (
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51A8.796 8.796 0 0021 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06a8.99 8.99 0 003.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/></svg>
                  ) : (
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>
                  )}
                </button>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={isMuted ? 0 : volume}
                  onChange={handleVolumeChange}
                  className={styles.volumeSlider}
                />
              </div>

              <div className={styles.ctrlRight}>
                {subtitles.length > 0 && (
                  <select
                    className={styles.trackSelect}
                    value={selectedSubIndex}
                    onChange={handleSubtitleChange}
                  >
                    <option value="-1">Subtitles Off</option>
                    {subtitles.map((s, i) => (
                      <option key={i} value={i}>{s.language || 'Sub ' + (i + 1)}</option>
                    ))}
                  </select>
                )}
                {audioTracks.length > 1 && (
                  <select
                    className={styles.trackSelect}
                    value={audioIndex ?? ''}
                    onChange={handleAudioChange}
                  >
                    <option value="">Audio</option>
                    {audioTracks.map((t, i) => (
                      <option key={i} value={t.index ?? i}>{t.language || 'Track ' + (i + 1)}</option>
                    ))}
                  </select>
                )}
                <span className={styles.endTimeBadge}>{endTimeText}</span>
                <button className={styles.ctrlBtn} onClick={toggleFullscreen} title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}>
                  {isFullscreen ? (
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z"/></svg>
                  ) : (
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/></svg>
                  )}
                </button>
              </div>
            </div>
          </div>

          {showSkipIntro && (
            <button className={styles.skipIntroBtn + ' ' + styles.visible} onClick={handleSkipIntro}>
              Skip Intro
            </button>
          )}

          {nextEpCountdown && (
            <div className={styles.nextEpOverlay}>
              <div className={styles.nextEpInfo}>
                <span className={styles.nextEpTimer}>{nextEpCountdown.seconds}s</span>
                <span className={styles.nextEpTitle}>Next: {nextEpCountdown.item.title}</span>
              </div>
              <button className={styles.qualityBtn} onClick={() => {
                clearInterval(nextEpTimerRef.current)
                setNextEpCountdown(null)
              }}>
                Cancel
              </button>
            </div>
          )}

          {showMovieEnd && (
            <div className={styles.movieEndOverlay}>
              <h3 style={{ marginBottom: 16 }}>More Like This</h3>
              <div style={{ display: 'flex', gap: 12, maxWidth: '100%', overflowX: 'auto' }}>
                {similarItems.length > 0 ? similarItems.map(m => (
                  <div key={m.id} style={{ textAlign: 'center', flexShrink: 0 }}>
                    <img
                      src={'/api/v1/image/tmdb/w185' + (m.poster_path || '')}
                      alt={m.title}
                      style={{ width: 140, borderRadius: 8, cursor: 'pointer' }}
                      onClick={() => { setCurrentItem(m); window.history.replaceState(null, '', '/watch/' + m.id) }}
                    />
                    <div style={{ fontSize: '0.75rem', marginTop: 4, color: 'var(--on-surface-variant)' }}>{m.title}</div>
                  </div>
                )) : <div style={{ color: 'var(--muted)' }}>No recommendations available</div>}
              </div>
              <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
                <button className={styles.qualityBtn} onClick={handleReplay}>Replay</button>
                <button className={styles.qualityBtn} onClick={handleClose}>Back to Browse</button>
              </div>
            </div>
          )}
        </div>
      </div>

      {showEpisodes && (
        <EpisodeDrawer
          episodes={showEpsAll}
          currentId={currentItem.id}
          onSelect={handleEpisodeSelect}
          onClose={() => setShowEpisodes(false)}
        />
      )}
    </div>
  )
}
