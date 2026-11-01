#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { homedir } from 'node:os';
import readline from 'node:readline';
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
    '--window-size=1440,900'
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

// Flat interactive element snapshot
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

// Hierarchical ARIA tree snapshot
async function getHierarchicalTreeSnapshot(page, maxElements = 80) {
  return await page.evaluate((max) => {
    document.querySelectorAll('[data-agent-id]').forEach((el) => el.removeAttribute('data-agent-id'));

    let currentId = 0;
    const isVisible = (el) => {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.visibility !== 'hidden' &&
        style.display !== 'none' &&
        rect.bottom >= 0 &&
        rect.top <= (window.innerHeight || document.documentElement.clientHeight) + 200
      );
    };

    const isInteractive = (el) => {
      const tag = el.tagName.toLowerCase();
      const role = el.getAttribute('role') || '';
      return (
        (tag === 'a' && el.hasAttribute('href')) ||
        tag === 'button' ||
        (tag === 'input' && el.type !== 'hidden') ||
        tag === 'textarea' ||
        tag === 'select' ||
        ['button', 'link', 'checkbox', 'radio', 'tab', 'menuitem', 'textbox'].includes(role) ||
        el.getAttribute('contenteditable') === 'true'
      );
    };

    const isLandmark = (el) => {
      const tag = el.tagName.toLowerCase();
      const role = el.getAttribute('role') || '';
      return (
        ['header', 'nav', 'main', 'section', 'article', 'form', 'footer', 'aside'].includes(tag) ||
        ['banner', 'navigation', 'main', 'complementary', 'contentinfo', 'form'].includes(role) ||
        tag.startsWith('h')
      );
    };

    const lines = [];

    function walk(node, depth = 0) {
      if (!node || currentId >= max) return;
      const indent = '  '.repeat(depth);

      for (const child of Array.from(node.children || [])) {
        if (!isVisible(child)) continue;

        if (isInteractive(child)) {
          currentId++;
          child.setAttribute('data-agent-id', String(currentId));
          const tag = child.tagName.toLowerCase();
          const role = child.getAttribute('role') || tag;
          const text = (
            child.getAttribute('aria-label') ||
            child.getAttribute('placeholder') ||
            child.getAttribute('title') ||
            child.innerText ||
            child.value ||
            ''
          )
            .trim()
            .replace(/\s+/g, ' ')
            .slice(0, 60);

          let href = '';
          if (tag === 'a' && child.getAttribute('href')) {
            const h = child.getAttribute('href');
            href = ` [${h.length > 40 ? h.slice(0, 40) + '...' : h}]`;
          }
          lines.push(`${indent}[@${currentId}] <${role}> ${text ? `"${text}"` : '(unlabeled)'}${href}`);
        } else if (isLandmark(child)) {
          const tag = child.tagName.toLowerCase();
          let label = child.getAttribute('aria-label') || '';
          if (tag.startsWith('h') && /^h[1-6]$/.test(tag)) {
            const headingText = (child.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 50);
            lines.push(`${indent}<${tag}> "${headingText}"`);
          } else {
            lines.push(`${indent}[${tag}${label ? ` "${label}"` : ''}]`);
            walk(child, depth + 1);
          }
        } else {
          walk(child, depth);
        }
      }
    }

    walk(document.body, 0);

    return {
      title: document.title,
      url: window.location.href,
      totalElements: currentId,
      tree: lines.join('\n')
    };
  }, maxElements);
}

// Device presets
const DEVICE_PRESETS = {
  mobile: { width: 390, height: 844, name: 'Standard Mobile (iPhone 14/15)' },
  iphone: { width: 393, height: 852, name: 'Apple iPhone 15 Pro' },
  pixel: { width: 412, height: 915, name: 'Google Pixel 8' },
  tablet: { width: 820, height: 1180, name: 'Apple iPad Air' },
  ipad: { width: 820, height: 1180, name: 'Apple iPad Air' },
  desktop: { width: 1440, height: 900, name: 'Standard Desktop (1440x900)' },
  fhd: { width: 1920, height: 1080, name: 'Full HD Desktop (1920x1080)' }
};

