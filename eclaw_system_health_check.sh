#!/bin/bash

# EClaw System Health Check
# Comprehensive monitoring script for EClaw infrastructure
# Monitors APIs, services, database connectivity, and system resources

set -euo pipefail

# Configuration
HEALTH_LOG="eclaw_health_$(date '+%Y%m%d_%H%M%S').log"
API_BASE="http://localhost:3000"
DEVICE_SECRET="${DEVICE_SECRET:-}"
BOT_SECRET="${BOT_SECRET:-}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging functions
log() {
    local level=$1
    shift
    local message="$*"
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')

    case $level in
        "INFO")  echo -e "${timestamp} ${BLUE}[INFO]${NC}  $message" | tee -a "$HEALTH_LOG" ;;
        "WARN")  echo -e "${timestamp} ${YELLOW}[WARN]${NC}  $message" | tee -a "$HEALTH_LOG" ;;
        "ERROR") echo -e "${timestamp} ${RED}[ERROR]${NC} $message" | tee -a "$HEALTH_LOG" ;;
        "SUCCESS") echo -e "${timestamp} ${GREEN}[SUCCESS]${NC} $message" | tee -a "$HEALTH_LOG" ;;
    esac
}

# Health check functions
check_api_endpoint() {
    local endpoint=$1
    local description=$2
    local expected_status=${3:-200}
    local headers=${4:-}

    log "INFO" "Checking $description: $endpoint"

    local curl_cmd="curl -s -w '%{http_code}' -o /dev/null"
    if [[ -n "$headers" ]]; then
        curl_cmd="$curl_cmd -H '$headers'"
    fi
    curl_cmd="$curl_cmd '$API_BASE$endpoint'"

    local status_code=$(eval $curl_cmd)

    if [[ "$status_code" == "$expected_status" ]]; then
        log "SUCCESS" "$description responding correctly ($status_code)"
        return 0
    else
        log "ERROR" "$description failed (expected $expected_status, got $status_code)"
        return 1
    fi
}

check_system_resources() {
    log "INFO" "Checking system resources"

    # Memory usage
    local mem_usage=$(ps -A -o %mem | awk '{s+=$1} END {print s "%"}')
    log "INFO" "Memory usage: $mem_usage"

    # CPU load
    if command -v uptime >/dev/null 2>&1; then
        local load_avg=$(uptime | awk -F'load averages:' '{print $2}' | tr -d ' ')
        log "INFO" "Load average: $load_avg"
    fi

    # Disk usage for current directory
    local disk_usage=$(df . | tail -1 | awk '{print $5}')
    log "INFO" "Disk usage (current): $disk_usage"
}

check_git_status() {
    log "INFO" "Checking Git repository status"

    if git status --porcelain 2>/dev/null | grep -q .; then
        log "WARN" "Repository has uncommitted changes"
        git status --porcelain | head -5 | while IFS= read -r line; do
            log "INFO" "  $line"
        done
    else
        log "SUCCESS" "Repository is clean"
    fi

    # Check if we're ahead of remote
    local ahead=$(git rev-list @{u}.. --count 2>/dev/null || echo "0")
    if [[ "$ahead" -gt 0 ]]; then
        log "WARN" "Repository is $ahead commits ahead of remote"
    else
        log "SUCCESS" "Repository is up to date with remote"
    fi
}

check_dependencies() {
    log "INFO" "Checking critical dependencies"

    local deps=("curl" "git" "node" "ffmpeg")
    local missing=0

    for dep in "${deps[@]}"; do
        if command -v "$dep" >/dev/null 2>&1; then
            local version=$($dep --version 2>/dev/null | head -1 || echo "unknown")
            log "SUCCESS" "$dep available: $version"
        else
            log "ERROR" "$dep not found"
            ((missing++))
        fi
    done

    if [[ $missing -eq 0 ]]; then
        log "SUCCESS" "All dependencies available"
    else
        log "ERROR" "$missing dependencies missing"
    fi
}

main() {
    log "INFO" "🔍 EClaw System Health Check Starting"
    log "INFO" "=============================================="

    local total_checks=0
    local failed_checks=0

    # System Resources
    check_system_resources

    # Dependencies
    ((total_checks++))
    if ! check_dependencies; then
        ((failed_checks++))
    fi

    # Git Status
    check_git_status

    # API Health Checks
    local api_endpoints=(
        "/health|Health endpoint"
        "/api/health|API health"
    )

    for endpoint_desc in "${api_endpoints[@]}"; do
        IFS='|' read -r endpoint desc <<< "$endpoint_desc"
        ((total_checks++))
        if ! check_api_endpoint "$endpoint" "$desc"; then
            ((failed_checks++))
        fi
    done

    # If we have credentials, test authenticated endpoints
    if [[ -n "$DEVICE_SECRET" ]]; then
        ((total_checks++))
        if ! check_api_endpoint "/api/device-vars" "Device variables" 200 "Authorization: Bearer $DEVICE_SECRET"; then
            ((failed_checks++))
        fi
    else
        log "WARN" "DEVICE_SECRET not available - skipping authenticated checks"
    fi

    # Summary
    log "INFO" "=============================================="
    local success_count=$((total_checks - failed_checks))

    if [[ $failed_checks -eq 0 ]]; then
        log "SUCCESS" "🎉 All checks passed ($success_count/$total_checks)"
    else
        log "ERROR" "⚠️  $failed_checks/$total_checks checks failed"
    fi

    log "INFO" "📄 Detailed log saved to: $HEALTH_LOG"

    # Return exit code based on results
    return $failed_checks
}

# Run main function
main "$@"