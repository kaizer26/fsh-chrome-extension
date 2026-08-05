// content_actions.js — DOM Executor for Approve/Revoke/Reject automation
// Wrapped in IIFE to avoid variable collision with content.js
(function() {
'use strict';

const _sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function _log(text, level = 'info') {
  console.log(`[FASIH-ACTION] ${text}`);
  chrome.runtime.sendMessage({ type: 'AUTOMASI_LOG', text, level }).catch(() => {});
}

function _getElementByXPath(xpath) {
  return document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
}

async function _waitForXPath(xpath, timeout = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const el = _getElementByXPath(xpath);
    if (el) return el;
    await _sleep(200);
  }
  throw new Error(`Timeout waiting for XPath: ${xpath}`);
}

async function _extractAnomali() {
  const nodes = document.querySelectorAll('div[id^="anomali_"][id$="_deskripsi"]');
  const texts = [];
  nodes.forEach(n => { if (n.innerText.trim()) texts.push(n.innerText.trim()); });
  return texts.join(' | ');
}

async function runAutomationSequence() {
  const result = {
    status: 'SUCCESS',
    error: '',
    data: { notifikasi: '', anomaliUsaha: '', anomaliKeluarga: '' }
  };

  try {
    _log('Menunggu loading awal...');
    await _sleep(800);

    // 1. Klik sidebar CATATAN
    _log('Mencari menu CATATAN...');
    let btnCatatan;
    try {
      btnCatatan = await _waitForXPath('//div[@title="CATATAN" or contains(text(), "CATATAN")]');
    } catch (e) {
      if (document.body.innerText.includes('SSO') || document.body.innerText.includes('Masuk ke akun')) {
        throw new Error('LOGIN_REQUIRED');
      }
      throw e;
    }
    btnCatatan.click();
    await _sleep(300);

    // 2. Cek switch pertama
    _log('Mencari switch cek_anomali_button...');
    const switch1 = await _waitForXPath('//*[@id="cek_anomali_button"]//button[@role="switch"] | //*[@id="cek_anomali_button"]//input[@type="checkbox"]');
    const isChecked1 = switch1.getAttribute('aria-checked') === 'true' || switch1.checked === true;
    if (!isChecked1) { _log('Switch 1 OFF. Mengaktifkan...'); switch1.click(); await _sleep(300); }
    else { _log('Switch 1 sudah ON.'); }

    _log('Mencari switch anomali_admin...');
    const switch2 = await _waitForXPath('//*[@id="anomali_admin"]//button[@role="switch"] | //*[@id="anomali_admin"]//input[@type="checkbox"]');
    _log('Klik switch 2 (1/2)...'); switch2.click(); await _sleep(200);
    _log('Klik switch 2 (2/2)...'); switch2.click(); await _sleep(300);

    // 3. Ekstrak ANOMALI USAHA
    _log('Buka tab ANOMALI USAHA...');
    const tabUsaha = _getElementByXPath('//div[contains(translate(text(), "anomali", "ANOMALI"), "ANOMALI USAHA")]');
    if (tabUsaha) { tabUsaha.click(); await _sleep(300); result.data.anomaliUsaha = await _extractAnomali(); }

    // 4. Ekstrak ANOMALI KELUARGA
    _log('Buka tab ANOMALI KELUARGA...');
    const tabKeluarga = _getElementByXPath('//div[contains(translate(text(), "anomali", "ANOMALI"), "ANOMALI KELUARGA")]');
    if (tabKeluarga) { tabKeluarga.click(); await _sleep(300); result.data.anomaliKeluarga = await _extractAnomali(); }

    // 5. Submit form
    _log('Mencari tombol Submit (Kirim)...');
    const btnSubmit = await _waitForXPath('//*[@id="fasih-form-nav-submit-button"]');
    btnSubmit.click(); await _sleep(400);

    // 6. Dialog Kirim 1
    _log('Mencari tombol Kirim di dialog...');
    const btnDialogKirim = await _waitForXPath('//div[contains(@role, "dialog")]//button[contains(text(), "Kirim") or contains(text(), "KIRIM")]');
    btnDialogKirim.click(); await _sleep(400);

    // 7. Dialog Konfirmasi
    _log('Mencari tombol Konfirmasi di dialog...');
    const btnDialogKonfirm = await _waitForXPath('//div[contains(@role, "dialog")]//button[contains(text(), "Konfirmasi") or contains(text(), "KONFIRMASI")]');
    btnDialogKonfirm.click(); await _sleep(500);

    // 8. Rekam notifikasi (Toast)
    _log('Menunggu notifikasi (toast)...');
    try {
      const toastEl = await _waitForXPath('//ol/li//div[contains(@class, "text-sm") or contains(@class, "font-medium")]', 3000);
      result.data.notifikasi = toastEl.innerText.trim();
    } catch { result.data.notifikasi = 'Tidak terbaca/Timeout'; }

    _log('Sequence selesai.');
  } catch (err) {
    _log(`ERROR: ${err.message}`, 'error');
    result.status = 'ERROR';
    result.error = err.message;
  }

  chrome.runtime.sendMessage({ type: 'AUTOMASI_RESULT', payload: result }).catch(() => {});
}

async function runNewAutomationSequence(actionType) {
  const result = {
    status: 'SUCCESS',
    error: '',
    data: { notifikasi: '' }
  };

  try {
    _log('Menunggu loading awal halaman detail...');
    await _sleep(300);

    let btnText = '';
    let btnXPath = '';
    if (actionType === 'approve') {
      btnText = 'Approve';
      btnXPath = '//button[.//*[local-name()="svg" and contains(@class, "tabler-icon-check")]] | //*[@id="fasih"]/div/div/div[2]/div/div/div/button[3]';
    } else if (actionType === 'reject') {
      btnText = 'Reject';
      btnXPath = '//button[.//*[local-name()="svg" and contains(@class, "tabler-icon-x")]] | //*[@id="fasih"]/div/div/div[2]/div/div/div/button[2]';
    } else if (actionType === 'revoke') {
      btnText = 'Revoke';
      btnXPath = '//button[.//*[local-name()="svg" and contains(@class, "tabler-icon-arrow-back")]] | //*[@id="fasih"]/div/div/div[2]/div/div/div/button[1]';
    }

    _log(`Mencari tombol aksi: ${btnText}...`);
    let btnAksi;
    try {
      btnAksi = await _waitForXPath(btnXPath, 8000);
    } catch (e) {
      if (document.body.innerText.includes('SSO') || document.body.innerText.includes('Masuk ke akun')) {
        throw new Error('LOGIN_REQUIRED');
      }
      throw new Error(`Tombol ${btnText} tidak ditemukan. Kemungkinan tugas tidak berada pada status yang tepat.`);
    }

    _log(`Klik tombol ${btnText}...`);
    btnAksi.click();
    await _sleep(300);

    // Dialog Konfirmasi Pertama
    _log('Mencari tombol Konfirmasi pada dialog...');
    const btnDialogKonfirm = await _waitForXPath('//div[starts-with(@id, "radix-")]/div[2]/button[2] | //div[contains(@role, "dialog") or contains(@role, "alertdialog")]//button[2] | //button[contains(translate(text(), "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz"), "ya")]', 5000);
    _log('Klik tombol Konfirmasi...');
    btnDialogKonfirm.click();
    
    // Kirim hasil SEGERA sebelum halaman sempat navigate/redirect
    _log('Sequence selesai. Mengirim hasil...');
    chrome.runtime.sendMessage({ type: 'AUTOMASI_RESULT', payload: result }).catch(() => {});
    return; // Jangan lanjut, biarkan background.js lanjut ke berikutnya
  } catch (err) {
    _log(`ERROR: ${err.message}`, 'error');
    result.status = 'ERROR';
    result.error = err.message;
  }

  chrome.runtime.sendMessage({ type: 'AUTOMASI_RESULT', payload: result }).catch(() => {});
}

// Entry Point — listen for START_ACTION from background.js
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'START_ACTION') {
    _log('Menerima instruksi START_ACTION: ' + message.actionType);
    if (message.actionType === 'approve_anomali') {
      runAutomationSequence();
    } else {
      runNewAutomationSequence(message.actionType);
    }
    sendResponse({ ok: true });
  }
});

})();
