document.addEventListener('DOMContentLoaded', async () => {
  const { MESSAGES, isAwsConsoleUrl, escapeHtml, mergeAccountLists } = AWSAutoLogin;

  const elEnabled = document.getElementById('enabled');
  const elNotConfigured = document.getElementById('notConfigured');
  const elNotAwsPage = document.getElementById('notAwsPage');
  const elDisabled = document.getElementById('disabled');
  const elDetection = document.getElementById('detection');
  const elQuickSwitch = document.getElementById('quickSwitch');

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const tabUrl = tab?.url || '';
  const status = await chrome.runtime.sendMessage({ type: MESSAGES.GET_STATUS });

  elEnabled.checked = status.enabled;

  // Always wire up the settings link regardless of state
  document.getElementById('openSettings').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
    window.close();
  });

  elEnabled.addEventListener('change', async () => {
    const result = await chrome.storage.local.get('settings');
    const current = result.settings || {};
    current.enabled = elEnabled.checked;
    await chrome.storage.local.set({ settings: current });
    window.close();
  });

  if (!status.enabled) {
    elDisabled.style.display = 'block';
    return;
  }

  if (!status.configured) {
    elNotConfigured.style.display = 'block';
    document.getElementById('openSettingsTop').addEventListener('click', () => {
      chrome.runtime.openOptionsPage();
      window.close();
    });
    return;
  }

  if (!isAwsConsoleUrl(tabUrl)) {
    elNotAwsPage.style.display = 'block';
    showQuickSwitch(tab.id, tabUrl);
    return;
  }

  // AWS console page — show detection result
  elDetection.style.display = 'block';
  document.getElementById('portalDisplay').textContent = status.portalUrl;
  document.getElementById('roleDisplay').textContent = status.roleName;

  const { detection } = await chrome.runtime.sendMessage({
    type: MESSAGES.GET_DETECTION, url: tabUrl,
  });

  document.getElementById('accountDisplay').textContent = detection.accountId || '--';
  document.getElementById('labelDisplay').textContent = detection.label || '--';
  document.getElementById('sourceDisplay').textContent = detection.matchSource;

  const badge = document.getElementById('confidenceBadge');
  badge.textContent = detection.confidence;
  badge.className = `badge ${detection.confidence}`;

  const redirectBtn = document.getElementById('redirectNow');
  if (!detection.accountId) {
    redirectBtn.disabled = true;
    redirectBtn.textContent = 'No account detected';
  }
  redirectBtn.addEventListener('click', async () => {
    if (!detection.accountId) return;
    await chrome.runtime.sendMessage({
      type: MESSAGES.REDIRECT_WITH_ACCOUNT,
      tabId: tab.id, url: tabUrl, accountId: detection.accountId, roleName: detection.roleName,
    });
    window.close();
  });

  showQuickSwitch(tab.id, tabUrl);

  // --- Quick switch ---

  async function showQuickSwitch(tabId, url) {
    const { settings, learnedAccounts } = await chrome.runtime.sendMessage({
      type: MESSAGES.GET_DETECTION,
      url: url || 'https://console.aws.amazon.com',
    });

    const allAccounts = mergeAccountLists(settings.accountMappings, learnedAccounts);
    if (allAccounts.length === 0) return;

    elQuickSwitch.style.display = 'block';
    const list = document.getElementById('accountList');
    list.innerHTML = '';

    for (const acct of allAccounts) {
      const btn = document.createElement('button');
      btn.className = 'btn-account';
      btn.innerHTML = `
        <span class="account-label">${escapeHtml(acct.label)}</span>
        <span class="account-id">${acct.accountId}</span>
      `;
      btn.addEventListener('click', async () => {
        const target = isAwsConsoleUrl(url) ? url : 'https://console.aws.amazon.com';
        await chrome.runtime.sendMessage({
          type: MESSAGES.REDIRECT_WITH_ACCOUNT,
          tabId, url: target, accountId: acct.accountId, roleName: acct.roleName,
        });
        window.close();
      });
      list.appendChild(btn);
    }
  }

});
