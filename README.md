# Agent Browser Linux

**AI Agent & Human Co-Browsing for Linux (Antigravity, Claude Code, Cursor, Codex)**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform: Linux](https://img.shields.io/badge/Platform-Linux-orange.svg)](#)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D20-green.svg)](#)
[![Agent: Antigravity](https://img.shields.io/badge/Agent-Antigravity%20Ready-purple.svg)](#)

Agent Browser Linux bridges the gap between AI coding assistants and the live web on Linux. It gives AI agents direct control over a real Google Chrome instance with human-in-the-loop collaboration, persistent session logins, and numbered accessibility snapshots.

---

## Why Agent Browser Linux?

Traditional browser automation for AI agents is either headless (causing bot detection blocks, lost logins, and invisible failures) or locked to macOS and Windows.

**Agent Browser Linux solves this natively for Linux:**
- **Linux-First**: Native support for Linux desktop environments running Wayland or X11.
- **Human-in-the-Loop Collaboration**: Chrome runs as a visible desktop window. If a 2FA prompt, CAPTCHA, or SSO check appears, the agent asks you to complete it, and picks right back up.
- **Persistent Authentication**: Sessions and cookies are saved in `~/.config/agent-browser-linux/profile`. Log into GitHub, Google, Twitter, AWS, or your internal company portals once, and your agent stays logged in forever.
- **Numbered DOM Snapshots**: Converts pages into an interactive map (`[@1]`, `[@2]`, `[@3]`) so agents can click, fill, and navigate deterministically.
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
| `screenshot [path]` | Saves a screenshot of the current page | `agent-browser screenshot /tmp/page.png` |
| `text` | Extracts readable text of the page | `agent-browser text` |
| `tabs` | Lists all open browser tabs | `agent-browser tabs` |
| `new-tab [url]` | Opens a new browser tab | `agent-browser new-tab https://google.com` |
| `close-tab [index]` | Closes active or specified tab | `agent-browser close-tab 1` |
| `wait <sec \| sel>` | Waits for seconds or a CSS selector to appear | `agent-browser wait 3` |
| `eval "<javascript>"` | Evaluates JavaScript in the browser context | `agent-browser eval "document.title"` |
| `stop` | Cleanly stops the browser process | `agent-browser stop` |

*(Note: Both `agent-browser` and `agent-browser-linux` can be used interchangeably).*

---

## Using with AI Agents (Antigravity, Claude Code, Cursor)

Once installed, your agent will automatically recognize the `agent-browser-linux` skill. You can prompt naturally:

### Example Prompts:
- *"Using agent-browser, open my GitHub dashboard and check the latest pull requests."*
- *"Navigate to https://news.ycombinator.com, find the top AI post, and summarize the comments."*
- *"Open our staging environment, sign in, fill out the user creation form, and take a screenshot of the confirmation page."*

### Agent Workflow Under the Hood:
```
User Prompt: "Check my notifications on GitHub"
   │
   ▼
1. Agent runs: `agent-browser open https://github.com/notifications`
   └─ Visible Chrome window opens on Linux desktop with saved session.
   │
2. Agent runs: `agent-browser snapshot`
   └─ Receives numbered interactive elements:
      [@1] Tab "Inbox"
      [@2] Tab "Saved"
      [@3] Link "PR #42: Add co-browsing support"
   │
3. Agent runs: `agent-browser click @3`
   └─ Navigates to PR #42.
   │
4. Agent runs: `agent-browser text`
   └─ Extracts discussion and reports findings to user.
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
│     • Snapshot Engine   • Interactive Element Tagging  │
│     • Session Manager   • Form & Navigation Dispatch   │
└───────────────────────────┬────────────────────────────┘
                            │ Chrome DevTools Protocol (CDP)
                            ▼
┌────────────────────────────────────────────────────────┐
│              Google Chrome (Linux GUI)                 │
│   • Visible window (Wayland / X11)                     │
│   • Persistent profile (~/.config/agent-browser-linux) │
│   • User-in-the-loop (Logins, 2FA, CAPTCHA)            │
└────────────────────────────────────────────────────────┘
```

---

## Contributing

Contributions, bug reports, and suggestions are welcome! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for details.

## License

This project is licensed under the [MIT License](LICENSE) - Copyright (c) 2026 Gleamsol Solutions.
