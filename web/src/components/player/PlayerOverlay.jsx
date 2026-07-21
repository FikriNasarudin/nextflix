import { useState, useEffect, useRef, useCallback } from 'react'
import Hls from 'hls.js'
import { apiFetch, tokenParam, showToast, isSlowConnection } from '../../api/client'
import ControlBar from './ControlBar'
import SettingsDrawer from './SettingsDrawer'
import EpisodeDrawer from './EpisodeDrawer'
import styles from './Player.module.css'

export default function PlayerOverlay({ item, allMedia, similarItems, onClose, onEpisodeSelect }) {
  const videoRef = useRef(null)
  const containerRef = useRef(null)
  const hlsRef = useRef(null)
  const progressTimer = useRef(null)
  const subtitleTrackRef = useRef(null)
  const lastTapRef = useRef({ time: 0, x: 0 })
  const firstInteractionRef = useRef(false)

  const [playing, setPlaying] = useState(true)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(item.duration_seconds || 0)
  const [volume, setVolume] = useState(1)
  const [muted, setMuted] = useState(true)
  const [buffered, setBuffered] = useState(0)
  const [buffering, setBuffering] = useState(false)
  const [showControls, setShowControls] = useState(true)
  const [showInfo, setShowInfo] = useState(true)
  const [showSettings, setShowSettings] = useState(false)
  const [showEpisodes, setShowEpisodes] = useState(false)
  const [showSkipIntro, setShowSkipIntro] = useState(false)
  const [aspectRatio, setAspectRatio] = useState('contain')
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [nextEpCountdown, setNextEpCountdown] = useState(null)
  const [showMovieEnd, setShowMovieEnd] = useState(false)
  const [subtitles, setSubtitles] = useState([])
  const [audioTracks, setAudioTracks] = useState([])
  const [selectedSubtitle, setSelectedSubtitle] = useState(null)
  const [selectedAudio, setSelectedAudio] = useState(null)

  const hideTimer = useRef(null)
  const allMediaRef = useRef(allMedia)
  const onEpisodeSelectRef = useRef(onEpisodeSelect)

  useEffect(() => { allMediaRef.current = allMedia }, [allMedia])
  useEffect(() => { onEpisodeSelectRef.current = onEpisodeSelect }, [onEpisodeSelect])

  const resetHideTimer = useCallback(() => {
    setShowControls(true)
    setShowInfo(true)
    clearTimeout(hideTimer.current)
    hideTimer.current = setTimeout(() => {
      setShowControls(false)
      setShowInfo(false)
    }, 3000)
  }, [])

  const initStream = useCallback(async () => {
    const video = videoRef.current
    if (!video || !item?.id) return

    try {
      const [subs, audios] = await Promise.all([
        apiFetch('/media/' + item.id + '/subtitles'),
        apiFetch('/media/' + item.id + '/audio'),
      ])
      if (subs) setSubtitles(subs)
      if (audios) setAudioTracks(audios)
    } catch {}

    const slow = isSlowConnection()
    const modes = item.hls_path
      ? (slow ? ['hls', 'remux'] : ['direct', 'remux', 'hls'])
      : (slow ? ['remux'] : ['direct', 'remux'])

    let currentIdx = 0
    let generation = 0

    function trySource() {
      if (currentIdx >= modes.length) {
        showToast('No playable source found. The file format may not be supported.', 'error')
        return
      }
      const mode = modes[currentIdx]
      currentIdx++
      const gen = ++generation

      if (mode === 'hls') {
        if (Hls.isSupported()) {
          if (hlsRef.current) hlsRef.current.destroy()
          const hls = new Hls()
          hls.loadSource('/api/v1/hls/' + item.id + '/index.m3u8' + tokenParam())
          hls.attachMedia(video)
          hlsRef.current = hls
          hls.on(Hls.Events.ERROR, (event, data) => {
            if (data.fatal && gen === generation) {
              hls.destroy()
              hlsRef.current = null
              trySource()
            }
          })
        }
        video.play().catch(() => {})
        return
      }

      const url = (mode === 'direct'
        ? '/api/v1/stream/' + item.id
        : '/api/v1/remux/' + item.id) + tokenParam()

      video.onerror = null
      video.src = url

      let fallbackTimer
      video.onerror = function () {
        if (gen !== generation) return
        clearTimeout(fallbackTimer)
        trySource()
      }

      if (mode === 'remux') {
        fallbackTimer = setTimeout(() => {
          if (gen !== generation) return
          trySource()
        }, 10000)
        const clearFallback = () => clearTimeout(fallbackTimer)
        video.addEventListener('loadeddata', clearFallback, { once: true })
        video.addEventListener('canplay', clearFallback, { once: true })
      }

      video.load()
      video.play().catch(() => {})
    }

    trySource()
  }, [item])

  useEffect(() => {
    initStream()
    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy()
        hlsRef.current = null
      }
    }
  }, [initStream])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    video.volume = volume
    video.muted = muted
  }, [])

  useEffect(() => {
    const el = containerRef.current
    if (!el || firstInteractionRef.current) return
    const handler = () => {
      if (firstInteractionRef.current) return
      firstInteractionRef.current = true
      const video = videoRef.current
      if (video) {
        video.muted = false
        video.volume = volume
        setMuted(false)
        if (video.paused) video.play().catch(() => {})
      }
      el.removeEventListener('click', handler)
      el.removeEventListener('touchstart', handler)
      el.removeEventListener('keydown', handler)
    }
    el.addEventListener('click', handler)
    el.addEventListener('touchstart', handler)
    el.addEventListener('keydown', handler)
    return () => {
      el.removeEventListener('click', handler)
      el.removeEventListener('touchstart', handler)
      el.removeEventListener('keydown', handler)
    }
  }, [volume])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    const onTimeUpdate = () => setCurrentTime(video.currentTime)
    const onDurationChange = () => setDuration(video.duration || item.duration_seconds || 0)
    const onProgress = () => {
      if (video.buffered.length > 0) {
        setBuffered(video.buffered.end(video.buffered.length - 1))
      }
    }
    const onEnded = () => {
      if (item.media_type === 'movie') {
        setShowMovieEnd(true)
      } else {
        handleNextEpisode()
      }
    }
    const onPlay = () => { setPlaying(true); setBuffering(false) }
    const onPause = () => setPlaying(false)
    const onWaiting = () => setBuffering(true)
    const onCanPlay = () => setBuffering(false)
    const onSeeking = () => setBuffering(true)
    const onSeeked = () => setBuffering(false)
    const onVolumeChangeEvent = () => {
      setVolume(video.volume)
      setMuted(video.muted)
    }

    video.addEventListener('timeupdate', onTimeUpdate)
    video.addEventListener('durationchange', onDurationChange)
    video.addEventListener('progress', onProgress)
    video.addEventListener('ended', onEnded)
    video.addEventListener('play', onPlay)
    video.addEventListener('pause', onPause)
    video.addEventListener('waiting', onWaiting)
    video.addEventListener('canplay', onCanPlay)
    video.addEventListener('seeking', onSeeking)
    video.addEventListener('seeked', onSeeked)
    video.addEventListener('volumechange', onVolumeChangeEvent)

    progressTimer.current = setInterval(() => {
      if (video.currentTime > 0 && item?.id) {
        apiFetch('/progress', {
          method: 'PUT',
          body: JSON.stringify({
            media_id: item.id,
            position_seconds: Math.floor(video.currentTime),
            duration_seconds: Math.floor(video.duration || item.duration_seconds || 0),
            is_finished: false,
          }),
          skipCache: true,
        })
      }
    }, 5000)

    const checkSkip = () => {
      if (item.media_type === 'tv' && video.currentTime >= 10 && video.currentTime < 85) {
        setShowSkipIntro(true)
      } else {
        setShowSkipIntro(false)
      }
    }
    video.addEventListener('timeupdate', checkSkip)

    return () => {
      video.removeEventListener('timeupdate', onTimeUpdate)
      video.removeEventListener('durationchange', onDurationChange)
      video.removeEventListener('progress', onProgress)
      video.removeEventListener('ended', onEnded)
      video.removeEventListener('play', onPlay)
      video.removeEventListener('pause', onPause)
      video.removeEventListener('waiting', onWaiting)
      video.removeEventListener('canplay', onCanPlay)
      video.removeEventListener('seeking', onSeeking)
      video.removeEventListener('seeked', onSeeked)
      video.removeEventListener('volumechange', onVolumeChangeEvent)
      video.removeEventListener('timeupdate', checkSkip)
      clearInterval(progressTimer.current)
    }
  }, [item])

  // Wire selected subtitle as a <track> element
  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    if (subtitleTrackRef.current) {
      subtitleTrackRef.current.track.mode = 'disabled'
      subtitleTrackRef.current = null
    }

    const sub = subtitles.find(s => String(s.id) === String(selectedSubtitle))
    if (!sub) return

    const existing = video.querySelector('track[data-subtitle-id="' + sub.id + '"]')
    if (existing) {
      existing.track.mode = 'showing'
      subtitleTrackRef.current = existing
      return
    }

    const track = document.createElement('track')
    track.setAttribute('data-subtitle-id', sub.id)
    track.kind = 'subtitles'
    track.label = sub.language || 'Subtitles'
    track.srclang = sub.language || 'und'
    track.src = '/api/v1/subtitle/' + sub.id + '/file' + tokenParam()
    track.addEventListener('load', function onLoad() {
      this.track.mode = 'showing'
    })
    video.appendChild(track)
    subtitleTrackRef.current = track
  }, [selectedSubtitle, subtitles])

  // Wire selected audio track
  useEffect(() => {
    const video = videoRef.current
    if (!video || selectedAudio == null) return

    if (selectedAudio.startsWith('hls-')) {
      const idx = parseInt(selectedAudio.replace('hls-', ''), 10)
      if (hlsRef.current && hlsRef.current.audioTrack !== undefined) {
        hlsRef.current.audioTrack = idx
      }
      return
    }

    if (selectedAudio.startsWith('ext-')) {
      const idx = parseInt(selectedAudio.replace('ext-', ''), 10)
      const track = audioTracks[idx]
      if (!track) return
      if (video.audioTracks && video.audioTracks.length > 1) {
        for (let i = 0; i < video.audioTracks.length; i++) {
          video.audioTracks[i].enabled = (i === track.stream_index)
        }
        return
      }
      if (hlsRef.current && hlsRef.current.audioTracks && hlsRef.current.audioTracks.length > 1) {
        const lang = (track.language || '').toLowerCase()
        const title = (track.title || '').toLowerCase()
        for (let i = 0; i < hlsRef.current.audioTracks.length; i++) {
          const at = hlsRef.current.audioTracks[i]
          if (at.lang === lang || (at.name && at.name.toLowerCase() === title)) {
            hlsRef.current.audioTrack = i
            return
          }
        }
      }
    }
  }, [selectedAudio, audioTracks])

  // Keyboard shortcuts
  useEffect(() => {
    const handleKey = (e) => {
      const v = videoRef.current
      if (!v) return
      switch (e.key) {
        case ' ':
        case 'k':
          e.preventDefault()
          if (v.paused) v.play().catch(() => {})
          else v.pause()
          break
        case 'f':
          e.preventDefault()
          toggleFullscreen()
          break
        case 'm':
          e.preventDefault()
          setMuted(prev => !prev)
          break
        case 'ArrowLeft':
          e.preventDefault()
          v.currentTime = Math.max(0, v.currentTime - 10)
          break
        case 'ArrowRight':
          e.preventDefault()
          v.currentTime = Math.min(v.duration, v.currentTime + 10)
          break
        case 'ArrowUp':
          e.preventDefault()
          setVolume(prev => Math.min(1, prev + 0.1))
          break
        case 'ArrowDown':
          e.preventDefault()
          setVolume(prev => Math.max(0, prev - 0.1))
          break
        case 's':
          e.preventDefault()
          handleSkipIntro()
          break
        default:
          if (e.key >= '0' && e.key <= '9') {
            e.preventDefault()
            v.currentTime = (parseInt(e.key) / 10) * v.duration
          }
      }
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [])

  const togglePlay = () => {
    const v = videoRef.current
    if (!v) return
    if (v.paused) v.play().catch(() => {})
    else v.pause()
  }

  const toggleFullscreen = () => {
    const el = containerRef.current
    if (!el) return
    if (document.fullscreenElement) {
      document.exitFullscreen()
    } else {
      el.requestFullscreen()
    }
    setIsFullscreen(!isFullscreen)
  }

  const handleTouchEnd = (e) => {
    const v = videoRef.current
    if (!v) return

    const now = Date.now()
    const touch = e.changedTouches[0]
    const rect = e.target.getBoundingClientRect()
    const x = touch.clientX - rect.left
    const last = lastTapRef.current

    if (now - last.time < 300) {
      e.preventDefault()
      const half = rect.width / 2
      if (x < half) {
        v.currentTime = Math.max(0, v.currentTime - 10)
      } else {
        v.currentTime = Math.min(v.duration, v.currentTime + 10)
      }
      lastTapRef.current = { time: 0, x: 0 }
    } else {
      lastTapRef.current = { time: now, x }
    }
  }

  const handleSkipIntro = () => {
    const v = videoRef.current
    if (v) {
      v.currentTime = 85
      setShowSkipIntro(false)
    }
  }

  const handleVolumeChange = (v) => {
    setVolume(v)
    setMuted(false)
    if (videoRef.current) {
      videoRef.current.volume = v
      videoRef.current.muted = false
    }
  }

  const toggleMute = () => {
    const video = videoRef.current
    if (!video) return
    const newMuted = !video.muted
    video.muted = newMuted
    setMuted(newMuted)
  }

  const handleSeek = (time) => {
    if (videoRef.current) videoRef.current.currentTime = time
  }

  const handleReplay = () => {
    const v = videoRef.current
    if (!v) return
    v.currentTime = 0
    v.play().catch(() => {})
    setShowMovieEnd(false)
    setPlaying(true)
  }

  const handleClose = () => {
    if (hlsRef.current) hlsRef.current.destroy()
    onClose()
  }

  const handleNextEpisode = () => {
    if (item.media_type !== 'tv' || !item.show_name) return
    const currentAllMedia = allMediaRef.current
    const selectEp = onEpisodeSelectRef.current
    const showEps = currentAllMedia
      .filter(m => m.media_type === 'tv' && m.show_name === item.show_name)
      .sort((a, b) => (a.season_number || 0) - (b.season_number || 0) || (a.episode_number || 0) - (b.episode_number || 0))
    const currentIdx = showEps.findIndex(e => e.id === item.id)
    if (currentIdx >= 0 && currentIdx < showEps.length - 1) {
      const next = showEps[currentIdx + 1]
      let countdown = 8
      setNextEpCountdown({ item: next, seconds: countdown })
      const timer = setInterval(() => {
        countdown--
        if (countdown <= 0) {
          clearInterval(timer)
          setNextEpCountdown(null)
          selectEp(next)
        } else {
          setNextEpCountdown({ item: next, seconds: countdown })
        }
      }, 1000)
    }
  }

  const cycleAspectRatio = () => {
    const ratios = ['contain', 'cover', 'fill']
    const idx = ratios.indexOf(aspectRatio)
    const next = ratios[(idx + 1) % ratios.length]
    setAspectRatio(next)
  }

  const handlePip = async () => {
    const v = videoRef.current
    if (!v) return
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture()
      } else {
        await v.requestPictureInPicture()
      }
    } catch {}
  }

  const isTV = item.media_type === 'tv'
  const showEpsAll = isTV && item.show_name
    ? allMedia.filter(m => m.media_type === 'tv' && m.show_name === item.show_name)
        .sort((a, b) => (a.season_number || 0) - (b.season_number || 0) || (a.episode_number || 0) - (b.episode_number || 0))
    : []

  return (
    <div className={`${styles.playerOverlay} ${styles.active}`}>
      <div className={styles.wrapper} ref={containerRef}>
        <div className={styles.videoContainer}>
          <video
            ref={videoRef}
            className={styles.video}
            style={{ objectFit: aspectRatio }}
            autoPlay
            playsInline
            muted
            crossOrigin="anonymous"
            onClick={togglePlay}
            onMouseMove={resetHideTimer}
            onTouchEnd={handleTouchEnd}
          />

          {buffering && <div className={styles.loadingSpinner} />}

          <div className={`${styles.topOverlay} ${showControls ? styles.visible : ''}`}>
            <button className={styles.back} onClick={handleClose}>← Back to Browse</button>
            <div className={styles.topRight}>
              <span className={styles.playerTitle}>{item.title}</span>
              {isTV && <button className={styles.qualityBtn} onClick={() => setShowEpisodes(true)}>Episodes</button>}
            </div>
          </div>

          <div className={`${styles.infoOverlay} ${showInfo ? styles.visible : ''}`}>
            <h1 className={styles.infoTitle}>{item.title}</h1>
            <div className={styles.infoMeta}>
              {item.rating && <span>{item.rating}</span>}
              {item.release_date && <span>{(item.release_date || '').substring(0, 4)}</span>}
              {item.duration_seconds && <span>{Math.floor(item.duration_seconds / 60)}m</span>}
            </div>
            {item.overview && <p className={styles.infoDesc}>{item.overview}</p>}
          </div>

          {showSkipIntro && (
            <button className={styles.skipIntroBtn + ' ' + styles.visible} onClick={handleSkipIntro}>
              Skip Intro
            </button>
          )}

          <div
            className={`${styles.centerPlay} ${!playing ? styles.centerShow : ''}`}
            onClick={togglePlay}
          >
            <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor"><polygon points="6,3 20,12 6,21"/></svg>
          </div>

          {nextEpCountdown && (
            <div className={styles.nextEpOverlay}>
              <div className={styles.nextEpInfo}>
                <span className={styles.nextEpTimer}>{nextEpCountdown.seconds}s</span>
                <span className={styles.nextEpTitle}>{nextEpCountdown.item.title}</span>
              </div>
              <button className={styles.qualityBtn} onClick={() => setNextEpCountdown(null)}>Cancel</button>
            </div>
          )}

          {showMovieEnd && (
            <div className={styles.movieEndOverlay}>
              <h3 style={{ marginBottom: 16 }}>More Like This</h3>
              <div style={{ display: 'flex', gap: 12, maxWidth: '100%', overflowX: 'auto' }}>
                {similarItems.map(m => (
                  <img
                    key={m.id}
                    src={'/api/v1/image/tmdb/w185' + (m.poster_path || '')}
                    alt={m.title}
                    style={{ width: 140, borderRadius: 8, cursor: 'pointer', flexShrink: 0 }}
                    onClick={() => onEpisodeSelect(m)}
                  />
                ))}
              </div>
              <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
                <button className={styles.qualityBtn} onClick={handleReplay}>
                  Replay
                </button>
                <button className={styles.qualityBtn} onClick={handleClose}>
                  Back to Browse
                </button>
              </div>
            </div>
          )}
        </div>

        <ControlBar
          playing={playing}
          currentTime={currentTime}
          duration={duration}
          buffered={buffered}
          volume={volume}
          muted={muted}
          isTV={isTV}
          onTogglePlay={togglePlay}
          onSeek={handleSeek}
          onVolumeChange={handleVolumeChange}
          onToggleMute={toggleMute}
          onToggleSettings={() => setShowSettings(true)}
          onSkipBack={() => videoRef.current && (videoRef.current.currentTime = Math.max(0, videoRef.current.currentTime - 10))}
          onSkipForward={() => videoRef.current && (videoRef.current.currentTime = Math.min(videoRef.current.duration, videoRef.current.currentTime + 10))}
          onNextEpisode={handleNextEpisode}
          onPip={handlePip}
          onAspectRatio={cycleAspectRatio}
          onFullscreen={toggleFullscreen}
        />
      </div>

      {showSettings && (
        <SettingsDrawer
          subtitles={subtitles}
          audioTracks={audioTracks}
          selectedSubtitle={selectedSubtitle}
          selectedAudio={selectedAudio}
          onSelectSubtitle={setSelectedSubtitle}
          onSelectAudio={setSelectedAudio}
          onClose={() => setShowSettings(false)}
        />
      )}

      {showEpisodes && (
        <EpisodeDrawer
          episodes={showEpsAll}
          currentId={item.id}
          onSelect={onEpisodeSelect}
          onClose={() => setShowEpisodes(false)}
        />
      )}
    </div>
  )
}
