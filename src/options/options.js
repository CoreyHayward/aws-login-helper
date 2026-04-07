document.addEventListener('DOMContentLoaded', async () => {
  const { MESSAGES, escapeHtml, isValidAccountId } = AWSAutoLogin;
  const settings = await AWSAutoLogin.getSettings();

  // --- Populate form ---
  document.getElementById('enabled').checked = settings.enabled;
  document.getElementById('portalUrl').value = settings.portalUrl;
  document.getElementById('roleName').value = settings.roleName;
  document.getElementById('defaultAccountId').value = settings.defaultAccountId;

  setRadio('autoRedirectMinConfidence', settings.autoRedirectMinConfidence);
  setRadio('fallbackBehavior', settings.fallbackBehavior);
  updateDefaultAccountVisibility();

  const mappingsBody = document.getElementById('mappingsBody');
  for (const m of settings.accountMappings) {
    addMappingRow(m.keyword, m.accountId, m.label, m.roleName);
  }

  // --- Event listeners ---
  document.getElementById('addMapping').addEventListener('click', () => addMappingRow('', '', '', ''));
  document.querySelectorAll('input[name="fallbackBehavior"]').forEach((r) =>
    r.addEventListener('change', updateDefaultAccountVisibility));
  document.getElementById('saveBtn').addEventListener('click', saveAll);
  document.getElementById('portalUrl').addEventListener('blur', (e) => {
    e.target.value = normalizePortalUrl(e.target.value);
  });
  document.getElementById('importPortal').addEventListener('click', importFromPortal);
  document.getElementById('clearLearned').addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ type: MESSAGES.CLEAR_LEARNED_ACCOUNTS });
    renderLearnedAccounts();
  });

  await renderLearnedAccounts();

  // --- Mapping rows ---

  function addMappingRow(keyword, accountId, label, roleName) {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td><input type="text" class="mapping-keyword" value="${escapeHtml(keyword)}" placeholder="prod"></td>
      <td><input type="text" class="mapping-account" value="${escapeHtml(accountId)}" placeholder="123456789012"></td>
      <td><input type="text" class="mapping-label" value="${escapeHtml(label)}" placeholder="Production"></td>
      <td><input type="text" class="mapping-role" value="${escapeHtml(roleName)}" placeholder="Use default"></td>
      <td><button type="button" class="btn-delete" title="Remove">&times;</button></td>
    `;
    row.querySelector('.btn-delete').addEventListener('click', () => row.remove());
    mappingsBody.appendChild(row);
  }

  // --- Helpers ---

  function setRadio(name, value) {
    const el = document.querySelector(`input[name="${name}"][value="${value}"]`);
    if (el) el.checked = true;
  }

  function getRadio(name, fallback) {
    return document.querySelector(`input[name="${name}"]:checked`)?.value || fallback;
  }

  function updateDefaultAccountVisibility() {
    const show = getRadio('fallbackBehavior', 'prompt') === 'default';
    document.getElementById('defaultAccountField').style.display = show ? 'block' : 'none';
  }

  function normalizePortalUrl(value) {
    return value.trim()
      .replace(/^https?:\/\//, '')
      .replace(/\/start\/?.*$/, '')
      .replace(/\/+$/, '');
  }

  function clearErrors() {
    document.querySelectorAll('.error').forEach((el) => (el.textContent = ''));
    document.querySelectorAll('.mapping-account').forEach((el) => (el.style.borderColor = ''));
  }

  // --- Save ---

  async function saveAll() {
    clearErrors();
    let valid = true;

    const portalUrl = normalizePortalUrl(document.getElementById('portalUrl').value);
    const roleName = document.getElementById('roleName').value.trim();
    const enabled = document.getElementById('enabled').checked;
    const autoRedirectMinConfidence = getRadio('autoRedirectMinConfidence', 'high');
    const fallbackBehavior = getRadio('fallbackBehavior', 'prompt');
    const defaultAccountId = document.getElementById('defaultAccountId').value.trim();

    if (!portalUrl) {
      document.getElementById('portalUrlError').textContent = 'Portal URL is required';
      valid = false;
    }
    if (!roleName) {
      document.getElementById('roleNameError').textContent = 'Role name is required';
      valid = false;
    }
    if (fallbackBehavior === 'default' && defaultAccountId && !isValidAccountId(defaultAccountId)) {
      document.getElementById('defaultAccountIdError').textContent = 'Must be exactly 12 digits';
      valid = false;
    }

    const accountMappings = [];
    for (const row of document.querySelectorAll('#mappingsBody tr')) {
      const keyword = row.querySelector('.mapping-keyword').value.trim();
      const accountId = row.querySelector('.mapping-account').value.trim();
      const label = row.querySelector('.mapping-label').value.trim();
      const roleName = row.querySelector('.mapping-role').value.trim();
      if (!keyword && !accountId) continue;
      if (accountId && !isValidAccountId(accountId)) {
        row.querySelector('.mapping-account').style.borderColor = '#d13212';
        valid = false;
      }
      if (keyword || accountId) accountMappings.push({ keyword, accountId, label, roleName });
    }

    if (!valid) return;

    await AWSAutoLogin.saveSettings({
      enabled, portalUrl, roleName, accountMappings,
      fallbackBehavior, defaultAccountId, autoRedirectMinConfidence,
    });

    flash('saveStatus', 'Saved successfully', '#1a8c1a');
  }

  // --- Learned accounts ---

  async function renderLearnedAccounts() {
    const { learnedAccounts } = await chrome.runtime.sendMessage({ type: MESSAGES.GET_LEARNED_ACCOUNTS });
    const entries = Object.values(learnedAccounts || {}).sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));

    const emptyEl = document.getElementById('learnedAccountsEmpty');
    const tableEl = document.getElementById('learnedTable');
    const clearBtn = document.getElementById('clearLearned');
    const body = document.getElementById('learnedBody');

    if (entries.length === 0) {
      emptyEl.style.display = 'block';
      tableEl.style.display = 'none';
      clearBtn.style.display = 'none';
      return;
    }

    emptyEl.style.display = 'none';
    tableEl.style.display = 'table';
    clearBtn.style.display = 'inline-block';
    body.innerHTML = '';

    for (const entry of entries) {
      const row = document.createElement('tr');
      const tags = (arr) => (arr || []).map((v) => `<span class="tag">${escapeHtml(v)}</span>`).join('') || '--';
      const src = entry.source === 'portal-import' ? 'portal-import' : 'detected';
      const srcLabel = entry.source === 'portal-import' ? 'Portal' : 'Detected';

      row.innerHTML = `
        <td><code>${entry.accountId}</code></td>
        <td>${escapeHtml(entry.label || '--')}</td>
        <td>${tags(entry.services)}</td>
        <td>${tags(entry.regions)}</td>
        <td><span class="source-badge ${src}">${srcLabel}</span></td>
        <td><button type="button" class="btn-promote">Promote</button></td>
      `;
      row.querySelector('.btn-promote').addEventListener('click', () => {
        addMappingRow('', entry.accountId, entry.label || '', '');
        const btn = row.querySelector('.btn-promote');
        btn.textContent = 'Added';
        btn.disabled = true;
      });
      body.appendChild(row);
    }
  }

  // --- Portal import ---

  async function importFromPortal() {
    const portalUrl = normalizePortalUrl(document.getElementById('portalUrl').value);
    if (!portalUrl) {
      flash('importStatus', 'Configure portal URL first', '#d13212');
      return;
    }

    flash('importStatus', 'Opening portal...', '#666');

    const tab = await chrome.tabs.create({ url: `https://${portalUrl}/start`, active: true });

    // Wait for tab to finish loading
    await new Promise((resolve) => {
      const onUpdate = (id, info) => {
        if (id === tab.id && info.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(onUpdate);
          resolve();
        }
      };
      chrome.tabs.onUpdated.addListener(onUpdate);
      setTimeout(() => { chrome.tabs.onUpdated.removeListener(onUpdate); resolve(); }, 15000);
    });

    // Give dynamic content time to render
    await new Promise((r) => setTimeout(r, 2000));
    flash('importStatus', 'Scanning for accounts...', '#666');

    try {
      const response = await chrome.tabs.sendMessage(tab.id, { type: MESSAGES.SCRAPE_PORTAL_ACCOUNTS });
      const accounts = response?.accounts || [];

      if (accounts.length === 0) {
        flash('importStatus', 'No accounts found. Make sure you are signed into the portal.', '#d13212', 5000);
        return;
      }

      await chrome.runtime.sendMessage({ type: MESSAGES.IMPORT_PORTAL_ACCOUNTS, accounts });
      flash('importStatus', `Imported ${accounts.length} account(s)`, '#1a8c1a');
      renderLearnedAccounts();
    } catch {
      flash('importStatus', 'Import failed. Make sure the portal page is loaded and you are signed in.', '#d13212', 5000);
    }
  }

  function flash(id, text, color, duration = 3000) {
    const el = document.getElementById(id);
    el.textContent = text;
    el.style.color = color;
    if (duration) setTimeout(() => { el.textContent = ''; }, duration);
  }
});
