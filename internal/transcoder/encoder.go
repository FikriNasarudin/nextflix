package transcoder

import (
	"fmt"
	"log"
	"os"
	"os/exec"
)

type FFmpegCmd struct {
	Cmd     *exec.Cmd
	SegDir  string
}

func DetectEncoder() string {
	candidates := []string{"h264_nvenc", "h264_qsv", "libx264"}

	for _, enc := range candidates {
		cmd := exec.Command("ffmpeg",
			"-hide_banner", "-f", "lavfi",
			"-i", "color=black:s=320x240:d=0.1",
			"-c:v", enc, "-frames:v", "1",
			"-f", "null", "-", "-y",
		)
		if err := cmd.Run(); err == nil {
			log.Printf("Transcoder: detected encoder %s", enc)
			return enc
		}
	}

	log.Printf("Transcoder: libx264 fallback selected (no test encoder passed)")
	return "libx264"
}

func spawnFFmpeg(inputPath, segDir, rendition, encoder string, segDur int) (*FFmpegCmd, error) {
	hlsTime := fmt.Sprintf("%d", segDur)
	if segDur <= 0 {
		hlsTime = "4"
	}
	var scale, bitrate, maxrate, bufsize string
	switch rendition {
	case "480p":
		scale = "scale=-2:480"
		bitrate = "800k"
		maxrate = "1000k"
		bufsize = "1600k"
	case "1080p":
		scale = "scale=-2:1080"
		bitrate = "4000k"
		maxrate = "5000k"
		bufsize = "8000k"
	default:
		scale = "scale=-2:480"
		bitrate = "800k"
		maxrate = "1000k"
		bufsize = "1600k"
	}

	segPattern := segDir + "/seg_%05d.ts"
	playlist := segDir + "/index.m3u8"

	var args []string
	switch encoder {
	case "h264_nvenc":
		args = []string{
			"-i", inputPath,
			"-map", "0:v:0", "-map", "0:a:0?",
			"-vf", scale,
			"-c:v", "h264_nvenc",
			"-preset", "p1",
			"-b:v", bitrate,
			"-maxrate", maxrate,
			"-bufsize", bufsize,
			"-c:a", "aac", "-b:a", "128k", "-ar", "48000", "-ac", "2",
			"-f", "hls",
			"-hls_time", hlsTime,
			"-hls_list_size", "5",
			"-hls_flags", "delete_segments+omit_endlist",
			"-hls_segment_filename", segPattern,
			playlist,
		}
	case "h264_qsv":
		args = []string{
			"-i", inputPath,
			"-map", "0:v:0", "-map", "0:a:0?",
			"-vf", scale,
			"-c:v", "h264_qsv",
			"-preset", "veryfast",
			"-global_quality", "22",
			"-b:v", bitrate,
			"-maxrate", maxrate,
			"-bufsize", bufsize,
			"-c:a", "aac", "-b:a", "128k", "-ar", "48000", "-ac", "2",
			"-f", "hls",
			"-hls_time", hlsTime,
			"-hls_list_size", "5",
			"-hls_flags", "delete_segments+omit_endlist",
			"-hls_segment_filename", segPattern,
			playlist,
		}
	default:
		args = []string{
			"-i", inputPath,
			"-map", "0:v:0", "-map", "0:a:0?",
			"-vf", scale,
			"-c:v", "libx264",
			"-preset", "ultrafast",
			"-crf", "28",
			"-b:v", bitrate,
			"-maxrate", maxrate,
			"-bufsize", bufsize,
			"-threads", "1",
			"-c:a", "aac", "-b:a", "128k", "-ar", "48000", "-ac", "2",
			"-f", "hls",
			"-hls_time", "4",
			"-hls_list_size", "5",
			"-hls_flags", "delete_segments+omit_endlist",
			"-hls_segment_filename", segPattern,
			playlist,
		}
	}

	cmd := exec.Command("nice", append([]string{"-n", "19", "ffmpeg"}, args...)...)
	cmd.Stderr = os.Stderr

	return &FFmpegCmd{Cmd: cmd, SegDir: segDir}, nil
}

func (f *FFmpegCmd) Start() error {
	return f.Cmd.Start()
}

func (f *FFmpegCmd) Wait() error {
	return f.Cmd.Wait()
}
