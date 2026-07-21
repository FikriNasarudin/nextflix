import styles from './SettingsDrawer.module.css'

export default function SettingsDrawer({
  subtitles, audioTracks, playbackRate, selectedSubtitle, selectedAudio,
  onSelectSubtitle, onSelectAudio, onSpeedChange, onClose,
}) {
  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.drawer} onClick={e => e.stopPropagation()}>
        <div className={styles.header}>
          <span>Audio & Subtitles</span>
          <button className={styles.closeBtn} onClick={onClose}>✕</button>
        </div>
        <div className={styles.body}>
          <div className={styles.section}>
            <div className={styles.sectionTitle}>Audio Track</div>
            {audioTracks.length > 0 ? (
              <select
                className={styles.select}
                value={selectedAudio || ''}
                onChange={(e) => onSelectAudio(e.target.value || null)}
              >
                <option value="">Default</option>
                {audioTracks.map((a, i) => (
                  <option key={i} value={a.id}>{a.language} {a.title ? '· ' + a.title : ''}</option>
                ))}
              </select>
            ) : (
              <div className={styles.empty}>No alternate audio tracks</div>
            )}
          </div>
          <div className={styles.section}>
            <div className={styles.sectionTitle}>Subtitles</div>
            {subtitles.length > 0 ? (
              <select
                className={styles.select}
                value={selectedSubtitle || ''}
                onChange={(e) => onSelectSubtitle(e.target.value || null)}
              >
                <option value="">Off</option>
                {subtitles.map((s, i) => (
                  <option key={i} value={s.id}>{s.language}</option>
                ))}
              </select>
            ) : (
              <div className={styles.empty}>No subtitles available</div>
            )}
          </div>
          <div className={styles.section}>
            <div className={styles.sectionTitle}>Playback Speed</div>
            <select
              className={styles.select}
              value={playbackRate}
              onChange={(e) => onSpeedChange(e.target.value)}
            >
              <option value="0.5">0.5x</option>
              <option value="1">1x</option>
              <option value="1.25">1.25x</option>
              <option value="1.5">1.5x</option>
              <option value="2">2x</option>
            </select>
          </div>
        </div>
      </div>
    </div>
  )
}
