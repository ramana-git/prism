/**
 * service-worker.js
 *
 * Core background logic for Prism.
 *
 * What it does:
 *  - Manages user-configured target domains
 *  - Tracks which tab is assigned to which user session
 *  - Auto-swaps localStorage on tab switch (save outgoing, restore incoming)
 *  - Saves/restores cookie sets per user identity
 *  - Shows user initials as badge on extension icon per tab
 *  - Programmatically registers content scripts for configured domains
 */

import { SessionStore } from '../sessions/session-store.js';

const store = new SessionStore();

// ─── Tab → User mapping (in-memory, also persisted via chrome.storage.local) ──
let tabAssignments = {};

// Track last active tab for swap-on-switch
let lastActiveTabId = null;

// Configured target domains (loaded from storage)
let configuredDomains = [];

// Load persisted state on startup
chrome.storage.local.get(['tabAssignments', 'configuredDomains'], (result) => {
  tabAssignments = result.tabAssignments || {};
  configuredDomains = result.configuredDomains || [];
  syncContentScripts();
});

// ─── Domain helpers ──────────────────────────────────────────────────────────

function domainToOrigins(domain) {
  if (domain === 'localhost') {
    return ['*://localhost/*'];
  }
  return [`*://${domain}/*`, `*://*.${domain}/*`];
}

function domainToMatchPatterns(domain) {
  return domainToOrigins(domain);
}

function isTabOnConfiguredDomain(url) {
  if (!url) return false;
  try {
    const hostname = new URL(url).hostname;
    return configuredDomains.some(domain => {
      if (domain === 'localhost') return hostname === 'localhost';
      return hostname === domain || hostname.endsWith('.' + domain);
    });
  } catch {
    return false;
  }
}

// Register content scripts for all configured domains
async function syncContentScripts() {
  // Unregister existing dynamic scripts
  try {
    const existing = await chrome.scripting.getRegisteredContentScripts();
    if (existing.length > 0) {
      await chrome.scripting.unregisterContentScripts({
        ids: existing.map(s => s.id)
      });
    }
  } catch (e) {
    console.debug('[Prism] Could not unregister scripts:', e.message);
  }

  if (configuredDomains.length === 0) return;

  // Build match patterns from all configured domains
  const matches = configuredDomains.flatMap(domainToMatchPatterns);

  try {
    await chrome.scripting.registerContentScripts([{
      id: 'prism-interceptor',
      matches,
      js: ['content/content.js'],
      runAt: 'document_start',
      allFrames: false
    }]);
    console.log('[Prism] Content scripts registered for:', configuredDomains);
  } catch (e) {
    console.warn('[Prism] Failed to register content scripts:', e.message);
  }
}

