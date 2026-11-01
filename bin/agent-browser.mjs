#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { homedir } from 'node:os';
import { chromium } from 'playwright-core';

// Parse profile argument: --profile <name>
function getProfileConfig() {
  const args = process.argv.slice(2);
  let profile = 'default';
  const filteredArgs = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--profile' && args[i + 1]) {
      profile = args[i + 1];
      i++;
    } else if (args[i].startsWith('--profile=')) {
      profile = args[i].split('=')[1];
    } else {
      filteredArgs.push(args[i]);
    }
  }

  // Calculate distinct port for profile if not default
  let port = 9222;
  if (profile !== 'default') {
    let hash = 0;
    for (let i = 0; i < profile.length; i++) {
      hash = (hash << 5) - hash + profile.charCodeAt(i);
      hash |= 0;
    }
    port = 9230 + (Math.abs(hash) % 50);
  }

  const profileDir = resolve(homedir(), '.config/agent-browser-linux/profiles', profile);
  return { profile, port, profileDir, args: filteredArgs };
}

const { profile: ACTIVE_PROFILE, port: CDP_PORT, profileDir: PROFILE_DIR, args: CLI_ARGS } = getProfileConfig();
const CDP_URL = `http://127.0.0.1:${CDP_PORT}`;
const SCREENSHOT_DEFAULT = '/tmp/agent-browser-screenshot.png';

const CHROME_PATHS = [
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/snap/bin/chromium'
];

function findChromePath() {
  for (const p of CHROME_PATHS) {
    if (existsSync(p)) return p;
  }
  return 'google-chrome';
}

