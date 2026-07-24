package transcoder

import (
	"context"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sync"
	"time"

	"nextflix/internal/config"
)

type Session struct {
	MediaID    int64
	FilePath   string
	Rendition  string
	Cmd        *FFmpegCmd
	lastTouch  time.Time
	mu         sync.Mutex
}

type SessionManager struct {
	cfg       config.TranscoderConfig
	encoder   string
	sessions  map[int64]*Session
	mu        sync.Mutex
}

func New(cfg config.TranscoderConfig, encoder string) *SessionManager {
	return &SessionManager{
		cfg:      cfg,
		encoder:  encoder,
		sessions: make(map[int64]*Session),
	}
}

func (sm *SessionManager) GetOrCreate(mediaID int64, filePath string, rendition string) (*Session, error) {
	sm.mu.Lock()
	defer sm.mu.Unlock()

	if s, ok := sm.sessions[mediaID]; ok {
		s.Touch()
		if s.Rendition != rendition {
			if err := s.switchRendition(mediaID, filePath, rendition, sm.encoder, sm.cfg.SegmentDurationSec); err != nil {
				return nil, fmt.Errorf("switch rendition: %w", err)
			}
		}
		return s, nil
	}

	if len(sm.sessions) >= 1 {
		for id, s := range sm.sessions {
			s.Kill()
			delete(sm.sessions, id)
			break
		}
	}

	s := &Session{
		MediaID:   mediaID,
		FilePath:  filePath,
		Rendition: rendition,
		lastTouch: time.Now(),
	}

	segDir := filepath.Join(sm.cfg.ShmDir, fmt.Sprintf("%d", mediaID), rendition)
	os.MkdirAll(segDir, 0755)

	cmd, err := spawnFFmpeg(filePath, segDir, rendition, sm.encoder, sm.cfg.SegmentDurationSec)
	if err != nil {
		os.RemoveAll(filepath.Join(sm.cfg.ShmDir, fmt.Sprintf("%d", mediaID)))
		return nil, fmt.Errorf("spawn ffmpeg: %w", err)
	}
	s.Cmd = cmd

	if err := cmd.Start(); err != nil {
		os.RemoveAll(filepath.Join(sm.cfg.ShmDir, fmt.Sprintf("%d", mediaID)))
		return nil, fmt.Errorf("start ffmpeg: %w", err)
	}

	sm.sessions[mediaID] = s
	log.Printf("Transcoder: started %s for media=%d (pid=%d)", rendition, mediaID, cmd.Cmd.Process.Pid)
	return s, nil
}

func (s *Session) switchRendition(mediaID int64, filePath string, newRendition string, encoder string, segDur int) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.Rendition == newRendition {
		return nil
	}

	s.Kill()

	oldDir := filepath.Join(filepath.Dir(s.Cmd.SegDir))
	os.RemoveAll(oldDir)

	s.FilePath = filePath
	s.Rendition = newRendition
	s.lastTouch = time.Now()

	segDir := filepath.Join(filepath.Dir(oldDir), newRendition)
	os.MkdirAll(segDir, 0755)

	cmd, err := spawnFFmpeg(filePath, segDir, newRendition, encoder, segDur)
	if err != nil {
		return fmt.Errorf("spawn ffmpeg: %w", err)
	}
	s.Cmd = cmd

	if err := cmd.Start(); err != nil {
		return fmt.Errorf("start ffmpeg: %w", err)
	}

	log.Printf("Transcoder: switched to %s for media=%d (pid=%d)", newRendition, mediaID, cmd.Cmd.Process.Pid)
	return nil
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
	if s.Cmd != nil && s.Cmd.Cmd != nil && s.Cmd.Cmd.Process != nil {
		s.Cmd.Cmd.Process.Kill()
		s.Cmd.Cmd.Wait()
	}
}

func (sm *SessionManager) KillAll() {
	sm.mu.Lock()
	defer sm.mu.Unlock()
	for id, s := range sm.sessions {
		s.Kill()
		os.RemoveAll(filepath.Join(sm.cfg.ShmDir, fmt.Sprintf("%d", id)))
		delete(sm.sessions, id)
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
			for id, s := range sm.sessions {
				if s.IdleDuration() > time.Duration(sm.cfg.SessionIdleTimeoutSec)*time.Second {
					log.Printf("Transcoder: reaping idle session media=%d (idle for %v)", id, s.IdleDuration())
					s.Kill()
					os.RemoveAll(filepath.Join(sm.cfg.ShmDir, fmt.Sprintf("%d", id)))
					delete(sm.sessions, id)
				}
			}
			sm.mu.Unlock()
		}
	}
}
