# Agent Browser Linux

**AI Agent & Human Co-Browsing for Linux (Antigravity, Claude Code, Cursor, Codex)**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform: Linux](https://img.shields.io/badge/Platform-Linux-orange.svg)](#)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D20-green.svg)](#)
[![Agent: Antigravity](https://img.shields.io/badge/Agent-Antigravity%20Ready-purple.svg)](#)

Agent Browser Linux bridges the gap between AI coding assistants and the live web on Linux. It gives AI agents direct control over a real Google Chrome instance with human-in-the-loop collaboration, persistent session logins, visual element grounding, built-in MCP server mode, and full console/network observability.

---

## Why Agent Browser Linux?

Traditional browser automation for AI agents is either headless (causing bot detection blocks, lost logins, and invisible failures) or locked to macOS and Windows.

**Agent Browser Linux solves this natively for Linux:**
- **Linux-First**: Native support for Linux desktop environments running Wayland or X11.
- **Dual Mode (CLI + Native MCP Server)**: Use it as a command-line tool or as a native Model Context Protocol (MCP) server over stdio via `agent-browser mcp`.
- **Human-in-the-Loop Collaboration**: Chrome runs as a visible desktop window. If a 2FA prompt, CAPTCHA, or SSO check appears, the agent asks you to complete it, and picks right back up.
- **Persistent Authentication**: Sessions and cookies are saved in `~/.config/agent-browser-linux/profiles/<name>`. Log into GitHub, Google, Twitter, AWS, or company portals once, and stay logged in forever.
- **Visual Grounding & Annotated Badges**: Converts pages into interactive maps (`[@1]`, `[@2]`) or structured hierarchical trees (`--tree`), and can render visual element badges directly onto screenshots with `--annotated`.
- **Batch AutoFill**: Match and populate entire complex forms in a single operation via `autofill`.
- **Responsive Device Emulation**: Instantly toggle mobile, tablet, and desktop viewports (`device mobile`, `device desktop`).
- **Web-to-PDF Export**: Export live pages directly to clean vectorized PDF documents (`pdf`).
- **Console & Network Observability**: Directly inspect runtime console errors (`agent-browser console`) and network requests (`agent-browser network`).
- **Storage & Cookie Control**: Deep inspection of `localStorage`, `sessionStorage`, and cookie stores.
- **Zero-Latency CDP Attach**: Connects instantly via Chrome DevTools Protocol (CDP) in milliseconds without restarting the browser.

---

## Quick Install

### One-Line Install (Recommended)
```bash
curl -fsSL https://raw.githubusercontent.com/gleamsolsolutions/agent-browser-linux/main/scripts/install.sh | bash
```

### Manual Install
```bash
# Clone the repository into Antigravity global skills directory
git clone https://github.com/gleamsolsolutions/agent-browser-linux.git ~/.gemini/config/skills/agent-browser-linux

# Install dependencies
cd ~/.gemini/config/skills/agent-browser-linux
npm install --omit=dev

# Make executable and symlink to your local bin
chmod +x bin/agent-browser.mjs
ln -sf ~/.gemini/config/skills/agent-browser-linux/bin/agent-browser.mjs ~/.local/bin/agent-browser
ln -sf ~/.gemini/config/skills/agent-browser-linux/bin/agent-browser.mjs ~/.local/bin/agent-browser-linux
```

---

## Command Reference

| Command | Description | Example |
| :--- | :--- | :--- |
| `open <url>` | Opens URL in the active tab (launches Chrome if needed) | `agent-browser open https://github.com` |
| `snapshot [--tree] [limit]` | Generates numbered interactive elements or hierarchical semantic tree | `agent-browser snapshot --tree` |
| `click <@id \| text \| sel>` | Clicks an element by `@id`, text, or selector | `agent-browser click @3` |
| `fill <@id \| sel> <text>` | Fills an input or textarea | `agent-browser fill @1 "search term"` |
| `autofill '<json-data>'` | Batch auto-fills multiple form fields simultaneously | `agent-browser autofill '{"email": "user@test.com"}'` |
| `type <text>` | Types raw text into the currently focused element | `agent-browser type "hello"` |
| `press <Key>` | Presses a keyboard key (`Enter`, `Escape`, `Tab`, etc.) | `agent-browser press Enter` |
| `scroll <dir> [px]` | Scrolls page (`down`, `up`, `top`, `bottom`) | `agent-browser scroll down 500` |
| `screenshot [path] [--annotated]` | Captures screenshot with optional visual element badges | `agent-browser screenshot /tmp/shot.png --annotated` |
| `pdf [path]` | Exports current page to a vectorized PDF document | `agent-browser pdf /tmp/invoice.pdf` |
| `device <preset>` | Switches responsive viewport (`mobile`, `tablet`, `desktop`, `iphone`, `pixel`) | `agent-browser device mobile` |
| `storage [get \| set \| clear \| dump]` | Inspects or modifies `localStorage` and `sessionStorage` | `agent-browser storage` |
| `console` | Inspects captured JavaScript errors and warnings | `agent-browser console` |
| `network` | Lists active network requests and performance metrics | `agent-browser network` |
| `upload <@id \| sel> <file>` | Uploads local file to `<input type="file">` | `agent-browser upload @4 /path/to/invoice.pdf` |
| `download <@id \| sel> [dir]` | Clicks element and saves downloaded file | `agent-browser download @6 /tmp/downloads` |
| `cookies [export \| import \| clear]` | Exports, imports, or clears session cookies | `agent-browser cookies export ./cookies.json` |
| `wait-nav [pattern] [sec]` | Waits for user or page to navigate to target URL | `agent-browser wait-nav "/dashboard" 60` |
| `wait <sec \| sel \| networkidle>` | Waits for seconds, selector, or network idle state | `agent-browser wait networkidle` |
| `eval "<javascript>"` | Evaluates JavaScript in the browser context | `agent-browser eval "document.title"` |
| `mcp` | Starts native Model Context Protocol (MCP) server over stdio | `agent-browser mcp` |
| `stop` | Cleanly stops the browser process | `agent-browser stop` |

### Multi-Profile Support
Isolate browser states, sessions, and cookies per persona or client using `--profile`:
```bash
agent-browser --profile personal open https://github.com
agent-browser --profile work open https://internal.company.com
```

### Model Context Protocol (MCP) Integration
Add `agent-browser-linux` as an MCP server in Antigravity or Claude Desktop configuration:
```json
{
  "mcpServers": {
    "agent-browser": {
      "command": "agent-browser",
      "args": ["mcp"]
    }
  }
}
```

---

## Contributing

Contributions, bug reports, and suggestions are welcome! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for details.

## License

This project is licensed under the [MIT License](LICENSE) - Copyright (c) 2026 Gleamsol Solutions.
