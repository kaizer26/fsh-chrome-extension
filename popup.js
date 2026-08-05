// popup.js — FASIH Extensions popup logic
const ROLES = CONFIG.ROLES;

let selectedAction = null;
let activeTabId = null;
let kabList = [];
let progKabList = [];
let surveyList = [];
let currentSurveyDetail = null;
let selectedPeriodIdx = null;

/* ═══════════════════════════════════════════════════════
   TABS
   ═══════════════════════════════════════════════════════ */
const tabNames = ['menu', 'progress', 'automasi'];
tabNames.forEach(t => {
  document.getElementById('tab-' + t).addEventListener('click', () => {
    tabNames.forEach(x => {
      document.getElementById('tab-' + x).classList.toggle('active', x === t);
      document.getElementById('pane-' + x).classList.toggle('active', x === t);
    });
  });
});

/* ═══════════════════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════════════════ */
function showStep(id) {
  document.querySelectorAll('#pane-menu .step').forEach(el => el.classList.add('hidden'));
  document.getElementById(id).classList.remove('hidden');
}

function appendLog(text, type) {
  const logEl = document.getElementById('run-log');
  if (!logEl) return;
  const line = document.createElement('div');
  line.className = 'log-' + (type || 'info');
  line.textContent = text;
  logEl.appendChild(line);
  logEl.scrollTop = logEl.scrollHeight;
}

async function getCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab;
}

function sendToTab(msg, callback) {
  if (!activeTabId) return;
  chrome.tabs.sendMessage(activeTabId, msg, callback);
}

/* Helper: get survey+period+group context for current selection */
function getContext() {
  if (!currentSurveyDetail) return null;
  const pIdx = parseInt(document.getElementById('sel-period').value);
  if (isNaN(pIdx) || !currentSurveyDetail.periods[pIdx]) return null;
  return {
    surveyId: currentSurveyDetail.id,
    surveyName: currentSurveyDetail.name,
    periodId: currentSurveyDetail.periods[pIdx].id,
    periodName: currentSurveyDetail.periods[pIdx].name,
    groupId: currentSurveyDetail.regionGroupId,
    templateId: currentSurveyDetail.templateId,
  };
}

/* ═══════════════════════════════════════════════════════
   STEP 1: SURVEY & PERIOD SELECTION
   ═══════════════════════════════════════════════════════ */
async function loadSurveys() {
  const surveyType = document.getElementById('sel-survey-type').value;
  const selSurvey = document.getElementById('sel-survey');
  selSurvey.disabled = true;
  selSurvey.innerHTML = '<option>Memuat daftar survey...</option>';
  document.getElementById('sel-period').disabled = true;
  document.getElementById('sel-period').innerHTML = '<option>Pilih survey dulu</option>';
  document.getElementById('btn-survey-next').disabled = true;

  sendToTab({ type: 'GET_SURVEYS', surveyType }, (resp) => {
    if (chrome.runtime.lastError || !resp?.ok) {
      selSurvey.innerHTML = '<option>Gagal memuat survey</option>';
      return;
    }
    surveyList = resp.data || [];
    selSurvey.innerHTML = '';
    surveyList.forEach((s, i) => {
      const opt = document.createElement('option');
      opt.value = i;
      opt.textContent = s.name;
      selSurvey.appendChild(opt);
    });
    selSurvey.disabled = false;
    if (surveyList.length > 0) loadPeriods();
  });
}

async function loadPeriods() {
  const selPeriod = document.getElementById('sel-period');
  const idx = parseInt(document.getElementById('sel-survey').value);
  if (isNaN(idx) || !surveyList[idx]) return;

  selPeriod.disabled = true;
  selPeriod.innerHTML = '<option>Memuat periode...</option>';
  document.getElementById('btn-survey-next').disabled = true;
  currentSurveyDetail = null;

  sendToTab({ type: 'GET_SURVEY_DETAIL', surveyId: surveyList[idx].id }, (resp) => {
    if (chrome.runtime.lastError || !resp?.ok) {
      selPeriod.innerHTML = '<option>Gagal memuat</option>';
      return;
    }
    currentSurveyDetail = resp.data;
    const periods = currentSurveyDetail.periods || [];
    selPeriod.innerHTML = '';
    periods.forEach((p, i) => {
      const opt = document.createElement('option');
      opt.value = i;
      opt.textContent = p.name;
      selPeriod.appendChild(opt);
    });
    selPeriod.disabled = false;
    document.getElementById('btn-survey-next').disabled = periods.length === 0;
  });
}

