import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react'
import Hls from 'hls.js'
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
  const hlsRef = useRef(null)
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
  const prefetchAbortRef = useRef(null)

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
      const v = videoRef.current
      if (v && v.paused) return
      setShowOverlays(false)
    }, 3000)
  }, [])

  const updateProgress = useCallback(() => {
    const v = videoRef.current
    if (!v || isDragging.current) return
    const ct = v.currentTime
    const dur = isFinite(v.duration) && v.duration > 0 ? v.duration : (currentItem.duration_seconds || 0)
    setCurrentTime(ct)
    setDuration(dur)
    if (playedRef.current && dur > 0) {
      playedRef.current.style.width = (ct / dur * 100) + '%'
    }
    try {
      const b = v.buffered
      if (b && b.length > 0 && dur > 0) {
        const be = b.end(b.length - 1)
        if (bufferRef.current) bufferRef.current.style.width = Math.min(be / dur * 100, 100) + '%'
      }
    } catch (e) {}
    try {
      const vh = v.videoHeight || 0
      if (vh > 0) {
        if (vh <= 360) setCurrentRes('360p')
        else if (vh <= 480) setCurrentRes('480p')
        else if (vh <= 720) setCurrentRes('720p')
        else if (vh <= 1080) setCurrentRes('1080p')
        else setCurrentRes('4K')
      }
    } catch (e) {}
  }, [currentItem])

  const handleProgressClick = useCallback((clientX) => {
    const el = progressRef.current
    const v = videoRef.current
    if (!el || !v) return
    const rect = el.getBoundingClientRect()
    const pos = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    const dur = isFinite(v.duration) && v.duration > 0 ? v.duration : (currentItem.duration_seconds || 0)
    if (dur > 0) {
      v.currentTime = pos * dur
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

  const destroyHls = useCallback(() => {
    if (hlsRef.current) {
      hlsRef.current.destroy()
      hlsRef.current = null
    }
  }, [])

  const initPlayer = useCallback((item) => {
    const el = videoRef.current
    if (!el || !el.parentNode) return

    destroyHls()
    if (prefetchAbortRef.current) {
      prefetchAbortRef.current.abort()
      prefetchAbortRef.current = null
    }

    setSwitchingSource(true)
    setError(null)
    setShowMovieEnd(false)
    setNextEpCountdown(null)
    setShowSkipIntro(false)
    setCurrentTime(0)
    setDuration(0)
    clearInterval(nextEpTimerRef.current)

    el.removeAttribute('src')
    el.load()

    const canDirect = canPlayDirect(item)
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

    let modes = ['transcode']
    if (canDirect) modes.push('direct')

    let currentIdx = 0
    let generation = 0

    function attachEventHandlers() {
      const onPlay = () => { setPlaying(true); resetHideTimer() }
      const onPause = () => setPlaying(false)
      const onEnded = () => {
        if (item.media_type === 'movie') {
          setShowMovieEnd(true)
        } else {
          startNextEpisodeCountdown(item)
        }
      }
      const onMeta = () => {
        setSwitchingSource(false)
        updateProgress()
        if (item.media_type === 'tv') {
          const ck = () => {
            if (el.currentTime >= 10 && el.currentTime < 85) {
              setShowSkipIntro(true)
            } else {
              setShowSkipIntro(false)
            }
          }
          el.addEventListener('timeupdate', ck)
        }
      }

      el.addEventListener('play', onPlay)
      el.addEventListener('pause', onPause)
      el.addEventListener('ended', onEnded)
      el.addEventListener('loadedmetadata', onMeta)
      el.addEventListener('timeupdate', updateProgress)
      el.addEventListener('progress', updateProgress)

      el.addEventListener('volumechange', () => {
        setVolume(el.volume)
        setIsMuted(el.muted)
      })

      progressTimer.current = setInterval(() => {
        const ct = el.currentTime
        if (ct > 0 && item?.id) {
          apiFetch('/progress', {
            method: 'PUT',
            body: JSON.stringify({
              media_id: item.id,
              position_seconds: Math.floor(ct),
              duration_seconds: Math.floor(el.duration || item.duration_seconds || 0),
              is_finished: false,
            }),
            skipCache: true,
          })
        }
      }, 5000)
    }

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

      if (mode === 'transcode') {
        const masterUrl = '/api/v1/transcode/' + item.id + '/master.m3u8' + tokenParam()
        if (Hls.isSupported()) {
          const hls = new Hls({
            maxBufferLength: 12,
            maxMaxBufferLength: 30,
            startLevel: 0,
            abrEwmaDefaultEstimate: isSlowConnection() ? 500000 : 2000000,
            enableWorker: true,
            lowLatencyMode: false,
          })
          hlsRef.current = hls

          const tk = getToken()
          if (tk) {
            hls.config.xhrSetup = function (xhr, url) {
              if (url.indexOf('token=') === -1) {
                const sep = url.indexOf('?') >= 0 ? '&' : '?'
                xhr.open('GET', url + sep + 'token=' + encodeURIComponent(tk), true)
              }
            }
          }

          hls.on(Hls.Events.MANIFEST_PARSED, () => {
            if (gen !== generation) return
            el.play().then(() => setPlaying(true)).catch(() => {})
            setSwitchingSource(false)
          })

          hls.on(Hls.Events.ERROR, (event, data) => {
            if (data.fatal && gen === generation) {
              destroyHls()
              trySource()
            }
          })

          hls.on(Hls.Events.LEVEL_SWITCHED, (event, data) => {
            const level = hls.levels[data.level]
            if (level) {
              const h = level.height || 0
              if (h <= 360) setCurrentRes('360p')
              else if (h <= 480) setCurrentRes('480p')
              else if (h <= 720) setCurrentRes('720p')
              else if (h <= 1080) setCurrentRes('1080p')
              else setCurrentRes('4K')
            }
          })

          hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, () => {
            setAudioIndex(null)
          })

          hls.loadSource(masterUrl)
          hls.attachMedia(el)

          attachEventHandlers()
        } else if (el.canPlayType('application/vnd.apple.mpegurl')) {
          el.src = masterUrl
          attachEventHandlers()
        } else {
          trySource()
          return
        }
      } else {
        const streamUrl = '/api/v1/stream/' + item.id + tokenParam()
        el.src = streamUrl
        attachEventHandlers()

        if ((item.duration_seconds || 0) > 180) {
          prefetchAbortRef.current = new AbortController()
          prefetchSegments(streamUrl, prefetchAbortRef.current.signal)
        }
      }
    }

    trySource()
  }, [])

  useLayoutEffect(() => {
    const el = videoRef.current
    if (!el || !el.parentNode) return
    initPlayer(currentItem)
    return () => {
      clearInterval(progressTimer.current)
      clearTimeout(hideTimer.current)
      clearInterval(nextEpTimerRef.current)
      destroyHls()
      if (prefetchAbortRef.current) {
        prefetchAbortRef.current.abort()
      }
      if (videoRef.current) {
        videoRef.current.removeAttribute('src')
        videoRef.current.load()
      }
    }
  }, [currentItem])

  useEffect(() => {
    if (currentModeRef.current === 'transcode' && hlsRef.current && audioIndex != null) {
      const tracks = hlsRef.current.audioTracks
      if (tracks && tracks.length > 0) {
        const idx = Math.min(audioIndex, tracks.length - 1)
        if (idx >= 0 && tracks[idx]) {
          hlsRef.current.audioTrack = idx
        }
      }
    }
  }, [audioIndex])

  useEffect(() => {
    if (!currentItem?.id) return
    let cancelled = false
    apiFetch('/media/' + currentItem.id + '/subtitles').then(subs => {
      if (cancelled || !subs || !videoRef.current) return
      setSubtitles(subs)
      const el = videoRef.current
      const tk = getToken()
      const t = tk ? '?token=' + encodeURIComponent(tk) : ''
      subs.forEach(sub => {
        const track = document.createElement('track')
        track.kind = 'subtitles'
        track.src = '/api/v1/subtitle/' + sub.id + '/file' + t
        track.srclang = sub.language || 'und'
        track.label = sub.language || 'Subtitles'
        el.appendChild(track)
      })
    }).catch(() => {})
    apiFetch('/media/' + currentItem.id + '/audio').then(audios => {
      if (!cancelled && audios) setAudioTracks(audios)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [currentItem])

  useEffect(() => {
    const handleKey = (e) => {
      const v = videoRef.current
      if (!v) return
      if (e.key === ' ' || e.key === 'k' || e.key === 'K') {
        e.preventDefault()
        if (v.paused) { v.play() } else { v.pause() }
      }
      if (e.key === 's' || e.key === 'S') {
        e.preventDefault()
        v.currentTime = v.currentTime + 85 - v.currentTime
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
        v.muted = !v.muted
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        v.currentTime = Math.max(0, v.currentTime - 10)
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault()
        const dur = isFinite(v.duration) ? v.duration : (currentItem.duration_seconds || 0)
        v.currentTime = Math.min(dur, v.currentTime + 10)
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        const vol = Math.min(1, v.volume + 0.1)
        v.volume = vol
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        const vol = Math.max(0, v.volume - 0.1)
        v.volume = vol
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
        const v = videoRef.current
        if (!el || !v || v.paused) return
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

    fetch('/api/v1/stream/' + next.id + tokenParam(), { cache: 'force-cache' }).catch(() => {})

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
    const v = videoRef.current
    if (v) {
      v.currentTime = 85
      setShowSkipIntro(false)
    }
  }

  const handleReplay = () => {
    const v = videoRef.current
    if (!v) return
    v.currentTime = 0
    v.play()
    setShowMovieEnd(false)
    setPlaying(true)
  }

  const handleClose = () => {
    destroyHls()
    if (prefetchAbortRef.current) prefetchAbortRef.current.abort()
    if (videoRef.current) {
      videoRef.current.removeAttribute('src')
      videoRef.current.load()
    }
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
    const v = videoRef.current
    if (!v) return
    if (v.paused) { v.play() } else { v.pause() }
  }

  const handleSubtitleChange = (e) => {
    const idx = parseInt(e.target.value, 10)
    setSelectedSubIndex(idx)
    const v = videoRef.current
    if (!v) return
    const tracks = v.textTracks
    for (let i = 0; i < tracks.length; i++) {
      tracks[i].mode = (i === idx) ? 'showing' : 'disabled'
    }
  }

  const handleAudioChange = (e) => {
    const val = e.target.value
    setAudioIndex(val === '' ? null : parseInt(val, 10))
  }

  const toggleMute = () => {
    const v = videoRef.current
    if (!v) return
    v.muted = !v.muted
  }

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen?.()
    } else {
      document.exitFullscreen()
    }
  }

  const handleVolumeChange = (e) => {
    const v = videoRef.current
    if (!v) return
    v.volume = parseFloat(e.target.value)
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
          <video
            ref={videoRef}
            className={styles.video}
            style={{ objectFit: aspectRatio === 'contain' || aspectRatio === 'cover' || aspectRatio === 'fill' ? aspectRatio : 'contain', width: '100%', height: '100%' }}
            playsInline
            webkit-playsinline="true"
            crossOrigin="anonymous"
          />

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
