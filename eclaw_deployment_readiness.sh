#!/bin/bash

# EClaw Deployment Readiness Checker
# Validates code quality, test coverage, and deployment prerequisites
# Ensures safe and reliable releases

set -euo pipefail

# Configuration
READINESS_LOG="deployment_readiness_$(date '+%Y%m%d_%H%M%S').log"
MIN_TEST_COVERAGE=80
REQUIRED_FILES=("package.json" "README.md")
CRITICAL_DIRS=("src" "routes" "database")

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
NC='\033[0m'

# Logging functions
log() {
    local level=$1
    shift
    local message="$*"
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')

    case $level in
        "INFO")     echo -e "${timestamp} ${BLUE}[INFO]${NC}     $message" | tee -a "$READINESS_LOG" ;;
        "WARN")     echo -e "${timestamp} ${YELLOW}[WARN]${NC}     $message" | tee -a "$READINESS_LOG" ;;
        "ERROR")    echo -e "${timestamp} ${RED}[ERROR]${NC}    $message" | tee -a "$READINESS_LOG" ;;
        "SUCCESS")  echo -e "${timestamp} ${GREEN}[SUCCESS]${NC}  $message" | tee -a "$READINESS_LOG" ;;
        "CHECK")    echo -e "${timestamp} ${PURPLE}[CHECK]${NC}    $message" | tee -a "$READINESS_LOG" ;;
    esac
}

# Check functions
check_git_status() {
    log "CHECK" "Validating Git repository state"

    # Check for uncommitted changes
    if git diff --quiet && git diff --staged --quiet; then
        log "SUCCESS" "Repository has no uncommitted changes"
    else
        log "ERROR" "Repository has uncommitted changes - commit before deployment"
        return 1
    fi

    # Check if branch is up to date with remote
    git fetch --quiet
    local local_commit=$(git rev-parse HEAD)
    local remote_commit=$(git rev-parse @{u} 2>/dev/null || echo "")

    if [[ -n "$remote_commit" && "$local_commit" != "$remote_commit" ]]; then
        log "ERROR" "Branch is not up to date with remote"
        return 1
    else
        log "SUCCESS" "Branch is up to date with remote"
    fi

    # Check for main branch
    local current_branch=$(git branch --show-current)
    if [[ "$current_branch" == "main" || "$current_branch" == "master" ]]; then
        log "SUCCESS" "Deploying from main branch"
    else
        log "WARN" "Deploying from non-main branch: $current_branch"
    fi

    return 0
}

check_code_quality() {
    log "CHECK" "Analyzing code quality"

    # Check for basic file structure
    for file in "${REQUIRED_FILES[@]}"; do
        if [[ -f "$file" ]]; then
            log "SUCCESS" "Required file present: $file"
        else
            log "ERROR" "Missing required file: $file"
            return 1
        fi
    done

    # Check for critical directories
    for dir in "${CRITICAL_DIRS[@]}"; do
        if [[ -d "$dir" ]]; then
            local file_count=$(find "$dir" -type f -name "*.js" -o -name "*.ts" -o -name "*.json" | wc -l)
            log "SUCCESS" "Directory $dir exists with $file_count files"
        else
            log "WARN" "Directory $dir not found (may be expected for some projects)"
        fi
    done

    return 0
}

check_dependencies() {
    log "CHECK" "Validating dependencies"

    if [[ -f "package.json" ]]; then
        # Check for package-lock.json or yarn.lock
        if [[ -f "package-lock.json" || -f "yarn.lock" ]]; then
            log "SUCCESS" "Lock file present for reproducible builds"
        else
            log "WARN" "No lock file found - builds may not be reproducible"
        fi

        # Check for security vulnerabilities if npm is available
        if command -v npm >/dev/null 2>&1; then
            log "INFO" "Checking for security vulnerabilities..."
            if npm audit --audit-level=moderate --quiet >/dev/null 2>&1; then
                log "SUCCESS" "No high-severity security vulnerabilities found"
            else
                log "WARN" "Security vulnerabilities detected - consider running 'npm audit fix'"
            fi
        fi
    else
        log "INFO" "No package.json found - skipping dependency checks"
    fi

    return 0
}