document.getElementById('sel-survey-type').addEventListener('change', loadSurveys);
document.getElementById('sel-survey').addEventListener('change', loadPeriods);
document.getElementById('sel-period').addEventListener('change', () => {
  document.getElementById('btn-survey-next').disabled = !getContext();
});

/* STEP 1 → STEP 2: Lanjutkan */
document.getElementById('btn-survey-next').addEventListener('click', () => {
  const ctx = getContext();
  if (!ctx) { alert('Pilih survey dan periode terlebih dahulu!'); return; }

  // Show survey info banner
  document.getElementById('survey-info').innerHTML =
    '📊 <strong>' + ctx.surveyName + '</strong><br>📅 ' + ctx.periodName;

  showStep('step-region');
  loadKabupaten();
});

/* Back button */
document.getElementById('btn-back-survey').addEventListener('click', () => {
  showStep('step-survey');
});

/* ═══════════════════════════════════════════════════════
   STEP 2: PROVINCE & KABUPATEN (uses groupId from survey)
   ═══════════════════════════════════════════════════════ */
document.getElementById('sel-prov').addEventListener('change', loadKabupaten);

async function loadKabupaten() {
  const ctx = getContext();
  if (!ctx) return;

  const kabSel = document.getElementById('sel-kab');
  const kabLoading = document.getElementById('kab-loading');
  kabSel.style.display = 'none';
  kabLoading.classList.remove('hidden');

  const prov = document.getElementById('sel-prov').value;

  // Pass the groupId from survey so content.js uses it
  sendToTab({ type: 'GET_KABS_BY_GROUP', groupId: ctx.groupId, prov }, (response) => {
    kabLoading.classList.add('hidden');
    if (chrome.runtime.lastError || !response?.ok) {
      kabSel.style.display = 'none';
      return;
    }
    kabList = response.kabs;
    kabSel.innerHTML = '';
    kabList.forEach((k, i) => {
      const opt = document.createElement('option');
      opt.value = i; opt.textContent = k.name;
      kabSel.appendChild(opt);
    });
    kabSel.style.display = 'block';
  });
}

/* ═══════════════════════════════════════════════════════
   ACTION BUTTONS
   ═══════════════════════════════════════════════════════ */
document.querySelectorAll('.btn-menu').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.btn-menu').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    selectedAction = btn.dataset.action;
    document.getElementById('btn-execute').disabled = !selectedAction;
    document.getElementById('filter-section').classList.toggle('hidden',
      !['approve', 'approve_anomali', 'revoke', 'reject', 'scrape_detail'].includes(selectedAction));
  });
});

/* ═══════════════════════════════════════════════════════
   EXECUTE BUTTON
   ═══════════════════════════════════════════════════════ */
