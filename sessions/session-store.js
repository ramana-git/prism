/**
 * session-store.js
 * 
 * Persists and retrieves user sessions using chrome.storage.local.
 * 
 * Storage structure:
 *   sessions:{userId} → { userId, userName, capturedAt, url, cookies[], localStorage{}, sessionStorage{} }
 *   sessionIndex      → [userId, userId, ...]
 * 
 * chrome.storage.local has a 10MB limit per extension — more than enough
 * for cookie + localStorage snapshots of a typical web app.
 */

export class SessionStore {

  // Save (or overwrite) a session for a user
  async saveSession(userId, sessionData) {
    const key = `sessions:${userId}`;
    await chrome.storage.local.set({ [key]: sessionData });
    await this._addToIndex(userId);
  }

  // Get a saved session for a user, or null if none exists
  async getSession(userId) {
    const key = `sessions:${userId}`;
    return new Promise((resolve) => {
      chrome.storage.local.get(key, (result) => {
        resolve(result[key] || null);
      });
    });
  }

  // Delete a user's saved session
  async clearSession(userId) {
    const key = `sessions:${userId}`;
    await chrome.storage.local.remove(key);
    await this._removeFromIndex(userId);
  }

  // List all saved sessions (returns array of session objects)
  async listSessions() {
    const index = await this._getIndex();
    if (index.length === 0) return [];

    const keys = index.map(id => `sessions:${id}`);
    return new Promise((resolve) => {
      chrome.storage.local.get(keys, (result) => {
        const sessions = keys
          .map(k => result[k])
          .filter(Boolean)
          .map(s => ({
            userId: s.userId,
            userName: s.userName,
            capturedAt: s.capturedAt,
            url: s.url,
            cookieCount: s.cookies?.length || 0,
            localStorageKeys: Object.keys(s.localStorage || {}).length,
            sessionStorageKeys: Object.keys(s.sessionStorage || {}).length
          }));
        resolve(sessions);
      });
    });
  }

  // Get storage usage info (helpful for debugging)
  async getStorageInfo() {
    return new Promise((resolve) => {
      chrome.storage.local.getBytesInUse(null, (bytes) => {
        resolve({
          usedBytes: bytes,
          usedKB: Math.round(bytes / 1024),
          maxBytes: chrome.storage.local.QUOTA_BYTES,
          maxMB: Math.round(chrome.storage.local.QUOTA_BYTES / 1024 / 1024)
        });
      });
    });
  }

  // ── Index helpers ────────────────────────────────────────────────────────────

  async _getIndex() {
    return new Promise((resolve) => {
      chrome.storage.local.get('sessionIndex', (result) => {
        resolve(result.sessionIndex || []);
      });
    });
  }

  async _addToIndex(userId) {
    const index = await this._getIndex();
    if (!index.includes(userId)) {
      index.push(userId);
      await chrome.storage.local.set({ sessionIndex: index });
    }
  }

  async _removeFromIndex(userId) {
    const index = await this._getIndex();
    const updated = index.filter(id => id !== userId);
    await chrome.storage.local.set({ sessionIndex: updated });
  }
}
