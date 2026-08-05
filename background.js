// background.js — Automation Queue Manager for FASIH Extensions
// Uses a single reusable tab instead of creating new tabs per assignment

let state = {
  isRunning: false,
  queue: [],
  currentIndex: 0,
  results: [],
  currentTabId: null,
  logs: [],
  actionType: 'approve',
  periodId: '',
  isPaused: false,
};

function addLog(message, type = 'info') {
  state.logs.push({ time: new Date().toISOString(), message, type });
  if (state.logs.length > 200) state.logs.shift();
  notifyPopup();
}

function notifyPopup() {
  chrome.runtime.sendMessage({ type: 'AUTOMASI_STATE_UPDATE', state }).catch(() => {});
}

async function saveCheckpoint() {
  const cpKey = `checkpoint_auto_${state.actionType}_${state.periodId}`;
  try {
    await chrome.storage.local.set({ [cpKey]: state });
  } catch(e) {}
}

async function clearCheckpoint() {
  const cpKey = `checkpoint_auto_${state.actionType}_${state.periodId}`;
  try {
    await chrome.storage.local.remove([cpKey]);
  } catch(e) {}
}

async function processNext() {
  if (!state.isRunning) return;

  if (state.currentIndex >= state.queue.length) {
    state.isRunning = false;
    addLog('✅ Automasi selesai semua! (' + state.results.length + ' assignment)', 'success');
    notifyPopup();
    return;
  }

  const assignmentId = state.queue[state.currentIndex];
  addLog('Memproses [' + (state.currentIndex + 1) + '/' + state.queue.length + ']: ' + assignmentId.substring(0, 8) + '...', 'info');

  let url;
  if (state.actionType === 'approve_anomali') {
    url = 'https://fasih-sm.bps.go.id/app/assignment/' + state.periodId + '/' + assignmentId + '/edit';
  } else {
    url = 'https://fasih-sm.bps.go.id/app/assignment/' + state.periodId + '/' + assignmentId;
  }

  try {
    if (state.currentTabId) {
      try {
        await chrome.tabs.update(state.currentTabId, { url, active: false });
      } catch {
        // Tab was closed, create new one
        const tab = await chrome.tabs.create({ url, active: false });
        state.currentTabId = tab.id;
      }
    } else {
      // Fallback
      const tab = await chrome.tabs.create({ url, active: false });
      state.currentTabId = tab.id;
    }
    notifyPopup();

    addLog('Menunggu halaman dimuat...', 'info');
    await waitForTabLoad(state.currentTabId, 30000);
    
    // Tunggu SPA render (dipercepat, content script punya polling sendiri)
    await new Promise(r => setTimeout(r, 1000));
    
    addLog('Halaman dimuat. Memulai eksekusi...', 'info');

    // Memicu content script dengan retry
    try {
      await sendMessageWithRetry(state.currentTabId, { type: 'START_ACTION', actionType: state.actionType });
    } catch (retryErr) {
      addLog('Gagal menghubungi content script: ' + retryErr.message, 'error');
    }

    // Failsafe timeout: 60 seconds (shorter since we reuse tab)
    state.timeoutId = setTimeout(() => {
      handleTaskResult({ status: 'ERROR', error: 'Timeout (60s)', data: {} });
    }, 60000);
  } catch (e) {
    handleTaskResult({ status: 'ERROR', error: e.message, data: {} });
  }
}

