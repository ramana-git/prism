/**
 * options.js
 *
 * Domain management for Prism.
 * Users add/remove target domains here. Each addition triggers
 * a Chrome permission request so users explicitly grant access.
 */

'use strict';

let domains = [];

document.addEventListener('DOMContentLoaded', async () => {
  domains = await sendMessage({ type: 'GET_DOMAINS' }) || [];
  renderDomains();
  bindEvents();
});

function bindEvents() {
  document.getElementById('addBtn').addEventListener('click', addDomain);
  document.getElementById('domainInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addDomain();
  });

  document.getElementById('domainList').addEventListener('click', async (e) => {
    const btn = e.target.closest('.btn-remove');
    if (!btn) return;

    const domain = btn.dataset.domain;
    const result = await sendMessage({ type: 'REMOVE_DOMAIN', domain });
    if (result?.success) {
      domains = result.domains;
      renderDomains();
      showToast(`Removed ${domain}`, 'success');
    }
  });
}

async function addDomain() {
  const input = document.getElementById('domainInput');
  const raw = input.value.trim().toLowerCase();

  // Clean up: strip protocol, path, port
  const domain = raw
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/:\d+$/, '')
    .replace(/^\*\./, '');

  if (!domain) return showToast('Enter a domain', 'error');
  if (domains.includes(domain)) return showToast('Domain already added', 'error');

  // Build origin patterns for permission request
  const origins = domain === 'localhost'
    ? ['*://localhost/*']
    : [`*://${domain}/*`, `*://*.${domain}/*`];

  // Request host permission — Chrome shows its own prompt
  let granted = false;
  try {
    granted = await chrome.permissions.request({ origins });
  } catch (e) {
    showToast('Permission request failed: ' + e.message, 'error');
    return;
  }

  if (!granted) {
    showToast('Permission denied — domain not added', 'error');
    return;
  }

  // Permission granted — tell service worker to register
  const result = await sendMessage({ type: 'ADD_DOMAIN', domain });
  if (result?.success) {
    domains = result.domains;
    input.value = '';
    renderDomains();
    showToast(`Added ${domain}`, 'success');
  } else {
    showToast(result?.error || 'Failed to add domain', 'error');
  }
}

function renderDomains() {
  const container = document.getElementById('domainList');

  if (domains.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        No domains configured yet.<br>
        Add a domain above to get started.
      </div>`;
    return;
  }

  container.innerHTML = '';
  domains.forEach(domain => {
    const patterns = domain === 'localhost'
      ? '*://localhost/*'
      : `*://${domain}/* , *://*.${domain}/*`;

    const card = document.createElement('div');
    card.className = 'domain-card';
    card.innerHTML = `
      <div class="domain-icon">◈</div>
      <div class="domain-info">
        <div class="domain-name">${escHtml(domain)}</div>
        <div class="domain-patterns">${escHtml(patterns)}</div>
      </div>
      <button class="btn-remove" data-domain="${escAttr(domain)}" title="Remove domain">✕</button>
    `;
    container.appendChild(card);
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function sendMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        console.warn('[Prism options]', chrome.runtime.lastError.message);
        resolve(null);
      } else {
        resolve(response);
      }
    });
  });
}

function showToast(message, type = 'success') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = `toast show ${type}`;
  setTimeout(() => { toast.className = 'toast'; }, 2500);
}

function escHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escAttr(str) {
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}
