#!/usr/bin/env bash
set -e

INSTALL_DIR="${HOME}/.gemini/config/skills/agent-browser-linux"
BIN_DIR="${HOME}/.local/bin"

echo "Uninstalling Agent Browser Linux..."

rm -f "$BIN_DIR/agent-browser"
rm -f "$BIN_DIR/agent-browser-linux"
rm -rf "$INSTALL_DIR"

echo "Agent Browser Linux uninstalled."
echo "Note: If you also wish to clear saved cookies and profiles, run:"
echo "  rm -rf ~/.config/agent-browser-linux"
