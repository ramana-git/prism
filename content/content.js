/**
 * content.js
 *
 * Runs in the context of every page on configured target domains.
 * Dynamically registered by the service worker based on user settings.
 *
 * Responsibilities:
 *  1. Intercept localStorage.setItem / removeItem in real-time
 *     When the app writes a JWT or auth token to localStorage, we catch it
 *     and notify the service worker so saved sessions reflect the latest token.
 *  2. Listen for restore commands from the service worker.
 *  3. Notify the service worker on page load.
 */

(function () {
  'use strict';

  // ── Inject localStorage interceptor into the REAL page context ──────────────
  const interceptorScript = document.createElement('script');
  interceptorScript.textContent = `
    (function() {
      const originalSetItem = Storage.prototype.setItem;
      const originalRemoveItem = Storage.prototype.removeItem;
      const originalClear = Storage.prototype.clear;

      Storage.prototype.setItem = function(key, value) {
        originalSetItem.call(this, key, value);
        if (this === window.localStorage) {
          window.dispatchEvent(new CustomEvent('__prism_storageWrite__', {
            detail: { type: 'set', key, value }
          }));
        }
      };

      Storage.prototype.removeItem = function(key) {
        originalRemoveItem.call(this, key);
        if (this === window.localStorage) {
          window.dispatchEvent(new CustomEvent('__prism_storageWrite__', {
            detail: { type: 'remove', key }
          }));
        }
      };

      Storage.prototype.clear = function() {
        originalClear.call(this);
        if (this === window.localStorage) {
          window.dispatchEvent(new CustomEvent('__prism_storageWrite__', {
            detail: { type: 'clear' }
          }));
        }
      };

      console.debug('[Prism] localStorage interceptor active');
    })();
  `;

  const parent = document.head || document.documentElement;
  parent.insertBefore(interceptorScript, parent.firstChild);
  interceptorScript.remove();

  // ── Listen for storage changes from the injected script ────────────────────
  let debounceTimer = null;

  window.addEventListener('__prism_storageWrite__', (event) => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      chrome.runtime.sendMessage({
        type: 'LOCALSTORAGE_CHANGED',
        tabId: null,
        change: event.detail
      }).catch(() => {});
    }, 500);
  });

  // ── Notify service worker on page load ────────────────────────────────────
  window.addEventListener('load', () => {
    chrome.runtime.sendMessage({
      type: 'PAGE_LOADED',
      url: window.location.href
    }).catch(() => {});
  });

  // ── Listen for restore commands from service worker ────────────────────────
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'RESTORE_STORAGE') {
      const { localStorageData, sessionStorageData } = message;

      if (localStorageData) {
        for (const [key, value] of Object.entries(localStorageData)) {
          try { localStorage.setItem(key, value); } catch (e) {
            console.warn('[Prism] Failed to restore localStorage key:', key, e);
          }
        }
      }

      if (sessionStorageData) {
        for (const [key, value] of Object.entries(sessionStorageData)) {
          try { sessionStorage.setItem(key, value); } catch (e) {
            console.warn('[Prism] Failed to restore sessionStorage key:', key, e);
          }
        }
      }

      window.dispatchEvent(new Event('storage'));
      sendResponse({ success: true });
    }
  });

  console.debug('[Prism] Content script initialized on', window.location.hostname);
})();
