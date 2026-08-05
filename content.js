// content.js — FASIH Extensions content script (main engine)
// Runs in context of fasih-sm.bps.go.id/app pages
// CONFIG is loaded via manifest content_scripts (config.js injected before this)

/* ═══════════════════════════════════════════════════════
   GLOBALS & HELPERS
   ═══════════════════════════════════════════════════════ */
let isRunning = false;
let currentRoleId = null;
let SIZE = null;
let seenRequests = null;
let abortController = null;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const jitter = (base, spread = CONFIG.DELAY_JITTER_MS) => base + Math.random() * spread;

function checkCancelled() {
  if (abortController && abortController.signal.aborted) {
    throw new DOMException('Proses dibatalkan oleh pengguna.', 'AbortError');
  }
}

const getCookie = (n) => {
  const m = document.cookie.match(new RegExp('(^|; )' + n + '=([^;]+)'));
  return m ? decodeURIComponent(m[2]) : null;
};

const getHeaders = () => {
  const xsrf = getCookie('XSRF-TOKEN');
  return { 'Content-Type': 'application/json', 'Accept': 'application/json', ...(xsrf ? { 'X-XSRF-TOKEN': xsrf } : {}) };
};

const findArr = (j) => {
  if (Array.isArray(j)) return j;
  for (const v of Object.values(j || {})) if (Array.isArray(v)) return v;
  if (j && j.data) return findArr(j.data);
  return [];
};
const pickId = (o) => { for (const v of Object.values(o)) if (typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}/i.test(v)) return v; };
const pickCode = (o) => { let b = null; for (const [k, v] of Object.entries(o)) { const s = String(v); if (/^\d{2,}$/.test(s)) { if (/code/i.test(k)) return s; b = b == null ? s : b; } } return b; };
const pickName = (o) => { for (const k of ['name', 'nama', 'regionName', 'label', 'namaWilayah']) if (o[k]) return o[k]; for (const v of Object.values(o)) if (typeof v === 'string' && /[a-zA-Z]/.test(v) && !/^\d/.test(v) && !v.includes('-')) return v; return ''; };
const regionObj = (r2 = null, r3 = null, r4 = null) => ({ region1Id: null, region2Id: r2, region3Id: r3, region4Id: r4, region5Id: null, region6Id: null, region7Id: null, region8Id: null, region9Id: null, region10Id: null });

function sendProgress(text, logType = 'info', statusText = null) {
  const msg = { type: 'PROGRESS', text, logType };
  if (statusText) msg.statusText = statusText;
  chrome.runtime.sendMessage(msg).catch(() => {});
  chrome.storage.session.get('fasih').then(s => {
    const prev = s.fasih || {};
    const log = prev.log || [];
    log.push({ text, logType });
    if (log.length > CONFIG.LOG_MAX) log.splice(0, log.length - CONFIG.LOG_MAX);
    const update = { ...prev, log };
    if (statusText) { update.state = 'running'; update.statusText = statusText; }
    chrome.storage.session.set({ fasih: update });
  }).catch(() => {});
}

/* ═══════════════════════════════════════════════════════
   FETCH HELPERS — with retry & exponential backoff
   ═══════════════════════════════════════════════════════ */
async function apiFetch(url, opts = {}) {
  const headers = { ...getHeaders(), ...(opts.headers || {}) };
  const fetchOpts = {
    method: opts.method || 'GET',
    credentials: 'include',
    headers,
    signal: abortController?.signal,
  };
  if (opts.body) fetchOpts.body = typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body);
  const res = await fetch(url, fetchOpts);
  return res;
}

async function apiFetchRetry(url, opts = {}, retries = CONFIG.MAX_RETRY, label = '') {
  for (let a = 0; a < retries; a++) {
    checkCancelled();
    let res;
    try { res = await apiFetch(url, opts); } catch (e) {
      if (e.name === 'AbortError') throw e;
      res = { ok: false, status: 0 };
    }

    // Periksa apakah diblokir WAF (Bot Protection)
    if (res && res.headers && res.headers.get('content-type')?.includes('text/html')) {
      const text = await res.clone().text().catch(() => '');
      if (text.includes('mendeteksi koneksi anda sebagai bot') || text.includes('BOT-')) {
        if (abortController) abortController.abort();
        throw new Error('Terdeteksi sebagai BOT oleh server FASIH. Mohon tunggu 15-30 menit atau ganti jaringan internet Anda, lalu coba lagi.');
      }
    }

    if (res.ok) return res;
    if ([0, 400, 401, 403, 408, 429, 500, 502, 503, 504].includes(res.status)) {
      const w = jitter(3000 * 1.5 ** a);
      sendProgress('   retry ' + label + ' (HTTP ' + res.status + ') ' + (w / 1000).toFixed(1) + 's', 'warn');
      await sleep(w);
      continue;
    }
    return res;
  }
  return { ok: false, status: 'exhausted' };
}