// ─── Message handler (from popup, options, and content script) ───────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {

    // ── Domain management ──

    case 'GET_DOMAINS': {
      sendResponse(configuredDomains);
      break;
    }

    case 'ADD_DOMAIN': {
      const domain = message.domain.toLowerCase().trim();
      if (!domain || configuredDomains.includes(domain)) {
        sendResponse({ success: false, error: 'Domain already configured or empty' });
        break;
      }
      configuredDomains.push(domain);
      chrome.storage.local.set({ configuredDomains });
      syncContentScripts();
      sendResponse({ success: true, domains: configuredDomains });
      break;
    }

    case 'REMOVE_DOMAIN': {
      const idx = configuredDomains.indexOf(message.domain);
      if (idx === -1) {
        sendResponse({ success: false });
        break;
      }
      configuredDomains.splice(idx, 1);
      chrome.storage.local.set({ configuredDomains });
      syncContentScripts();

      // Revoke host permissions for this domain
      const origins = domainToOrigins(message.domain);
      chrome.permissions.remove({ origins }).catch(() => {});

      sendResponse({ success: true, domains: configuredDomains });
      break;
    }

    case 'CHECK_DOMAIN': {
      sendResponse({ active: isTabOnConfiguredDomain(message.url) });
      break;
    }

    // ── Tab/session management ──

    case 'ASSIGN_USER': {
      const { tabId, userId, userName, color } = message;
      tabAssignments[tabId] = { userId, userName, color };
      chrome.storage.local.set({ tabAssignments });
      setBadge(tabId, userName, color);
      applySessionToTab(tabId, userId).then(() => {
        sendResponse({ success: true });
      });
      return true;
    }

    case 'GET_ASSIGNMENT': {
      sendResponse(tabAssignments[message.tabId] || null);
      break;
    }

    case 'GET_ALL_ASSIGNMENTS': {
      sendResponse(tabAssignments);
      break;
    }

    case 'SAVE_SESSION': {
      const { tabId, userId } = message;
      captureSessionFromTab(tabId, userId).then((session) => {
        sendResponse({ success: true, session });
      });
      return true;
    }

    case 'APPLY_SESSION': {
      const { tabId, userId } = message;
      applySessionToTab(tabId, userId).then(() => {
        sendResponse({ success: true });
      });
      return true;
    }

    case 'CLEAR_SESSION': {
      store.clearSession(message.userId).then(() => {
        sendResponse({ success: true });
      });
      return true;
    }

    case 'LIST_SESSIONS': {
      store.listSessions().then((sessions) => {
        sendResponse(sessions);
      });
      return true;
    }

    case 'GET_STORAGE_INFO': {
      store.getStorageInfo().then((info) => {
        sendResponse(info);
      });
      return true;
    }

    case 'LOCALSTORAGE_CHANGED': {
      const tabId = sender.tab?.id;
      if (tabId && tabAssignments[tabId]) {
        pendingRecapture.add(tabId);
      }
      sendResponse({ received: true });
      break;
    }

    case 'LOCALSTORAGE_SNAPSHOT': {
      pendingLocalStorageSnapshots[sender.tab.id] = message.data;
      sendResponse({ received: true });
      break;
    }

    case 'UNASSIGN_TAB': {
      delete tabAssignments[message.tabId];
      chrome.storage.local.set({ tabAssignments });
      clearBadge(message.tabId);
      sendResponse({ success: true });
      break;
    }
  }
});

const pendingLocalStorageSnapshots = {};
const pendingRecapture = new Set();

// ─── Tab-switch auto-swap ────────────────────────────────────────────────────
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  const previousTabId = lastActiveTabId;
  lastActiveTabId = tabId;

  // 1. Capture outgoing tab if assigned
  if (previousTabId && tabAssignments[previousTabId]) {
    try {
      const prevTab = await chrome.tabs.get(previousTabId);
      if (isTabOnConfiguredDomain(prevTab.url)) {
        await captureSessionFromTab(previousTabId, tabAssignments[previousTabId].userId);
        pendingRecapture.delete(previousTabId);
      }
    } catch (e) {
      console.debug('[Prism] Could not capture outgoing tab', previousTabId, e.message);
    }
  }

  // 2. Restore incoming tab if assigned
  if (tabAssignments[tabId]) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (isTabOnConfiguredDomain(tab.url)) {
        await applySessionToTab(tabId, tabAssignments[tabId].userId);
      }
    } catch (e) {
      console.debug('[Prism] Could not restore incoming tab', tabId, e.message);
    }
  }
});

// ─── Apply a saved session to a tab ──────────────────────────────────────────
async function applySessionToTab(tabId, userId) {
  const session = await store.getSession(userId);
  if (!session) return;

  const tab = await chrome.tabs.get(tabId);
  if (!isTabOnConfiguredDomain(tab.url)) return;

  const url = new URL(tab.url);

  // 1. Restore cookies
  if (session.cookies && session.cookies.length > 0) {
    await clearCookiesForDomain(url.hostname);
    for (const cookie of session.cookies) {
      await setCookie(cookie, url.origin);
    }
  }

  // 2. Restore localStorage + sessionStorage
  if (session.localStorage || session.sessionStorage) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        func: restoreStorageInPage,
        args: [session.localStorage || {}, session.sessionStorage || {}]
      });
    } catch (e) {
      console.debug('[Prism] Could not inject storage restore:', e.message);
    }
  }
}

