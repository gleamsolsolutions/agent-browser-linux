# Contributing to Agent Browser Linux

Thank you for your interest in contributing to Agent Browser Linux!

## Development Setup

1. Clone your fork:
   ```bash
   git clone https://github.com/gleamsolsolutions/agent-browser-linux.git
   cd agent-browser-linux
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Link the binary locally for testing:
   ```bash
   npm link
   ```

4. Run tests / help:
   ```bash
   agent-browser help
   ```

## Pull Request Guidelines

- Keep code simple, clean, and dependency-light.
- Verify changes work on Linux desktop (X11 / Wayland).
- Ensure all interactive commands adhere to the numbered snapshot pattern (`[@1]`, `[@2]`).
