# AccountHop for AWS

A Chrome extension that redirects AWS console links through your company's SSO portal so you land in the correct account — no more 403s.

## Install

1. Clone this repo
2. Open `chrome://extensions`, enable **Developer mode**
3. **Load unpacked** → select the `src/` directory
4. Click the extension icon → **Settings** to configure

## Setup

You need three things:

| Setting | Example | Notes |
|---------|---------|-------|
| **Portal URL** | `mycompany.awsapps.com` | Just the hostname, no `https://` |
| **Default Role** | `Developer` | The permission set name from your portal |
| **Account Mappings** | `prod` → `123456789012` | Keywords that map URLs to accounts |

Each mapping has: **Keyword**, **Account ID**, **Label**, and an optional **Role Override** (if that account uses a different permission set than the default).

## How It Works

When you open an AWS console link, the extension:

1. **Detects the account** — looks for a 12-digit account ID in the URL (query params, path, ARN, embedded service URLs)
2. **Checks your mappings** — if no ID in the URL, matches keywords against your configured rules
3. **Redirects through the portal** — builds a deep link like `https://portal/start/#/console?account_id=...&role_name=...&destination=...`
4. **You land on the resource** in the correct account context

If the extension can't confidently determine the account, it shows a dropdown banner to pick one manually.

## Account Learning

The extension automatically remembers accounts it encounters:

- **From browsing** — when a URL contains an account ID, it's saved with the service and region for future suggestions
- **From your portal** — click "Import from Portal" in settings to pull in all your available accounts at once

Learned accounts show up in the chooser and popup but **never auto-redirect** — only explicit URL detection and keyword mappings do that.

## Project Structure

```
src/
  manifest.json
  background/service-worker.js    Navigation interception + redirect logic
  content/content.js              Account chooser banner + 403 detection
  content/portal-scraper.js       Portal account import
  shared/constants.js             Shared config + utilities
  shared/storage.js               Chrome storage wrappers
  shared/account-detector.js      Account detection pipeline
  popup/                          Extension popup
  options/                        Settings page
  icons/
```

## Privacy

All data stays in local Chrome storage. Nothing is sent externally. The extension only has access to AWS console and portal domains.