async function handleTaskResult(resultPayload) {
  if (state.timeoutId) { clearTimeout(state.timeoutId); state.timeoutId = null; }

  const assignmentId = state.queue[state.currentIndex];

  state.results.push({
    assignmentId,
    actionType: state.actionType,
    status: resultPayload.status,
    error: resultPayload.error || '',
    notifikasi: resultPayload.data?.notifikasi || '',
    anomaliUsaha: resultPayload.data?.anomaliUsaha || '',
    anomaliKeluarga: resultPayload.data?.anomaliKeluarga || '',
  });

  if (resultPayload.status === 'ERROR') {
    if (resultPayload.error === 'LOGIN_REQUIRED') {
      if (state.timeoutId) { clearTimeout(state.timeoutId); state.timeoutId = null; }
      state.isRunning = false;
      state.isPaused = true;
      addLog('⚠️ Terdeteksi halaman login. Proses dijeda.', 'warn');
      notifyPopup();
      return;
    }
    addLog('❌ Gagal ' + assignmentId.substring(0, 8) + '...: ' + resultPayload.error, 'error');
  } else {
    addLog('✅ Selesai ' + assignmentId.substring(0, 8) + '... [' + (state.currentIndex + 1) + '/' + state.queue.length + ']', 'success');
  }

  // Move to next
  state.currentIndex++;
  await saveCheckpoint();

  // If done, save to results
  if (state.currentIndex >= state.queue.length) {
    chrome.storage.local.set({
      fasih_result: { 
        action: state.actionType, 
        date: new Date().toISOString(), 
        rows: state.results, 
        columns: ['assignmentId', 'actionType', 'status', 'error', 'notifikasi', 'anomaliUsaha', 'anomaliKeluarga'] 
      }
    });
    chrome.storage.session.set({ fasih: { state: 'done', result: { total: state.results.length, action: state.actionType } } });
    chrome.runtime.sendMessage({ type: 'DONE', result: { total: state.results.length, action: state.actionType } }).catch(() => {});
    await clearCheckpoint();
  }

  // Jeda 1 detik antar assignment
  setTimeout(processNext, 1000);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_AUTOMASI_STATE') {
    sendResponse(state);
    return false;
  }

  if (message.type === 'START_AUTOMASI') {
    if (state.isRunning) { sendResponse({ ok: false, error: 'Already running' }); return false; }
    
    // Check if resume
    if (message.resumeState) {
        state = message.resumeState;
        state.isRunning = true;
        state.isPaused = false;
        addLog(`Melanjutkan automasi dari checkpoint... (${state.currentIndex}/${state.queue.length})`, 'info');
    } else {
        state = {
          isRunning: true,
          queue: message.queue || [],
          currentIndex: 0,
          results: [],
          currentTabId: null,
          logs: [],
          actionType: message.actionType || 'approve',
          periodId: message.periodId || 'fd68e454-ba45-4b85-8205-f3bf777ded24',
          isPaused: false,
        };
        // Hapus checkpoint lama saat mulai baru
        clearCheckpoint();
        addLog('Memulai automasi ' + state.actionType + ' untuk ' + state.queue.length + ' assignment...', 'info');
    }
    
    processNext();
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === 'STOP_AUTOMASI') {
    state.isRunning = false;
    addLog('⛔ Automasi dihentikan paksa.', 'warn');
    state.isPaused = false;
    notifyPopup();
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === 'AUTOMASI_LOG') {
    if (sender.tab && sender.tab.id === state.currentTabId) {
      addLog('   ↪ ' + message.text, message.level || 'info');
    }
    return false;
  }

  if (message.type === 'AUTOMASI_RESULT') {
    if (sender.tab && sender.tab.id === state.currentTabId) {
      handleTaskResult(message.payload);
    }
    return false;
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (state.isRunning && tabId === state.currentTabId && changeInfo.url) {
    const url = changeInfo.url;
    if (!url.includes('/assignment/') && (url.includes('/login') || url.includes('/auth') || url.endsWith('/app/') || url.endsWith('/app'))) {
      if (state.timeoutId) { clearTimeout(state.timeoutId); state.timeoutId = null; }
      state.isRunning = false;
      state.isPaused = true;
      addLog('⚠️ Terdeteksi redirect login/session expired. Proses dijeda.', 'warn');
      notifyPopup();
    }
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'RESUME_AUTOMASI') {
    if (!state.isPaused) return false;
    state.isPaused = false;
    state.isRunning = true;
    addLog('▶ Melanjutkan automasi...', 'info');
    processNext();
    sendResponse({ ok: true });
    return false;
  }
});

function waitForTabLoad(tabId, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error('Timeout menunggu halaman dimuat (30s)'));
    }, timeoutMs);

    let sawLoading = false;

    function listener(updatedTabId, changeInfo) {
      if (updatedTabId !== tabId) return;
      // Pertama harus detect status 'loading' dulu (navigasi dimulai)
      if (changeInfo.status === 'loading') {
        sawLoading = true;
      }
      // Baru setelah loading, tunggu 'complete'
      if (sawLoading && changeInfo.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function sendMessageWithRetry(tabId, message, maxAttempts = 5, delay = 1000) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const resp = await chrome.tabs.sendMessage(tabId, message);
      return resp;
    } catch (err) {
      addLog(`   Percobaan ${i + 1}/${maxAttempts} gagal kontak tab, menunggu ${delay}ms...`, 'info');
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw new Error('Content script tidak merespons setelah ' + maxAttempts + ' percobaan');
}