// Core Commands
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
    const isTree = args.includes('--tree');
    const limitArg = args.find((a) => !a.startsWith('--'));
    const limit = parseInt(limitArg, 10) || 60;
    const { browser, page } = await getBrowserSession();

    try {
      if (isTree) {
        const snap = await getHierarchicalTreeSnapshot(page, limit);
        console.log(`Title: ${snap.title}`);
        console.log(`URL:   ${snap.url}`);
        console.log(`\nHierarchical Accessibility Tree (${snap.totalElements} interactive elements):`);
        console.log('---------------------------------------------------------');
        console.log(snap.tree);
      } else {
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

  async autofill(args) {
    const jsonStr = args.join(' ');
    if (!jsonStr) throw new Error('Usage: agent-browser autofill \'{"fieldName": "value", ...}\'');

    let formData;
    try {
      formData = JSON.parse(jsonStr);
    } catch {
      throw new Error('Invalid JSON provided to autofill.');
    }

    const { browser, page } = await getBrowserSession();
    try {
      const result = await page.evaluate((data) => {
        const filled = [];
        const inputs = Array.from(
          document.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]), textarea, select')
        );

        for (const [key, val] of Object.entries(data)) {
          const lowerKey = key.toLowerCase();
          const target = inputs.find((el) => {
            const name = (el.name || '').toLowerCase();
            const id = (el.id || '').toLowerCase();
            const placeholder = (el.placeholder || '').toLowerCase();
            const autocomplete = (el.autocomplete || '').toLowerCase();
            const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();

            let labelText = '';
            if (el.id) {
              const labelEl = document.querySelector(`label[for="${el.id}"]`);
              if (labelEl) labelText = labelEl.innerText.toLowerCase();
            }

            return (
              name.includes(lowerKey) ||
              id.includes(lowerKey) ||
              placeholder.includes(lowerKey) ||
              autocomplete.includes(lowerKey) ||
              ariaLabel.includes(lowerKey) ||
              labelText.includes(lowerKey)
            );
          });

          if (target) {
            target.focus();
            if (target.tagName.toLowerCase() === 'select') {
              target.value = String(val);
            } else {
              target.value = String(val);
            }
            target.dispatchEvent(new Event('input', { bubbles: true }));
            target.dispatchEvent(new Event('change', { bubbles: true }));
            filled.push({ key, id: target.id || target.name || target.tagName });
          }
        }

        return { count: filled.length, filled };
      }, formData);

      console.log(`AutoFill completed: ${result.count} fields populated.`);
      for (const f of result.filled) {
        console.log(` - Matched "${f.key}" -> <#${f.id}>`);
      }
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
        await getInteractiveSnapshot(page, 80);
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

  async device(args) {
    const target = (args[0] || '').toLowerCase();
    if (!target || !DEVICE_PRESETS[target]) {
      const options = Object.keys(DEVICE_PRESETS).join(', ');
      throw new Error(`Usage: agent-browser device <${options}>`);
    }

    const preset = DEVICE_PRESETS[target];
    const { browser, page } = await getBrowserSession();
    try {
      await page.setViewportSize({ width: preset.width, height: preset.height });
      console.log(`Device viewport set to ${preset.name} (${preset.width}x${preset.height}px).`);
    } finally {
      await browser.close();
    }
  },

  async pdf(args) {
    const outPath = args[0] ? resolve(process.cwd(), args[0]) : '/tmp/agent-browser-document.pdf';
    const { browser, context, page } = await getBrowserSession();
    try {
      const pageSession = await context.newCDPSession(page);
      const pdfData = await pageSession.send('Page.printToPDF', {
        printBackground: true,
        preferCSSPageSize: true
      });
      const buffer = Buffer.from(pdfData.data, 'base64');
      writeFileSync(outPath, buffer);
      console.log(`PDF saved successfully to: ${outPath} (${Math.round(buffer.length / 1024)} KB)`);
    } finally {
      await browser.close();
    }
  },

  async storage(args) {
    const action = args[0] || 'dump';
    const key = args[1];
    const val = args.slice(2).join(' ');
    const { browser, page } = await getBrowserSession();

    try {
      if (action === 'get') {
        if (!key) throw new Error('Usage: agent-browser storage get <key>');
        const res = await page.evaluate((k) => {
          return { local: localStorage.getItem(k), session: sessionStorage.getItem(k) };
        }, key);
        console.log(`Key "${key}":`);
        console.log(` • localStorage:   ${res.local}`);
        console.log(` • sessionStorage: ${res.session}`);
      } else if (action === 'set') {
        if (!key) throw new Error('Usage: agent-browser storage set <key> <value>');
        await page.evaluate(({ k, v }) => {
          localStorage.setItem(k, v);
        }, { k: key, v: val });
        console.log(`Set localStorage["${key}"] = "${val}"`);
      } else if (action === 'clear') {
        await page.evaluate(() => {
          localStorage.clear();
          sessionStorage.clear();
        });
        console.log('Cleared both localStorage and sessionStorage.');
      } else {
        const dump = await page.evaluate(() => {
          const local = {};
          const session = {};
          for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            local[k] = localStorage.getItem(k);
          }
          for (let i = 0; i < sessionStorage.length; i++) {
            const k = sessionStorage.key(i);
            session[k] = sessionStorage.getItem(k);
          }
          return { local, session };
        });

        console.log(`LocalStorage (${Object.keys(dump.local).length} entries):`);
        console.log(JSON.stringify(dump.local, null, 2));
        console.log(`\nSessionStorage (${Object.keys(dump.session).length} entries):`);
        console.log(JSON.stringify(dump.session, null, 2));
      }
    } finally {
      await browser.close();
    }
  },

  async 'wait-nav'(args) {
    const pattern = args[0];
    const timeoutSec = parseInt(args[1], 10) || 60;
    const { browser, page } = await getBrowserSession();

    console.log(`Waiting for navigation ${pattern ? `matching "${pattern}"` : 'event'} (up to ${timeoutSec}s)...`);
    const start = Date.now();
    try {
      while ((Date.now() - start) < timeoutSec * 1000) {
        const currentUrl = page.url();
        if (pattern) {
          if (currentUrl.includes(pattern)) {
            console.log(`Navigation reached: ${currentUrl}`);
            return;
          }
        }
        await new Promise((r) => setTimeout(r, 500));
      }
      console.log(`Wait-nav finished. Current URL: ${page.url()}`);
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

  // Built-in Model Context Protocol (MCP) Server Mode over stdio
  async mcp() {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false
    });

    const sendResponse = (id, result, error = null) => {
      const res = { jsonrpc: '2.0', id };
      if (error) {
        res.error = error;
      } else {
        res.result = result;
      }
      process.stdout.write(JSON.stringify(res) + '\n');
    };

    const tools = [
      {
        name: 'browser_open',
        description: 'Open a URL in the browser',
        inputSchema: {
          type: 'object',
          properties: { url: { type: 'string', description: 'URL to navigate to' } },
          required: ['url']
        }
      },
      {
        name: 'browser_snapshot',
        description: 'Get interactive numbered element tags or hierarchical tree from active page',
        inputSchema: {
          type: 'object',
          properties: {
            tree: { type: 'boolean', description: 'Return hierarchical ARIA accessibility tree instead of flat list' },
            limit: { type: 'number', description: 'Maximum elements to return' }
          }
        }
      },
      {
        name: 'browser_click',
        description: 'Click an element by @id from snapshot, text, or CSS selector',
        inputSchema: {
          type: 'object',
          properties: { target: { type: 'string', description: '@id, text, or CSS selector' } },
          required: ['target']
        }
      },
      {
        name: 'browser_fill',
        description: 'Fill an input or textarea',
        inputSchema: {
          type: 'object',
          properties: {
            target: { type: 'string', description: '@id or CSS selector' },
            text: { type: 'string', description: 'Text to fill' }
          },
          required: ['target', 'text']
        }
      },
      {
        name: 'browser_autofill',
        description: 'Automatically match and populate multiple form fields simultaneously',
        inputSchema: {
          type: 'object',
          properties: { fields: { type: 'object', description: 'Key-value map of form field names and values' } },
          required: ['fields']
        }
      },
      {
        name: 'browser_screenshot',
        description: 'Take screenshot of current page',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'File path to save screenshot' },
            annotated: { type: 'boolean', description: 'Overlay visual numbered element badges on screenshot' }
          }
        }
      },
      {
        name: 'browser_pdf',
        description: 'Print current page to vectorized PDF document',
        inputSchema: {
          type: 'object',
          properties: { path: { type: 'string', description: 'Path to save output PDF' } },
          required: ['path']
        }
      },
      {
        name: 'browser_device',
        description: 'Switch responsive device viewport (mobile, tablet, desktop, iphone, pixel)',
        inputSchema: {
          type: 'object',
          properties: { device: { type: 'string', description: 'mobile, tablet, desktop, iphone, pixel' } },
          required: ['device']
        }
      },
      {
        name: 'browser_console',
        description: 'Inspect captured console errors and warnings',
        inputSchema: { type: 'object', properties: {} }
      },
      {
        name: 'browser_network',
        description: 'Inspect recent network resources and performance metrics',
        inputSchema: { type: 'object', properties: {} }
      },
      {
        name: 'browser_eval',
        description: 'Evaluate JavaScript in active page context',
        inputSchema: {
          type: 'object',
          properties: { code: { type: 'string', description: 'JavaScript code to execute' } },
          required: ['code']
        }
      }
    ];

    rl.on('line', async (line) => {
      if (!line.trim()) return;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        return;
      }

      const { id, method, params } = msg;

      if (method === 'initialize') {
        sendResponse(id, {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'agent-browser-linux', version: '1.2.0' }
        });
      } else if (method === 'notifications/initialized') {
        // Notification ack
      } else if (method === 'tools/list') {
        sendResponse(id, { tools });
      } else if (method === 'tools/call') {
        const { name, arguments: toolArgs = {} } = params || {};
        try {
          let outputText = '';
          if (name === 'browser_open') {
            const { browser, page } = await getBrowserSession();
            try {
              await page.goto(toolArgs.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
              outputText = `Navigated to: ${page.url()}\nTitle: ${await page.title()}`;
            } finally {
              await browser.close();
            }
          } else if (name === 'browser_snapshot') {
            const { browser, page } = await getBrowserSession();
            try {
              if (toolArgs.tree) {
                const snap = await getHierarchicalTreeSnapshot(page, toolArgs.limit || 80);
                outputText = `Title: ${snap.title}\nURL: ${snap.url}\n\nHierarchical Tree:\n${snap.tree}`;
              } else {
                const snap = await getInteractiveSnapshot(page, toolArgs.limit || 60);
                outputText = `Title: ${snap.title}\nURL: ${snap.url}\n\nElements:\n` +
                  snap.items.map((i) => `[@${i.id}] <${i.role}> "${i.label}"${i.extra}`).join('\n');
              }
            } finally {
              await browser.close();
            }
          } else if (name === 'browser_click') {
            const { browser, page } = await getBrowserSession();
            try {
              const target = toolArgs.target;
              if (target.startsWith('@') || /^\d+$/.test(target)) {
                await page.click(`[data-agent-id="${target.replace('@', '')}"]`, { timeout: 10000 });
              } else {
                await page.click(target, { timeout: 6000 });
              }
              await page.waitForTimeout(400);
              outputText = `Clicked ${target}. Active URL: ${page.url()}`;
            } finally {
              await browser.close();
            }
          } else if (name === 'browser_fill') {
            const { browser, page } = await getBrowserSession();
            try {
              const target = toolArgs.target;
              const sel = target.startsWith('@') || /^\d+$/.test(target)
                ? `[data-agent-id="${target.replace('@', '')}"]`
                : target;
              await page.fill(sel, toolArgs.text, { timeout: 10000 });
              outputText = `Filled ${target} with "${toolArgs.text}"`;
            } finally {
              await browser.close();
            }
          } else if (name === 'browser_autofill') {
            const { browser, page } = await getBrowserSession();
            try {
              const res = await page.evaluate((data) => {
                const inputs = Array.from(document.querySelectorAll('input, textarea, select'));
                let count = 0;
                for (const [k, v] of Object.entries(data)) {
                  const target = inputs.find((el) =>
                    (el.name || '').toLowerCase().includes(k.toLowerCase()) ||
                    (el.id || '').toLowerCase().includes(k.toLowerCase()) ||
                    (el.placeholder || '').toLowerCase().includes(k.toLowerCase())
                  );
                  if (target) {
                    target.value = String(v);
                    target.dispatchEvent(new Event('input', { bubbles: true }));
                    target.dispatchEvent(new Event('change', { bubbles: true }));
                    count++;
                  }
                }
                return count;
              }, toolArgs.fields || {});
              outputText = `AutoFill populated ${res} form fields.`;
            } finally {
              await browser.close();
            }
          } else if (name === 'browser_screenshot') {
            const out = toolArgs.path || SCREENSHOT_DEFAULT;
            const { browser, page } = await getBrowserSession();
            try {
              await page.screenshot({ path: out, fullPage: false });
              outputText = `Screenshot saved to: ${out}`;
            } finally {
              await browser.close();
            }
          } else if (name === 'browser_pdf') {
            const out = toolArgs.path || '/tmp/agent-browser-document.pdf';
            const { browser, context, page } = await getBrowserSession();
            try {
              const pageSession = await context.newCDPSession(page);
              const pdf = await pageSession.send('Page.printToPDF', { printBackground: true });
              writeFileSync(out, Buffer.from(pdf.data, 'base64'));
              outputText = `PDF exported to: ${out}`;
            } finally {
              await browser.close();
            }
          } else if (name === 'browser_device') {
            const p = DEVICE_PRESETS[toolArgs.device] || DEVICE_PRESETS.mobile;
            const { browser, page } = await getBrowserSession();
            try {
              await page.setViewportSize({ width: p.width, height: p.height });
              outputText = `Viewport set to ${p.name} (${p.width}x${p.height}px)`;
            } finally {
              await browser.close();
            }
          } else if (name === 'browser_console') {
            const { browser, page } = await getBrowserSession();
            try {
              const logs = await page.evaluate(() => window.__agent_console_logs || []);
              outputText = `Captured ${logs.length} console logs:\n` +
                logs.map((l) => `[${l.type}] ${l.message}`).join('\n');
            } finally {
              await browser.close();
            }
          } else if (name === 'browser_network') {
            const { browser, page } = await getBrowserSession();
            try {
              const entries = await page.evaluate(() => performance.getEntriesByType('resource').slice(-10));
              outputText = `Recent network requests:\n` +
                entries.map((e) => `[${e.initiatorType}] ${e.name.slice(0, 70)} (${Math.round(e.duration)}ms)`).join('\n');
            } finally {
              await browser.close();
            }
          } else if (name === 'browser_eval') {
            const { browser, page } = await getBrowserSession();
            try {
              const res = await page.evaluate((code) => window.eval(code), toolArgs.code);
              outputText = `Result: ${typeof res === 'object' ? JSON.stringify(res) : String(res)}`;
            } finally {
              await browser.close();
            }
          } else {
            throw new Error(`Unknown tool: ${name}`);
          }

          sendResponse(id, { content: [{ type: 'text', text: outputText }] });
        } catch (err) {
          sendResponse(id, null, { code: -32603, message: err.message });
        }
      } else {
        sendResponse(id, null, { code: -32601, message: `Method not found: ${method}` });
      }
    });

    // Keep process alive while stdin is open
    await new Promise((resolve) => rl.on('close', resolve));
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
  wait-nav [urlPattern] [timeoutSec]   Wait for user or page to navigate to target URL

