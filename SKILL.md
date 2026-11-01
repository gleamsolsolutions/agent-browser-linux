---
name: agent-browser-linux
description: AI Agent & Human Co-Browsing for Linux. Use to open and operate websites, test web apps, fill forms, click buttons, take screenshots, and extract page data using the user's real browser profile and saved logins.
metadata:
  version: "1.0.0"
  os: "linux"
  bootstrap: true
---

# Agent Browser Linux (Co-Browsing Skill)

`agent-browser-linux` is a native Linux tool and skill designed for collaborative human + AI web browsing. It connects AI agents directly to a real Google Chrome instance with a persistent profile.

### Core Capabilities
- **Shared Authentication**: Uses a persistent profile at `~/.config/agent-browser-linux/profile`. Log in once to any account (Google, GitHub, Twitter, Slack, AWS, Jira) and sessions persist across tasks.
- **Human-in-the-Loop Collaboration**: Chrome runs visibly on the desktop. If a CAPTCHA, 2FA, or SSO challenge appears, the agent asks the user to complete it in the window, and seamlessly resumes once done.
- **Interactive Numbered Snapshot**: Converts complex web pages into an interactive numbered map (`[@1]`, `[@2]`, `[@3]`) for deterministic clicking, selecting, and form filling.
- **Zero-Latency CDP Attach**: Uses the Chrome DevTools Protocol (CDP) to attach to the browser in milliseconds without relaunching.

---

## Command Reference

| Command | Description | Example |
| :--- | :--- | :--- |
| `agent-browser open <url>` | Opens URL in the active tab (starts Chrome if needed) | `agent-browser open https://github.com` |
| `agent-browser snapshot [limit]` | Prints interactive elements with numbered IDs (`[@1]`, `[@2]`) | `agent-browser snapshot 50` |
| `agent-browser text` | Extracts the readable main text content of the page | `agent-browser text` |
| `agent-browser click <@id \| text \| sel>` | Clicks an element by `@id` from snapshot, visible text, or selector | `agent-browser click @4` |
| `agent-browser fill <@id \| sel> <text>` | Fills an input or textarea field | `agent-browser fill @2 "search query"` |
| `agent-browser type <text>` | Types text directly into the focused element | `agent-browser type "Hello World"` |
| `agent-browser press <Key>` | Presses a keyboard key (`Enter`, `Escape`, `Tab`, etc.) | `agent-browser press Enter` |
| `agent-browser scroll <dir> [px]` | Scrolls page (`down`, `up`, `top`, `bottom`) | `agent-browser scroll down 600` |
| `agent-browser screenshot [path]` | Captures viewport or full page screenshot | `agent-browser screenshot /tmp/shot.png` |
| `agent-browser tabs` | Lists all open tabs | `agent-browser tabs` |
| `agent-browser new-tab [url]` | Opens a new tab | `agent-browser new-tab https://google.com` |
| `agent-browser close-tab [index]` | Closes a specific tab or active tab | `agent-browser close-tab 2` |
| `agent-browser wait <sec \| sel>` | Waits for seconds or for a CSS selector to appear | `agent-browser wait 3` |
| `agent-browser eval "<js>"` | Evaluates JavaScript expression in the page context | `agent-browser eval "document.title"` |
| `agent-browser stop` | Closes the Chrome browser instance cleanly | `agent-browser stop` |

*(Note: The alias `agent-browser-linux` can also be used interchangeably).*

---

## Standard Co-Browsing Workflow

When an agent is asked to interact with a website or web app, follow this pattern:

### 1. Open the Target URL
```bash
agent-browser open https://example.com/login
```

### 2. Inspect Interactive Elements
```bash
agent-browser snapshot
```
Output:
```text
Title: Sign in - Example
URL:   https://example.com/login

Interactive Elements (4 visible):
---------------------------------------------------------
[@1] <input> "Username or email" (text)
[@2] <input> "Password" (password)
[@3] <button> "Sign In"
[@4] <a> "Forgot Password?" [https://example.com/reset]
```

### 3. Interact Using Numbered Tags
```bash
agent-browser fill @1 "my-account@example.com"
agent-browser fill @2 "secretPassword"
agent-browser click @3
```

### 4. Human-in-the-Loop Verification
If an action requires user intervention (e.g., biometric prompt, SMS/Authenticator 2FA, CAPTCHA):
1. Take a screenshot: `agent-browser screenshot /tmp/auth-check.png`
2. Ask the user in chat:
   > *"A verification challenge is displayed in the open Chrome window. Please complete the verification in the browser, and reply here when done."*
3. Once the user replies, run `agent-browser snapshot` to resume the automated workflow.

### 5. Extract Content or Inspect
- To read text: `agent-browser text`
- To verify visual layout: `agent-browser screenshot /tmp/result.png`