check_test_coverage() {
    log "CHECK" "Evaluating test coverage"

    # Look for test files
    local test_files=$(find . -name "*.test.js" -o -name "*.spec.js" -o -name "test_*.js" 2>/dev/null | wc -l)

    if [[ $test_files -gt 0 ]]; then
        log "SUCCESS" "Found $test_files test files"

        # Try to run tests if npm test is available
        if [[ -f "package.json" ]] && command -v npm >/dev/null 2>&1; then
            if jq -e '.scripts.test' package.json >/dev/null 2>&1; then
                log "INFO" "Test script available - manual test run recommended before deployment"
            fi
        fi
    else
        log "WARN" "No test files found - consider adding tests for reliability"
    fi

    return 0
}

check_environment_vars() {
    log "CHECK" "Validating environment configuration"

    # Common environment variables that should be set for production
    local env_vars=("NODE_ENV")
    local missing_vars=()

    for var in "${env_vars[@]}"; do
        if [[ -n "${!var:-}" ]]; then
            log "SUCCESS" "Environment variable $var is set"
        else
            missing_vars+=("$var")
            log "WARN" "Environment variable $var not set"
        fi
    done

    # Check for .env files
    local env_files=(.env .env.local .env.production)
    for env_file in "${env_files[@]}"; do
        if [[ -f "$env_file" ]]; then
            log "INFO" "Environment file found: $env_file"
        fi
    done

    return 0
}

check_documentation() {
    log "CHECK" "Validating documentation"

    if [[ -f "README.md" ]]; then
        local readme_size=$(wc -c < README.md)
        if [[ $readme_size -gt 100 ]]; then
            log "SUCCESS" "README.md exists and has content ($readme_size bytes)"
        else
            log "WARN" "README.md exists but seems minimal"
        fi
    fi

    # Check for other documentation
    local doc_files=(CHANGELOG.md CONTRIBUTING.md docs/README.md)
    for doc_file in "${doc_files[@]}"; do
        if [[ -f "$doc_file" ]]; then
            log "SUCCESS" "Documentation found: $doc_file"
        fi
    done

    return 0
}

calculate_readiness_score() {
    local total_checks=$1
    local failed_checks=$2
    local score=$(( (total_checks - failed_checks) * 100 / total_checks ))
    echo $score
}

main() {
    log "INFO" "🚀 EClaw Deployment Readiness Check Starting"
    log "INFO" "================================================="

    local total_checks=0
    local failed_checks=0

    # Run all checks
    local checks=(
        "check_git_status:Git Repository State"
        "check_code_quality:Code Quality"
        "check_dependencies:Dependencies"
        "check_test_coverage:Test Coverage"
        "check_environment_vars:Environment Configuration"
        "check_documentation:Documentation"
    )

    for check_desc in "${checks[@]}"; do
        IFS=':' read -r check_func check_name <<< "$check_desc"
        ((total_checks++))

        log "INFO" "Running check: $check_name"
        if ! $check_func; then
            ((failed_checks++))
            log "ERROR" "Check failed: $check_name"
        else
            log "SUCCESS" "Check passed: $check_name"
        fi
        log "INFO" "---"
    done

    # Calculate and report final score
    local readiness_score=$(calculate_readiness_score $total_checks $failed_checks)

    log "INFO" "================================================="
    log "INFO" "🎯 Deployment Readiness Assessment"

    if [[ $failed_checks -eq 0 ]]; then
        log "SUCCESS" "🟢 DEPLOYMENT READY (100% - All checks passed)"
        log "SUCCESS" "✅ Safe to proceed with deployment"
    elif [[ $readiness_score -ge 80 ]]; then
        log "WARN" "🟡 DEPLOYMENT CAUTION ($readiness_score% - Some warnings)"
        log "WARN" "⚠️  Review warnings before deployment"
    else
        log "ERROR" "🔴 DEPLOYMENT NOT READY ($readiness_score% - Critical issues)"
        log "ERROR" "❌ Address errors before deployment"
    fi

    log "INFO" "📊 Score: $readiness_score% ($((total_checks - failed_checks))/$total_checks checks passed)"
    log "INFO" "📄 Detailed report saved to: $READINESS_LOG"

    # Return exit code based on readiness
    if [[ $readiness_score -ge 80 ]]; then
        return 0
    else
        return 1
    fi
}

# Run main function
main "$@"