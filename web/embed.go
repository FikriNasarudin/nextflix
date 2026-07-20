package web

import "embed"

//go:embed templates/* static/css/* static/js/*
var FS embed.FS
