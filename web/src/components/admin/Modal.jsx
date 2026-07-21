import { useState } from 'react'
import styles from './Modal.module.css'

export default function Modal({ title, onClose, onSave, children, saveLabel }) {
  return (
    <div className={styles.overlay + ' ' + styles.open} onClick={onClose}>
      <div className={styles.box} onClick={e => e.stopPropagation()}>
        <h2>{title}</h2>
        <div>{children}</div>
        <div className={styles.actions}>
          <button className="btn btn-outline" onClick={onClose}>Cancel</button>
          {onSave && (
            <button className="btn btn-primary" onClick={onSave}>
              {saveLabel || 'Save'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