document.getElementById('btn-execute').addEventListener('click', async () => {
  if (!selectedAction || kabList.length === 0) return;

  const ctx = getContext();
  if (!ctx) { alert('Survey/Periode belum dipilih!'); return; }

  const kabIdx = parseInt(document.getElementById('sel-kab').value);
  const kab = kabList[kabIdx];
  if (!kab) return;

  showStep('step-running');
  document.getElementById('run-log').innerHTML = '';
  document.getElementById('run-status-text').textContent = 'Memulai ' + selectedAction + '...';

  const filterText = document.getElementById('filter-ids').value;
  const filterIds = filterText.split('\n').map(s => s.trim()).filter(s => s.length > 5);

  const msg = {
    surveyId: ctx.surveyId, periodId: ctx.periodId,
    groupId: ctx.groupId, templateId: ctx.templateId,
    kabId: kab.id, kabCode: kab.code,
  };

  if (selectedAction === 'scrape_wilayah') {
    sendToTab({ type: 'FETCH_SCRAPE_WILAYAH', ...msg });
  } else if (selectedAction === 'scrape_detail') {
    sendToTab({ type: 'FETCH_SCRAPE_DETAIL', ...msg, filterIds });
  } else if (['approve', 'approve_anomali', 'revoke', 'reject'].includes(selectedAction)) {
    sendToTab({ type: 'FETCH_ACTION', actionType: selectedAction, ...msg, filterIds });
  } else if (selectedAction === 'email') {
    sendToTab({ type: 'FETCH_EMAIL', periodId: ctx.periodId, kabId: kab.id, groupId: ctx.groupId });
  } else if (selectedAction === 'alokasi') {
    sendToTab({ type: 'GET_SURVEY_ROLES', surveyId: ctx.surveyId }, (resp) => {
      const roleIds = (resp?.ok && resp.data) ? resp.data.map(r => r.id) : [ROLES.pencacah.id, ROLES.pengawas.id];
      sendToTab({ type: 'FETCH_ALOKASI', surveyId: ctx.surveyId, periodId: ctx.periodId, roleIds });
    });
    return;
  }
});

/* ═══════════════════════════════════════════════════════
   CANCEL, RESULTS, RETRY, CONFIRM
   ═══════════════════════════════════════════════════════ */
document.getElementById('btn-run-cancel').addEventListener('click', () => sendToTab({ type: 'CANCEL' }));
document.getElementById('btn-view-results').addEventListener('click', () => chrome.tabs.create({ url: chrome.runtime.getURL('results.html') }));
document.getElementById('btn-back-menu').addEventListener('click', () => {
  chrome.storage.session.remove('fasih');
  init();
});
document.getElementById('btn-retry').addEventListener('click', () => {
  chrome.storage.session.remove('fasih');
  init();
});



/* ═══════════════════════════════════════════════════════
   PANE: PROGRESS
   ═══════════════════════════════════════════════════════ */
function progShow(id) {
  document.querySelectorAll('#pane-progress .step').forEach(el => el.classList.add('hidden'));
  document.getElementById(id).classList.remove('hidden');
}

function progAppendLog(text, type) {
  const logEl = document.getElementById('prog-log');
  if (!logEl) return;
  const line = document.createElement('div');
  line.className = 'log-' + (type || 'info');
  line.textContent = text;
  logEl.appendChild(line);
  logEl.scrollTop = logEl.scrollHeight;
}

async function selectProgressRole(roleKey) {
  const role = ROLES[roleKey];
  progShow('prog-step-loading');
  const prov = document.getElementById('prog-sel-prov').value;

  sendToTab({ type: 'GET_KABS', role, prov }, (response) => {
    if (chrome.runtime.lastError || !response?.ok) {
      progShow('prog-step-role');
      alert(response?.error || 'Gagal mengambil kabupaten');
      return;
    }
    progKabList = response.kabs;
    renderProgKabList();
    progShow('prog-step-kabs');
    document.getElementById('prog-btn-start').dataset.roleKey = roleKey;
  });
}

function renderProgKabList() {
  const listEl = document.getElementById('prog-kab-list');
  listEl.innerHTML = '';
  progKabList.forEach((kab, i) => {
    const label = document.createElement('label');
    label.className = 'kab-item';
    const chk = document.createElement('input');
    chk.type = 'checkbox'; chk.dataset.index = i;
    chk.addEventListener('change', updateProgStartBtn);
    const span = document.createElement('span');
    span.textContent = kab.name;
    label.appendChild(chk); label.appendChild(span);
    listEl.appendChild(label);
  });
}

function updateProgStartBtn() {
  const checked = document.querySelectorAll('#prog-kab-list input:checked').length;
  document.getElementById('prog-btn-start').disabled = checked === 0;
  document.getElementById('prog-kab-count').textContent = checked + ' dipilih';
}

document.getElementById('prog-chk-all').addEventListener('change', function () {
  document.querySelectorAll('#prog-kab-list input').forEach(c => { c.checked = this.checked; });
  updateProgStartBtn();
});

document.getElementById('btn-pengawas').addEventListener('click', () => selectProgressRole('pengawas'));
document.getElementById('btn-pencacah').addEventListener('click', () => selectProgressRole('pencacah'));

