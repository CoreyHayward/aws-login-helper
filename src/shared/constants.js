self.AWSAutoLogin = self.AWSAutoLogin || {};

AWSAutoLogin.CONFIDENCE = {
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low',
};

AWSAutoLogin.ACCOUNT_ID_RE = /^\d{12}$/;

AWSAutoLogin.DEFAULT_SETTINGS = {
  portalUrl: '',
  roleName: '',
  accountMappings: [],       // [{ keyword, accountId, label, roleName? }]
  fallbackBehavior: 'prompt', // 'prompt' | 'ignore' | 'default'
  defaultAccountId: '',
  autoRedirectMinConfidence: 'high', // 'high' | 'medium'
  enabled: true,
};

AWSAutoLogin.LOOP_TTL_MS = 30000;

AWSAutoLogin.MESSAGES = {
  GET_DETECTION: 'GET_DETECTION',
  REDIRECT_WITH_ACCOUNT: 'REDIRECT_WITH_ACCOUNT',
  GET_STATUS: 'GET_STATUS',
  SHOW_CHOOSER: 'SHOW_CHOOSER',
  WAS_RECENTLY_REDIRECTED: 'WAS_RECENTLY_REDIRECTED',
  SCRAPE_PORTAL_ACCOUNTS: 'SCRAPE_PORTAL_ACCOUNTS',
  IMPORT_PORTAL_ACCOUNTS: 'IMPORT_PORTAL_ACCOUNTS',
  GET_LEARNED_ACCOUNTS: 'GET_LEARNED_ACCOUNTS',
  CLEAR_LEARNED_ACCOUNTS: 'CLEAR_LEARNED_ACCOUNTS',
};

// Services that are generic AWS pages, not specific resource views.
AWSAutoLogin.GENERIC_SERVICES = new Set([
  'console', 'home', 'support', 'billing', 'health',
]);

AWSAutoLogin.isAwsConsoleUrl = function (urlString) {
  try {
    const hostname = new URL(urlString).hostname;
    return hostname === 'console.aws.amazon.com' ||
      hostname.endsWith('.console.aws.amazon.com');
  } catch {
    return false;
  }
};

AWSAutoLogin.isValidAccountId = function (value) {
  return typeof value === 'string' && AWSAutoLogin.ACCOUNT_ID_RE.test(value);
};

AWSAutoLogin.escapeHtml = function (str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
};

// Merge manual mappings + learned accounts into a single list for UI display.
// Manual mappings come first; learned accounts that aren't already in mappings follow.
AWSAutoLogin.mergeAccountLists = function (mappings, learnedAccounts) {
  const manualIds = new Set((mappings || []).map((m) => m.accountId));
  return [
    ...(mappings || []).filter((m) => m.accountId).map((m) => ({
      accountId: m.accountId,
      label: m.label || m.keyword,
      roleName: m.roleName || null,
      source: 'manual',
    })),
    ...Object.values(learnedAccounts || {})
      .filter((l) => l.accountId && !manualIds.has(l.accountId))
      .map((l) => ({
        accountId: l.accountId,
        label: l.label || l.services.join(', ') || l.accountId,
        roleName: null,
        source: l.source || 'detected',
      })),
  ];
};
