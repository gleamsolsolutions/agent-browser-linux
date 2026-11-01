#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { chromium } from 'playwright-core';

const CDP_PORT = 9222;
const CDP_URL = `http://127.0.0.1:${CDP_PORT}`;
const PROFILE_DIR = resolve(homedir(), '.config/agent-browser-linux/profile');
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
    '--enable-automation',
    '--disable-blink-features=AutomationControlled'
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
  const pages = context.pages();
  const page = pages[pages.length - 1] || (await context.newPage());
  return { browser, context, page };
}

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
        rect.bottom >= 0 &&
        rect.top <= (window.innerHeight || document.documentElement.clientHeight) + 100
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

    const all = Array.from(document.querySelectorAll(selector));
    const visible = all.filter(isVisible);

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

const commands = {
  async start(args) {
    const headless = args.includes('--headless');
    await ensureBrowser(headless);
    console.log(`Browser started (${headless ? 'headless' : 'visible window'}). Profile: ${PROFILE_DIR}`);
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

  async text(args) {
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
    const outPath = args[0] ? resolve(process.cwd(), args[0]) : SCREENSHOT_DEFAULT;
    const { browser, page } = await getBrowserSession();
    try {
      await page.screenshot({ path: outPath, fullPage: args.includes('--full') });
      console.log(`Screenshot saved to: ${outPath}`);
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
    if (!target) throw new Error('Usage: agent-browser wait <seconds | selector>');
    const { browser, page } = await getBrowserSession();
    try {
      if (/^\d+(\.\d+)?$/.test(target)) {
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
      console.log('Browser is not currently running.');
      return;
    }
    try {
      const browser = await chromium.connectOverCDP(CDP_URL);
      const session = await browser.newBrowserCDPSession();
      await session.send('Browser.close');
      await browser.close();
      console.log('Browser stopped cleanly.');
    } catch {
      console.log('Sent stop signal.');
    }
  },

  async help() {
    console.log(`
Agent Browser Linux — AI Agent & Human Co-Browsing for Linux

Usage: agent-browser <command> [arguments...] (alias: agent-browser-linux)

Navigation:
  open <url>                    Open URL in active tab
  new-tab [url]                 Open a new tab
  tabs                          List all open tabs
  close-tab [index]             Close active or specific tab

Inspection:
  snapshot [limit]              Print interactive elements with [@1], [@2] IDs
  text                          Extract readable text of current page
  screenshot [path] [--full]    Take screenshot (default: /tmp/agent-browser-screenshot.png)

Interaction:
  click <@id | text | sel>      Click element by @id (from snapshot), text, or selector
  fill <@id | sel> <text>       Fill form field / input
  type <text>                   Type raw text into focused element
  press <Key>                   Press keyboard key (Enter, Escape, Tab, etc.)
  scroll <up|down|top|bottom>   Scroll page
  wait <seconds | selector>     Wait for element or duration
  eval "<javascript>"           Execute JavaScript on page

Management:
  start [--headless]            Launch browser instance (default is visible GUI)
  stop                          Close browser instance
  help                          Show this help message

Data & Persistence:
  Profile & Cookies saved to:   ~/.config/agent-browser-linux/profile
`);
  }
};

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'help';
  const cmdArgs = args.slice(1);

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