// ─── Capture current session from a tab ──────────────────────────────────────
async function captureSessionFromTab(tabId, userId) {
  const tab = await chrome.tabs.get(tabId);
  const url = new URL(tab.url);

  const cookies = await chrome.cookies.getAll({ domain: url.hostname });
  const cleanCookies = cookies.map(c => ({
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path,
    secure: c.secure,
    httpOnly: c.httpOnly,
    sameSite: c.sameSite,
    expirationDate: c.expirationDate
  }));

  let storageData = {};
  try {
    const storageResults = await chrome.scripting.executeScript({
      target: { tabId },
      func: captureStorageFromPage
    });
    storageData = storageResults[0]?.result || {};
  } catch (e) {
    console.debug('[Prism] Could not capture storage:', e.message);
  }

  const assignment = tabAssignments[tabId];
  const session = {
    userId,
    userName: assignment?.userName || userId,
    capturedAt: Date.now(),
    url: url.origin,
    cookies: cleanCookies,
    localStorage: storageData.localStorage || {},
    sessionStorage: storageData.sessionStorage || {}
  };

  await store.saveSession(userId, session);
  return session;
}

// ─── Cookie helpers ───────────────────────────────────────────────────────────
async function clearCookiesForDomain(hostname) {
  const cookies = await chrome.cookies.getAll({ domain: hostname });
  for (const cookie of cookies) {
    const protocol = cookie.secure ? 'https' : 'http';
    const cookieDomain = cookie.domain.startsWith('.')
      ? cookie.domain.slice(1)
      : cookie.domain;
    await chrome.cookies.remove({
      url: `${protocol}://${cookieDomain}${cookie.path}`,
      name: cookie.name
    });
  }
}

async function setCookie(cookie, origin) {
  try {
    const url = `${origin}${cookie.path || '/'}`;
    const cookieDetails = {
      url,
      name: cookie.name,
      value: cookie.value,
      path: cookie.path || '/',
      secure: cookie.secure,
      httpOnly: cookie.httpOnly,
      sameSite: cookie.sameSite || 'lax'
    };
    if (cookie.domain) cookieDetails.domain = cookie.domain;
    if (cookie.expirationDate) cookieDetails.expirationDate = cookie.expirationDate;

    await chrome.cookies.set(cookieDetails);
  } catch (err) {
    console.warn(`[Prism] Failed to set cookie ${cookie.name}:`, err);
  }
}

// ─── Badge helpers ───────────────────────────────────────────────────────────
function setBadge(tabId, userName, color) {
  const initials = userName.slice(0, 2).toUpperCase();
  chrome.action.setBadgeText({ text: initials, tabId });
  chrome.action.setBadgeBackgroundColor({ color, tabId });
  chrome.action.setBadgeTextColor({ color: '#ffffff', tabId });
}

function clearBadge(tabId) {
  chrome.action.setBadgeText({ text: '', tabId });
}

// ─── Functions injected into the page context ─────────────────────────────────

function captureStorageFromPage() {
  const ls = {};
  const ss = {};

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    ls[key] = localStorage.getItem(key);
  }

  for (let i = 0; i < sessionStorage.length; i++) {
    const key = sessionStorage.key(i);
    ss[key] = sessionStorage.getItem(key);
  }

  return { localStorage: ls, sessionStorage: ss };
}

function restoreStorageInPage(localStorageData, sessionStorageData) {
  if (localStorageData && Object.keys(localStorageData).length > 0) {
    localStorage.clear();
    for (const [key, value] of Object.entries(localStorageData)) {
      localStorage.setItem(key, value);
    }
  }

  if (sessionStorageData && Object.keys(sessionStorageData).length > 0) {
    for (const key of Object.keys(sessionStorageData)) {
      sessionStorage.removeItem(key);
    }
    for (const [key, value] of Object.entries(sessionStorageData)) {
      sessionStorage.setItem(key, value);
    }
  }

  window.dispatchEvent(new StorageEvent('storage', { key: null, storageArea: localStorage }));
  return true;
}

// ─── Tab lifecycle ────────────────────────────────────────────────────────────

chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabAssignments[tabId]) {
    delete tabAssignments[tabId];
    chrome.storage.local.set({ tabAssignments });
  }
  pendingRecapture.delete(tabId);
  if (lastActiveTabId === tabId) lastActiveTabId = null;
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tabAssignments[tabId]) {
    if (!isTabOnConfiguredDomain(tab.url)) return;
    const { userId, userName, color } = tabAssignments[tabId];
    setBadge(tabId, userName, color);
    setTimeout(() => {
      applySessionToTab(tabId, userId);
    }, 300);
  }
});

console.log('[Prism] Service worker started');
