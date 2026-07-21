import { useState, useEffect, useRef, useCallback } from 'react'
import Hls from 'hls.js'
import { apiFetch } from '../../api/client'
import ControlBar from './ControlBar'
import SettingsDrawer from './SettingsDrawer'
import EpisodeDrawer from './EpisodeDrawer'
import styles from './Player.module.css'

export default function PlayerOverlay({ item, allMedia, similarItems, onClose, onEpisodeSelect }) {
  const videoRef = useRef(null)
  const containerRef = useRef(null)
  const hlsRef = useRef(null)
  const progressTimer = useRef(null)

  const [playing, setPlaying] = useState(true)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(item.duration_seconds || 0)
  const [volume, setVolume] = useState(1)
  const [muted, setMuted] = useState(false)
  const [buffered, setBuffered] = useState(0)
  const [showControls, setShowControls] = useState(true)
  const [showInfo, setShowInfo] = useState(true)
  const [showSettings, setShowSettings] = useState(false)
  const [showEpisodes, setShowEpisodes] = useState(false)
  const [showSkipIntro, setShowSkipIntro] = useState(false)
  const [playbackRate, setPlaybackRate] = useState(1)
  const [aspectRatio, setAspectRatio] = useState('contain')
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [nextEpCountdown, setNextEpCountdown] = useState(null)
  const [showMovieEnd, setShowMovieEnd] = useState(false)
  const [subtitles, setSubtitles] = useState([])
  const [audioTracks, setAudioTracks] = useState([])
  const [selectedSubtitle, setSelectedSubtitle] = useState(null)
  const [selectedAudio, setSelectedAudio] = useState(null)
  const [streamType, setStreamType] = useState('auto')

  const hideTimer = useRef(null)

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

    if (streamType === 'hls') {
      if (Hls.isSupported()) {
        const hls = new Hls()
        hls.loadSource('/api/v1/hls/' + item.id + '/index.m3u8')
        hls.attachMedia(video)
        hlsRef.current = hls
      }
    } else if (streamType === 'remux') {
      video.src = '/api/v1/remux/' + item.id
    } else {
      video.src = '/api/v1/stream/' + item.id
    }

    try {
      const [subs, audios] = await Promise.all([
        apiFetch('/media/' + item.id + '/subtitles'),
        apiFetch('/media/' + item.id + '/audio'),
      ])
      if (subs) setSubtitles(subs)
      if (audios) setAudioTracks(audios)
    } catch {}
  }, [item, streamType])

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
    const onPlay = () => setPlaying(true)
    const onPause = () => setPlaying(false)

    video.addEventListener('timeupdate', onTimeUpdate)
    video.addEventListener('durationchange', onDurationChange)
    video.addEventListener('progress', onProgress)
    video.addEventListener('ended', onEnded)
    video.addEventListener('play', onPlay)
    video.addEventListener('pause', onPause)

    // Save progress every 5 seconds
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

    // Skip intro detection
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
      video.removeEventListener('timeupdate', checkSkip)
      clearInterval(progressTimer.current)
    }
  }, [item])

  // Keyboard shortcuts
  useEffect(() => {
    const handleKey = (e) => {
      const v = videoRef.current
      if (!v) return
      switch (e.key) {
        case ' ':
        case 'k':
          e.preventDefault()
          if (v.paused) v.play()
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
        case 'l':
          e.preventDefault()
          cycleSpeed()
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
    if (v.paused) v.play()
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

  const handleSkipIntro = () => {
    const v = videoRef.current
    if (v) {
      v.currentTime = 85
      setShowSkipIntro(false)
    }
  }

  const cycleSpeed = () => {
    const speeds = [0.5, 1, 1.25, 1.5, 2]
    const currentIdx = speeds.indexOf(playbackRate)
    const next = speeds[(currentIdx + 1) % speeds.length]
    setPlaybackRate(next)
    if (videoRef.current) videoRef.current.playbackRate = next
  }

  const handleSpeedChange = (speed) => {
    setPlaybackRate(parseFloat(speed))
    if (videoRef.current) videoRef.current.playbackRate = parseFloat(speed)
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
    setMuted(prev => !prev)
    if (videoRef.current) videoRef.current.muted = !muted
  }

  const handleSeek = (time) => {
    if (videoRef.current) videoRef.current.currentTime = time
  }

  const handleClose = () => {
    if (hlsRef.current) hlsRef.current.destroy()
    onClose()
  }

  const handleNextEpisode = () => {
    if (item.media_type !== 'tv' || !item.show_name) return
    const showEps = allMedia
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
          onEpisodeSelect(next)
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
            onClick={togglePlay}
            onMouseMove={resetHideTimer}
          />

          <div className={`${styles.topOverlay} ${showControls ? styles.visible : ''}`}>
            <button className={styles.back} onClick={handleClose}>← Back to Browse</button>
            <div className={styles.topRight}>
              <span className={styles.playerTitle}>{item.title}</span>
              {isTV && <button className={styles.qualityBtn} onClick={() => setShowEpisodes(true)}>Episodes</button>}
              <button className={styles.settingsBtn} onClick={() => setShowSettings(true)} aria-label="Settings">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M19.14 12.94a7.07 7.07 0 0 0 .06-.94c0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.48.48 0 0 0-.48-.41h-3.84a.48.48 0 0 0-.48.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.49.49 0 0 0-.59.22L2.74 8.87a.48.48 0 0 0 .12.61l2.03 1.58c-.05.3-.07.62-.07.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.26.41.48.41h3.84c.24 0 .44-.17.48-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.49.49 0 0 0-.12-.61l-2.03-1.58zM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2z"/></svg>
              </button>
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
              <button className={styles.qualityBtn} style={{ marginTop: 16 }} onClick={handleClose}>
                Back to Browse
              </button>
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
          playbackRate={playbackRate}
          isTV={isTV}
          onTogglePlay={togglePlay}
          onSeek={handleSeek}
          onVolumeChange={handleVolumeChange}
          onToggleMute={toggleMute}
          onSpeedChange={handleSpeedChange}
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
          playbackRate={playbackRate}
          selectedSubtitle={selectedSubtitle}
          selectedAudio={selectedAudio}
          onSelectSubtitle={setSelectedSubtitle}
          onSelectAudio={setSelectedAudio}
          onSpeedChange={handleSpeedChange}
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
