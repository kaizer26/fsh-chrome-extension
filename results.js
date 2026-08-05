// results.js — FASIH Extensions results page logic

async function main() {
  const stored = await chrome.storage.local.get('fasih_result');
  const data = stored.fasih_result;
  if (!data || !data.rows || data.rows.length === 0) {
    document.getElementById('table-wrap').innerHTML = '<div class="empty">Belum ada data hasil. Jalankan ekstraksi dari popup terlebih dahulu.</div>';
    document.getElementById('info').textContent = 'Tidak ada data.';
    return;
  }

  const rows = data.rows;
  const action = data.action || 'unknown';
  const date = data.date ? new Date(data.date).toLocaleString('id-ID') : '-';
  const cols = data.columns && data.columns.length > 0 ? data.columns : Object.keys(rows[0]);

  document.getElementById('meta').textContent = 'Aksi: ' + action + ' | Tanggal: ' + date;
  document.getElementById('info').textContent = rows.length + ' baris × ' + cols.length + ' kolom';

  // Render table
  let html = '<table><thead><tr><th>#</th>';
  cols.forEach(function(c) { html += '<th>' + escHtml(c) + '</th>'; });
  html += '</tr></thead><tbody>';

  const maxRows = Math.min(rows.length, 5000);
  for (let i = 0; i < maxRows; i++) {
    html += '<tr><td>' + (i + 1) + '</td>';
    cols.forEach(function(c) {
      let v = rows[i][c];
      if (v == null) v = '';
      else if (typeof v === 'object') v = JSON.stringify(v);
      else v = String(v);
      html += '<td title="' + escHtml(v) + '">' + escHtml(v) + '</td>';
    });
    html += '</tr>';
  }
  if (rows.length > maxRows) {
    html += '<tr><td colspan="' + (cols.length + 1) + '" style="text-align:center;color:#999;">... dan ' + (rows.length - maxRows) + ' baris lainnya (download CSV untuk data lengkap)</td></tr>';
  }
  html += '</tbody></table>';
  document.getElementById('table-wrap').innerHTML = html;

  document.getElementById('btn-csv').disabled = false;
  document.getElementById('btn-json').disabled = false;

  document.getElementById('btn-csv').addEventListener('click', function() {
    const esc = function(v) { v = v == null ? '' : String(v); if (typeof v === 'object') v = JSON.stringify(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    const csvRows = [cols.map(esc).join(',')];
    rows.forEach(function(r) { csvRows.push(cols.map(function(c) { return esc(r[c]); }).join(',')); });
    const csv = '\uFEFF' + csvRows.join('\n');
    downloadBlob(csv, 'text/csv;charset=utf-8', 'fasih_' + action + '_' + dateTag() + '.csv');
  });

  document.getElementById('btn-json').addEventListener('click', function() {
    const json = JSON.stringify(rows, null, 2);
    downloadBlob(json, 'application/json', 'fasih_' + action + '_' + dateTag() + '.json');
  });
}

function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function dateTag() {
  return new Date().toISOString().slice(0, 10);
}

function downloadBlob(content, mimeType, filename) {
  const blob = new Blob([content], { type: mimeType });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
}

main();
