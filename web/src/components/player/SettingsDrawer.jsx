import styles from './SettingsDrawer.module.css'

export default function SettingsDrawer({
  subtitles, audioTracks, selectedSubtitle, selectedAudio,
  onSelectSubtitle, onSelectAudio, onClose,
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
        </div>
      </div>
    </div>
  )
}
