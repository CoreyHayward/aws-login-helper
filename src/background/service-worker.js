importScripts(
  '../shared/constants.js',
  '../shared/storage.js',
  '../shared/account-detector.js'
);

const {
  MESSAGES, LOOP_TTL_MS, isAwsConsoleUrl, isValidAccountId,
  detectAccount, getSettings, getRedirectLog, saveRedirectLog,
  getLearnedAccounts, saveLearnedAccounts, learnAccount, createLearnedEntry,
} = AWSAutoLogin;

// --- In-memory state ---

let settingsCache = null;
let redirectLog = {};
const pendingPrompts = new Map();

const hydratedPromise = (async () => {
  redirectLog = await getRedirectLog();
})();

// --- Settings cache ---

async function getCachedSettings() {
  if (!settingsCache) settingsCache = await getSettings();
  return settingsCache;
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.settings) {
    settingsCache = { ...AWSAutoLogin.DEFAULT_SETTINGS, ...changes.settings.newValue };
  }
});

// --- Loop prevention helpers ---

function normalizeUrl(urlString) {
  try {
    const u = new URL(urlString);
    u.hash = '';
    u.searchParams.sort();
    for (const key of ['sessionId', 'token', 'X-Amz-Security-Token']) {
      u.searchParams.delete(key);
    }
    return u.origin + u.pathname + u.search;
  } catch {
    return urlString;
  }
}

function loopKey(tabId, url) {
  return `${tabId}:${normalizeUrl(url)}`;
}

function wasRecentlyRedirected(key) {
  const ts = redirectLog[key];
  return ts && (Date.now() - ts) < LOOP_TTL_MS;
}

function recordRedirect(key) {
  redirectLog[key] = Date.now();
  saveRedirectLog(redirectLog);
}

function consumeRedirectEntry(key) {
  delete redirectLog[key];
  saveRedirectLog(redirectLog);
}

function pruneStaleEntries() {
  const cutoff = Date.now() - (LOOP_TTL_MS * 2);
  let changed = false;
  for (const key of Object.keys(redirectLog)) {
    if (redirectLog[key] < cutoff) {
      delete redirectLog[key];
      changed = true;
    }
  }
  if (changed) saveRedirectLog(redirectLog);
}

// --- Portal URL helpers ---

function buildPortalUrl(settings, accountId, destinationUrl, roleOverride) {
  const portal = settings.portalUrl.replace(/\/$/, '');
  const base = portal.startsWith('https://') ? portal : `https://${portal}`;
  const role = roleOverride || settings.roleName;
  return `${base}/start/#/console?account_id=${accountId}` +
    `&role_name=${encodeURIComponent(role)}` +
    `&destination=${encodeURIComponent(destinationUrl)}`;
}

function isPortalUrl(urlString, portalUrl) {
  if (!portalUrl) return false;
  try {
    const hostname = new URL(urlString).hostname;
    const portalHost = portalUrl.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    return hostname === portalHost || hostname.endsWith('.' + portalHost);
  } catch {
    return false;
  }
}

// --- Core: intercept AWS console navigations ---

chrome.webNavigation.onBeforeNavigate.addListener(async (details) => {
  const { url, tabId, frameId } = details;
  if (frameId !== 0) return;
  if (!isAwsConsoleUrl(url)) return;

  await hydratedPromise;
  pruneStaleEntries();

  const settings = await getCachedSettings();
  if (!settings.enabled || !settings.portalUrl || !settings.roleName) return;
  if (isPortalUrl(url, settings.portalUrl)) return;

  // Loop prevention: if we just redirected this tab+URL, let it through once
  const key = loopKey(tabId, url);
  if (wasRecentlyRedirected(key)) {
    consumeRedirectEntry(key);
    return;
  }

  const learned = await getLearnedAccounts();
  const detection = detectAccount(url, settings.accountMappings, learned);

  const shouldAutoRedirect =
    detection.confidence === 'high' ||
    (detection.confidence === 'medium' && settings.autoRedirectMinConfidence !== 'high');

  if (detection.accountId && shouldAutoRedirect) {
    recordRedirect(key);
    learnAccount(detection.accountId, url);
    chrome.tabs.update(tabId, { url: buildPortalUrl(settings, detection.accountId, url, detection.roleName) });
    return;
  }

  // Medium confidence with high threshold, or low confidence with prompt fallback
  if (detection.confidence === 'medium' || settings.fallbackBehavior === 'prompt') {
    pendingPrompts.set(tabId, { detection, originalUrl: url });
    return;
  }

  if (settings.fallbackBehavior === 'default' && isValidAccountId(settings.defaultAccountId)) {
    recordRedirect(key);
    chrome.tabs.update(tabId, { url: buildPortalUrl(settings, settings.defaultAccountId, url) });
  }
});

