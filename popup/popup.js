/**
 * popup.js
 *
 * Drives the extension popup UI.
 * Communicates with the service worker via chrome.runtime.sendMessage.
 */

'use strict';

const USER_COLORS = [
  { hex: '#4f9eff', label: 'blue' },
  { hex: '#3ecf8e', label: 'green' },
  { hex: '#f59e0b', label: 'amber' },
  { hex: '#ef4444', label: 'red' },
  { hex: '#a78bfa', label: 'purple' },
  { hex: '#fb923c', label: 'orange' },
  { hex: '#34d399', label: 'teal' },
  { hex: '#f472b6', label: 'pink' },
];

let users = [];
let currentTabId = null;
let currentTabUrl = null;
let currentAssignment = null;
let selectedColor = USER_COLORS[0].hex;
let savedSessions = [];
let domainActive = false;

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  await loadUsers();
  buildColorPicker();
  await loadCurrentTab();
  await loadSessions();
  bindEvents();
});

async function loadUsers() {
  return new Promise((resolve) => {
    chrome.storage.local.get('users', (result) => {
      users = result.users || [];
      resolve();
    });
  });
}

async function saveUsers() {
  return chrome.storage.local.set({ users });
}

async function loadCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;

  currentTabId = tab.id;
  currentTabUrl = tab.url || '';

  // Update tab info in header
  let hostname = '—';
  try {
    hostname = new URL(currentTabUrl).hostname;
  } catch {}
  document.getElementById('tabUrl').textContent = hostname;
  document.getElementById('tabTitle').textContent = tab.title || tab.url || 'Unknown tab';

  // Check if this domain is configured
  const domainCheck = await sendMessage({ type: 'CHECK_DOMAIN', url: currentTabUrl });
  domainActive = domainCheck?.active || false;
  updateDomainBanner(hostname);

  // Get current assignment for this tab
  currentAssignment = await sendMessage({ type: 'GET_ASSIGNMENT', tabId: tab.id });
  updateAssignmentUI();
  populateUserDropdown();
}

function updateDomainBanner(hostname) {
  const banner = document.getElementById('domainBanner');
  const label = document.getElementById('domainLabel');
  const enableBtn = document.getElementById('enableBtn');
  const mainPanel = document.getElementById('mainPanel');
  const addUserPanel = document.getElementById('addUserPanel');
  const sessionsPanel = document.getElementById('sessionsPanel');

  if (domainActive) {
    banner.className = 'domain-banner active';
    label.textContent = `Active on ${hostname}`;
    enableBtn.classList.add('hidden');
    mainPanel.classList.remove('hidden');
    addUserPanel.classList.remove('hidden');
    sessionsPanel.classList.remove('hidden');
  } else {
    banner.className = 'domain-banner inactive';
    label.textContent = `Not enabled for ${hostname}`;
    enableBtn.classList.remove('hidden');
    enableBtn.dataset.hostname = hostname;
    // Hide session panels when domain not configured
    mainPanel.classList.add('hidden');
    addUserPanel.classList.add('hidden');
    sessionsPanel.classList.add('hidden');
  }
}

async function loadSessions() {
  savedSessions = await sendMessage({ type: 'LIST_SESSIONS' }) || [];
  renderSessionsList();

  const info = await sendMessage({ type: 'GET_STORAGE_INFO' });
  if (info) {
    document.getElementById('storageInfo').textContent = `storage: ${info.usedKB}KB / ${info.maxMB}MB`;
  }
}

// ── UI builders ───────────────────────────────────────────────────────────────
function buildColorPicker() {
  const container = document.getElementById('colorPicker');
  USER_COLORS.forEach(({ hex }) => {
    const swatch = document.createElement('div');
    swatch.className = 'color-swatch' + (hex === selectedColor ? ' selected' : '');
    swatch.style.background = hex;
    swatch.title = hex;
    swatch.addEventListener('click', () => {
      selectedColor = hex;
      container.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
      swatch.classList.add('selected');
    });
    container.appendChild(swatch);
  });
}

function populateUserDropdown() {
  const select = document.getElementById('userSelect');
  select.innerHTML = '<option value="">— Assign user —</option>';
  users.forEach(user => {
    const option = document.createElement('option');
    option.value = user.userId;
    option.textContent = user.userName;
    if (currentAssignment?.userId === user.userId) option.selected = true;
    select.appendChild(option);
  });
}

function updateAssignmentUI() {
  const badge = document.getElementById('assignmentBadge');
  const text = document.getElementById('assignmentText');
  const dot = document.getElementById('tabStatusDot');
  const saveBtn = document.getElementById('saveBtn');
  const unassignBtn = document.getElementById('unassignBtn');

  if (currentAssignment) {
    badge.className = 'assignment-badge';
    badge.style.background = hexToRgba(currentAssignment.color, 0.12);
    badge.style.borderColor = hexToRgba(currentAssignment.color, 0.4);
    badge.style.color = currentAssignment.color;
    badge.querySelector('span').textContent = '●';
    text.textContent = currentAssignment.userName;
    dot.style.background = currentAssignment.color;
    saveBtn.disabled = false;
    unassignBtn.disabled = false;
  } else {
    badge.className = 'assignment-badge none';
    badge.style = '';
    badge.querySelector('span').textContent = '⬜';
    text.textContent = 'Not assigned';
    dot.style.background = 'var(--muted)';
    saveBtn.disabled = true;
    unassignBtn.disabled = true;
  }
}

