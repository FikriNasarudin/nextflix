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

type rungConfig struct {
	Height  int
	Bitrate string
	Maxrate string
	Bufsize string
}

var renditionRungs = map[string]rungConfig{
	"360p":  {Height: 360, Bitrate: "500k", Maxrate: "700k", Bufsize: "1200k"},
	"480p":  {Height: 480, Bitrate: "800k", Maxrate: "1000k", Bufsize: "1600k"},
	"540p":  {Height: 540, Bitrate: "1200k", Maxrate: "1600k", Bufsize: "2500k"},
	"720p":  {Height: 720, Bitrate: "2500k", Maxrate: "3200k", Bufsize: "5000k"},
	"1080p": {Height: 1080, Bitrate: "4000k", Maxrate: "5000k", Bufsize: "8000k"},
}

func spawnFFmpeg(inputPath, segDir, rendition, kind, encoder string, segDur int, startPos int, hlsListSize int, isHdr bool) (*FFmpegCmd, error) {
	hlsTime := fmt.Sprintf("%d", segDur)
	if segDur <= 0 {
		hlsTime = "4"
	}
	listSize := hlsListSize
	if listSize <= 0 {
		listSize = 30
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
		rung, ok := renditionRungs[rendition]
		if !ok {
			rung = renditionRungs["480p"]
		}
		scale := fmt.Sprintf("scale=-2:%d", rung.Height)

		vf := scale
		if isHdr {
			vf = fmt.Sprintf("tonemap=hable:desat=0,%s", scale)
		}

		args = append(args, "-vf", vf)

		switch encoder {
		case "h264_nvenc":
			args = append(args,
				"-c:v", "h264_nvenc",
				"-preset", "p1",
				"-b:v", rung.Bitrate,
				"-maxrate", rung.Maxrate,
				"-bufsize", rung.Bufsize,
			)
			if isHdr {
				args = append(args,
					"-color_range", "tv",
					"-colorspace", "bt709",
					"-color_trc", "bt709",
					"-color_primaries", "bt709",
				)
			}
		case "h264_qsv":
			args = append(args,
				"-c:v", "h264_qsv",
				"-preset", "veryfast",
				"-global_quality", "22",
				"-b:v", rung.Bitrate,
				"-maxrate", rung.Maxrate,
				"-bufsize", rung.Bufsize,
			)
			if isHdr {
				args = append(args,
					"-color_range", "tv",
					"-colorspace", "bt709",
					"-color_trc", "bt709",
					"-color_primaries", "bt709",
				)
			}
		default:
			args = append(args,
				"-c:v", "libx264",
				"-preset", "ultrafast",
				"-crf", "28",
				"-b:v", rung.Bitrate,
				"-maxrate", rung.Maxrate,
				"-bufsize", rung.Bufsize,
			)
			if isHdr {
				args = append(args,
					"-color_range", "tv",
					"-colorspace", "bt709",
					"-color_trc", "bt709",
					"-color_primaries", "bt709",
				)
			}
		}

		args = append(args,
			"-c:a", "aac", "-b:a", "128k", "-ar", "48000", "-ac", "2",
		)
	}

	hlsArgs := []string{
		"-f", "hls",
		"-hls_time", hlsTime,
		"-hls_list_size", fmt.Sprintf("%d", listSize),
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
