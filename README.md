# Dusty Video Summarizer

A Node.js tool for processing, transcribing, and compressing video files with AI summaries.

## Overview

This project helps organize video content by:
1. Transcribing audio with OpenAI Whisper
2. Extracting key frames and analyzing content with OpenAI Vision
3. Rating importance of videos (scale 1-9) 
4. Generating meaningful filenames and descriptions
5. Compressing videos to save space

## Main Scripts

- **convert.cjs**: Process videos to generate transcripts, summaries, and rename intelligently
- **compress.cjs**: Compress MOV videos to MP4 format with good quality/size balance

## Usage

### Processing Videos
```bash
node convert.cjs path/to/videos [--force] [--comment-only] [--mp4]
```

Options:
- `--force`: Reprocess files even if already processed
- `--comment-only`: Only add metadata comments without processing
- `--mp4`: Process MP4 files instead of MOV files

### Compressing Videos
```bash
node compress.cjs path/to/videos [--force] [--limit=N] [--clobber] [--verbose]
```

Options:
- `--force`: Compress files even if already compressed
- `--limit=N`: Process only the first N files
- `--clobber`: Replace original files instead of creating a new directory
- `--verbose`: Show detailed logs

## Requirements

- Node.js
- FFmpeg (installed via Homebrew or included via ffmpeg-static)
- OpenAI API key (in .env file)

## Technical Notes

- Uses the OpenAI API for transcription and analysis
- Relies on FFmpeg for video processing
- Stores transcripts and summaries in JSON and TXT format
- Sets macOS Finder comments with metadata

## Troubleshooting

If experiencing FFmpeg issues:
1. Verify FFmpeg is installed: `brew install ffmpeg`
2. The scripts automatically detect and configure FFmpeg paths
3. Both system FFmpeg and the bundled ffmpeg-static package are supported

If experiencing NPM issues:
1. Clear NPM cache: `npm cache clean --force`
2. Install packages individually if bulk installation fails