package admin

import (
	"database/sql"
	"net/http"
	"strconv"

	"nextflix/internal/encoder"
)

type EncodingHandler struct {
	db  *sql.DB
	enc *encoder.Encoder
}

func NewEncodingHandler(db *sql.DB, enc *encoder.Encoder) *EncodingHandler {
	return &EncodingHandler{db: db, enc: enc}
}

func (h *EncodingHandler) Streams(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeError(w, "invalid id", http.StatusBadRequest)
		return
	}

	type video struct {
		ID          int64  `json:"id"`
		Codec       string `json:"codec"`
		Width       int    `json:"width"`
		Height      int    `json:"height"`
		StreamIndex int    `json:"stream_index"`
		Profile     string `json:"profile"`
		BitRate     string `json:"bit_rate"`
		FrameRate   string `json:"frame_rate"`
		IsHDR       bool   `json:"is_hdr"`
		IsDefault   bool   `json:"is_default"`
	}
	type audio struct {
		ID          int64  `json:"id"`
		Language    string `json:"language"`
		Codec       string `json:"codec"`
		Channels    int    `json:"channels"`
		StreamIndex int    `json:"stream_index"`
		Title       string `json:"title"`
		IsDefault   bool   `json:"is_default"`
	}
	type subtitle struct {
		ID          int64  `json:"id"`
		Language    string `json:"language"`
		Codec       string `json:"codec"`
		FilePath    string `json:"file_path"`
		IsForced    bool   `json:"is_forced"`
		IsExternal  bool   `json:"is_external"`
		StreamIndex int    `json:"stream_index"`
		IsDefault   bool   `json:"is_default"`
	}
	type streams struct {
		Video     []video    `json:"video"`
		Audio     []audio    `json:"audio"`
		Subtitles []subtitle `json:"subtitles"`
	}

	out := streams{Video: []video{}, Audio: []audio{}, Subtitles: []subtitle{}}

	vrows, err := h.db.Query(`
		SELECT id, codec, width, height, stream_index, profile, bit_rate, frame_rate, is_hdr, is_default
		FROM media_video_tracks WHERE media_id = ? ORDER BY is_default DESC, id ASC
	`, id)
	if err == nil {
		for vrows.Next() {
			var v video
			var isHdr, isDefault int
			if err := vrows.Scan(&v.ID, &v.Codec, &v.Width, &v.Height, &v.StreamIndex, &v.Profile, &v.BitRate, &v.FrameRate, &isHdr, &isDefault); err == nil {
				v.IsHDR = isHdr == 1
				v.IsDefault = isDefault == 1
				out.Video = append(out.Video, v)
			}
		}
		vrows.Close()
	}

	arows, err := h.db.Query(`
		SELECT id, language, codec, channels, stream_index, title, is_default
		FROM media_audio_tracks WHERE media_id = ? ORDER BY is_default DESC, id ASC
	`, id)
	if err == nil {
		for arows.Next() {
			var a audio
			var isDefault int
			if err := arows.Scan(&a.ID, &a.Language, &a.Codec, &a.Channels, &a.StreamIndex, &a.Title, &isDefault); err == nil {
				a.IsDefault = isDefault == 1
				out.Audio = append(out.Audio, a)
			}
		}
		arows.Close()
	}

	srows, err := h.db.Query(`
		SELECT id, language, codec, file_path, is_forced, is_external, stream_index, is_default
		FROM media_subtitles WHERE media_id = ? ORDER BY is_external ASC, is_default DESC, id ASC
	`, id)
	if err == nil {
		for srows.Next() {
			var s subtitle
			var isForced, isExternal, isDefault int
			if err := srows.Scan(&s.ID, &s.Language, &s.Codec, &s.FilePath, &isForced, &isExternal, &s.StreamIndex, &isDefault); err == nil {
				s.IsForced = isForced == 1
				s.IsExternal = isExternal == 1
				s.IsDefault = isDefault == 1
				out.Subtitles = append(out.Subtitles, s)
			}
		}
		srows.Close()
	}

	writeJSON(w, out)
}

func (h *EncodingHandler) Optimization(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeError(w, "invalid id", http.StatusBadRequest)
		return
	}

	type job struct {
		Rendition       string `json:"rendition"`
		Status          string `json:"status"`
		ProgressPercent int    `json:"progress_percent"`
		StartedAt       string `json:"started_at"`
		FinishedAt      string `json:"finished_at"`
		Error           string `json:"error"`
		OutputPath      string `json:"output_path"`
		OutputSize      int64  `json:"output_size"`
	}
	type optim struct {
		HlsPath  string `json:"hls_path"`
		IsOptimized bool `json:"is_optimized"`
		Jobs     []job  `json:"jobs"`
		TotalSize int64 `json:"total_size"`
	}

	var resp optim
	resp.Jobs = []job{}

	var hlsPath string
	h.db.QueryRow(`SELECT COALESCE(hls_480p_path, '') FROM media_items WHERE id = ?`, id).Scan(&hlsPath)
	resp.HlsPath = hlsPath
	resp.IsOptimized = hlsPath != ""

	jrows, err := h.db.Query(`
		SELECT rendition, status, progress_percent,
		       COALESCE(started_at, ''), COALESCE(finished_at, ''),
		       COALESCE(error, ''), COALESCE(output_path, ''), output_size
		FROM encode_jobs WHERE media_id = ? ORDER BY id ASC
	`, id)
	if err == nil {
		for jrows.Next() {
			var j job
			if err := jrows.Scan(&j.Rendition, &j.Status, &j.ProgressPercent, &j.StartedAt, &j.FinishedAt, &j.Error, &j.OutputPath, &j.OutputSize); err == nil {
				resp.Jobs = append(resp.Jobs, j)
				resp.TotalSize += j.OutputSize
			}
		}
		jrows.Close()
	}

	writeJSON(w, resp)
}

func (h *EncodingHandler) Queue(w http.ResponseWriter, r *http.Request) {
	if h.enc == nil {
		writeJSON(w, []encoder.QueueItem{})
		return
	}
	writeJSON(w, h.enc.Queue())
}