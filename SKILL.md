---
name: agent-browser-linux
description: AI Agent & Human Co-Browsing for Linux. Use to open and operate websites, test web apps, fill forms, click buttons, take screenshots, export PDFs, and extract page data using the user's real browser profile and saved logins.
metadata:
  version: "1.2.0"
  os: "linux"
  bootstrap: true
---

# Agent Browser Linux (Co-Browsing Skill)

`agent-browser-linux` is a native Linux tool and skill designed for collaborative human + AI web browsing. It connects AI agents directly to a real Google Chrome instance with a persistent profile.

### Core Capabilities
- **Shared Authentication & Multi-Profile**: Uses persistent profiles stored at `~/.config/agent-browser-linux/profiles/<name>`. Log in once to any service (Google, GitHub, Twitter, AWS, Jira), and sessions persist across tasks.
- **Dual Mode (CLI + Native MCP Server)**: Can be run from terminal commands or as a full Model Context Protocol (MCP) server over `stdio` via `agent-browser mcp`.
- **Human-in-the-Loop Collaboration**: Chrome runs visibly on the desktop. If a CAPTCHA, 2FA, or SSO challenge appears, the agent asks the user to complete it in the window, and seamlessly resumes once done.
- **Hierarchical Tree & Numbered Snapshots**: Generates interactive element maps (`[@1]`, `[@2]`) or structured semantic trees (`--tree`), and can render visual element badges directly onto screenshots using `--annotated`.
- **Responsive Emulation**: Dynamically toggles between mobile, tablet, and desktop viewports (`device mobile`, `device desktop`).
- **Batch AutoFill**: Populates multi-field forms instantly in one single call via `autofill`.
- **Document & Artifact Export**: Prints live web pages directly to vectorized PDF files (`pdf`).
- **Storage & State Inspection**: Complete inspection and control over `localStorage`, `sessionStorage`, and session cookies.

---

## Command Reference

| Command | Description | Example |
| :--- | :--- | :--- |
| `agent-browser open <url>` | Opens URL in the active tab (starts Chrome if needed) | `agent-browser open https://github.com` |
| `agent-browser snapshot [--tree] [limit]` | Interactive elements: flat tags (`[@1]`) or structured tree (`--tree`) | `agent-browser snapshot --tree` |
| `agent-browser click <@id \| text \| sel>` | Clicks an element by `@id` from snapshot, visible text, or selector | `agent-browser click @4` |
| `agent-browser fill <@id \| sel> <text>` | Fills an input or textarea field | `agent-browser fill @2 "search query"` |
| `agent-browser autofill '<json-data>'` | Batch auto-fills multiple form fields simultaneously | `agent-browser autofill '{"email": "user@test.com"}'` |
| `agent-browser type <text>` | Types text directly into the focused element | `agent-browser type "Hello World"` |
| `agent-browser press <Key>` | Presses a keyboard key (`Enter`, `Escape`, `Tab`, etc.) | `agent-browser press Enter` |
| `agent-browser scroll <dir> [px]` | Scrolls page (`down`, `up`, `top`, `bottom`) | `agent-browser scroll down 600` |
| `agent-browser screenshot [path] [--annotated]` | Captures screenshot (optional `--annotated` element badges) | `agent-browser screenshot /tmp/shot.png --annotated` |
| `agent-browser pdf [path]` | Exports current page to a vectorized PDF document | `agent-browser pdf /tmp/document.pdf` |
| `agent-browser device <preset>` | Switches responsive viewport (`mobile`, `tablet`, `desktop`, `iphone`, `pixel`) | `agent-browser device mobile` |
| `agent-browser storage [get \| set \| clear \| dump]` | Inspects or modifies `localStorage` and `sessionStorage` | `agent-browser storage` |
| `agent-browser console` | Displays captured page console errors and warnings | `agent-browser console` |
| `agent-browser network` | Lists recent network requests, status, and performance metrics | `agent-browser network` |
| `agent-browser upload <@id \| sel> <file>` | Uploads local file to `<input type="file">` | `agent-browser upload @5 /tmp/document.pdf` |
| `agent-browser download <@id \| sel> [dir]` | Clicks download link/button and waits for file to save | `agent-browser download @7 /tmp/downloads` |
| `agent-browser cookies [export \| import \| clear]` | Manages session cookies (export to JSON, import, or clear) | `agent-browser cookies export /tmp/cookies.json` |
| `agent-browser wait-nav [pattern] [sec]` | Waits for user or page to navigate to target URL | `agent-browser wait-nav "/dashboard" 60` |
| `agent-browser wait <sec \| sel \| networkidle>` | Waits for seconds, selector, or network idle | `agent-browser wait networkidle` |
| `agent-browser eval "<js>"` | Evaluates JavaScript expression in the page context | `agent-browser eval "document.title"` |
| `agent-browser mcp` | Starts native Model Context Protocol (MCP) server over stdio | `agent-browser mcp` |
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
agent-browser snapshot --tree
```

### 3. Interact Using Batch AutoFill or Numbered Tags
```bash
agent-browser autofill '{"email": "my-account@example.com", "password": "secretPassword"}'
agent-browser click @3
```

### 4. Human-in-the-Loop Verification
If an action requires user intervention (e.g., biometric prompt, SMS/Authenticator 2FA, CAPTCHA):
1. Take a screenshot: `agent-browser screenshot /tmp/auth-check.png --annotated`
2. Wait for completion: `agent-browser wait-nav "/dashboard" 120`
3. Once the target URL is reached, automated execution resumes seamlessly.