function renderSessionsList() {
  const container = document.getElementById('sessionsList');

  if (!savedSessions || savedSessions.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        No sessions saved yet.<br>Assign a user and click Save Session.
      </div>`;
    return;
  }

  container.innerHTML = '';
  savedSessions.forEach(session => {
    const user = users.find(u => u.userId === session.userId);
    const color = user?.color || '#6b7080';
    const initials = (session.userName || session.userId).slice(0, 2).toUpperCase();
    const age = formatAge(session.capturedAt);

    const card = document.createElement('div');
    card.className = 'session-card';
    card.innerHTML = `
      <div class="session-avatar" style="background:${hexToRgba(color, 0.15)};color:${color}">${initials}</div>
      <div class="session-info">
        <div class="session-name">${escHtml(session.userName || session.userId)}</div>
        <div class="session-meta">
          ${session.cookieCount} cookies ·
          ${session.localStorageKeys} ls keys ·
          saved ${age}
        </div>
      </div>
      <div class="session-actions">
        <button class="btn-icon" title="Apply to current tab" data-action="apply" data-userid="${session.userId}">▶</button>
        <button class="btn-icon danger" title="Delete session" data-action="delete" data-userid="${session.userId}">✕</button>
      </div>
    `;
    container.appendChild(card);
  });
}

// ── Event bindings ────────────────────────────────────────────────────────────
function bindEvents() {
  // Settings button → open options page
  document.getElementById('settingsBtn').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  // Quick enable for current domain
  document.getElementById('enableBtn').addEventListener('click', async () => {
    const hostname = document.getElementById('enableBtn').dataset.hostname;
    if (!hostname) return;

    // Extract root domain (strip subdomains for the permission request)
    const parts = hostname.split('.');
    let domain = hostname;
    if (hostname !== 'localhost' && parts.length > 2) {
      domain = parts.slice(-2).join('.');
    }

    // Request permission — Chrome shows its own prompt
    const origins = domain === 'localhost'
      ? ['*://localhost/*']
      : [`*://${domain}/*`, `*://*.${domain}/*`];

    let granted = false;
    try {
      granted = await chrome.permissions.request({ origins });
    } catch (e) {
      showToast('Permission denied', 'error');
      return;
    }

    if (!granted) {
      showToast('Permission denied', 'error');
      return;
    }

    // Tell service worker to register
    const result = await sendMessage({ type: 'ADD_DOMAIN', domain });
    if (result?.success) {
      domainActive = true;
      updateDomainBanner(hostname);
      showToast(`Enabled for ${domain}`, 'success');
    }
  });

  // Assign user to current tab
  document.getElementById('assignBtn').addEventListener('click', async () => {
    const userId = document.getElementById('userSelect').value;
    if (!userId) return showToast('Select a user first', 'error');

    const user = users.find(u => u.userId === userId);
    if (!user) return;

    await sendMessage({
      type: 'ASSIGN_USER',
      tabId: currentTabId,
      userId: user.userId,
      userName: user.userName,
      color: user.color
    });

    currentAssignment = user;
    updateAssignmentUI();
    showToast(`Tab assigned to ${user.userName}`, 'success');
    await loadSessions();
  });

  // Save current session
  document.getElementById('saveBtn').addEventListener('click', async () => {
    if (!currentAssignment) return;
    document.getElementById('saveBtn').disabled = true;
    document.getElementById('saveBtn').textContent = 'Saving...';

    try {
      await sendMessage({
        type: 'SAVE_SESSION',
        tabId: currentTabId,
        userId: currentAssignment.userId
      });
      showToast('Session saved!', 'success');
      await loadSessions();
    } catch (e) {
      showToast('Save failed', 'error');
    } finally {
      document.getElementById('saveBtn').disabled = false;
      document.getElementById('saveBtn').textContent = 'Save Session';
    }
  });

  // Unassign tab
  document.getElementById('unassignBtn').addEventListener('click', async () => {
    await sendMessage({ type: 'UNASSIGN_TAB', tabId: currentTabId });
    currentAssignment = null;
    updateAssignmentUI();
    document.getElementById('userSelect').value = '';
    showToast('Tab unassigned', 'success');
  });

  // Add new user
  document.getElementById('addUserBtn').addEventListener('click', async () => {
    const name = document.getElementById('newUserName').value.trim();
    if (!name) return showToast('Enter a user name', 'error');

    const userId = 'user_' + Date.now();
    const newUser = { userId, userName: name, color: selectedColor };
    users.push(newUser);
    await saveUsers();

    document.getElementById('newUserName').value = '';
    populateUserDropdown();
    showToast(`User "${name}" added`, 'success');
  });

  // Session card actions
  document.getElementById('sessionsList').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;

    const action = btn.dataset.action;
    const userId = btn.dataset.userid;

    if (action === 'apply') {
      const user = users.find(u => u.userId === userId);
      if (user) {
        await sendMessage({
          type: 'ASSIGN_USER',
          tabId: currentTabId,
          ...user
        });
      }
      await sendMessage({ type: 'APPLY_SESSION', tabId: currentTabId, userId });
      showToast('Session applied to tab', 'success');
      currentAssignment = users.find(u => u.userId === userId) || null;
      updateAssignmentUI();
    }

    if (action === 'delete') {
      await sendMessage({ type: 'CLEAR_SESSION', userId });
      showToast('Session deleted', 'success');
      await loadSessions();
    }
  });

  // Refresh
  document.getElementById('refreshBtn').addEventListener('click', async () => {
    await loadCurrentTab();
    await loadSessions();
    showToast('Refreshed', 'success');
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function sendMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        console.warn('[Prism popup]', chrome.runtime.lastError.message);
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
  setTimeout(() => { toast.className = 'toast'; }, 2200);
}

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function formatAge(timestamp) {
  if (!timestamp) return 'unknown';
  const diff = Date.now() - timestamp;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function escHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