// --- Message handlers ---

function handleGetDetection(message) {
  return Promise.all([getCachedSettings(), getLearnedAccounts()]).then(([settings, learned]) => ({
    detection: detectAccount(message.url, settings.accountMappings, learned),
    settings,
    learnedAccounts: learned,
  }));
}

function handleRedirectWithAccount(message, sender) {
  return getCachedSettings().then((settings) => {
    const tabId = message.tabId || sender.tab?.id;
    const { url, accountId, roleName } = message;
    if (typeof tabId !== 'number' || !isValidAccountId(accountId)) {
      return { success: false };
    }
    const key = loopKey(tabId, url);
    recordRedirect(key);
    learnAccount(accountId, url);
    chrome.tabs.update(tabId, { url: buildPortalUrl(settings, accountId, url, roleName) });
    pendingPrompts.delete(tabId);
    return { success: true };
  });
}

function handleGetStatus() {
  return getCachedSettings().then((settings) => ({
    enabled: settings.enabled,
    configured: !!(settings.portalUrl && settings.roleName),
    portalUrl: settings.portalUrl,
    roleName: settings.roleName,
  }));
}

function handleWasRecentlyRedirected(sender) {
  const tabId = sender.tab?.id;
  const url = sender.tab?.url || '';
  if (typeof tabId !== 'number') return { wasRedirected: false };
  return { wasRedirected: wasRecentlyRedirected(loopKey(tabId, url)) };
}

function handleShowChooser(sender) {
  const tabId = sender.tab?.id;
  if (typeof tabId !== 'number') {
    return Promise.resolve({ pending: null, accountMappings: [], learnedAccounts: {} });
  }
  const pending = pendingPrompts.get(tabId) || null;
  pendingPrompts.delete(tabId);

  return Promise.all([getCachedSettings(), getLearnedAccounts()]).then(([settings, learned]) => ({
    pending,
    accountMappings: settings.accountMappings,
    learnedAccounts: learned,
    originalUrl: pending?.originalUrl || sender.tab.url,
  }));
}

function handleGetLearnedAccounts() {
  return getLearnedAccounts().then((accounts) => ({ learnedAccounts: accounts }));
}

function handleClearLearnedAccounts() {
  return saveLearnedAccounts({}).then(() => ({ success: true }));
}

function handleImportPortalAccounts(message) {
  const accounts = message.accounts || [];
  return getLearnedAccounts().then(async (existing) => {
    for (const acct of accounts) {
      if (!isValidAccountId(acct.accountId)) continue;
      const entry = existing[acct.accountId] || createLearnedEntry(acct.accountId, 'portal-import');
      if (acct.label && !entry.label) entry.label = acct.label;
      entry.lastSeen = Date.now();
      if (!entry.source || entry.source === 'portal-import') entry.source = 'portal-import';
      existing[acct.accountId] = entry;
    }
    await saveLearnedAccounts(existing);
    return { success: true, count: accounts.length };
  });
}

// --- Message router ---

const handlers = {
  [MESSAGES.GET_DETECTION]: handleGetDetection,
  [MESSAGES.REDIRECT_WITH_ACCOUNT]: handleRedirectWithAccount,
  [MESSAGES.GET_STATUS]: handleGetStatus,
  [MESSAGES.WAS_RECENTLY_REDIRECTED]: handleWasRecentlyRedirected,
  [MESSAGES.SHOW_CHOOSER]: handleShowChooser,
  [MESSAGES.GET_LEARNED_ACCOUNTS]: handleGetLearnedAccounts,
  [MESSAGES.CLEAR_LEARNED_ACCOUNTS]: handleClearLearnedAccounts,
  [MESSAGES.IMPORT_PORTAL_ACCOUNTS]: handleImportPortalAccounts,
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handler = handlers[message.type];
  if (!handler) return;

  try {
    const result = handler(message, sender);
    if (result && typeof result.then === 'function') {
      result.then(sendResponse).catch((err) => {
        console.error(`[AccountHop for AWS] ${message.type}:`, err);
        sendResponse({ error: err.message });
      });
      return true; // keep message channel open for async response
    }
    sendResponse(result);
  } catch (err) {
    console.error(`[AccountHop for AWS] ${message.type}:`, err);
    sendResponse({ error: err.message });
  }
});

// --- Tab cleanup ---

chrome.tabs.onRemoved.addListener((tabId) => {
  let changed = false;
  for (const key of Object.keys(redirectLog)) {
    if (key.startsWith(tabId + ':')) {
      delete redirectLog[key];
      changed = true;
    }
  }
  if (changed) saveRedirectLog(redirectLog);
  pendingPrompts.delete(tabId);
});
