---
name: agent-browser-linux
description: AI Agent & Human Co-Browsing for Linux. Use to open and operate websites, test web apps, fill forms, click buttons, take screenshots, and extract page data using the user's real browser profile and saved logins.
metadata:
  version: "1.1.0"
  os: "linux"
  bootstrap: true
---

# Agent Browser Linux (Co-Browsing Skill)

`agent-browser-linux` is a native Linux tool and skill designed for collaborative human + AI web browsing. It connects AI agents directly to a real Google Chrome instance with a persistent profile.

### Core Capabilities
- **Shared Authentication & Multi-Profile**: Uses persistent profiles stored at `~/.config/agent-browser-linux/profiles/<name>`. Log in once to any service (Google, GitHub, Twitter, AWS, Jira), and sessions persist across tasks.
- **Human-in-the-Loop Collaboration**: Chrome runs as a visible desktop window. If a CAPTCHA, 2FA, or SSO challenge appears, the agent asks the user to complete it in the window, and seamlessly resumes once done.
- **Visual Grounding & Numbered Snapshots**: Generates numbered interactive maps (`[@1]`, `[@2]`, `[@3]`) with Shadow DOM support, and can render visual element badges directly onto screenshots using `--annotated`.
- **Full Observability**: Live inspection of browser console errors (`console`) and network traffic / API requests (`network`).
- **File Automation**: Seamless file uploads (`upload`) and download handling (`download`).
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
| `agent-browser screenshot [path] [--annotated]` | Captures screenshot (optional `--annotated` element badges) | `agent-browser screenshot /tmp/shot.png --annotated` |
| `agent-browser console` | Displays captured page console errors and warnings | `agent-browser console` |
| `agent-browser network` | Lists recent network requests, status, and performance metrics | `agent-browser network` |
| `agent-browser upload <@id \| sel> <file>` | Uploads local file to `<input type="file">` | `agent-browser upload @5 /tmp/document.pdf` |
| `agent-browser download <@id \| sel> [dir]` | Clicks download link/button and waits for file to save | `agent-browser download @7 /tmp/downloads` |
| `agent-browser cookies [export \| import \| clear]` | Manages session cookies (export to JSON, import, or clear) | `agent-browser cookies export /tmp/cookies.json` |
| `agent-browser tabs` | Lists all open tabs | `agent-browser tabs` |
| `agent-browser new-tab [url]` | Opens a new tab | `agent-browser new-tab https://google.com` |
| `agent-browser close-tab [index]` | Closes a specific tab or active tab | `agent-browser close-tab 2` |
| `agent-browser wait <sec \| sel \| networkidle>` | Waits for seconds, selector, or network idle | `agent-browser wait networkidle` |
| `agent-browser eval "<js>"` | Evaluates JavaScript expression in the page context | `agent-browser eval "document.title"` |
| `agent-browser stop` | Closes the Chrome browser instance cleanly | `agent-browser stop` |

### Multi-Profile Support
Pass `--profile <name>` to isolate cookies and browser state per project or client:
```bash
agent-browser --profile personal open https://github.com
agent-browser --profile work open https://internal.corp.com
```

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
1. Take a screenshot: `agent-browser screenshot /tmp/auth-check.png --annotated`
2. Ask the user in chat:
   > *"A verification challenge is displayed in the open Chrome window. Please complete the verification in the browser, and reply here when done."*
3. Once the user replies, run `agent-browser snapshot` to resume the automated workflow.

### 5. Check Console & Network Logs
- Verify no uncaught exceptions: `agent-browser console`
- Verify network status: `agent-browser network`
