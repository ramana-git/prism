# Prism — One app, every user.

A Chrome extension for per-tab session isolation. Login once per user, switch tabs to switch identity. Built for multi-user web app testing without login/logout cycles.

Works with **any web app** — Gmail, your SaaS product, localhost dev servers, anything.

---

## Install

### From source (developer mode)
1. Clone or download this repo
2. Open Chrome → `chrome://extensions`
3. Enable **Developer mode** (top right)
4. Click **Load unpacked** → select the `prism/` folder

### Chrome Web Store
*Coming soon*

---

## Quick start

1. Click the Prism icon on any tab
2. Click **Enable** to activate Prism for that domain (Chrome will ask permission)
3. Create users: "Admin", "User A", "User B"
4. Assign a user to the tab → log in → click **Save Session**
5. Repeat on other tabs for other users
6. **Done.** Switching tabs auto-swaps the identity.

---

## How it works

Web apps typically store auth tokens in `localStorage` or cookies. Since `localStorage` is shared per-origin across all tabs, logging in as User B on Tab 2 overwrites User A's token on Tab 1.

Prism fixes this by intercepting tab switches:

1. **Outgoing tab** — captures current localStorage + cookies → saves as that user's snapshot
2. **Incoming tab** — restores the assigned user's saved snapshot
3. **Dispatches `StorageEvent`** — so your app (React, Vue, Angular, etc.) picks up the auth change

This is sequential isolation — only the active tab has the "real" session at any moment. Perfect for manual testing, QA workflows, and AI agent-driven testing.

---

## Features

| Feature | Description |
|---|---|
| **Configurable domains** | Add any domain from the popup or settings page. Chrome grants permissions per-domain. |
| **Tab-switch auto-swap** | Saves outgoing session, restores incoming — transparent identity switching |
| **Cookie isolation** | Full cookie save/restore including HttpOnly cookies via `chrome.cookies` API |
| **localStorage isolation** | Captures and restores all keys including JWT tokens |
| **sessionStorage isolation** | Same as localStorage |
| **Real-time JWT tracking** | Intercepts `localStorage.setItem` so new tokens are auto-captured |
| **Persistent sessions** | Saved to `chrome.storage.local` — survive browser restarts |
| **Named users with colors** | Create identities with color coding for easy identification |
| **Tab badge** | Shows user initials on the extension icon per tab |
| **One-click apply** | Click play on any saved session to swap the current tab's identity |

---

## Use cases

### QA testing
Test role-based access without logging in and out. Keep Admin, Editor, and Viewer tabs open simultaneously.

### AI agent testing
Let a browser automation agent switch between user tabs without re-authenticating. Each tab swap triggers automatic session restore.

### Multi-account workflows
Switch between multiple accounts on the same service (email, social, SaaS tools) across tabs.

### Development
Test multi-tenant apps, permission systems, or user-specific features by keeping multiple user sessions ready.

---

## Architecture

```
prism/
├── manifest.json                  # Manifest V3, optional_host_permissions
├── background/
│   └── service-worker.js          # Core: domain management, cookie/storage swap, tab-switch
├── content/
│   └── content.js                 # Injected into pages: intercepts localStorage writes
├── sessions/
│   └── session-store.js           # Persistence layer (chrome.storage.local)
├── popup/
│   ├── popup.html                 # Extension popup UI
│   └── popup.js                   # Popup logic + quick domain enable
├── options/
│   ├── options.html               # Full settings page
│   └── options.js                 # Domain add/remove with permission management
└── icons/
    ├── icon-16.png
    ├── icon-48.png
    └── icon-128.png
```

### Key design decisions

- **No hardcoded domains** — users configure targets at runtime via `chrome.permissions.request()`
- **`optional_host_permissions`** — Chrome prompts per-domain, so users grant access explicitly
- **Content scripts registered dynamically** — via `chrome.scripting.registerContentScripts()`, not in manifest
- **No build step** — vanilla JS, load unpacked and go
- **No external dependencies** — zero npm packages, no bundler, no framework

---

## Privacy

Prism stores all data locally in `chrome.storage.local`. It makes **zero network requests** and collects **no telemetry**. See [PRIVACY.md](PRIVACY.md) for details.

---

## Known limitations

### Sequential isolation only
Prism swaps sessions on tab switch, not in real-time. If two tabs make simultaneous background requests (e.g., polling), they share the same cookie jar. For interactive testing this is a non-issue.

### SameSite + Secure cookies
Edge cases exist with strict `SameSite` policies when restoring cookies. The `setCookie` function handles most scenarios.

### Token refresh
If your app auto-refreshes JWTs via `localStorage.setItem`, the content script captures them automatically. If refresh happens via `httpOnly` cookie, it's transparent.

---

## Contributing

1. Fork the repo
2. Create a feature branch
3. Make changes — no build step needed, just edit and reload in `chrome://extensions`
4. Submit a PR

---

## License

[MIT](LICENSE)