document.getElementById('prog-btn-start').addEventListener('click', async () => {
  const chosen = [...document.querySelectorAll('#prog-kab-list input:checked')].map(c => progKabList[+c.dataset.index]);
  const roleKey = document.getElementById('prog-btn-start').dataset.roleKey || 'pencacah';
  progShow('prog-step-progress');
  document.getElementById('prog-log').innerHTML = '';
  await chrome.storage.session.set({ fasih: { state: 'running', statusText: 'Memulai...' } });
  sendToTab({ type: 'FETCH_PROGRESS', role: ROLES[roleKey], kabs: chosen });
});

document.getElementById('prog-btn-cancel').addEventListener('click', () => sendToTab({ type: 'CANCEL' }));
document.getElementById('prog-btn-view').addEventListener('click', () => chrome.tabs.create({ url: chrome.runtime.getURL('results.html') }));
document.getElementById('prog-btn-restart').addEventListener('click', async () => {
  await chrome.storage.session.remove('fasih');
  progShow('prog-step-role');
});

/* ═══════════════════════════════════════════════════════
   PANE: AUTOMASI
   ═══════════════════════════════════════════════════════ */
let automasiResults = [];

function renderAutomasiState(st) {
  const setupEl = document.getElementById('auto-setup');
  const progEl = document.getElementById('auto-progress');
  const logEl = document.getElementById('auto-log');
  const statusTxt = document.getElementById('auto-status-text');
  const spinner = document.getElementById('auto-spinner');
  const btnExport = document.getElementById('btn-auto-export');
  const btnStop = document.getElementById('btn-auto-stop');
  const btnResume = document.getElementById('btn-auto-resume');

  automasiResults = st.results || [];

  if (st.isPaused) {
    setupEl.classList.add('hidden'); progEl.classList.remove('hidden');
    spinner.classList.add('hidden'); btnStop.classList.remove('hidden');
    btnResume.classList.remove('hidden');
    statusTxt.textContent = 'Menunggu Login (Jeda)';
    btnExport.classList.add('hidden');
  } else if (st.isRunning) {
    setupEl.classList.add('hidden'); progEl.classList.remove('hidden');
    spinner.classList.remove('hidden'); btnStop.classList.remove('hidden');
    btnResume.classList.add('hidden');
    statusTxt.textContent = 'Memproses [' + (st.currentIndex + 1) + '/' + st.queue.length + ']';
    btnExport.classList.add('hidden');
    
    // Auto-switch ke tab automasi jika sedang running
    if (document.getElementById('tab-menu').classList.contains('active')) {
      document.getElementById('tab-automasi').click();
    }
  } else if (st.currentIndex > 0) {
    setupEl.classList.add('hidden'); progEl.classList.remove('hidden');
    spinner.classList.add('hidden'); btnStop.classList.add('hidden');
    btnResume.classList.add('hidden');
    statusTxt.textContent = 'Selesai memproses ' + st.currentIndex + ' assignment.';
    if (automasiResults.length > 0) btnExport.classList.remove('hidden');
  } else {
    setupEl.classList.remove('hidden'); progEl.classList.add('hidden');
  }

  logEl.innerHTML = '';
  (st.logs || []).forEach(logItem => {
    const d = document.createElement('div');
    d.className = logItem.type === 'error' ? 'log-error' : logItem.type === 'success' ? 'log-ok' : logItem.type === 'warn' ? 'log-warn' : 'log-info';
    d.textContent = logItem.message;
    logEl.appendChild(d);
  });
  logEl.scrollTop = logEl.scrollHeight;
}

document.getElementById('btn-auto-start').addEventListener('click', () => {
  const text = document.getElementById('auto-input').value;
  const queue = text.split('\n').map(s => s.trim()).filter(s => s.length > 5);
  if (queue.length === 0) { alert('Masukkan minimal 1 Assignment ID'); return; }
  const actionType = document.getElementById('auto-action-type').value;

  const ctx = getContext();
  const periodId = ctx ? ctx.periodId : CONFIG.SURVEY_PERIOD_ID;

  chrome.runtime.sendMessage({ type: 'START_AUTOMASI', queue, actionType, periodId, tabId: activeTabId }, (res) => {
    if (!res || !res.ok) alert('Gagal memulai automasi.');
  });
});

