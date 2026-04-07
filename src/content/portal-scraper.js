(() => {
  const { MESSAGES } = self.AWSAutoLogin || {};
  if (!MESSAGES) return;
  if (!window.location.href.includes('/start')) return;

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === MESSAGES.SCRAPE_PORTAL_ACCOUNTS) {
      sendResponse({ accounts: scrapeAccounts() });
    }
    return true;
  });

  function scrapeAccounts() {
    const accounts = [];
    const seen = new Set();

    // Strategy 1: structured elements with account-related class names
    const els = document.querySelectorAll(
      '[data-testid], [class*="account"], [class*="Account"], [class*="instance"]'
    );
    for (const el of els) extractFromElement(el, accounts, seen);

    // Strategy 2: walk body text for 12-digit IDs
    if (accounts.length === 0) extractFromBodyText(accounts, seen);

    // Strategy 3: JSON embedded in script tags
    extractFromScriptTags(accounts, seen);

    return accounts;
  }

  function extractFromElement(el, accounts, seen) {
    const text = el.textContent || '';
    const ids = text.match(/\b(\d{12})\b/g);
    if (!ids) return;

    for (const id of ids) {
      if (seen.has(id)) continue;
      seen.add(id);

      let label = '';
      const heading = el.querySelector('h2, h3, h4, strong, [class*="name"], [class*="Name"]');
      if (heading) {
        const t = heading.textContent.trim();
        if (t && !/^\d{12}$/.test(t)) label = t;
      }
      if (!label) {
        const before = text.split(id)[0].trim().split('\n').pop().trim();
        if (before && before.length < 100 && !/^\d+$/.test(before)) label = before;
      }

      accounts.push({ accountId: id, label: label.replace(/[#()\[\]]/g, '').trim() });
    }
  }

  function extractFromBodyText(accounts, seen) {
    const text = document.body?.innerText || '';
    const re = /([^\n]{1,80}?)\s*[#(]?\s*(\d{12})\b/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      const id = m[2];
      if (seen.has(id)) continue;
      seen.add(id);
      let label = m[1].trim();
      if (/^\d+$/.test(label) || label.length > 80) label = '';
      accounts.push({ accountId: id, label: label.replace(/[#()\[\]|]/g, '').trim() });
    }
  }

  function extractFromScriptTags(accounts, seen) {
    const scripts = document.querySelectorAll('script[type="application/json"], script#__NEXT_DATA__');
    for (const s of scripts) {
      try { walk(JSON.parse(s.textContent), accounts, seen, 0); } catch { /* ignore */ }
    }
  }

  function walk(obj, accounts, seen, depth) {
    if (depth > 10 || !obj || typeof obj !== 'object') return;
    if (Array.isArray(obj)) {
      for (const item of obj) walk(item, accounts, seen, depth + 1);
      return;
    }
    const id = obj.accountId || obj.account_id || obj.accountID || obj.id;
    if (typeof id === 'string' && /^\d{12}$/.test(id) && !seen.has(id)) {
      seen.add(id);
      accounts.push({
        accountId: id,
        label: String(obj.accountName || obj.account_name || obj.name || obj.label || ''),
      });
    }
    for (const v of Object.values(obj)) walk(v, accounts, seen, depth + 1);
  }
})();