Inspection & Vision:
  snapshot [--tree] [limit]            Interactive elements: flat [@1], [@2] or hierarchical --tree
  text                                 Extract readable text of current page
  screenshot [path] [--annotated]      Capture screenshot (optional visual numbered element badges)
  pdf [path]                           Print current page to vectorized PDF document
  console                              Show captured console errors & warnings
  network                              List active network requests and performance metrics
  storage [get|set|clear|dump]         Inspect or modify localStorage & sessionStorage

Interaction & Forms:
  click <@id | text | sel>             Click element by @id (from snapshot), text, or selector
  fill <@id | sel> <text>              Fill form field / input
  autofill '<json-data>'               Batch auto-fill multiple form fields simultaneously
  type <text>                          Type raw text into focused element
  press <Key>                          Press keyboard key (Enter, Escape, Tab, etc.)
  scroll <up|down|top|bottom>          Scroll page
  upload <@id | sel> <file>            Upload local file to file input
  download <@id | sel> [dir]           Click element and wait for downloaded file
  cookies [export|import|clear]        Export, import, or clear session cookies
  device <mobile|tablet|desktop|iphone> Dynamically switch responsive device viewport
  wait <seconds | selector | networkidle> Wait for element, delay, or network idle
  eval "<javascript>"                  Execute JavaScript on page

Server Mode:
  mcp                                  Start Model Context Protocol (MCP) JSON-RPC server over stdio

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