document.getElementById('btn-auto-stop').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'STOP_AUTOMASI' });
});

document.getElementById('btn-auto-resume').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'RESUME_AUTOMASI' });
});

document.getElementById('btn-auto-export').addEventListener('click', () => {
  if (automasiResults.length === 0) return;
  const esc = v => { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  const headers = ['AssignmentID', 'ActionType', 'Status', 'Error', 'Notifikasi', 'AnomaliUsaha', 'AnomaliKeluarga'];
  const rows = automasiResults.map(r => [r.assignmentId, r.actionType, r.status, r.error, r.notifikasi, r.anomaliUsaha, r.anomaliKeluarga].map(esc).join(','));
  const csv = '\uFEFF' + headers.join(',') + '\n' + rows.join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'fasih_automasi_' + new Date().toISOString().slice(0, 10) + '.csv'; a.click();
});

/* ═══════════════════════════════════════════════════════
   MESSAGE LISTENER
   ═══════════════════════════════════════════════════════ */
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'PROGRESS') {
    appendLog(message.text, message.logType);
    progAppendLog(message.text, message.logType);
    if (message.statusText) {
      const el = document.getElementById('run-status-text');
      if (el) el.textContent = message.statusText;
      const pEl = document.getElementById('prog-progress-text');
      if (pEl) pEl.textContent = message.statusText;
    }
  } else if (message.type === 'DONE') {
    const result = message.result || {};
    showStep('step-done');
    const txt = 'Total: ' + (result.total || 0) + (result.csvRows ? ' | Baris CSV: ' + result.csvRows : '') + ' (' + (result.action || '') + ')';
    document.getElementById('done-summary').textContent = txt;
    progShow('prog-step-done');
    document.getElementById('prog-done-summary').textContent = txt;

  } else if (message.type === 'FETCH_ERROR') {
    appendLog('Error: ' + message.error, 'error');
    document.getElementById('error-detail').textContent = message.error;
    showStep('step-error');
  } else if (message.type === 'CANCELLED') {
    appendLog('⛔ Proses dibatalkan.', 'warn');
    showStep('step-region');
    progShow('prog-step-role');
  }
  if (message.type === 'AUTOMASI_STATE_UPDATE') {
    renderAutomasiState(message.state);
  }
});

/* ═══════════════════════════════════════════════════════
   INIT
   ═══════════════════════════════════════════════════════ */
async function init() {
  showStep('step-init');

  const stored = await chrome.storage.session.get('fasih');
  const state = stored.fasih?.state;

  if (state === 'running') {
    showStep('step-running');
    const el = document.getElementById('run-status-text');
    if (el) el.textContent = stored.fasih.statusText || 'Memproses...';
    (stored.fasih.log || []).forEach(entry => appendLog(entry.text, entry.logType));

  } else if (state === 'done') {
    showStep('step-done');
  } else {
    const tab = await getCurrentTab();
    if (!tab?.url?.includes(CONFIG.FASIH_HOST)) {
      showStep('step-wrong-page');
    } else if (!tab.url.includes(CONFIG.FASIH_APP)) {
      document.getElementById('wrong-page-msg').innerHTML = 'Buka <strong>fasih-sm.bps.go.id/app</strong> (bukan halaman lama).';
      showStep('step-wrong-page');
    } else {
      activeTabId = tab.id;
      chrome.tabs.sendMessage(tab.id, { type: 'PING' }, (response) => {
        if (chrome.runtime.lastError || !response?.ok) {
          document.getElementById('wrong-page-msg').innerHTML = 'Tab FASIH ditemukan, tapi perlu <strong>reload halaman</strong> (Ctrl+R).';
          showStep('step-wrong-page');
          return;
        }
        // Start at survey selection step
        showStep('step-survey');
        loadSurveys();
      });
    }
  }

  chrome.runtime.sendMessage({ type: 'GET_AUTOMASI_STATE' }, (resp) => {
    if (resp) renderAutomasiState(resp);
  });
}

init();
