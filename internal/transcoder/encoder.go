package transcoder

import (
	"fmt"
	"log"
	"os"
	"os/exec"
	"strconv"
)

type FFmpegCmd struct {
	Cmd    *exec.Cmd
	SegDir string
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

func spawnFFmpeg(inputPath, segDir, rendition, kind, encoder string, segDur int, startPos int) (*FFmpegCmd, error) {
	hlsTime := fmt.Sprintf("%d", segDur)
	if segDur <= 0 {
		hlsTime = "4"
	}

	segPattern := segDir + "/seg_%05d.ts"
	playlist := segDir + "/index.m3u8"

	var args []string

	if startPos > 0 {
		args = append(args, "-ss", strconv.Itoa(startPos))
	}

	args = append(args, "-i", inputPath)
	args = append(args, "-map", "0:v:0", "-map", "0:a:0?")

	switch kind {
	case "remux":
		args = append(args,
			"-c:v", "copy",
			"-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2",
		)

	default:
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

		args = append(args, "-vf", scale)

		switch encoder {
		case "h264_nvenc":
			args = append(args,
				"-c:v", "h264_nvenc",
				"-preset", "p1",
				"-b:v", bitrate,
				"-maxrate", maxrate,
				"-bufsize", bufsize,
			)
		case "h264_qsv":
			args = append(args,
				"-c:v", "h264_qsv",
				"-preset", "veryfast",
				"-global_quality", "22",
				"-b:v", bitrate,
				"-maxrate", maxrate,
				"-bufsize", bufsize,
			)
		default:
			args = append(args,
				"-c:v", "libx264",
				"-preset", "ultrafast",
				"-crf", "28",
				"-b:v", bitrate,
				"-maxrate", maxrate,
				"-bufsize", bufsize,
			)
		}

		args = append(args,
			"-c:a", "aac", "-b:a", "128k", "-ar", "48000", "-ac", "2",
		)
	}

	hlsArgs := []string{
		"-f", "hls",
		"-hls_time", hlsTime,
		"-hls_list_size", "5",
		"-hls_flags", "delete_segments+omit_endlist",
	}

	if startPos > 0 {
		segNum := startPos / segDur
		hlsArgs = append(hlsArgs, "-start_number", strconv.Itoa(segNum))
	}

	hlsArgs = append(hlsArgs, "-hls_segment_filename", segPattern, playlist)
	args = append(args, hlsArgs...)

	cmd := exec.Command("ffmpeg", args...)
	cmd.Stderr = os.Stderr

	return &FFmpegCmd{Cmd: cmd, SegDir: segDir}, nil
}

func (f *FFmpegCmd) Start() error {
	return f.Cmd.Start()
}

func (f *FFmpegCmd) Wait() error {
	return f.Cmd.Wait()
}