async function isBrowserRunning() {
  try {
    const res = await fetch(`${CDP_URL}/json/version`, { signal: AbortSignal.timeout(1000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function ensureBrowser(headless = false) {
  if (await isBrowserRunning()) return;

  if (!existsSync(PROFILE_DIR)) {
    mkdirSync(PROFILE_DIR, { recursive: true });
  }

  const chromeExecutable = findChromePath();
  const args = [
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${PROFILE_DIR}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--start-maximized',
    '--window-size=1440,900',
    '--disable-blink-features=AutomationControlled',
    '--disable-infobars'
  ];

  if (headless) {
    args.push('--headless=new');
  }

  const child = spawn(chromeExecutable, args, {
    detached: true,
    stdio: 'ignore'
  });
  child.unref();

  const start = Date.now();
  while (Date.now() - start < 15000) {
    if (await isBrowserRunning()) {
      return;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Failed to start Chrome with remote debugging on port ${CDP_PORT}`);
}

async function getBrowserSession() {
  await ensureBrowser();
  const browser = await chromium.connectOverCDP(CDP_URL);
  const contexts = browser.contexts();
  const context = contexts[0] || (await browser.newContext());
  
  // Attach stealth & console capture init scripts
  await context.addInitScript(() => {
    try {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    } catch {}

    if (!window.__agent_console_logs) {
      window.__agent_console_logs = [];
      const origErr = console.error;
      const origWarn = console.warn;
      console.error = (...args) => {
        try {
          window.__agent_console_logs.push({
            type: 'error',
            time: new Date().toISOString(),
            message: args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ')
          });
        } catch {}
        origErr.apply(console, args);
      };
      console.warn = (...args) => {
        try {
          window.__agent_console_logs.push({
            type: 'warn',
            time: new Date().toISOString(),
            message: args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ')
          });
        } catch {}
        origWarn.apply(console, args);
      };
    }
  });

  const pages = context.pages();
  const page = pages[pages.length - 1] || (await context.newPage());
  return { browser, context, page };
}

// Interactive element extractor with Shadow DOM & recursive container support
async function getInteractiveSnapshot(page, maxElements = 60) {
  return await page.evaluate((max) => {
    document.querySelectorAll('[data-agent-id]').forEach((el) => el.removeAttribute('data-agent-id'));

    const isVisible = (el) => {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.visibility !== 'hidden' &&
        style.display !== 'none' &&
        style.opacity !== '0' &&
        rect.bottom >= 0 &&
        rect.top <= (window.innerHeight || document.documentElement.clientHeight) + 150
      );
    };

    const selector = [
      'a[href]',
      'button',
      'input:not([type="hidden"])',
      'textarea',
      'select',
      '[role="button"]',
      '[role="link"]',
      '[role="checkbox"]',
      '[role="radio"]',
      '[role="menuitem"]',
      '[role="tab"]',
      '[role="textbox"]',
      '[contenteditable="true"]',
      '[tabindex="0"]'
    ].join(', ');

    // Collect interactive elements including Shadow DOM
    function collectInteractive(root, list = []) {
      const items = root.querySelectorAll ? Array.from(root.querySelectorAll(selector)) : [];
      for (const el of items) {
        if (isVisible(el)) list.push(el);
      }
      const all = root.querySelectorAll ? Array.from(root.querySelectorAll('*')) : [];
      for (const el of all) {
        if (el.shadowRoot) {
          collectInteractive(el.shadowRoot, list);
        }
      }
      return list;
    }

    const visible = collectInteractive(document);

    const items = visible.slice(0, max).map((el, idx) => {
      const id = idx + 1;
      el.setAttribute('data-agent-id', String(id));
      const tag = el.tagName.toLowerCase();
      const role = el.getAttribute('role') || tag;
      const type = el.getAttribute('type') || '';

      const label = (
        el.getAttribute('aria-label') ||
        el.getAttribute('placeholder') ||
        el.getAttribute('title') ||
        el.innerText ||
        el.value ||
        ''
      )
        .trim()
        .replace(/\s+/g, ' ')
        .slice(0, 80);

      let extra = '';
      if (tag === 'a' && el.getAttribute('href')) {
        const href = el.getAttribute('href');
        extra = ` [${href.length > 50 ? href.slice(0, 50) + '...' : href}]`;
      } else if (type) {
        extra = ` (${type})`;
      }

      if (el.disabled) extra += ' [disabled]';
      if (el.checked) extra += ' [checked]';

      return {
        id,
        role,
        label,
        extra
      };
    });

    return {
      title: document.title,
      url: window.location.href,
      totalFound: visible.length,
      items
    };
  }, maxElements);
}

// Commands
const commands = {
  async start(args) {
    const headless = args.includes('--headless');
    await ensureBrowser(headless);
    console.log(`Browser started for profile "${ACTIVE_PROFILE}" (${headless ? 'headless' : 'maximized GUI'} on port ${CDP_PORT}).`);
    console.log(`Profile directory: ${PROFILE_DIR}`);
  },

  async open(args) {
    const url = args[0];
    if (!url) throw new Error('Usage: agent-browser open <url>');
    const targetUrl = url.startsWith('http') ? url : `https://${url}`;
    const { browser, page } = await getBrowserSession();
    try {
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      console.log(`Navigated to: ${page.url()}`);
      console.log(`Title: ${await page.title()}`);
    } finally {
      await browser.close();
    }
  },

  async snapshot(args) {
    const limit = parseInt(args[0], 10) || 50;
    const { browser, page } = await getBrowserSession();
    try {
      const snap = await getInteractiveSnapshot(page, limit);
      console.log(`Title: ${snap.title}`);
      console.log(`URL:   ${snap.url}`);
      console.log(`\nInteractive Elements (${snap.items.length} visible of ${snap.totalFound}):`);
      console.log('---------------------------------------------------------');
      for (const item of snap.items) {
        console.log(`[@${item.id}] <${item.role}> ${item.label ? `"${item.label}"` : '(unlabeled)'}${item.extra}`);
      }
      if (snap.totalFound > snap.items.length) {
        console.log(`... and ${snap.totalFound - snap.items.length} more elements. Use scroll or agent-browser snapshot 100.`);
      }
    } finally {
      await browser.close();
    }
  },

  async text() {
    const { browser, page } = await getBrowserSession();
    try {
      const content = await page.evaluate(() => {
        return document.body ? document.body.innerText.trim() : '';
      });
      console.log(`Title: ${await page.title()}`);
      console.log(`URL:   ${page.url()}\n`);
      console.log(content.slice(0, 5000));
      if (content.length > 5000) {
        console.log(`\n... [truncated ${content.length - 5000} characters]`);
      }
    } finally {
      await browser.close();
    }
  },

  async click(args) {
    const target = args[0];
    if (!target) throw new Error('Usage: agent-browser click <@id | text | selector>');
    const { browser, page } = await getBrowserSession();
    try {
      if (target.startsWith('@') || /^\d+$/.test(target)) {
        const id = target.replace('@', '');
        const selector = `[data-agent-id="${id}"]`;
        await page.click(selector, { timeout: 10000 });
        console.log(`Clicked element @${id}`);
      } else {
        try {
          await page.click(target, { timeout: 4000 });
          console.log(`Clicked selector: ${target}`);
        } catch {
          await page.click(`text="${target}"`, { timeout: 6000 });
          console.log(`Clicked text: "${target}"`);
        }
      }
      await page.waitForTimeout(500);
      console.log(`Active URL: ${page.url()}`);
    } finally {
      await browser.close();
    }
  },

  async fill(args) {
    const target = args[0];
    const value = args.slice(1).join(' ');
    if (!target) throw new Error('Usage: agent-browser fill <@id | selector> <text>');
    const { browser, page } = await getBrowserSession();
    try {
      const selector = target.startsWith('@') || /^\d+$/.test(target)
        ? `[data-agent-id="${target.replace('@', '')}"]`
        : target;
      await page.fill(selector, value, { timeout: 10000 });
      console.log(`Filled ${target} with "${value}"`);
    } finally {
      await browser.close();
    }
  },

  async type(args) {
    const text = args.join(' ');
    if (!text) throw new Error('Usage: agent-browser type <text>');
    const { browser, page } = await getBrowserSession();
    try {
      await page.keyboard.type(text);
      console.log(`Typed: "${text}"`);
    } finally {
      await browser.close();
    }
  },

  async press(args) {
    const key = args[0];
    if (!key) throw new Error('Usage: agent-browser press <Key>');
    const { browser, page } = await getBrowserSession();
    try {
      await page.keyboard.press(key);
      console.log(`Pressed key: ${key}`);
      await page.waitForTimeout(500);
    } finally {
      await browser.close();
    }
  },

  async scroll(args) {
    const direction = args[0] || 'down';
    const amount = parseInt(args[1], 10) || 500;
    const { browser, page } = await getBrowserSession();
    try {
      if (direction === 'top') {
        await page.evaluate(() => window.scrollTo(0, 0));
        console.log('Scrolled to top');
      } else if (direction === 'bottom') {
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        console.log('Scrolled to bottom');
      } else if (direction === 'up') {
        await page.evaluate((y) => window.scrollBy(0, -y), amount);
        console.log(`Scrolled up by ${amount}px`);
      } else {
        await page.evaluate((y) => window.scrollBy(0, y), amount);
        console.log(`Scrolled down by ${amount}px`);
      }
    } finally {
      await browser.close();
    }
  },

  async screenshot(args) {
    const isAnnotated = args.includes('--annotated');
    const isFull = args.includes('--full');
    const pathArg = args.find((a) => !a.startsWith('--'));
    const outPath = pathArg ? resolve(process.cwd(), pathArg) : SCREENSHOT_DEFAULT;

    const { browser, page } = await getBrowserSession();
    try {
      if (isAnnotated) {
        // Tag visible elements
        await getInteractiveSnapshot(page, 80);
        // Inject visual badges overlay
        await page.evaluate(() => {
          const container = document.createElement('div');
          container.id = '__agent_annotated_overlay';
          container.style.position = 'absolute';
          container.style.top = '0';
          container.style.left = '0';
          container.style.width = '100%';
          container.style.height = document.documentElement.scrollHeight + 'px';
          container.style.pointerEvents = 'none';
          container.style.zIndex = '2147483647';

          document.querySelectorAll('[data-agent-id]').forEach((el) => {
            const rect = el.getBoundingClientRect();
            const id = el.getAttribute('data-agent-id');
            const badge = document.createElement('div');
            badge.innerText = id;
            badge.style.position = 'absolute';
            badge.style.left = `${rect.left + window.scrollX}px`;
            badge.style.top = `${rect.top + window.scrollY}px`;
            badge.style.background = '#2563eb';
            badge.style.color = '#ffffff';
            badge.style.fontSize = '12px';
            badge.style.fontWeight = 'bold';
            badge.style.padding = '1px 5px';
            badge.style.borderRadius = '3px';
            badge.style.border = '1px solid #ffffff';
            badge.style.boxShadow = '0 2px 4px rgba(0,0,0,0.5)';
            badge.style.lineHeight = '14px';

            const box = document.createElement('div');
            box.style.position = 'absolute';
            box.style.left = `${rect.left + window.scrollX}px`;
            box.style.top = `${rect.top + window.scrollY}px`;
            box.style.width = `${rect.width}px`;
            box.style.height = `${rect.height}px`;
            box.style.border = '2px solid rgba(37, 99, 235, 0.7)';
            box.style.boxSizing = 'border-box';

            container.appendChild(box);
            container.appendChild(badge);
          });

          document.body.appendChild(container);
        });
      }

      await page.screenshot({ path: outPath, fullPage: isFull });

      if (isAnnotated) {
        await page.evaluate(() => {
          document.getElementById('__agent_annotated_overlay')?.remove();
        });
      }

      console.log(`Screenshot saved to: ${outPath} ${isAnnotated ? '(with visual element badges)' : ''}`);
    } finally {
      await browser.close();
    }
  },

  async upload(args) {
    const target = args[0];
    const filePath = args[1];
    if (!target || !filePath) throw new Error('Usage: agent-browser upload <@id | selector> <filepath>');

    const resolvedFile = resolve(process.cwd(), filePath);
    if (!existsSync(resolvedFile)) {
      throw new Error(`File not found: ${resolvedFile}`);
    }

    const { browser, page } = await getBrowserSession();
    try {
      const selector = target.startsWith('@') || /^\d+$/.test(target)
        ? `[data-agent-id="${target.replace('@', '')}"]`
        : target;

      await page.setInputFiles(selector, resolvedFile);
      console.log(`Uploaded "${resolvedFile}" to ${target}`);
    } finally {
      await browser.close();
    }
  },

  async download(args) {
    const target = args[0];
    const outDir = args[1] ? resolve(process.cwd(), args[1]) : '/tmp';
    if (!target) throw new Error('Usage: agent-browser download <@id | selector> [outputDir]');

    const { browser, page } = await getBrowserSession();
    try {
      const selector = target.startsWith('@') || /^\d+$/.test(target)
        ? `[data-agent-id="${target.replace('@', '')}"]`
        : target;

      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 30000 }),
        page.click(selector)
      ]);

      const suggestedName = download.suggestedFilename();
      const savePath = resolve(outDir, suggestedName);
      await download.saveAs(savePath);
      console.log(`Downloaded file saved to: ${savePath}`);
    } finally {
      await browser.close();
    }
  },

  async console() {
    const { browser, page } = await getBrowserSession();
    try {
      const logs = await page.evaluate(() => {
        return window.__agent_console_logs || [];
      });

      console.log(`Console Logs (${logs.length} captured):`);
      console.log('---------------------------------------------------------');
      if (logs.length === 0) {
        console.log('No console errors or warnings recorded on active page.');
      } else {
        for (const log of logs.slice(-25)) {
          console.log(`[${log.type.toUpperCase()}] ${log.time.split('T')[1].slice(0, 8)}: ${log.message}`);
        }
      }
    } finally {
      await browser.close();
    }
  },

  async network() {
    const { browser, page } = await getBrowserSession();
    try {
      const metrics = await page.evaluate(() => {
        const entries = performance.getEntriesByType('resource');
        return {
          totalRequests: entries.length,
          recent: entries.slice(-15).map((e) => ({
            name: e.name.length > 70 ? e.name.slice(0, 70) + '...' : e.name,
            initiatorType: e.initiatorType,
            durationMs: Math.round(e.duration),
            transferSize: e.transferSize || 0
          }))
        };
      });

      console.log(`Network Requests (${metrics.totalRequests} total resources on page):`);
      console.log('---------------------------------------------------------');
      for (const req of metrics.recent) {
        console.log(`[${req.initiatorType.padEnd(7)}] ${req.name} (${req.durationMs}ms, ${Math.round(req.transferSize / 1024)}KB)`);
      }
    } finally {
      await browser.close();
    }
  },

  async cookies(args) {
    const action = args[0] || 'list';
    const filePath = args[1];
    const { browser, context } = await getBrowserSession();

    try {
      if (action === 'export') {
        const targetPath = filePath ? resolve(process.cwd(), filePath) : resolve(homedir(), '.config/agent-browser-linux/cookies.json');
        const cookieList = await context.cookies();
        writeFileSync(targetPath, JSON.stringify(cookieList, null, 2), 'utf-8');
        console.log(`Exported ${cookieList.length} cookies to: ${targetPath}`);
      } else if (action === 'import') {
        if (!filePath || !existsSync(resolve(process.cwd(), filePath))) {
          throw new Error('Usage: agent-browser cookies import <file.json>');
        }
        const data = JSON.parse(readFileSync(resolve(process.cwd(), filePath), 'utf-8'));
        await context.addCookies(data);
        console.log(`Imported ${data.length} cookies successfully.`);
      } else if (action === 'clear') {
        await context.clearCookies();
        console.log('Cleared all session and persistent cookies.');
      } else {
        const cookieList = await context.cookies();
        console.log(`Cookies in profile "${ACTIVE_PROFILE}" (${cookieList.length}):`);
        const domains = [...new Set(cookieList.map((c) => c.domain))];
        for (const dom of domains.slice(0, 15)) {
          console.log(` • Domain: ${dom} (${cookieList.filter((c) => c.domain === dom).length} cookies)`);
        }
      }
    } finally {
      await browser.close();
    }
  },

  async tabs() {
    const { browser, context } = await getBrowserSession();
    try {
      const pages = context.pages();
      console.log(`Open Tabs (${pages.length}):`);
      for (let i = 0; i < pages.length; i++) {
        const p = pages[i];
        console.log(`[Tab ${i + 1}] "${await p.title()}" -> ${p.url()}`);
      }
    } finally {
      await browser.close();
    }
  },

  async 'new-tab'(args) {
    const url = args[0] || 'about:blank';
    const targetUrl = url.startsWith('http') || url === 'about:blank' ? url : `https://${url}`;
    const { browser, context } = await getBrowserSession();
    try {
      const newPage = await context.newPage();
      if (targetUrl !== 'about:blank') {
        await newPage.goto(targetUrl, { waitUntil: 'domcontentloaded' });
      }
      console.log(`Opened new tab: ${newPage.url()}`);
    } finally {
      await browser.close();
    }
  },

  async 'close-tab'(args) {
    const { browser, context } = await getBrowserSession();
    try {
      const pages = context.pages();
      const idx = args[0] ? parseInt(args[0], 10) - 1 : pages.length - 1;
      if (pages[idx]) {
        await pages[idx].close();
        console.log(`Closed tab ${idx + 1}`);
      } else {
        console.log('No matching tab to close');
      }
    } finally {
      await browser.close();
    }
  },

  async wait(args) {
    const target = args[0];
    if (!target) throw new Error('Usage: agent-browser wait <seconds | selector | networkidle>');
    const { browser, page } = await getBrowserSession();
    try {
      if (target === 'networkidle') {
        await page.waitForLoadState('networkidle', { timeout: 15000 });
        console.log('Network activity idle.');
      } else if (/^\d+(\.\d+)?$/.test(target)) {
        const ms = parseFloat(target) * 1000;
        await page.waitForTimeout(ms);
        console.log(`Waited ${target}s`);
      } else {
        await page.waitForSelector(target, { timeout: 20000 });
        console.log(`Element appeared: ${target}`);
      }
    } finally {
      await browser.close();
    }
  },

  async eval(args) {
    const code = args.join(' ');
    if (!code) throw new Error('Usage: agent-browser eval "<javascript>"');
    const { browser, page } = await getBrowserSession();
    try {
      const result = await page.evaluate((src) => {
        return window.eval(src);
      }, code);
      console.log('Result:', result);
    } finally {
      await browser.close();
    }
  },

  async stop() {
    if (!(await isBrowserRunning())) {
      console.log(`Browser on port ${CDP_PORT} (profile "${ACTIVE_PROFILE}") is not running.`);
      return;
    }
    try {
      const browser = await chromium.connectOverCDP(CDP_URL);
      const session = await browser.newBrowserCDPSession();
      await session.send('Browser.close');
      await browser.close();
      console.log(`Browser stopped cleanly for profile "${ACTIVE_PROFILE}".`);
    } catch {
      console.log('Sent stop signal.');
    }
  },

  async help() {
    console.log(`
Agent Browser Linux — AI Agent & Human Co-Browsing for Linux

Usage: agent-browser [--profile <name>] <command> [arguments...] (alias: agent-browser-linux)

Navigation:
  open <url>                           Open URL in active tab
  new-tab [url]                        Open a new tab
  tabs                                 List all open tabs
  close-tab [index]                    Close active or specific tab

Inspection & Vision:
  snapshot [limit]                     Print interactive elements with [@1], [@2] IDs (with Shadow DOM support)
  text                                 Extract readable text of current page
  screenshot [path] [--annotated]      Capture screenshot (optional visual numbered element badges)
  console                              Show captured console errors & warnings
  network                              List active network requests and performance metrics

Interaction:
  click <@id | text | sel>             Click element by @id (from snapshot), text, or selector
  fill <@id | sel> <text>              Fill form field / input
  type <text>                          Type raw text into focused element
  press <Key>                          Press keyboard key (Enter, Escape, Tab, etc.)
  scroll <up|down|top|bottom>          Scroll page
  upload <@id | sel> <file>            Upload local file to file input
  download <@id | sel> [dir]           Click element and wait for downloaded file
  cookies [export|import|clear]        Export, import, or clear session cookies
  wait <seconds | selector | networkidle> Wait for element, delay, or network idle
  eval "<javascript>"                  Execute JavaScript on page

Management:
  start [--headless]                   Launch browser instance (default: maximized GUI)
  stop                                 Close browser instance
  help                                 Show this help message

Multi-Profile Support:
  Pass --profile <name> before or after command to use isolated browser profiles:
  agent-browser --profile work open https://internal.company.com
`);
  }
};

async function main() {
  const command = CLI_ARGS[0] || 'help';
  const cmdArgs = CLI_ARGS.slice(1);

  if (!commands[command]) {
    console.error(`Unknown command: "${command}". Run "agent-browser help" for available commands.`);
    process.exit(1);
  }

  try {
    await commands[command](cmdArgs);
  } catch (err) {
    console.error(`Error executing "${command}":`, err.message);
    process.exit(1);
  }
}

main();
