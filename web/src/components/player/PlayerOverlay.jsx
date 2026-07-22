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
  if (!seconds || isNaN(seconds)) return '00:00'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0')
}

export default function PlayerOverlay({ item: initialItem, allMedia, similarItems = [], onClose, onEpisodeSelect }) {
  const videoRef = useRef(null)
  const playerRef = useRef(null)
  const containerRef = useRef(null)
  const progressTimer = useRef(null)
  const hideTimer = useRef(null)
  const allMediaRef = useRef(allMedia)
  const onEpisodeSelectRef = useRef(onEpisodeSelect)
  const nextEpTimerRef = useRef(null)

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
    clearInterval(nextEpTimerRef.current)

    const slow = isSlowConnection()
    const canDirect = canPlayDirect(item)
    const useHLS = !!item.hls_path

    const videoJsOptions = {
      autoplay: true,
      controls: true,
      fluid: false,
      fill: true,
      html5: {
        nativeAudioTracks: false,
        nativeVideoTracks: false,
        vhs: {
          overrideNative: false,
          useBandwidthFromLocalStorage: true,
        },
      },
      userActions: {
        hotkeys: true,
      },
      inactivityTimeout: 3000,
      liveui: false,
      nativeControlsForTouch: true,
      controlBar: {
        volumePanel: { inline: false },
      },
    }

    const player = videojs(el, videoJsOptions)
    playerRef.current = player

    const ft = function (seconds) { return formatTime(seconds) }
    player.formatTime = ft
    player.formatTime_ = ft

    player.ready(function () {
      const tech = this.tech(true)
      let vhs = tech && tech.vhs
      if (!vhs && this.vhs) vhs = this.vhs
      if (vhs && vhs.beforeRequest) {
        const orig = vhs.beforeRequest
        vhs.beforeRequest = function (options) {
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

    function trySource() {
      if (currentIdx >= modes.length) {
        setError('No playable source found for this media.')
        setSwitchingSource(false)
        return
      }
      const mode = modes[currentIdx++]
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

      const src = mode === 'hls'
        ? { src: '/api/v1/hls/' + item.id + '/index.m3u8' + tokenParam(), type: 'application/x-mpegURL' }
        : { src: (mode === 'direct' ? '/api/v1/stream/' : '/api/v1/remux/') + item.id + tokenParam(), type: mode === 'direct' ? 'video/' + (item.container || 'mp4') : 'video/mp4' }

      player.src(src)
      player.load()
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
    player.on('loadedmetadata', () => setSwitchingSource(false))

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
    if (!currentItem?.id) return
    apiFetch('/media/' + currentItem.id + '/subtitles').then(subs => {
      if (subs) setSubtitles(subs)
    }).catch(() => {})
    apiFetch('/media/' + currentItem.id + '/audio').then(audios => {
      if (audios) setAudioTracks(audios)
    }).catch(() => {})
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
  }, [])

  useEffect(() => {
    const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0
    if (!isTouch) return

    let timeout
    const handler = () => {
      clearTimeout(timeout)
      timeout = setTimeout(() => {
        const el = containerRef.current
        if (!el) return
        if (window.innerHeight < window.innerWidth && !document.fullscreenElement) {
          el.requestFullscreen().catch(() => {})
        } else if (window.innerHeight > window.innerWidth && document.fullscreenElement) {
          document.exitFullscreen().catch(() => {})
        }
      }, 300)
    }

    window.addEventListener('orientationchange', handler)
    return () => {
      window.removeEventListener('orientationchange', handler)
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

  const containerStyle = aspectRatio === '16:9' || aspectRatio === '4:3'
    ? { background: 'var(--void)' }
    : { background: 'var(--void)' }

  const isTV = currentItem.media_type === 'tv'
  const showEpsAll = getNextEpisodes(currentItem, allMedia)

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
              ← Back to Browse
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
