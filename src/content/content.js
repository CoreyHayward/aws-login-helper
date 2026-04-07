(() => {
  const { MESSAGES, escapeHtml, mergeAccountLists } = self.AWSAutoLogin || {};
  if (!MESSAGES) return;

  let bannerShown = false;

  setTimeout(init, 800);

  async function init() {
    // If this tab was just redirected through the portal, skip everything.
    const { wasRedirected } = await chrome.runtime.sendMessage({ type: MESSAGES.WAS_RECENTLY_REDIRECTED });
    if (wasRedirected) return;

    // Check for a pending prompt from the service worker (medium confidence or fallback).
    const response = await chrome.runtime.sendMessage({ type: MESSAGES.SHOW_CHOOSER });
    if (response?.pending) {
      showBanner(response);
      return;
    }

    // Wait for the page to fully settle before checking for access denied.
    setTimeout(() => {
      if (detectAccessDenied()) {
        chrome.runtime.sendMessage({ type: MESSAGES.SHOW_CHOOSER }).then(showBanner);
      }
    }, 3000);
  }

  function detectAccessDenied() {
    const title = document.title.toLowerCase();
    if (title.includes('sign in') || title.includes('error')) return true;

    const bodyText = (document.body?.innerText || '').substring(0, 5000).toLowerCase();
    const phrases = [
      'you are not authorized', 'access denied', 'session expired',
      'not authenticated', 'sign in to the console', 'you need to be signed in',
      'you don\'t have permissions',
    ];
    return phrases.some((p) => bodyText.includes(p));
  }

  function showBanner(response) {
    if (bannerShown) return;
    bannerShown = true;

    const pending = response?.pending || null;
    const originalUrl = response?.originalUrl || window.location.href;
    const allAccounts = mergeAccountLists(
      response?.accountMappings,
      response?.learnedAccounts,
    );

    const info = pending?.detection?.accountId
      ? `Detected: ${pending.detection.accountId} (${pending.detection.confidence} — ${pending.detection.matchSource})`
      : 'No account detected automatically.';

    const host = document.createElement('div');
    host.id = 'aws-auto-login-banner-host';
    const shadow = host.attachShadow({ mode: 'closed' });

    const options = allAccounts
      .map((a) => {
        const selected = pending?.detection?.accountId === a.accountId ? ' selected' : '';
        const role = a.roleName ? ` data-role="${escapeHtml(a.roleName)}"` : '';
        return `<option value="${a.accountId}"${role}${selected}>${escapeHtml(a.label)} (${a.accountId})</option>`;
      })
      .join('');

    shadow.innerHTML = `
      <style>
        :host { all: initial; }
        .banner {
          position: fixed; top: 0; left: 0; right: 0; z-index: 999999;
          background: #232f3e; color: #fff;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          font-size: 13px; padding: 10px 16px;
          display: flex; align-items: center; gap: 12px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        }
        .text { flex: 1; }
        .info { font-size: 11px; color: #aaa; margin-top: 2px; }
        select { padding: 5px 8px; border: 1px solid #555; border-radius: 4px; background: #fff; color: #111; font-size: 13px; }
        button { padding: 6px 14px; border: none; border-radius: 4px; font-size: 13px; font-weight: 500; cursor: pointer; }
        .go { background: #ff9900; color: #fff; }
        .go:hover { background: #ec8c04; }
        .go:disabled { background: #666; cursor: default; }
        .dismiss { background: transparent; color: #aaa; border: 1px solid #555; }
        .dismiss:hover { color: #fff; border-color: #888; }
      </style>
      <div class="banner">
        <div class="text">
          <strong>AWS Login Helper</strong> &mdash; Choose an account to redirect through the portal.
          <div class="info">${info}</div>
        </div>
        <select id="sel"><option value="">Select account...</option>${options}</select>
        <button class="go" id="go" disabled>Redirect</button>
        <button class="dismiss" id="x">Dismiss</button>
      </div>
    `;
    document.body.prepend(host);

    const sel = shadow.getElementById('sel');
    const go = shadow.getElementById('go');

    if (sel.value) go.disabled = false;
    sel.addEventListener('change', () => { go.disabled = !sel.value; });

    go.addEventListener('click', () => {
      if (!sel.value) return;
      go.disabled = true;
      go.textContent = 'Redirecting...';
      const selectedOption = sel.options[sel.selectedIndex];
      chrome.runtime.sendMessage({
        type: MESSAGES.REDIRECT_WITH_ACCOUNT,
        tabId: null,
        url: originalUrl,
        accountId: sel.value,
        roleName: selectedOption?.dataset?.role || null,
      });
    });

    shadow.getElementById('x').addEventListener('click', () => {
      host.remove();
      bannerShown = false;
    });
  }
})();
