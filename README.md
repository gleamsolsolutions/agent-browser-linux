# Agent Browser Linux

**AI Agent & Human Co-Browsing for Linux (Antigravity, Claude Code, Cursor, Codex)**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform: Linux](https://img.shields.io/badge/Platform-Linux-orange.svg)](#)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D20-green.svg)](#)
[![Agent: Antigravity](https://img.shields.io/badge/Agent-Antigravity%20Ready-purple.svg)](#)

Agent Browser Linux bridges the gap between AI coding assistants and the live web on Linux. It gives AI agents direct control over a real Google Chrome instance with human-in-the-loop collaboration, persistent session logins, visual element grounding, and full console/network observability.

---

## Why Agent Browser Linux?

Traditional browser automation for AI agents is either headless (causing bot detection blocks, lost logins, and invisible failures) or locked to macOS and Windows.

**Agent Browser Linux solves this natively for Linux:**
- **Linux-First**: Native support for Linux desktop environments running Wayland or X11.
- **Human-in-the-Loop Collaboration**: Chrome runs as a visible desktop window. If a 2FA prompt, CAPTCHA, or SSO check appears, the agent asks you to complete it, and picks right back up.
- **Persistent Authentication**: Sessions and cookies are saved in `~/.config/agent-browser-linux/profiles/<name>`. Log into GitHub, Google, Twitter, AWS, or company portals once, and stay logged in forever.
- **Visual Grounding & Annotated Badges**: Converts pages into interactive maps (`[@1]`, `[@2]`) and can render visual element badges directly onto screenshots with `--annotated`.
- **Console & Network Observability**: Directly inspect runtime console errors (`agent-browser console`) and network requests (`agent-browser network`).
- **File Automation**: First-class support for file uploads (`upload`) and file download handling (`download`).
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
| `snapshot [limit]` | Generates numbered interactive elements (`[@1]`, `[@2]`) | `agent-browser snapshot 50` |
| `click <@id \| text \| sel>` | Clicks an element by `@id`, text, or selector | `agent-browser click @3` |
| `fill <@id \| sel> <text>` | Fills an input or textarea | `agent-browser fill @1 "search term"` |
| `type <text>` | Types raw text into the currently focused element | `agent-browser type "hello"` |
| `press <Key>` | Presses a keyboard key (`Enter`, `Escape`, `Tab`, etc.) | `agent-browser press Enter` |
| `scroll <dir> [px]` | Scrolls page (`down`, `up`, `top`, `bottom`) | `agent-browser scroll down 500` |
| `screenshot [path] [--annotated]` | Captures screenshot with optional visual element badges | `agent-browser screenshot /tmp/shot.png --annotated` |
| `console` | Inspects captured JavaScript errors and warnings | `agent-browser console` |
| `network` | Lists active network requests and performance metrics | `agent-browser network` |
| `upload <@id \| sel> <file>` | Uploads local file to `<input type="file">` | `agent-browser upload @4 /path/to/invoice.pdf` |
| `download <@id \| sel> [dir]` | Clicks element and saves downloaded file | `agent-browser download @6 /tmp/downloads` |
| `cookies [export \| import \| clear]` | Exports, imports, or clears session cookies | `agent-browser cookies export ./cookies.json` |
| `text` | Extracts readable text of the page | `agent-browser text` |
| `tabs` | Lists all open browser tabs | `agent-browser tabs` |
| `new-tab [url]` | Opens a new browser tab | `agent-browser new-tab https://google.com` |
| `close-tab [index]` | Closes active or specified tab | `agent-browser close-tab 1` |
| `wait <sec \| sel \| networkidle>` | Waits for seconds, selector, or network idle state | `agent-browser wait networkidle` |
| `eval "<javascript>"` | Evaluates JavaScript in the browser context | `agent-browser eval "document.title"` |
| `stop` | Cleanly stops the browser process | `agent-browser stop` |

### Multi-Profile Support
Isolate browser states, sessions, and cookies per persona or client using `--profile`:
```bash
agent-browser --profile personal open https://github.com
agent-browser --profile work open https://internal.company.com
```

---

## Architecture

```
┌────────────────────────────────────────────────────────┐
│                   AI Agent (Antigravity)               │
│               Reads SKILL.md instructions              │
└───────────────────────────┬────────────────────────────┘
                            │ CLI commands
                            ▼
┌────────────────────────────────────────────────────────┐
│             Agent Browser CLI (Node.js)                │
│     • Visual Element Badging  • Shadow DOM Traversal   │
│     • Console / Network Taps  • File Upload / Download │
│     • Session / Cookie Store  • Multi-Profile Manager  │
└───────────────────────────┬────────────────────────────┘
                            │ Chrome DevTools Protocol (CDP)
                            ▼
┌────────────────────────────────────────────────────────┐
│              Google Chrome (Linux GUI)                 │
│   • Visible window (Wayland / X11)                     │
│   • Persistent profiles (~/.config/agent-browser-linux)│
│   • User-in-the-loop (Logins, 2FA, CAPTCHA)            │
└───────────────────────────┘
```

---

## Contributing

Contributions, bug reports, and suggestions are welcome! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for details.

## License

This project is licensed under the [MIT License](LICENSE) - Copyright (c) 2026 Gleamsol Solutions.
