package transcoder

import (
	"context"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"time"

	"nextflix/internal/config"
)

type Session struct {
	MediaID    int64
	FilePath   string
	Rendition  string
	Kind       string
	Pos        int
	Cmd        *FFmpegCmd
	lastTouch  time.Time
	mu         sync.Mutex
	killed     int32
	generation int32
}

type SessionManager struct {
	cfg      config.TranscoderConfig
	encoder  string
	sessions map[string]*Session
	mu       sync.Mutex
}

func New(cfg config.TranscoderConfig, encoder string) *SessionManager {
	return &SessionManager{
		cfg:      cfg,
		encoder:  encoder,
		sessions: make(map[string]*Session),
	}
}

func sessionKey(mediaID int64, rendition string, pos int) string {
	return fmt.Sprintf("%d:%s:%d", mediaID, rendition, pos)
}

func segDirFor(shmDir string, mediaID int64, rendition string, pos int) string {
	return filepath.Join(shmDir, fmt.Sprintf("%d", mediaID), rendition, fmt.Sprintf("%d", pos))
}

func (sm *SessionManager) GetOrCreate(mediaID int64, filePath string, rendition string, kind string, startPos int) (*Session, error) {
	segDur := sm.cfg.SegmentDurationSec
	if segDur <= 0 {
		segDur = 4
	}
	pos := (startPos / segDur) * segDur
	key := sessionKey(mediaID, rendition, pos)

	sm.mu.Lock()
	defer sm.mu.Unlock()

	if s, ok := sm.sessions[key]; ok {
		s.Touch()
		return s, nil
	}

	sd := segDirFor(sm.cfg.ShmDir, mediaID, rendition, pos)
	if err := os.MkdirAll(sd, 0755); err != nil {
		return nil, fmt.Errorf("mkdir: %w", err)
	}

	cmd, err := spawnFFmpeg(filePath, sd, rendition, kind, sm.encoder, segDur, pos)
	if err != nil {
		os.RemoveAll(sd)
		return nil, fmt.Errorf("spawn ffmpeg: %w", err)
	}

	s := &Session{
		MediaID:    mediaID,
		FilePath:   filePath,
		Rendition:  rendition,
		Kind:       kind,
		Pos:        pos,
		Cmd:        cmd,
		lastTouch:  time.Now(),
		generation: 1,
	}

	if err := cmd.Start(); err != nil {
		os.RemoveAll(sd)
		return nil, fmt.Errorf("start ffmpeg: %w", err)
	}

	sm.sessions[key] = s
	log.Printf("Transcoder: started %s %s for media=%d pos=%d (pid=%d)", kind, rendition, mediaID, pos, cmd.Cmd.Process.Pid)

	gen := atomic.LoadInt32(&s.generation)
	go func(cmd *FFmpegCmd, key string, mediaID int64, segDir string, gen int32) {
		cmd.Wait()
		sm.mu.Lock()
		if found, ok := sm.sessions[key]; ok &&
			atomic.LoadInt32(&found.generation) == gen &&
			atomic.LoadInt32(&found.killed) == 0 {
			delete(sm.sessions, key)
			os.RemoveAll(segDir)
			log.Printf("Transcoder: cleaned up dead session %s", key)
		}
		sm.mu.Unlock()
	}(cmd, key, mediaID, sd, gen)

	return s, nil
}

func (s *Session) Touch() {
	s.mu.Lock()
	s.lastTouch = time.Now()
	s.mu.Unlock()
}

func (s *Session) IdleDuration() time.Duration {
	s.mu.Lock()
	defer s.mu.Unlock()
	return time.Since(s.lastTouch)
}

func (s *Session) Kill() {
	s.mu.Lock()
	defer s.mu.Unlock()
	atomic.StoreInt32(&s.killed, 1)
	if s.Cmd != nil && s.Cmd.Cmd != nil && s.Cmd.Cmd.Process != nil {
		s.Cmd.Cmd.Process.Kill()
		s.Cmd.Cmd.Wait()
	}
}

func (sm *SessionManager) ShmDir() string {
	return sm.cfg.ShmDir
}

func (sm *SessionManager) KillAll() {
	sm.mu.Lock()
	defer sm.mu.Unlock()
	for _, s := range sm.sessions {
		s.Kill()
	}
	for key, s := range sm.sessions {
		sd := segDirFor(sm.cfg.ShmDir, s.MediaID, s.Rendition, s.Pos)
		os.RemoveAll(sd)
		delete(sm.sessions, key)
	}
}

func (sm *SessionManager) StartReaper(ctx context.Context) {
	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			sm.KillAll()
			return
		case <-ticker.C:
			sm.mu.Lock()
			for key, s := range sm.sessions {
				if s.IdleDuration() > time.Duration(sm.cfg.SessionIdleTimeoutSec)*time.Second {
					log.Printf("Transcoder: reaping idle session %s (idle for %v)", key, s.IdleDuration())
					s.Kill()
					sd := segDirFor(sm.cfg.ShmDir, s.MediaID, s.Rendition, s.Pos)
					os.RemoveAll(sd)
					delete(sm.sessions, key)
				}
			}
			sm.mu.Unlock()
		}
	}
}
