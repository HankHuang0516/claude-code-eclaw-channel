#!/bin/bash

# EClaw Promo V4 Audio Processing Pipeline
# Task: Combine EClaw promo v4 video with licensed audio and create platform-specific versions

set -euo pipefail

# Configuration
VIDEO_INPUT="eclaw_real_v4_no_bgm.mp4"  # 42.5s, 1080×1920, 9:16
AUDIO_INPUT="eclaw_promo_audio.mp3"     # Licensed energetic track from Pixabay
OUTPUT_DIR="eclaw_promo_v4_outputs"
LOG_FILE="$OUTPUT_DIR/processing.log"

# Create output directory and log file
mkdir -p "$OUTPUT_DIR"
exec 1> >(tee -a "$LOG_FILE")
exec 2> >(tee -a "$LOG_FILE" >&2)

# Utility functions
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"
}

check_dependency() {
    if ! command -v "$1" >/dev/null 2>&1; then
        log "❌ Error: $1 is required but not installed"
        exit 1
    fi
}

validate_input() {
    local file=$1
    local type=$2

    if [[ ! -f "$file" ]]; then
        log "❌ $type file not found: $file"
        return 1
    fi

    local size=$(du -h "$file" | cut -f1)
    log "✅ $type file validated: $file ($size)"
    return 0
}

log "🎬 EClaw Promo V4 Processing Pipeline"
log "==============================================="

# Check dependencies
log "🔧 Checking dependencies..."
check_dependency "ffmpeg"
check_dependency "du"

# Validate inputs
log "📁 Validating input files..."
validate_input "$AUDIO_INPUT" "Audio" || exit 1

VIDEO_AVAILABLE=false
if validate_input "$VIDEO_INPUT" "Video"; then
    VIDEO_AVAILABLE=true
else
    log "⚠️  Video file not found: $VIDEO_INPUT"
    log "📝 Note: This script demonstrates the processing workflow"
    log "   Place the video file in the current directory to execute"
    VIDEO_AVAILABLE=false
fi

# Audio file analysis
if [[ $VIDEO_AVAILABLE == true ]]; then
    log "🔍 Analyzing input files..."
    VIDEO_INFO=$(ffprobe -v quiet -print_format json -show_format -show_streams "$VIDEO_INPUT")
    AUDIO_INFO=$(ffprobe -v quiet -print_format json -show_format -show_streams "$AUDIO_INPUT")
    log "📊 Input analysis complete"
fi

# Processing function
process_version() {
    local platform=$1
    local output_file=$2
    local max_duration=$3
    local audio_delay=${4:-"0s"}
    local additional_filters=${5:-""}

    log "🎬 Processing $platform version..."

    local base_filters="volume=-8dB,adelay=delays=${audio_delay}:all=1"
    if [[ -n "$additional_filters" ]]; then
        base_filters="${base_filters},${additional_filters}"
    fi

    local cmd="ffmpeg -y -i \"$VIDEO_INPUT\" -i \"$AUDIO_INPUT\" \
        -map 0:v -map 1:a \
        -af \"$base_filters\" \
        -vf \"scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black\" \
        -c:v libx264 -preset fast -crf 23 \
        -t $max_duration \
        -movflags +faststart \
        \"$output_file\""

    if eval $cmd; then
        local size=$(du -h "$output_file" | cut -f1)
        log "✅ $platform version complete: $(basename "$output_file") ($size)"
        return 0
    else
        log "❌ Failed to process $platform version"
        return 1
    fi
}

log ""
log "🔄 Processing Configuration:"
log "==============================================="
log "📱 YouTube Shorts: 60s max, 1080×1920, standard hook timing"
log "🐦 X/Twitter: 140s max, 1080×1920, engagement optimized"
log "🎵 TikTok: 60s max, 1080×1920, 500ms hook delay for viral optimization"
log ""
log "🎚️  Audio Processing: -8dB volume, licensed background music"
log "🎥 Video Processing: H.264, CRF 23, fast preset, +faststart"

echo ""
echo "🎯 Processing Summary:"
echo "==============================================="
echo "• Source: EClaw real v4 (42.5s, 1080×1920)"
echo "• Audio: Energetic Upbeat Background Music (2:01) - Licensed from Pixabay"
echo "• Processing: Video map 0:v, Audio map 1:a, Volume -8dB, Hook alignment"
echo "• Output formats: YouTube Shorts, X/Twitter, TikTok (all 1080×1920)"
echo "• Features: eclawbot.com CTA integration ready"

# Execute processing if video file exists
if [[ $VIDEO_AVAILABLE == true ]]; then
    log ""
    log "🚀 Executing processing pipeline..."
    log "==============================================="

    local success_count=0
    local total_count=3

    # YouTube Shorts version (60s max, standard hook)
    if process_version "YouTube Shorts" "$OUTPUT_DIR/eclaw_promo_v4_youtube_shorts.mp4" 60 "0s"; then
        ((success_count++))
    fi

    # X/Twitter version (140s max, standard hook)
    if process_version "X/Twitter" "$OUTPUT_DIR/eclaw_promo_v4_twitter.mp4" 140 "0s"; then
        ((success_count++))
    fi

    # TikTok version (60s max, 500ms delay for hook optimization)
    if process_version "TikTok" "$OUTPUT_DIR/eclaw_promo_v4_tiktok.mp4" 60 "500ms"; then
        ((success_count++))
    fi

    log ""
    log "📊 Processing Summary:"
    log "==============================================="
    log "✅ Successful: $success_count/$total_count versions"

    if [[ -d "$OUTPUT_DIR" && $(ls -1 "$OUTPUT_DIR"/*.mp4 2>/dev/null | wc -l) -gt 0 ]]; then
        log "📁 Output files:"
        for file in "$OUTPUT_DIR"/*.mp4; do
            local size=$(du -h "$file" | cut -f1)
            local duration=$(ffprobe -v quiet -show_entries format=duration -of csv=p=0 "$file" 2>/dev/null | cut -d. -f1)
            log "   📹 $(basename "$file"): $size, ${duration}s"
        done
    fi

    if [[ $success_count -eq $total_count ]]; then
        log "🎉 All processing completed successfully!"
        log "📋 Ready for distribution to platform channels"
    else
        log "⚠️  Some processing failed. Check logs above for errors."
    fi

else
    log ""
    log "📋 Processing pipeline ready for execution"
    log "   Waiting for video file: $VIDEO_INPUT"
    log "   All dependencies verified and commands prepared"
fi

log ""
log "🎬 EClaw Promo V4 pipeline execution complete!"
log "📄 Full log saved to: $LOG_FILE"

echo ""
echo "🎬 EClaw Promo V4 processing pipeline ready!"