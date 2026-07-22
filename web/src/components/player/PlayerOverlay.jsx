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
  const progressTimer = useRef(null)
  const hideTimer = useRef(null)
  const allMediaRef = useRef(allMedia)
  const onEpisodeSelectRef = useRef(onEpisodeSelect)
  const nextEpTimerRef = useRef(null)
  const audioIndexRef = useRef(null)
  const endTimeTimerRef = useRef(null)

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
  const [endTimeText, setEndTimeText] = useState('')
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
    setEndTimeText('')
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
        nativeAudioTracks: true,
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
        children: [
          'playToggle', 'currentTimeDisplay', 'progressControl',
          'durationDisplay', 'volumePanel', 'subsCapsButton',
          'AspectRatioButton', 'pictureInPictureToggle',
          'fullscreenToggle'
        ],
      },
    }

    const player = videojs(el, videoJsOptions)
    playerRef.current = player

    const ft = function (seconds) { return formatTime(seconds) }
    player.formatTime = ft
    player.formatTime_ = ft

    player.fill = true

    const AspectBtn = videojs.getComponent('Button')
    class AspectRatioButton extends AspectBtn {
      handleClick() {
        const cur = currentItem
        if (!cur) return
        cycleAspectRatio()
      }
      buildCSSClass() { return 'vjs-icon-cog ' + super.buildCSSClass() }
    }
    videojs.registerComponent('AspectRatioButton', AspectRatioButton)

    const OrigDurationDisplay = videojs.getComponent('DurationDisplay')
    videojs.registerComponent('DurationDisplay', class extends OrigDurationDisplay {
      updateContent() {
        if (!this.player_ || !this.player_.duration_) return super.updateContent()
        const dur = this.player_.duration()
        const serverDur = currentItem.duration_seconds || 0
        const v = (!isFinite(dur) || dur === 0) ? serverDur : Math.max(dur, serverDur)
        if (v > 0) {
          this.updateFormattedTime_(v)
          return
        }
        super.updateContent()
      }
    })

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

    endTimeTimerRef.current = setInterval(() => {
      const p = playerRef.current
      if (!p) return
      const dur = Math.max(p.duration() || 0, item.duration_seconds || 0)
      const remaining = dur - p.currentTime()
      setEndTimeText(formatEndTime(remaining))
    }, 1000)
  }, [])

  useEffect(() => {
    initPlayer(currentItem)
    return () => {
      clearInterval(progressTimer.current)
      clearInterval(endTimeTimerRef.current)
      clearTimeout(hideTimer.current)
      clearInterval(nextEpTimerRef.current)
      if (playerRef.current) {
        playerRef.current.dispose()
        playerRef.current = null
      }
    }
  }, [currentItem])

  useEffect(() => {
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
              {audioTracks.length > 1 && (
                <select className={styles.audioSelect} value={audioIndex ?? ''} onChange={e => {
                  const v = e.target.value
                  setAudioIndex(v === '' ? null : parseInt(v, 10))
                }}>
                  <option value="">Default Audio</option>
                  {audioTracks.map((t, i) => (
                    <option key={i} value={t.index ?? i}>{t.language || 'Track ' + (i + 1)}</option>
                  ))}
                </select>
              )}
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
              {endTimeText && <span>{endTimeText}</span>}
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
