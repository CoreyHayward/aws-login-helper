self.AWSAutoLogin = self.AWSAutoLogin || {};

// --- Settings ---

AWSAutoLogin.getSettings = async function () {
  const result = await chrome.storage.local.get('settings');
  return { ...AWSAutoLogin.DEFAULT_SETTINGS, ...(result.settings || {}) };
};

AWSAutoLogin.saveSettings = async function (settings) {
  await chrome.storage.local.set({ settings });
};

// --- Redirect log (session-scoped, for loop prevention) ---

AWSAutoLogin.getRedirectLog = async function () {
  const result = await chrome.storage.session.get('redirectLog');
  return result.redirectLog || {};
};

AWSAutoLogin.saveRedirectLog = async function (log) {
  await chrome.storage.session.set({ redirectLog: log });
};

// --- Learned accounts ---

AWSAutoLogin.createLearnedEntry = function (accountId, source) {
  return {
    accountId,
    label: '',
    lastSeen: Date.now(),
    services: [],
    regions: [],
    resourcePatterns: [],
    source: source || 'detected',
  };
};

AWSAutoLogin.getLearnedAccounts = async function () {
  const result = await chrome.storage.local.get('learnedAccounts');
  return result.learnedAccounts || {};
};

AWSAutoLogin.saveLearnedAccounts = async function (accounts) {
  await chrome.storage.local.set({ learnedAccounts: accounts });
};

AWSAutoLogin.learnAccount = async function (accountId, urlString) {
  if (!AWSAutoLogin.isValidAccountId(accountId)) return;

  const accounts = await AWSAutoLogin.getLearnedAccounts();
  const context = AWSAutoLogin.parseUrlContext(urlString);
  const existing = accounts[accountId] || AWSAutoLogin.createLearnedEntry(accountId, 'detected');

  existing.lastSeen = Date.now();

  if (context.service && !existing.services.includes(context.service)) {
    existing.services.push(context.service);
  }
  if (context.region && !existing.regions.includes(context.region)) {
    existing.regions.push(context.region);
  }
  if (context.resourcePattern && !existing.resourcePatterns.includes(context.resourcePattern)) {
    existing.resourcePatterns.push(context.resourcePattern);
    if (existing.resourcePatterns.length > 20) {
      existing.resourcePatterns = existing.resourcePatterns.slice(-20);
    }
  }

  accounts[accountId] = existing;
  await AWSAutoLogin.saveLearnedAccounts(accounts);
};
