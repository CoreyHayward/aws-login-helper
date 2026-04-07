self.AWSAutoLogin = self.AWSAutoLogin || {};

// Parses service name, region, and resource pattern from an AWS console URL.
AWSAutoLogin.parseUrlContext = function (urlString) {
  try {
    const url = new URL(urlString);
    const hostname = url.hostname;

    // Region: from hostname prefix or ?region= param
    const regionMatch = hostname.match(/^([a-z]{2}-[a-z]+-\d+)\./);
    const region = regionMatch ? regionMatch[1] : (url.searchParams.get('region') || null);

    // Service: from hostname (e.g. "sqs.eu-central-1.console.aws...") or first path segment
    let service = null;
    const hostPrefix = hostname.replace('.console.aws.amazon.com', '').split('.')[0];
    if (hostPrefix && !/^[a-z]{2}-[a-z]+-\d+$/.test(hostPrefix) && hostPrefix !== 'console') {
      service = hostPrefix;
    }
    if (!service) {
      const firstPath = url.pathname.split('/').filter(Boolean)[0];
      if (firstPath && /^[a-z][a-z0-9-]+$/.test(firstPath)) {
        service = firstPath;
      }
    }

    // Resource pattern: extract name prefix after an account ID
    let resourcePattern = null;
    const decoded = decodeURIComponent(urlString);
    const resourceMatch = decoded.match(/\/\d{12}\/([a-zA-Z0-9][a-zA-Z0-9._-]+)/);
    if (resourceMatch) {
      const parts = resourceMatch[1].split('-');
      if (parts.length >= 2) {
        resourcePattern = parts.slice(0, 2).join('-') + '-*';
      }
    }

    return { service, region, resourcePattern };
  } catch {
    return { service: null, region: null, resourcePattern: null };
  }
};

// --- Individual detection steps (each returns a result or null) ---

function fromUrlParams(url) {
  const names = ['accountid', 'account_id', 'account'];
  for (const [key, value] of url.searchParams.entries()) {
    if (names.includes(key.toLowerCase()) && AWSAutoLogin.isValidAccountId(value)) {
      return { accountId: value, confidence: 'high', matchSource: 'url-param', label: null };
    }
  }
  return null;
}

function fromUrlPath(url) {
  const fullPath = url.pathname + decodeURIComponent(url.hash);
  for (const segment of fullPath.split('/').filter(Boolean)) {
    if (AWSAutoLogin.isValidAccountId(segment)) {
      return { accountId: segment, confidence: 'high', matchSource: 'url-path', label: null };
    }
  }
  return null;
}

function fromServiceUrl(urlString) {
  const decoded = decodeURIComponent(urlString);
  const match = decoded.match(/amazonaws\.com\/(\d{12})\//);
  if (match && AWSAutoLogin.isValidAccountId(match[1])) {
    return { accountId: match[1], confidence: 'high', matchSource: 'aws-service-url', label: null };
  }
  return null;
}

function fromArn(decodedUrl) {
  const match = decodedUrl.match(/arn:aws[a-z-]*:[^:]*:[^:]*:(\d{12})/);
  if (match) {
    return { accountId: match[1], confidence: 'high', matchSource: 'arn', label: null };
  }
  return null;
}

function fromKeywordMappings(decodedUrl, mappings) {
  if (!mappings || mappings.length === 0) return null;
  for (const m of mappings) {
    if (!m.keyword || !m.accountId) continue;
    if (decodedUrl.includes(m.keyword.toLowerCase())) {
      return {
        accountId: m.accountId, confidence: 'high', matchSource: 'exact-mapping',
        label: m.label || null, roleName: m.roleName || null,
      };
    }
  }
  return null;
}

function fromLearnedAccounts(urlString, learnedAccounts) {
  if (!learnedAccounts || Object.keys(learnedAccounts).length === 0) return null;
  const context = AWSAutoLogin.parseUrlContext(urlString);
  if (!context) return null;

  const hasRealService = context.service && !AWSAutoLogin.GENERIC_SERVICES.has(context.service);
  const matches = [];

  for (const entry of Object.values(learnedAccounts)) {
    let score = 0;
    if (hasRealService && entry.services.includes(context.service)) score++;
    if (context.region && entry.regions.includes(context.region)) score++;
    if (context.resourcePattern && entry.resourcePatterns.length > 0) {
      const prefix = context.resourcePattern.replace('-*', '-');
      if (entry.resourcePatterns.some((p) => p.replace('-*', '-') === prefix)) score += 2;
    }
    if (score > 0) matches.push({ entry, score });
  }

  if (matches.length === 0) return null;
  matches.sort((a, b) => b.score - a.score);

  // Learned accounts never auto-redirect — always LOW confidence.
  // They pre-select the best guess in the chooser UI.
  return {
    accountId: matches[0].entry.accountId,
    confidence: 'low',
    matchSource: 'learned-suggestion',
    label: matches[0].entry.label || null,
  };
}

function fromEnvHeuristics(urlString, mappings) {
  if (!mappings || mappings.length === 0) return null;
  const envKeywords = ['prod', 'production', 'staging', 'stg', 'dev', 'development', 'sandbox', 'test', 'qa', 'uat'];
  const tokens = urlString.toLowerCase().split(/[/\-_.?&=]+/).filter(Boolean);

  for (const token of tokens) {
    if (!envKeywords.includes(token)) continue;
    for (const m of mappings) {
      if (!m.keyword || !m.accountId) continue;
      if (m.keyword.toLowerCase() === token) {
        return {
          accountId: m.accountId, confidence: 'medium', matchSource: 'env-heuristic',
          label: m.label || null, roleName: m.roleName || null,
        };
      }
    }
  }
  return null;
}

// --- Main detection pipeline ---

AWSAutoLogin.detectAccount = function (urlString, accountMappings, learnedAccounts) {
  const noMatch = { accountId: null, confidence: 'low', matchSource: 'none', label: null };

  let url;
  try {
    url = new URL(urlString);
  } catch {
    return noMatch;
  }

  const decodedUrl = decodeURIComponent(urlString).toLowerCase();

  // Steps 1-4: explicit account ID in URL (HIGH confidence, auto-redirect)
  // Steps 5: manual keyword mappings (HIGH confidence, auto-redirect)
  // Step 6: learned accounts (LOW confidence, suggestion only)
  // Step 7: environment keyword heuristics (MEDIUM confidence)
  return fromUrlParams(url)
    || fromUrlPath(url)
    || fromServiceUrl(urlString)
    || fromArn(decodedUrl)
    || fromKeywordMappings(decodedUrl, accountMappings)
    || fromLearnedAccounts(urlString, learnedAccounts)
    || fromEnvHeuristics(urlString, accountMappings)
    || noMatch;
};