/* Run up to N promises concurrently (like ThreadPoolExecutor) */
async function parallelMap(items, fn, concurrency = CONFIG.MAX_WORKERS) {
  const results = [];
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      checkCancelled();
      const i = idx++;
      results[i] = await fn(items[i], i);
      await sleep(jitter(CONFIG.DELAY_MS));
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

/* ═══════════════════════════════════════════════════════
   REGION API
   ═══════════════════════════════════════════════════════ */
async function getRegion(level, params) {
  checkCancelled();
  const url = CONFIG.REGION_URL + '/' + level + '?' + new URLSearchParams(params);
  const res = await apiFetchRetry(url, {}, CONFIG.MAX_RETRY, 'region/' + level);
  if (!res.ok) throw new Error('region/' + level + ' HTTP ' + res.status);
  return findArr(await res.json()).map(o => ({ id: pickId(o), code: pickCode(o), name: pickName(o) }));
}

/* ═══════════════════════════════════════════════════════
   PROGRESS BY RESPONSIBILITY (from se-progress-extension)
   ═══════════════════════════════════════════════════════ */
async function callAssign(page, size, region) {
  checkCancelled();
  const payload = {
    surveyPeriodId: CONFIG.SURVEY_PERIOD_ID,
    surveyRoleId: currentRoleId,
    search: '', target: 'TARGET_ONLY', regionSummaryLevel: 6,
    page, size, region,
  };
  const cacheKey = JSON.stringify({ page, size, region });
  if (seenRequests && seenRequests.has(cacheKey)) return seenRequests.get(cacheKey);
  const res = await apiFetch(CONFIG.ASSIGN_URL, { method: 'POST', body: payload });
  const result = { ok: res.ok, status: res.status, json: res.ok ? await res.json() : null };
  if (seenRequests && result.ok) seenRequests.set(cacheKey, result);
  return result;
}

async function callRetry(page, size, region, label) {
  for (let a = 0; a < CONFIG.MAX_RETRY; a++) {
    checkCancelled();
    let r;
    try { r = await callAssign(page, size, region); } catch (e) {
      if (e.name === 'AbortError') throw e;
      r = { ok: false, status: 0 };
    }
    if (r.ok) return r;
    if ([0, 400, 401, 403, 408, 429, 500, 502, 503, 504].includes(r.status)) {
      const w = jitter(3000 * 1.5 ** a);
      sendProgress('   retry ' + label + ' p' + page + ' (HTTP ' + r.status + ') ' + (w / 1000).toFixed(1) + 's', 'warn');
      await sleep(w);
      continue;
    }
    return r;
  }
  return { ok: false, status: 'exhausted' };
}

async function fetchAll(region, label) {
  let recs = [], page = 0, total = null, error = false;
  while (true) {
    checkCancelled();
    const r = await callRetry(page, SIZE, region, label);
    if (!r.ok) { error = true; sendProgress('   gagal permanen ' + label + ' p' + page + ' (' + r.status + ')', 'error'); break; }
    total = r.json.data.totalElements;
    recs = recs.concat(r.json.data.content);
    if (r.json.data.last) break;
    if (recs.length >= CONFIG.CAP) break;
    page++;
    await sleep(jitter(CONFIG.DELAY_MS));
  }
  return { recs, total, error, capped: total != null && total > recs.length };
}

/* ═══════════════════════════════════════════════════════
   SURVEY HELPERS
   ═══════════════════════════════════════════════════════ */
async function getSurveyList(surveyType = 'pencacahan') {
  const res = await apiFetch(CONFIG.SURVEY_LIST + '?surveyType=' + surveyType, {
    method: 'POST',
    body: { pageNumber: 0, pageSize: 50, sortBy: 'CREATED_AT', sortDirection: 'DESC' },
  });
  if (!res.ok) throw new Error('Gagal mengambil daftar survei: HTTP ' + res.status);
  const data = await res.json();
  return (data.data?.content || []).map(s => ({ id: s.id, name: s.name }));
}

async function getSurveyDetail(surveyId) {
  const res = await apiFetchRetry(CONFIG.SURVEY_DETAIL + '/' + surveyId);
  if (!res.ok) throw new Error('Gagal ambil detail survei');
  const d = (await res.json()).data;
  return {
    id: d.id, name: d.name,
    regionGroupId: d.regionGroupId,
    templateId: d.surveyTemplates?.[d.surveyTemplates.length - 1]?.templateId,
    periods: (d.surveyPeriods || []).map(p => ({ id: p.id, name: p.name })),
  };
}

async function getSurveyRoles(surveyId) {
  const res = await apiFetchRetry(CONFIG.SURVEY_ROLES + '?surveyId=' + surveyId);
  if (!res.ok) return [];
  return (await res.json()).data || [];
}

async function getMyRole(periodId) {
  try {
    const res = await apiFetch(CONFIG.SURVEY_USER_INFO + '?surveyPeriodId=' + periodId);
    if (res.ok) return (await res.json()).data?.surveyRole?.description || 'Admin';
  } catch {}
  return 'Admin';
}

/* ═══════════════════════════════════════════════════════
   1. SCRAPE — fetch assignment details (like fasih_scraper menu #1)
   Uses recursive drill-down (kab→kec→desa) when bulk fetch fails
   ═══════════════════════════════════════════════════════ */

/* Helper: build region filter for datatable API */
function buildRegionFilter(periodId, regionOverrides) {
  const base = {
    surveyPeriodId: periodId, currentUserId: null,
    assignmentErrorStatusType: -1,
    filterTargetType: "TARGET_ONLY",
    region1Id: null, region2Id: null, region3Id: null, region4Id: null,
    region5Id: null, region6Id: null, region7Id: null, region8Id: null,
    region9Id: null, region10Id: null,
  };
  return { ...base, ...regionOverrides };
}

/* Helper: fetch assignments for a given region filter, with drill-down on failure */
async function fetchAssignmentsDrillDown(periodId, groupId, regionFilter, label, currentLevel, maxLevel) {
  checkCancelled();

  const payload = {
    draw: 1, start: 0, length: 1,
    columns: [], order: [], search: { value: "", regex: false },
    assignmentExtraParam: regionFilter,
  };

  // 1. Get total count for this region
  let countRes;
  try {
    countRes = await apiFetchRetry(CONFIG.ASSIGN_DATATABLE, { method: 'POST', body: payload }, CONFIG.MAX_RETRY, 'count-' + label);
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    sendProgress('❌ Gagal hitung ' + label + ': ' + e.message, 'error');
    return [];
  }

  if (!countRes.ok) {
    sendProgress('⚠️ Gagal hitung ' + label + ' (HTTP ' + countRes.status + ')', 'warn');
    return [];
  }

  const totalHit = (await countRes.json()).totalHit || 0;
  if (totalHit === 0) return [];

  // 2. If small enough, fetch directly
  if (totalHit <= 1000) {
    sendProgress('📥 ' + label + ': ' + totalHit + ' data (langsung)', 'info');
    const results = [];
    for (let start = 0; start < totalHit; start += 100) {
      checkCancelled();
      const bulkPayload = { ...payload, start, length: 100 };
      try {
        const res = await apiFetchRetry(CONFIG.ASSIGN_DATATABLE, { method: 'POST', body: bulkPayload }, CONFIG.MAX_RETRY, label + '-bulk-' + start);
        if (res.ok) {
          const data = (await res.json()).searchData || [];
          results.push(...data);
          sendProgress('   ✅ ' + label + ': ' + results.length + '/' + totalHit, 'ok');
        } else {
          sendProgress('   ⚠️ ' + label + ' halaman ' + start + ' gagal (HTTP ' + res.status + ')', 'warn');
        }
      } catch (e) {
        if (e.name === 'AbortError') throw e;
        sendProgress('   ⚠️ ' + label + ' halaman ' + start + ' error: ' + e.message, 'warn');
      }
      await sleep(jitter(CONFIG.DELAY_MS));
    }
    return results;
  }

  // 3. Too large → drill down to sub-regions
  if (currentLevel >= maxLevel) {
    // Already at max drill level, force paginated fetch
    sendProgress('📥 ' + label + ': ' + totalHit + ' data (paginated paksa)', 'warn');
    const results = [];
    for (let start = 0; start < totalHit; start += 100) {
      checkCancelled();
      const pagePayload = { ...payload, start, length: 100 };
      try {
        const res = await apiFetchRetry(CONFIG.ASSIGN_DATATABLE, { method: 'POST', body: pagePayload }, CONFIG.MAX_RETRY, label + '-p' + start);
        if (res.ok) {
          results.push(...((await res.json()).searchData || []));
        } else {
          sendProgress('   ⚠️ Gagal halaman ' + start + '/' + totalHit, 'warn');
        }
      } catch (e) {
        if (e.name === 'AbortError') throw e;
        sendProgress('   ⚠️ Error halaman ' + start + ': ' + e.message, 'warn');
      }
      await sleep(jitter(CONFIG.DELAY_MS));
    }
    sendProgress('   📊 ' + label + ': ' + results.length + '/' + totalHit + ' data diambil', results.length > 0 ? 'ok' : 'warn');
    return results;
  }

  // Drill down
  const nextLevel = currentLevel + 1;
  const levelKey = 'level' + nextLevel;
  const parentCode = regionFilter['region' + currentLevel + 'Id'] ? undefined : undefined;

  // Get sub-regions
  let subParams = { groupId };
  if (currentLevel === 2) {
    // Drill from kab → kec: need level2FullCode or level2Id
    // We use the kab code from the caller
    subParams.level2Id = regionFilter.region2Id;
  } else if (currentLevel === 3) {
    subParams.level3Id = regionFilter.region3Id;
  } else if (currentLevel === 4) {
    subParams.level4Id = regionFilter.region4Id;
  }

  let subRegions;
  try {
    subRegions = await getRegion(levelKey, subParams);
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    sendProgress('⚠️ Gagal ambil sub-region ' + levelKey + ' untuk ' + label + ': ' + e.message, 'warn');
    return [];
  }

  sendProgress('📂 ' + label + ': ' + totalHit + ' data → drill ' + subRegions.length + ' ' + levelKey, 'info');

  const allResults = [];
  for (const sub of subRegions) {
    checkCancelled();
    const subFilter = { ...regionFilter };
    subFilter['region' + nextLevel + 'Id'] = sub.id;

    const subLabel = (nextLevel <= 3 ? sub.name : label + '/' + sub.name);
    if (nextLevel <= 3) sendProgress('   📂 ' + sub.name + '...', 'info');

    const subData = await fetchAssignmentsDrillDown(periodId, groupId, subFilter, subLabel, nextLevel, maxLevel);
    allResults.push(...subData);
    await sleep(jitter(CONFIG.DELAY_MS / 2));
  }

  return allResults;
}

async function handleScrapeWilayah(surveyId, periodId, groupId, templateId, kabId, kabCode) {
  isRunning = true; abortController = new AbortController();
  sendProgress('Memulai scrape wilayah...', 'info', 'Scrape Wilayah: mengambil data...');

  try {
    const kecs = await getRegion('level3', { groupId, level2Id: kabId });
    sendProgress('Ditemukan ' + kecs.length + ' kecamatan', 'info');

    sendProgress('Mengambil daftar assignment (drill-down)...', 'info', 'Scrape Wilayah: daftar assignment...');
    const regionFilter = buildRegionFilter(periodId, { region2Id: kabId });
    const allAssignments = await fetchAssignmentsDrillDown(periodId, groupId, regionFilter, 'Kabupaten', 2, 5);

    const seen = new Set();
    const uniqueAssignments = [];
    for (const a of allAssignments) {
      const id = a.id || a.assignmentId;
      if (id && !seen.has(id)) { seen.add(id); uniqueAssignments.push(a); }
    }

    if (uniqueAssignments.length === 0) {
      sendProgress('⚠️ Tidak ada assignment ditemukan.', 'warn', 'Selesai (0 data)');
      chrome.storage.session.set({ fasih: { state: 'done', result: { total: 0, action: 'scrape_wilayah' } } });
      chrome.runtime.sendMessage({ type: 'DONE', result: { total: 0, action: 'scrape_wilayah' } }).catch(() => {});
      finish(); return;
    }

    sendProgress('Total unik: ' + uniqueAssignments.length + ' assignment.', 'info');

    const rows = uniqueAssignments.map(item => ({
      assignment_id: item.id || item.assignmentId,
      current_user: item.assignmentUsername || item.username || '',
      current_user_fullname: item.assignmentUserFullname || item.userFullName || '',
      status: item.assignmentStatusAlias || item.status || 'TIDAK DIAMBIL (DOWNLOAD AWAL)',
      identity: item.codeIdentity || item.identity || '',
      smallcode: item.regionSummaryLevel6 || item.smallcode || '',
      role_name: item.current_user_survey_role_name || '',
      region2_name: item.region2Name || '', region3_name: item.region3Name || '',
      region4_name: item.region4Name || '', region5_name: item.region5Name || '',
    }));

    sendProgress('Scrape Wilayah selesai! ' + rows.length + ' baris data.', 'ok', 'Selesai');

    chrome.storage.local.set({
      fasih_result: { action: 'scrape_wilayah', date: new Date().toISOString(), rows, columns: rows.length > 0 ? Object.keys(rows[0]) : [] },
    });
    chrome.storage.session.set({ fasih: { state: 'done', result: { total: rows.length, action: 'scrape_wilayah' } } });
    chrome.runtime.sendMessage({ type: 'DONE', result: { total: rows.length, action: 'scrape_wilayah' } }).catch(() => {});
  } catch (e) {
    if (e.name === 'AbortError') { finishCancelled(); return; }
    sendProgress('Error: ' + e.message, 'error', 'Gagal');
    chrome.runtime.sendMessage({ type: 'FETCH_ERROR', error: e.message }).catch(() => {});
  }
  finish();
}

async function handleScrapeDetail(surveyId, periodId, groupId, templateId, kabId, kabCode, filterIds = null) {
  isRunning = true; abortController = new AbortController();
  sendProgress('Memulai scrape detail...', 'info', 'Scrape Detail: memproses...');

  try {
    let uniqueAssignments = [];

    if (filterIds && filterIds.length > 0) {
      sendProgress('Menggunakan ' + filterIds.length + ' ID dari input manual...', 'info');
      uniqueAssignments = filterIds.map(id => ({ id }));
    } else {
      sendProgress('Mengambil daftar assignment (drill-down)...', 'info', 'Scrape Detail: daftar assignment...');
      const regionFilter = buildRegionFilter(periodId, { region2Id: kabId });
      const allAssignments = await fetchAssignmentsDrillDown(periodId, groupId, regionFilter, 'Kabupaten', 2, 5);

      const seen = new Set();
      for (const a of allAssignments) {
        const id = a.id || a.assignmentId;
        if (id && !seen.has(id)) { seen.add(id); uniqueAssignments.push(a); }
      }
    }

    if (uniqueAssignments.length === 0) {
      sendProgress('⚠️ Tidak ada assignment ditemukan.', 'warn', 'Selesai (0 data)');
      chrome.storage.session.set({ fasih: { state: 'done', result: { total: 0, action: 'scrape_detail' } } });
      chrome.runtime.sendMessage({ type: 'DONE', result: { total: 0, action: 'scrape_detail' } }).catch(() => {});
      finish(); return;
    }

    sendProgress('Total unik: ' + uniqueAssignments.length + ' assignment. Mengambil detail...', 'info', 'Scrape Detail: ' + uniqueAssignments.length + ' data...');

    const details = await parallelMap(uniqueAssignments, async (item, i) => {
      const aid = item.id || item.assignmentId;
      if ((i + 1) % 50 === 0) sendProgress('Detail ' + (i + 1) + '/' + uniqueAssignments.length, 'info', 'Detail ' + (i + 1) + '/' + uniqueAssignments.length);

      const fallback = {
        assignment_id: aid,
        current_user: item.assignmentUsername || item.username || '',
        current_user_fullname: item.assignmentUserFullname || item.userFullName || '',
        status: item.assignmentStatusAlias || item.status || 'ERROR FETCH DETAIL',
        identity: '', smallcode: '', longitude: '', latitude: '', role_name: '',
        data1: '', data2: '', data3: '', data4: '', data5: '',
        data6: '', data7: '', data8: '', data9: '', data10: '',
      };

      try {
        const url = CONFIG.ASSIGN_DETAIL + '?assignmentId=' + aid;
        const res = await apiFetchRetry(url, {}, 4, aid);
        if (!res.ok) { fallback.status = 'ERROR HTTP ' + res.status; return fallback; }
        const d = (await res.json()).data;
        if (!d) { fallback.status = 'ERROR EMPTY DATA'; return fallback; }

        const smallcode = extractDeepestFullCode(d.region);
        return {
          assignment_id: aid,
          current_user: d.current_user_username || '',
          current_user_fullname: d.current_user_fullname || '',
          status: d.assignment_status_alias || '',
          identity: d.code_identity || '',
          smallcode,
          longitude: d.longitude || '',
          latitude: d.latitude || '',
          role_name: d.current_user_survey_role_name || '',
          data1: flattenVal(d.data1), data2: flattenVal(d.data2), data3: flattenVal(d.data3),
          data4: flattenVal(d.data4), data5: flattenVal(d.data5), data6: flattenVal(d.data6),
          data7: flattenVal(d.data7), data8: flattenVal(d.data8), data9: flattenVal(d.data9),
          data10: flattenVal(d.data10),
        };
      } catch (e) {
        if (e.name === 'AbortError' || (e.message && e.message.includes('Terdeteksi sebagai BOT'))) throw e;
        fallback.status = 'ERROR EXCEPTION';
        return fallback;
      }
    });

    const rows = details.filter(Boolean);
    sendProgress('Scrape Detail selesai! ' + rows.length + ' baris data.', 'ok', 'Selesai');

    chrome.storage.local.set({
      fasih_result: { action: 'scrape_detail', date: new Date().toISOString(), rows, columns: rows.length > 0 ? Object.keys(rows[0]) : [] },
    });
    chrome.storage.session.set({ fasih: { state: 'done', result: { total: rows.length, action: 'scrape_detail' } } });
    chrome.runtime.sendMessage({ type: 'DONE', result: { total: rows.length, action: 'scrape_detail' } }).catch(() => {});
  } catch (e) {
    if (e.name === 'AbortError') { finishCancelled(); return; }
    sendProgress('Error: ' + e.message, 'error', 'Gagal');
    chrome.runtime.sendMessage({ type: 'FETCH_ERROR', error: e.message }).catch(() => {});
  }
  finish();
}

function flattenVal(val) {
  if (val == null) return '';
  if (Array.isArray(val)) return val.map(v => typeof v === 'object' ? (v.label || JSON.stringify(v)) : String(v)).join(', ');
  if (typeof val === 'object') return val.label || val.value || JSON.stringify(val);
  const s = String(val);
  return s.length > 1000 ? 'too long' : s;
}

function extractDeepestFullCode(region) {
  if (!region || typeof region !== 'object') return '';
  let current = region, deepest = null;
  while (current && typeof current === 'object') {
    if (current.fullCode) deepest = current.fullCode;
    if (current.full_code) deepest = current.full_code;
    let next = null;
    for (const k of Object.keys(current)) {
      if (k.startsWith('level') && current[k] && typeof current[k] === 'object') { next = current[k]; break; }
    }
    if (next) current = next; else break;
  }
  return deepest || '';
}

/* ═══════════════════════════════════════════════════════
   2/3/4. APPROVE / REVOKE / REJECT — via background tab automation
   ═══════════════════════════════════════════════════════ */
async function handleAction(actionType, surveyId, periodId, groupId, templateId, kabId, kabCode, filterIds = null) {
  isRunning = true; abortController = new AbortController();
  
  const cpKey = `checkpoint_auto_${actionType}_${periodId}`;
  let resumeState = null;
  try {
    const cpData = await chrome.storage.local.get([cpKey]);
    if (cpData[cpKey] && cpData[cpKey].queue && cpData[cpKey].currentIndex < cpData[cpKey].queue.length) {
      if (confirm(`Ditemukan proses ${actionType} yang belum selesai (progress ${cpData[cpKey].currentIndex}/${cpData[cpKey].queue.length}). Lanjutkan?`)) {
        resumeState = cpData[cpKey];
      }
    }
  } catch(e) {}

  if (resumeState) {
    sendProgress('Melanjutkan dari checkpoint...', 'info', 'Melanjutkan...');
    chrome.runtime.sendMessage({
      type: 'START_AUTOMASI',
      resumeState: resumeState
    });
    return;
  }

  sendProgress('Memulai ' + actionType + '...', 'info', actionType + ': mengambil data...');

  try {
    let assignments = [];

    if (filterIds && filterIds.length > 0) {
      sendProgress('Menggunakan ' + filterIds.length + ' ID input manual, melewati pencarian data...', 'info');
      assignments = filterIds.map(id => ({ id }));
    } else {
      // Fetch assignments using drill-down
      const regionFilter = buildRegionFilter(periodId, { region2Id: kabId });
      const allAssignments = await fetchAssignmentsDrillDown(periodId, groupId, regionFilter, 'Kabupaten (Action)', 2, 5);

      const seen = new Set();
      for (const a of allAssignments) {
        const id = a.id || a.assignmentId;
        if (id && !seen.has(id)) { seen.add(id); assignments.push(a); }
      }

      // Jika tidak difilter spesifik by ID, filter berdasarkan status yang masuk akal
      if (actionType === 'approve' || actionType === 'reject') {
        assignments = assignments.filter(a => {
          const st = (a.assignmentStatusAlias || '').toUpperCase();
          return st.includes('SUBMITTED');
        });
      }
    }

    sendProgress('Ditemukan ' + assignments.length + ' assignment valid. Mengirim ke queue automasi...', 'info');

    if (assignments.length === 0) {
      sendProgress('⚠️ Tidak ada assignment ditemukan.', 'warn', 'Selesai (0 data)');
      chrome.storage.session.set({ fasih: { state: 'done', result: { total: 0, action: actionType } } });
      chrome.runtime.sendMessage({ type: 'DONE', result: { total: 0, action: actionType } }).catch(() => {});
      finish(); return;
    }

    // Get my role
    const myRole = await getMyRole(periodId);

    // Send to background for DOM automation
    const queue = assignments.map(a => ({
      id: a.id || a.assignmentId,
      status: a.assignmentStatusAlias || '',
    }));

    chrome.runtime.sendMessage({
      type: 'START_AUTOMASI',
      queue: queue.map(q => q.id),
      actionType,
      templateId,
      periodId,
      surveyId,
      role: myRole,
    });

    sendProgress('Queue ' + queue.length + ' assignment dikirim ke automasi background.', 'ok', 'Menunggu automasi...');

    // JANGAN mengirim DONE di sini, biarkan background.js yang mengirimkannya saat antrean benar-benar selesai.
  } catch (e) {
    if (e.name === 'AbortError') { finishCancelled(); return; }
    sendProgress('Error: ' + e.message, 'error', 'Gagal');
    finish();
  }
}

/* ═══════════════════════════════════════════════════════
   5. EMAIL BROADCAST HISTORY
   ═══════════════════════════════════════════════════════ */
async function handleEmailHistory(periodId, groupId, kabId) {
  isRunning = true; abortController = new AbortController();
  sendProgress('Mengambil history email broadcast...', 'info', 'Email: memproses...');

  try {
    // First get assignments to get their IDs, using drill-down
    const regionFilter = buildRegionFilter(periodId, { region2Id: kabId });
    const allAssignments = await fetchAssignmentsDrillDown(periodId, groupId, regionFilter, 'Kabupaten (Email)', 2, 5);

    // Deduplicate by assignment ID
    const seen = new Set();
    const uniqueAssignments = [];
    for (const a of allAssignments) {
      const id = a.id || a.assignmentId;
      if (id && !seen.has(id)) { seen.add(id); uniqueAssignments.push(a); }
    }

    const aIds = uniqueAssignments.map(a => a.id || a.assignmentId).filter(Boolean);

    sendProgress('Ditemukan ' + aIds.length + ' assignment. Fetching email per assignment...', 'info');

    const allEmails = [];
    const seenEmailIds = new Set();

    await parallelMap(aIds, async (aid, i) => {
      if ((i + 1) % 50 === 0) sendProgress('Email ' + (i + 1) + '/' + aIds.length, 'info');
      const payload = {
        draw: 1,
        columns: [{ data: 'email', name: '', searchable: true, orderable: true, search: { value: '', regex: false } }],
        order: [{ column: 0, dir: 'asc' }],
        start: 0, length: 100,
        search: { value: '', regex: false },
        emailScheduleParam: {
          region1Id: '', region2Id: '', region3Id: '', region4Id: '', region5Id: '',
          region6Id: '', region7Id: '', region8Id: '', region9Id: '', region10Id: '',
          surveyPeriodId: periodId, assignmentId: aid,
        },
      };
      try {
        const res = await apiFetchRetry(CONFIG.EMAIL_URL, { method: 'POST', body: payload }, 2, 'email-' + aid);
        if (res.ok) {
          const data = (await res.json()).data || [];
          for (const item of data) {
            const eid = item.id || item.emailScheduleId || JSON.stringify(item);
            if (!seenEmailIds.has(eid)) { seenEmailIds.add(eid); allEmails.push(item); }
          }
        }
      } catch {}
    });

    sendProgress('Email history selesai! ' + allEmails.length + ' record.', 'ok', 'Selesai');

    chrome.storage.local.set({
      fasih_result: { action: 'email', date: new Date().toISOString(), rows: allEmails, columns: allEmails.length > 0 ? Object.keys(allEmails[0]) : [] },
    });
    chrome.storage.session.set({ fasih: { state: 'done', result: { total: allEmails.length, action: 'email' } } });
    chrome.runtime.sendMessage({ type: 'DONE', result: { total: allEmails.length, action: 'email' } }).catch(() => {});
  } catch (e) {
    if (e.name === 'AbortError') { finishCancelled(); return; }
    sendProgress('Error: ' + e.message, 'error', 'Gagal');
  }
  finish();
}

/* ═══════════════════════════════════════════════════════
   8. REKAP ALOKASI PETUGAS
   ═══════════════════════════════════════════════════════ */
async function handleRekapAlokasi(surveyId, periodId, selectedRoleIds) {
  isRunning = true; abortController = new AbortController();
  sendProgress('Mengambil rekap alokasi petugas...', 'info', 'Alokasi: memproses...');

  try {
    const allRows = [];

    for (const roleId of selectedRoleIds) {
      checkCancelled();
      // Page 0
      const url0 = CONFIG.ALLOC_URL + '?surveyRoleId=' + roleId + '&surveyPeriodId=' + periodId + '&page=0&size=100';
      const res0 = await apiFetchRetry(url0, {}, 3, 'alloc-p0');
      if (!res0.ok) { sendProgress('Gagal mengambil alokasi role ' + roleId, 'warn'); continue; }
      const d0 = (await res0.json()).data || {};
      const totalPages = d0.totalPages || 1;
      const totalEl = d0.totalElements || 0;
      let content = d0.content || [];

      sendProgress('Role ' + roleId + ': ' + totalEl + ' user, ' + totalPages + ' halaman', 'info');

      // Fetch remaining pages
      if (totalPages > 1) {
        const pages = Array.from({ length: totalPages - 1 }, (_, i) => i + 1);
        const pageResults = await parallelMap(pages, async (p) => {
          const url = CONFIG.ALLOC_URL + '?surveyRoleId=' + roleId + '&surveyPeriodId=' + periodId + '&page=' + p + '&size=100';
          const res = await apiFetchRetry(url, {}, 2, 'alloc-p' + p);
          if (res.ok) return (await res.json()).data?.content || [];
          return [];
        });
        for (const pc of pageResults) content = content.concat(pc);
      }

      // Flatten regions
      for (const item of content) {
        const base = {
          userId: item.userId || '', username: item.username || '', email: item.email || '',
          roleId: item.roleId || '', roleName: item.roleName || roleId,
        };
        const regions = item.regions || [];
        if (regions.length === 0) { allRows.push(base); continue; }
        for (const reg of regions) {
          allRows.push({ ...base, regionCode: reg.regionCode || '', regionName: reg.regionName || '', level: reg.level || '', allocationId: reg.allocationId || '' });
        }
      }
    }

    sendProgress('Rekap alokasi selesai! ' + allRows.length + ' baris.', 'ok', 'Selesai');

    chrome.storage.local.set({
      fasih_result: {
        action: 'alokasi', date: new Date().toISOString(), rows: allRows,
        columns: ['userId', 'username', 'email', 'roleId', 'roleName', 'regionCode', 'regionName', 'level', 'allocationId'],
      },
    });
    chrome.storage.session.set({ fasih: { state: 'done', result: { total: allRows.length, action: 'alokasi' } } });
    chrome.runtime.sendMessage({ type: 'DONE', result: { total: allRows.length, action: 'alokasi' } }).catch(() => {});
  } catch (e) {
    if (e.name === 'AbortError') { finishCancelled(); return; }
    sendProgress('Error: ' + e.message, 'error', 'Gagal');
  }
  finish();
}

/* ═══════════════════════════════════════════════════════
   9. REKAP PROGRESS — (from se-progress-extension drill-down)
   ═══════════════════════════════════════════════════════ */
async function handleFetchProgress(role, chosenKabs) {
  isRunning = true;
  currentRoleId = role.id;
  seenRequests = new Map();
  abortController = new AbortController();

  chrome.storage.session.get('fasih').then(s => {
    chrome.storage.session.set({ fasih: { ...(s.fasih || {}), log: [] } });
  }).catch(() => {});

  SIZE = null;
  let lastProbeStatus = 0;
  try {
    for (const s of CONFIG.SIZE_CANDIDATES) {
      const r = await callAssign(0, s, regionObj());
      lastProbeStatus = r.status;
      if (r.ok) { SIZE = s; break; }
    }
  } catch (e) {
    if (e.name === 'AbortError') { finishCancelled(); return; }
    throw e;
  }

  if (!SIZE) {
    const msg = (lastProbeStatus === 403 || lastProbeStatus === 401)
      ? 'Sesi FASIH kedaluwarsa. Refresh halaman (Ctrl+R) lalu coba lagi.'
      : 'Gagal: server menolak semua ukuran halaman. Periksa koneksi VPN.';
    sendProgress(msg, 'error');
    chrome.runtime.sendMessage({ type: 'FETCH_ERROR', error: msg }).catch(() => {});
    finish(); return;
  }
  sendProgress('size=' + SIZE + ' | peran=' + role.label, 'info', 'Memproses ' + chosenKabs.length + ' kabupaten...');

  const byUser = new Map();
  const add = (arr) => arr.forEach(u => byUser.set(u.userId, u));
  const report = [], incomplete = [];

  try {
    for (const kab of chosenKabs) {
      checkCancelled();
      sendProgress('Proses ' + kab.name + '...', 'info', kab.name);
      let res = await fetchAll(regionObj(kab.id), kab.name);
      await sleep(jitter(CONFIG.DELAY_MS));

      if (!res.error && !res.capped) {
        add(res.recs); report.push(kab.name + ': ' + res.recs.length + '/' + res.total + ' OK');
        sendProgress('OK ' + kab.name + ': ' + res.recs.length + '/' + res.total + ' | unik:' + byUser.size, 'ok');
        continue;
      }

      if (res.recs.length) add(res.recs);
      sendProgress(kab.name + ': ' + (res.error ? 'TIMEOUT' : res.total + '>' + CONFIG.CAP) + ' → drill kecamatan', 'warn');

      let kecs = [];
      try { kecs = await getRegion('level3', { groupId: CONFIG.GROUP_ID, level2FullCode: kab.code }); }
      catch (e) {
        if (e.name === 'AbortError') throw e;
        sendProgress('   gagal kecamatan ' + kab.name, 'error'); incomplete.push(kab.name); continue;
      }

      let cnt = 0;
      for (const kec of kecs) {
        checkCancelled();
        const rk = await fetchAll(regionObj(kab.id, kec.id), kab.name + '/' + kec.name);
        if (rk.recs.length) add(rk.recs); cnt += rk.recs.length;
        if (!rk.error && !rk.capped) {
          sendProgress('   . ' + kec.name + ': ' + rk.recs.length + '/' + rk.total + ' OK', 'ok');
        } else {
          sendProgress('   . ' + kec.name + ': drill desa', 'warn');
          try {
            const desas = await getRegion('level4', { groupId: CONFIG.GROUP_ID, level3FullCode: kec.code });
            for (const d of desas) {
              checkCancelled();
              const rd = await fetchAll(regionObj(kab.id, kec.id, d.id), kec.name + '/' + d.name);
              if (rd.recs.length) add(rd.recs); cnt += rd.recs.length;
              if (rd.error) incomplete.push(kab.name + '/' + kec.name + '/' + d.name);
              await sleep(jitter(CONFIG.DELAY_MS));
            }
          } catch (e) {
            if (e.name === 'AbortError') throw e;
            sendProgress('     gagal desa ' + kec.name, 'error');
            incomplete.push(kab.name + '/' + kec.name);
          }
        }
        await sleep(jitter(CONFIG.DELAY_MS));
      }
      report.push(kab.name + ': ~' + cnt + ' via ' + kecs.length + ' kec');
    }
  } catch (e) {
    if (e.name === 'AbortError') { finishCancelled(); return; }
    throw e;
  }

  const all = [...byUser.values()];
  sendProgress('===== REKAP (' + role.label + ') =====', 'info');
  report.forEach(r => sendProgress(r, 'ok'));
  if (incomplete.length) sendProgress('BELUM lengkap: ' + incomplete.join(', '), 'warn');
  sendProgress('TOTAL ' + role.label.toUpperCase() + ' UNIK: ' + all.length, 'info', 'Selesai');

  const rows = [];
  for (const u of all)
    for (const reg of (u.regionSummary || []))
      for (const st of (reg.statusBreakdown || []))
        rows.push({ userId: u.userId, username: u.username, email: u.email, roleName: u.roleName, userTotal: u.total, regionCode: reg.regionCode, regionTotal: reg.total, status: st.status, count: st.count });

  chrome.storage.local.set({
    fasih_result: {
      action: 'progress', role: role.label, date: new Date().toISOString(),
      all, rows, report, incomplete,
    },
  });
  chrome.storage.session.set({ fasih: { state: 'done', result: { total: all.length, csvRows: rows.length, action: 'progress' } } });
  chrome.runtime.sendMessage({ type: 'DONE', result: { total: all.length, csvRows: rows.length, action: 'progress' } }).catch(() => {});
  finish();
}

/* ═══════════════════════════════════════════════════════
   GET KABUPATEN LIST
   ═══════════════════════════════════════════════════════ */
async function handleGetKabs(role, prov) {
  try {
    currentRoleId = role.id;
    let kabs = await getRegion('level2', { groupId: CONFIG.GROUP_ID, level1FullCode: prov });
    if (!kabs.length) kabs = await getRegion('level2', { groupId: CONFIG.GROUP_ID });
    if (!kabs.length || !kabs[0].id) return { ok: false, error: 'Struktur region tidak terdeteksi' };
    return { ok: true, kabs };
  } catch (e) {
    const msg = /HTTP 403/.test(e.message) ? 'Akses ditolak (403). Pastikan Anda membuka fasih-sm.bps.go.id/app dan akun ini memiliki akses.'
      : /HTTP 401/.test(e.message) ? 'Sesi kedaluwarsa. Refresh halaman (Ctrl+R) lalu coba lagi.'
      : e.message;
    return { ok: false, error: msg };
  }
}

/* ═══════════════════════════════════════════════════════
   FINISH HELPERS
   ═══════════════════════════════════════════════════════ */
function finish() {
  isRunning = false; abortController = null; seenRequests = null;
}

function finishCancelled() {
  sendProgress('⛔ Proses dibatalkan oleh pengguna.', 'warn', 'Dibatalkan');
  chrome.storage.session.set({ fasih: { state: 'idle' } }).catch(() => {});
  chrome.runtime.sendMessage({ type: 'CANCELLED' }).catch(() => {});
  finish();
}

/* ═══════════════════════════════════════════════════════
   MESSAGE LISTENER
   ═══════════════════════════════════════════════════════ */
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'PING') { sendResponse({ ok: true }); return false; }

  if (message.type === 'GET_KABS') {
    handleGetKabs(message.role, message.prov || '72').then(sendResponse);
    return true;
  }

  if (message.type === 'GET_KABS_BY_GROUP') {
    // Uses groupId from the selected survey (not hardcoded)
    const gid = message.groupId;
    const prov = message.prov || '72';
    (async () => {
      try {
        let kabs = await getRegion('level2', { groupId: gid, level1FullCode: prov });
        if (!kabs.length) kabs = await getRegion('level2', { groupId: gid });
        if (!kabs.length || !kabs[0].id) return { ok: false, error: 'Struktur region tidak terdeteksi' };
        return { ok: true, kabs };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    })().then(sendResponse);
    return true;
  }

  if (message.type === 'GET_SURVEYS') {
    getSurveyList(message.surveyType || 'pencacahan').then(data => sendResponse({ ok: true, data })).catch(e => sendResponse({ ok: false, error: e.message }));
    return true;
  }

  if (message.type === 'GET_SURVEY_DETAIL') {
    getSurveyDetail(message.surveyId).then(data => sendResponse({ ok: true, data })).catch(e => sendResponse({ ok: false, error: e.message }));
    return true;
  }

  if (message.type === 'GET_SURVEY_ROLES') {
    getSurveyRoles(message.surveyId).then(data => sendResponse({ ok: true, data })).catch(e => sendResponse({ ok: false, error: e.message }));
    return true;
  }

  if (message.type === 'FETCH_PROGRESS') {
    if (isRunning) { sendResponse({ ok: false, error: 'already running' }); return false; }
    handleFetchProgress(message.role, message.kabs);
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === 'FETCH_SCRAPE_WILAYAH') {
    if (isRunning) { sendResponse({ ok: false, error: 'already running' }); return false; }
    handleScrapeWilayah(message.surveyId, message.periodId, message.groupId, message.templateId, message.kabId, message.kabCode);
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === 'FETCH_SCRAPE_DETAIL') {
    if (isRunning) { sendResponse({ ok: false, error: 'already running' }); return false; }
    handleScrapeDetail(message.surveyId, message.periodId, message.groupId, message.templateId, message.kabId, message.kabCode, message.filterIds);
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === 'FETCH_ACTION') {
    if (isRunning) { sendResponse({ ok: false, error: 'already running' }); return false; }
    handleAction(message.actionType, message.surveyId, message.periodId, message.groupId, message.templateId, message.kabId, message.kabCode, message.filterIds);
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === 'FETCH_EMAIL') {
    if (isRunning) { sendResponse({ ok: false, error: 'already running' }); return false; }
    handleEmailHistory(message.periodId, message.groupId, message.kabId);
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === 'FETCH_ALOKASI') {
    if (isRunning) { sendResponse({ ok: false, error: 'already running' }); return false; }
    handleRekapAlokasi(message.surveyId, message.periodId, message.roleIds);
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === 'CANCEL') {
    if (abortController) { abortController.abort(); sendResponse({ ok: true }); }
    else { sendResponse({ ok: false, error: 'not running' }); }
    return false;
  }
});
