# Privacy Policy — Prism

**Last updated:** April 2026

## What Prism does

Prism is a browser extension that saves and restores browser sessions (cookies, localStorage, sessionStorage) per tab. It is designed for multi-user testing workflows.

## Data collection

Prism does **not** collect, transmit, or share any data. All data stays on your machine.

### What is stored locally

- **Session snapshots** (cookies, localStorage, sessionStorage key-value pairs) — stored in `chrome.storage.local` on your device only.
- **User profiles** (names and color preferences you create) — stored in `chrome.storage.local`.
- **Domain list** (sites you've enabled Prism for) — stored in `chrome.storage.local`.

### What is NOT collected

- No analytics or telemetry
- No network requests to external servers
- No browsing history tracking
- No personal information beyond what you explicitly save as session data

## Permissions explained

| Permission | Why |
|---|---|
| `cookies` | Read and write cookies to save/restore sessions |
| `tabs` | Detect tab switches to auto-swap sessions |
| `storage` | Persist sessions and settings locally |
| `scripting` | Inject scripts to capture/restore localStorage |
| `activeTab` | Read the current tab's URL to check domain status |
| Host permissions (per-domain) | Requested individually when you add a domain — required to access cookies and inject scripts on that site |

## Data deletion

Uninstalling the extension removes all stored data. You can also delete individual sessions or domains from within the extension.

## Contact

For questions about this privacy policy, open an issue on the GitHub repository.
