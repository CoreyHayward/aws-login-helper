# AWS Login Helper

A Chrome extension that redirects AWS console links through your company's AWS IAM Identity Center (SSO) portal, so you always land in the correct account and role.

## The Problem

You click an AWS console link shared in Slack, Jira, or a wiki. It opens, but you're signed into the wrong account — 403. You have to manually go to the portal, find the right account, sign in, then navigate back to the resource. This extension automates that.

## How It Works

```
You click an AWS link
        |
        v
Extension intercepts the navigation
        |
        v
Tries to detect the target account from the URL
        |
   +---------+----------+
   |         |          |
  Found    Unsure    Not found
   |         |          |
   v         v          v
 Auto     Prompt    Configurable:
redirect   user      prompt / ignore /
through   to pick    use default
portal    account
   |         |          |
   v         v          v
Portal authenticates you into the right account
        |
        v
You land on the original resource
```

The redirect URL looks like:

```
https://<portal>.awsapps.com/start/#/console
  ?account_id=123456789012
  &role_name=Developer
  &destination=https://eu-central-1.console.aws.amazon.com/sqs/...
```

## Account Detection

The extension extracts the AWS account ID from the URL using a pipeline of checks, in order:

| Step | What it checks | Confidence | Example |
|------|---------------|------------|---------|
| 1 | `?account_id=` query param | High | `?account_id=123456789012` |
| 2 | 12-digit number in URL path or fragment | High | `#/queues/.../123456789012/my-queue` |
| 3 | `amazonaws.com/<account>/` in embedded service URLs | High | `sqs.amazonaws.com/123456789012/queue` |
| 4 | ARN in the URL | High | `arn:aws:iam::123456789012:role/foo` |
| 5 | Manual keyword mapping | High | URL contains `prod` → mapped to account |
| 6 | Learned account suggestion | Low | Previously seen service+region combo |
| 7 | Environment keyword heuristic | Medium | URL token `dev` matches a mapping keyword |

- **High confidence** → auto-redirects through the portal
- **Medium confidence** → prompts you to confirm (configurable)
- **Low confidence** → suggests an account in the chooser but does not redirect

Only steps 1–5 can trigger automatic redirects. Steps 6–7 are suggestions only.

## Automatic Account Learning

The extension remembers accounts it encounters:

- **From browsing**: When you visit an AWS URL containing an account ID (in the path, ARN, etc.), the extension saves the account along with the service name, region, and resource patterns from that URL.
- **From your portal**: Click "Import from Portal" in settings to open your SSO portal and automatically scrape all available accounts.

Learned accounts appear in the account chooser and the popup quick-switch list. They **never** trigger automatic redirects — only manual keyword mappings and explicit URL detection do that.

## Installation

1. Clone this repository
2. Go to `chrome://extensions`
3. Enable **Developer mode** (top-right toggle)
4. Click **Load unpacked** and select the `src/` directory
5. Click the extension icon → **Settings**

## Configuration

### Portal URL

Your AWS access portal domain. Just the hostname — no `https://` or `/start`.

```
mycompany.awsapps.com
```

### Role Name

The permission set name from your portal (e.g. `Developer`, `AdministratorAccess`).

### Account Mappings

Keyword-to-account rules. When a keyword appears anywhere in an AWS console URL, the extension redirects to that account with **high confidence**.

| Keyword | Account ID | Label | Role Override |
|---------|------------|-------|---------------|
| `prod` | `123456789012` | Production | `ReadOnlyAccess` |
| `dev` | `234567890123` | Development | |
| `staging` | `345678901234` | Staging | |

**Role Override** is optional. If set, it overrides the global default role for that specific account. Leave blank to use the default role. This is useful when your org grants different permission sets per account (e.g. `ReadOnlyAccess` for prod, `AdministratorAccess` for dev).

### Redirect Behavior

- **Auto-redirect confidence**: High only (default) or Medium and above
- **Fallback when no account detected**: Show chooser, use a default account, or do nothing

## Extension UI

### Popup

Click the extension icon to see:
- Detection result for the current tab (account, confidence, source)
- "Redirect Now" button
- Quick-switch list of all configured + learned accounts
- Enable/disable toggle

### Account Chooser Banner

When the extension can't auto-redirect (medium/low confidence, or fallback = prompt), a banner appears at the top of the AWS page with a dropdown to pick an account.

### 403 Detection

If an AWS page shows an "access denied" or "sign in" error, the extension shows the account chooser banner after a short delay so you can switch accounts.

## Architecture

```
src/
  manifest.json
  shared/
    constants.js        Shared config, enums, utility functions
    storage.js          Chrome storage wrappers, learned account logic
    account-detector.js Detection pipeline + URL context parser
  background/
    service-worker.js   URL interception, redirect logic, message router
  content/
    content.js          AWS console: 403 detection, account chooser banner
    portal-scraper.js   Portal page: scrapes account list for import
  popup/                Extension popup (status + quick switch)
  options/              Settings page (config + learned accounts)
  icons/                Extension icons
```

### Key design decisions

- **Manifest V3** with `webNavigation.onBeforeNavigate` for interception (not `declarativeNetRequest`, because the redirect URL is dynamic)
- **No build step** — vanilla JS, `importScripts()` in the service worker, `<script>` tags elsewhere
- **Shared namespace** (`self.AWSAutoLogin`) for cross-context code sharing
- **`chrome.storage.session`** for loop prevention (survives service worker restarts, clears on browser close)
- **`chrome.storage.local`** for settings and learned accounts (persists across sessions)
- **Shadow DOM** for the content script banner (isolates styles from AWS CSS)
- **Learned accounts never auto-redirect** — they're suggestions for the chooser, not triggers

### Loop prevention

After redirecting a tab to the portal, the extension records the tab+URL pair. When the portal sends you back to the same URL, the extension recognizes it and lets the page load normally (one-use bypass, expires after 30 seconds).

## Permissions

| Permission | Why |
|-----------|-----|
| `webNavigation` | Intercept navigations before pages load |
| `storage` | Persist settings and learned accounts |
| `tabs` | Redirect tabs and query active tab |
| `activeTab` | Popup interaction with current tab |
| `*.console.aws.amazon.com` | Detect and redirect AWS console URLs |
| `*.awsapps.com` | Construct portal redirects + scrape portal accounts |

No data is collected or sent externally. All data stays in local Chrome storage.
