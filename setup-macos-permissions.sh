#!/usr/bin/env bash
# setup-macos-permissions.sh
#
# Checks and guides macOS TCC (Downloads folder) permission setup for bun.
# macOS intentionally prevents programmatic granting — this script detects
# the current state and opens System Preferences to the right pane.
#
# Usage: ./setup-macos-permissions.sh

set -euo pipefail

TCC_DB="$HOME/Library/Application Support/com.apple.TCC/TCC.db"
SERVICE="kTCCServiceDownloadsFolder"

# ── Detect current terminal bundle ID ────────────────────────────────────────
detect_terminal() {
    # Check common terminals via $TERM_PROGRAM or process tree
    case "${TERM_PROGRAM:-}" in
        iTerm.app)      echo "com.googlecode.iterm2" ;;
        Apple_Terminal) echo "com.apple.Terminal" ;;
        WarpTerminal)   echo "dev.warp.Warp-Stable" ;;
        vscode)         echo "com.microsoft.VSCode" ;;
        *)
            # Fallback: walk up process tree to find app bundle
            local pid=$PPID
            while [ "$pid" -gt 1 ]; do
                local bundle
                bundle=$(osascript -e "tell application \"System Events\" to get bundle identifier of (processes whose unix id is $pid)" 2>/dev/null | head -1 || true)
                if [ -n "$bundle" ] && [ "$bundle" != "missing value" ]; then
                    echo "$bundle"
                    return
                fi
                pid=$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d ' ' || echo 1)
            done
            echo "com.apple.Terminal"  # safe default
            ;;
    esac
}

# ── Check TCC permission ──────────────────────────────────────────────────────
check_permission() {
    local bundle_id="$1"
    if [ ! -f "$TCC_DB" ]; then
        echo "unknown"
        return
    fi
    # auth_value: 0=deny, 2=allow, 3=limited
    local result
    result=$(sqlite3 "$TCC_DB" \
        "SELECT auth_value FROM access WHERE service='$SERVICE' AND client='$bundle_id' LIMIT 1;" \
        2>/dev/null || echo "")
    case "$result" in
        2) echo "allowed" ;;
        0) echo "denied" ;;
        3) echo "limited" ;;
        *) echo "unset" ;;
    esac
}

# ── Main ──────────────────────────────────────────────────────────────────────
echo ""
echo "EClaw Channel — macOS Downloads Folder Permission Setup"
echo "========================================================"
echo ""

TERMINAL_BUNDLE=$(detect_terminal)
echo "Detected terminal: $TERMINAL_BUNDLE"

PERM=$(check_permission "$TERMINAL_BUNDLE")
echo "Current Downloads folder access: $PERM"
echo ""

case "$PERM" in
    allowed)
        echo "✅ Permission already granted. bun can access the Downloads folder."
        echo "   No action needed."
        ;;
    denied)
        echo "❌ Permission was previously DENIED."
        echo "   You need to re-enable it in System Settings."
        echo ""
        echo "Opening System Settings → Privacy & Security → Files and Folders..."
        open "x-apple.systempreferences:com.apple.preference.security?Privacy_FilesAndFolders"
        echo ""
        echo "Steps:"
        echo "  1. Find your terminal app in the list"
        echo "  2. Enable the 'Downloads Folder' toggle"
        echo "  3. Restart your terminal if prompted"
        ;;
    *)
        echo "ℹ️  Permission not yet set (will prompt on first access)."
        echo ""
        echo "To pre-authorize and avoid the popup, open:"
        echo "  System Settings → Privacy & Security → Files and Folders"
        echo ""
        echo "Opening now..."
        open "x-apple.systempreferences:com.apple.preference.security?Privacy_FilesAndFolders"
        echo ""
        echo "Steps:"
        echo "  1. If your terminal app is listed, enable 'Downloads Folder'"
        echo "  2. If not listed yet, run 'bun install' first — macOS will prompt,"
        echo "     click Allow, then it will appear here for future management"
        ;;
esac

echo ""
echo "Note: macOS does not allow scripts to grant permissions automatically."
echo "      This is by design (security). The one-time manual click is required."
echo ""
