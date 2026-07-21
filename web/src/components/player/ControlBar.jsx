import { useState, useRef, useCallback } from 'react'
import styles from './ControlBar.module.css'

function formatTime(seconds) {
  if (!seconds || isNaN(seconds)) return '0:00'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return m + ':' + String(s).padStart(2, '0')
}

export default function ControlBar({
  playing, currentTime, duration, buffered, volume, muted,
  playbackRate, isTV,
  onTogglePlay, onSeek, onVolumeChange, onToggleMute, onSpeedChange,
  onSkipBack, onSkipForward, onNextEpisode, onPip, onAspectRatio, onFullscreen,
}) {
  const [isDragging, setIsDragging] = useState(false)
  const progressRef = useRef(null)

  const handleSeek = useCallback((e) => {
    const el = progressRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    onSeek(pct * duration)
  }, [duration, onSeek])

  const playedPct = duration > 0 ? (currentTime / duration) * 100 : 0
  const bufferedPct = duration > 0 ? (buffered / duration) * 100 : 0
  const remaining = duration - currentTime
  const endsAt = new Date(Date.now() + remaining * 1000)

  const speeds = [0.5, 1, 1.25, 1.5, 2]

  return (
    <div className={styles.controlBar}>
      <div className={styles.progressWrap}>
        <div
          className={styles.progressTrack}
          ref={progressRef}
          onClick={handleSeek}
        >
          <div className={styles.progressBuffer} style={{ width: bufferedPct + '%' }} />
          <div className={styles.progressPlayed} style={{ width: playedPct + '%' }} />
          <input
            type="range"
            className={styles.progressRange}
            min="0"
            max={duration || 100}
            value={currentTime}
            readOnly
          />
        </div>
      </div>
      <div className={styles.row}>
        <div className={styles.left}>
          <button className={styles.btn} onClick={onTogglePlay} aria-label="Play/Pause">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
              {playing
                ? <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z"/>
                : <path d="M7 4l13 8-13 8V4z"/>
              }
            </svg>
          </button>
          <button className={styles.btn + ' ' + styles.skipBtn} onClick={onSkipBack} aria-label="Rewind 10s">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
              <path d="M11.99 5V1l-5 5 5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6h-2c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/>
              <text x="12" y="16" textAnchor="middle" fontSize="9" fontWeight="bold" fill="currentColor">10</text>
            </svg>
          </button>
          <button className={styles.btn + ' ' + styles.skipBtn} onClick={onSkipForward} aria-label="Forward 10s">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
              <path d="M12.01 5V1l5 5-5 5V7c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6h2c0 4.42-3.58 8-8 8s-8-3.58-8-8 3.58-8 8-8z"/>
              <text x="12" y="16" textAnchor="middle" fontSize="9" fontWeight="bold" fill="currentColor">10</text>
            </svg>
          </button>
          <span className={styles.time}>
            {formatTime(currentTime)} / {formatTime(duration)}
            {endsAt && <span className={styles.timeEnd}> · Ends at {endsAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>}
          </span>
        </div>
        <div className={styles.right}>
          <div className={styles.volumeGroup}>
            <button className={styles.btn} onClick={onToggleMute} aria-label="Volume" style={{ padding: '8px 6px' }}>
              <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                {muted || volume === 0
                  ? <path d="M16.5 12A4.5 4.5 0 0 0 14 8.5v7M3 9v6h4l5 5V4L7 9H3z"/>
                  : <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 8.5v7a4.49 4.49 0 0 0 2.5-3.5zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
                }
              </svg>
            </button>
            <input
              type="range"
              className={styles.volumeSlider}
              min="0"
              max="1"
              step="0.05"
              value={muted ? 0 : volume}
              onChange={(e) => onVolumeChange(parseFloat(e.target.value))}
            />
          </div>
          {isTV && (
            <button className={styles.btn + ' ' + styles.nextBtn} onClick={onNextEpisode} aria-label="Next episode">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>
            </button>
          )}
          <select
            className={styles.speed}
            value={playbackRate}
            onChange={(e) => onSpeedChange(e.target.value)}
          >
            {speeds.map(s => <option key={s} value={s}>{s}x</option>)}
          </select>
          <button className={styles.btn + ' ' + styles.pipBtn} onClick={onPip} aria-label="Picture in Picture">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M19 11h-8v6h8v-6zm4 8V4.98C23 3.88 22.1 3 21 3H3c-1.1 0-2 .88-2 1.98V19c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2zm-2 .02H3V4.97h18v14.05z"/></svg>
          </button>
          <button className={styles.btn + ' ' + styles.ratioBtn} onClick={onAspectRatio} aria-label="Aspect Ratio" title="Aspect Ratio">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V5h14v14zm-4-4h2v2h-2v-2zm-4 0h2v2h-2v-2zm-2 0h-2v2h2v-2z"/></svg>
          </button>
          <button className={styles.btn} onClick={onFullscreen} aria-label="Fullscreen">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/></svg>
          </button>
        </div>
      </div>
    </div>
  )
}
