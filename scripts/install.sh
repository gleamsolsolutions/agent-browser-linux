#!/usr/bin/env bash
set -e

# Agent Browser Linux Installer
# https://github.com/gleamsolsolutions/agent-browser-linux

REPO_URL="https://github.com/gleamsolsolutions/agent-browser-linux.git"
INSTALL_DIR="${HOME}/.gemini/config/skills/agent-browser-linux"
BIN_DIR="${HOME}/.local/bin"

echo "=========================================================="
echo "      Installing Agent Browser Linux (Co-Browsing Skill)  "
echo "=========================================================="

# 1. Check OS
if [ "$(uname -s)" != "Linux" ]; then
  echo "Error: Agent Browser Linux is specifically built for Linux (X11 / Wayland)."
  exit 1
fi

# 2. Check Node.js
if ! command -v node >/dev/null 2>&1; then
  echo "Error: Node.js (>= 20) is required. Please install Node.js first."
  exit 1
fi

NODE_VER=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VER" -lt 20 ]; then
  echo "Warning: Node.js version is $NODE_VER. Recommended version is 20 or higher."
fi

# 3. Check for Chrome / Chromium
CHROME_FOUND=false
for p in /usr/bin/google-chrome /usr/bin/google-chrome-stable /usr/bin/chromium /usr/bin/chromium-browser /snap/bin/chromium; do
  if [ -x "$p" ]; then
    CHROME_FOUND=true
    echo "Found browser at: $p"
    break
  fi
done

if [ "$CHROME_FOUND" = false ]; then
  echo "Notice: Google Chrome or Chromium was not detected in standard paths."
  echo "Please install Google Chrome: sudo apt install google-chrome-stable"
fi

# 4. Create target directories
mkdir -p "$INSTALL_DIR"
mkdir -p "$BIN_DIR"

# 5. Clone or copy files
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PARENT_DIR="$(dirname "$SCRIPT_DIR")"

if [ -f "$PARENT_DIR/package.json" ]; then
  echo "Installing from local source: $PARENT_DIR"
  cp -r "$PARENT_DIR/bin" "$INSTALL_DIR/"
  cp -r "$PARENT_DIR/scripts" "$INSTALL_DIR/"
  cp "$PARENT_DIR/package.json" "$INSTALL_DIR/"
  cp "$PARENT_DIR/SKILL.md" "$INSTALL_DIR/"
  cp "$PARENT_DIR/README.md" "$INSTALL_DIR/"
  cp "$PARENT_DIR/LICENSE" "$INSTALL_DIR/" 2>/dev/null || true
else
  echo "Cloning repository from GitHub..."
  rm -rf "$INSTALL_DIR"
  git clone "$REPO_URL" "$INSTALL_DIR"
fi

# 6. Install npm dependencies
echo "Installing dependencies..."
cd "$INSTALL_DIR"
npm install --omit=dev

# 7. Symlink CLI binaries
chmod +x "$INSTALL_DIR/bin/agent-browser.mjs"
ln -sf "$INSTALL_DIR/bin/agent-browser.mjs" "$BIN_DIR/agent-browser"
ln -sf "$INSTALL_DIR/bin/agent-browser.mjs" "$BIN_DIR/agent-browser-linux"

echo ""
echo "=========================================================="
echo "    Agent Browser Linux Installed Successfully!           "
echo "=========================================================="
echo "Skill directory:  $INSTALL_DIR"
echo "CLI binary:       $BIN_DIR/agent-browser"
echo "Alias:            $BIN_DIR/agent-browser-linux"
echo ""

if [[ ":$PATH:" != *":$BIN_DIR:"* ]]; then
  echo "Note: Add $BIN_DIR to your PATH by adding this line to ~/.bashrc or ~/.zshrc:"
  echo "  export PATH=\"\$HOME/.local/bin:\$PATH\""
  echo ""
fi

echo "Quick test:"
echo "  agent-browser help"
echo "  agent-browser open https://news.ycombinator.com"
echo "  agent-browser snapshot"
echo ""
