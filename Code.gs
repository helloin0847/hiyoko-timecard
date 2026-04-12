// kitchen ひよこ タイムカード - GAS（v8）

const SHEET_EMP    = '従業員マスタ';
const SHEET_RECORD = '打刻記録';
const STORES       = ['本店', 'east', 'ASAHI'];
const TZ           = 'Asia/Tokyo';
const SCAN_ROWS    = 500; // 逆方向スキャンの最大行数

function doGet(e) {
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('kitchen ひよこ タイムカード')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function handleApiCall(action, bodyStr) {
  const body = bodyStr ? JSON.parse(bodyStr) : {};
  const ss   = SpreadsheetApp.getActiveSpreadsheet();
  try {
    if (action === 'getEmployees')    return getEmployees(ss);
    if (action === 'saveEmployees')   return saveEmployees(ss, body);
    if (action === 'punchIn')         return punchIn(ss, body);
    if (action === 'punchOut')        return punchOut(ss, body);
    if (action === 'getOpenRecords')  return getOpenRecords(ss, body);
    if (action === 'getRecords')      return getRecords(ss, body);
    if (action === 'updateRecord')    return updateRecord(ss, body);
    if (action === 'deleteRecord')    return deleteRecord(ss, body);
    if (action === 'getDailySummary') return getDailySummary(ss, body);
    if (action === 'getShiftSummary') return getShiftSummary(ss, body);
    if (action === 'getCalendarData') return getCalendarData(ss, body);
    if (action === 'getMonthlyCsv')   return getMonthlyCsv(ss, body);
    if (action === 'cleanupDeleted')  return cleanupDeleted(ss);
    return { ok: false, error: 'Unknown action: ' + action };
  } catch(err) {
    return { ok: false, error: err.toString() };
  }
}

// ========================
// ユーティリティ
// ========================

function toDateStr(val) {
  if (!val && val !== 0) return '';
  if (val instanceof Date) {
    return Utilities.formatDate(val, TZ, 'yyyy-MM-dd');
  }
  return String(val).slice(0, 10);
}

function toTimeStr(val) {
  if (!val && val !== 0) return '';
  if (val instanceof Date) {
    return Utilities.formatDate(val, TZ, 'HH:mm:ss');
  }
  return String(val);
}

function roundTime(timeStr, unit, method) {
  const u = Number(unit || 0);
  if (!u || !method || method === 'none') return timeStr;
  const parts = String(timeStr).split(':').map(Number);
  const totalMins = parts[0] * 60 + (parts[1] || 0);
  let rounded;
  if (method === 'ceil')  rounded = Math.ceil(totalMins  / u) * u;
  if (method === 'floor') rounded = Math.floor(totalMins / u) * u;
  if (method === 'round') rounded = Math.round(totalMins / u) * u;
  rounded = Math.max(0, Math.min(rounded, 23 * 60 + 59));
  const h = Math.floor(rounded / 60);
  const m = rounded % 60;
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':00';
}

function calcMinutes(inStr, outStr) {
  const p1 = String(inStr).split(':').map(Number);
  const p2 = String(outStr).split(':').map(Number);
  let diff = (p2[0] * 60 + p2[1]) - (p1[0] * 60 + p1[1]);
  if (diff < 0) diff += 1440; // 日付またぎ: 24h加算
  return Math.round(diff);
}

// バリデーション
function validateTime(str) {
  return /^\d{2}:\d{2}(:\d{2})?$/.test(str);
}

function validatePunchIn(body) {
  if (!body.mgmtNo)  return '管理番号が空です';
  if (!body.empName) return '氏名が空です';
  if (!body.store || STORES.indexOf(body.store) < 0) return '無効な店舗です';
  if (body.kubun !== '仕込' && body.kubun !== '営業' && body.kubun !== '通し') return '無効な区分です';
  return null;
}

// シートの末尾N行を取得（ヘッダー除外済み）
// 戻り値: { rows: 2D配列, startIdx: シート上の開始行番号(1-based, ヘッダー=1) }
function getRecentRows(sh, n) {
  const lastRow = sh.getLastRow();
  if (lastRow <= 1) return { rows: [], startIdx: 2 };
  const startRow = Math.max(2, lastRow - n + 1);
  const numRows  = lastRow - startRow + 1;
  const rows     = sh.getRange(startRow, 1, numRows, 15).getValues();
  return { rows, startIdx: startRow };
}

// ========================
// 初回セットアップ
// ========================

function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss.getSheetByName(SHEET_EMP)) {
    ss.insertSheet(SHEET_EMP).appendRow(['管理番号','氏名','読み仮名','社員番号','ソート順','有効','店舗','入社日','退職日','雇用形態']);
  }
  if (!ss.getSheetByName(SHEET_RECORD)) {
    ss.insertSheet(SHEET_RECORD).appendRow(['ID','日付','管理番号','氏名','店舗','区分','出勤時刻','退勤時刻','勤務分数','修正フラグ','修正メモ','社員番号','丸め出勤','丸め退勤','丸め分数','削除フラグ']);
  }
  Logger.log('セットアップ完了');
}

// ========================
// 従業員マスタ
// ========================

function getEmployees(ss) {
  const rows = ss.getSheetByName(SHEET_EMP).getDataRange().getValues().slice(1);
  const emps = rows
    .filter(r => r[1])
    .map(r => ({
      mgmtNo:     String(r[0]),
      name:       String(r[1]),
      kana:       String(r[2] || ''),
      empNo:      String(r[3] || ''),
      sort:       Number(r[4]) || 0,
      store:      String(r[6] || ''),
      hireDate:   r[7] ? toDateStr(r[7]) : '',
      retireDate: r[8] ? toDateStr(r[8]) : '',
      empType:    String(r[9] || 'アルバイト'),
    }))
    .sort((a, b) => a.sort - b.sort);
  return { ok: true, employees: emps };
}

// バッチ書き込み版
function saveEmployees(ss, body) {
  const emps = body.employees || [];
  const seen = new Set();
  for (const e of emps) {
    const no = String(e.mgmtNo || '').trim();
    if (!no) return { ok: false, error: '管理番号が空です: ' + e.name };
    if (seen.has(no)) return { ok: false, error: '管理番号が重複: ' + no };
    seen.add(no);
  }
  const sh = ss.getSheetByName(SHEET_EMP);
  const header = ['管理番号','氏名','読み仮名','社員番号','ソート順','有効','店舗','入社日','退職日','雇用形態'];
  const data = [header];
  emps.forEach((e, i) => {
    data.push([e.mgmtNo, e.name, e.kana || '', e.empNo || '', i + 1, true, e.store || '', e.hireDate || '', e.retireDate || '', e.empType || 'アルバイト']);
  });
  sh.clearContents();
  if (data.length > 0) {
    sh.getRange(1, 1, data.length, 10).setValues(data);
  }
  return { ok: true };
}

// ========================
// 打刻
// ========================

function punchIn(ss, body) {
  // バリデーション
  const err = validatePunchIn(body);
  if (err) return { ok: false, error: err };

  const sh = ss.getSheetByName(SHEET_RECORD);

  // 重複出勤チェック（末尾N行のみスキャン）
  const { rows: recentRows } = getRecentRows(sh, SCAN_ROWS);
  const already = recentRows.find(r => String(r[2]) === String(body.mgmtNo) && !r[7] && !r[15]);
  if (already) {
    const info = already[4] + '・' + already[5] + 'で出勤中です（' + toTimeStr(already[6]) + '〜）';
    return { ok: false, error: '重複出勤: ' + info };
  }

  const now       = new Date();
  const date      = Utilities.formatDate(now, TZ, 'yyyy-MM-dd');
  const actualIn  = Utilities.formatDate(now, TZ, 'HH:mm:ss');
  const roundedIn = roundTime(actualIn, body.roundInUnit, body.roundInMethod);
  const id        = Utilities.getUuid();
  sh.appendRow([
    id, date,
    body.mgmtNo, body.empName, body.store, body.kubun,
    actualIn, '', '', '', '', body.empNo || '',
    roundedIn, '', '', ''
  ]);
  return { ok: true, id: id, time: actualIn, roundedTime: roundedIn, date: date };
}

// 1D修正: store条件を緩和（mgmtNo + 未退勤のみでマッチ）
function punchOut(ss, body) {
  if (!body.mgmtNo) return { ok: false, error: '管理番号が空です' };

  const sh = ss.getSheetByName(SHEET_RECORD);
  const now        = new Date();
  const actualOut  = Utilities.formatDate(now, TZ, 'HH:mm:ss');
  const roundedOut = roundTime(actualOut, body.roundOutUnit, body.roundOutMethod);

  // 末尾N行のみスキャン
  const { rows, startIdx } = getRecentRows(sh, SCAN_ROWS);

  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i];
    if (String(r[2]) === String(body.mgmtNo) && !r[7] && !r[15]) {
      const sheetRow    = startIdx + i;
      const roundedIn   = r[12] ? toTimeStr(r[12]) : toTimeStr(r[6]);
      const actualMins  = calcMinutes(toTimeStr(r[6]), actualOut);
      const roundedMins = calcMinutes(roundedIn, roundedOut);

      // 通し勤務は退勤店舗で更新（正社員が別店舗で退勤するケース）
      const store = (String(r[5]) === '通し' && body.store) ? body.store : r[4];

      // バッチ書き込み: 行全体を更新
      const rowData = [
        r[0], r[1], r[2], r[3], store, r[5],
        r[6], actualOut, actualMins, r[9], r[10], r[11],
        r[12], roundedOut, roundedMins, r[15] || ''
      ];
      sh.getRange(sheetRow, 1, 1, 16).setValues([rowData]);

      return { ok: true, time: actualOut, roundedTime: roundedOut, minutes: roundedMins };
    }
  }
  return { ok: false, error: '出勤記録が見つかりません' };
}

// ========================
// レコード取得
// ========================

// 末尾N行のみスキャンして未退勤レコードを取得
// 正社員（通し区分）は全店舗の画面に表示する
function getOpenRecords(ss, body) {
  const sh = ss.getSheetByName(SHEET_RECORD);
  const { rows } = getRecentRows(sh, SCAN_ROWS);
  const open = rows
    .filter(r => !r[7] && !r[15] && (String(r[4]) === String(body.store) || String(r[5]) === '通し'))
    .map(r => ({
      id:        r[0],
      date:      toDateStr(r[1]),
      mgmtNo:    String(r[2]),
      empName:   String(r[3]),
      store:     String(r[4]),
      kubun:     String(r[5]),
      inTime:    toTimeStr(r[6]),
      roundedIn: r[12] ? toTimeStr(r[12]) : '',
    }));
  return { ok: true, openRecords: open };
}

function getRecords(ss, body) {
  const rows = ss.getSheetByName(SHEET_RECORD).getDataRange().getValues().slice(1);
  let recs = rows
    .filter(r => !r[15]) // 削除フラグ除外
    .map(r => ({
      id:             r[0],
      date:           toDateStr(r[1]),
      mgmtNo:         String(r[2]),
      empName:        String(r[3]),
      store:          String(r[4]),
      kubun:          String(r[5]),
      in:             toTimeStr(r[6]),
      out:            toTimeStr(r[7]),
      minutes:        r[8],
      fixed:          r[9],
      memo:           r[10],
      empNo:          String(r[11] || ''),
      roundedIn:      r[12] ? toTimeStr(r[12]) : '',
      roundedOut:     r[13] ? toTimeStr(r[13]) : '',
      roundedMinutes: r[14] !== '' && r[14] != null ? Number(r[14]) : null
    }));
  if (body.date)  recs = recs.filter(r => r.date  === body.date);
  if (body.store) recs = recs.filter(r => r.store === body.store);
  if (body.kubun) recs = recs.filter(r => r.kubun === body.kubun);
  if (body.from && body.to) recs = recs.filter(r => r.date >= body.from && r.date <= body.to);
  return { ok: true, records: recs };
}

// バッチ書き込み版
function updateRecord(ss, body) {
  if (!body.id) return { ok: false, error: 'IDが空です' };
  if (body.in  && !validateTime(body.in))  return { ok: false, error: '出勤時刻の形式が不正です' };
  if (body.out && !validateTime(body.out)) return { ok: false, error: '退勤時刻の形式が不正です' };

  const sh   = ss.getSheetByName(SHEET_RECORD);
  const rows = sh.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === body.id) {
      const row = rows[i].slice(0); // コピー
      const newIn  = body.in  || toTimeStr(row[6]);
      const newOut = body.out || toTimeStr(row[7]);

      if (body.in)  row[6] = body.in;
      if (body.out) {
        row[7] = body.out;
        row[8] = calcMinutes(newIn, newOut);
      }
      if (body.roundedIn)  row[12] = body.roundedIn;
      if (body.roundedOut) row[13] = body.roundedOut;

      if (body.roundedIn || body.roundedOut) {
        const rIn  = body.roundedIn  || toTimeStr(row[12]) || newIn;
        const rOut = body.roundedOut || toTimeStr(row[13]) || newOut;
        if (rIn && rOut) row[14] = calcMinutes(rIn, rOut);
      }

      row[9]  = '修正済';
      row[10] = body.memo || '修正';

      // 一括書き込み（元の列数に合わせる）
      const cols = Math.max(row.length, 16);
      while (row.length < cols) row.push('');
      sh.getRange(i + 1, 1, 1, cols).setValues([row]);
      return { ok: true };
    }
  }
  return { ok: false, error: 'IDが見つかりません' };
}

// ソフトデリート版
function deleteRecord(ss, body) {
  if (!body.id) return { ok: false, error: 'IDが空です' };
  const sh   = ss.getSheetByName(SHEET_RECORD);
  const rows = sh.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === body.id) {
      // 16列目（削除フラグ）をセット
      sh.getRange(i + 1, 16).setValue(true);
      return { ok: true };
    }
  }
  return { ok: false, error: 'IDが見つかりません' };
}

// 月次クリーンアップ: ソフトデリート済み行を物理削除（手動実行用）
function cleanupDeleted(ss) {
  const sh   = ss.getSheetByName(SHEET_RECORD);
  const rows = sh.getDataRange().getValues();
  let deleted = 0;
  // 下から削除して行番号ズレを回避
  for (let i = rows.length - 1; i >= 1; i--) {
    if (rows[i][15]) {
      sh.deleteRow(i + 1);
      deleted++;
    }
  }
  return { ok: true, deleted: deleted };
}

// ========================
// 集計・CSV
// ========================

function getDailySummary(ss, body) {
  const rows = ss.getSheetByName(SHEET_RECORD).getDataRange().getValues().slice(1);
  const recs = rows.filter(r => toDateStr(r[1]) === body.date && r[8] !== '' && !r[15]);
  const byStore = { '本店': 0, 'east': 0, 'ASAHI': 0 };
  const byEmp   = {};
  recs.forEach(r => {
    const mins = (r[14] !== '' && r[14] != null) ? Number(r[14]) : Number(r[8]);
    byStore[r[4]] = (byStore[r[4]] || 0) + mins;
    const key = String(r[2]);
    if (!byEmp[key]) byEmp[key] = { name: r[3], store: r[4], total: 0, shikomi: 0, eigyo: 0, tooshi: 0 };
    byEmp[key].total   += mins;
    byEmp[key].shikomi += r[5] === '仕込' ? mins : 0;
    byEmp[key].eigyo   += r[5] === '営業' ? mins : 0;
    byEmp[key].tooshi  += r[5] === '通し' ? mins : 0;
  });
  return { ok: true, byStore: byStore, byEmp: byEmp };
}

function getShiftSummary(ss, body) {
  const { from, to } = body;
  if (!from || !to) return { ok: false, error: 'from/toが必要です' };
  const rows = ss.getSheetByName(SHEET_RECORD).getDataRange().getValues().slice(1);
  const recs = rows.filter(r => {
    const d = toDateStr(r[1]);
    return d >= from && d <= to && r[8] !== '' && !r[15];
  });

  const byStore      = { '本店': 0, 'east': 0, 'ASAHI': 0 };
  const byStoreKubun = {
    '本店': { shikomi: 0, eigyo: 0 },
    'east': { shikomi: 0, eigyo: 0 },
    'ASAHI':{ shikomi: 0, eigyo: 0 },
  };
  const byEmp = {};

  const empMaster = {};
  ss.getSheetByName(SHEET_EMP).getDataRange().getValues().slice(1).forEach(r => {
    if (r[1]) empMaster[String(r[0])] = { store: String(r[6] || ''), empNo: String(r[3] || '') };
  });

  recs.forEach(r => {
    const mins  = (r[14] !== '' && r[14] != null) ? Number(r[14]) : Number(r[8]);
    const store = String(r[4]);
    const kubun = String(r[5]);
    byStore[store] = (byStore[store] || 0) + mins;
    if (byStoreKubun[store]) {
      if (kubun === '仕込') byStoreKubun[store].shikomi += mins;
      if (kubun === '営業') byStoreKubun[store].eigyo   += mins;
      if (kubun === '通し') byStoreKubun[store].tooshi  = (byStoreKubun[store].tooshi || 0) + mins;
    }
    const key  = String(r[2]);
    const date = toDateStr(r[1]);
    if (!byEmp[key]) {
      const master = empMaster[key] || {};
      byEmp[key] = {
        name:    String(r[3]),
        store:   master.store || '',
        days:    new Set(),
        total:   0,
        shikomi: 0,
        eigyo:   0,
        tooshi:  0,
      };
    }
    byEmp[key].days.add(date);
    byEmp[key].total   += mins;
    byEmp[key].shikomi += kubun === '仕込' ? mins : 0;
    byEmp[key].eigyo   += kubun === '営業' ? mins : 0;
    byEmp[key].tooshi  += kubun === '通し' ? mins : 0;
  });

  const result = {};
  Object.entries(byEmp).forEach(([k, v]) => {
    result[k] = { name: v.name, store: v.store, days: v.days.size,
                  total: v.total, shikomi: v.shikomi, eigyo: v.eigyo, tooshi: v.tooshi };
  });

  return { ok: true, byStore: byStore, byStoreKubun: byStoreKubun, byEmp: result };
}

function getCalendarData(ss, body) {
  const { from, to } = body;
  if (!from || !to) return { ok: false, error: 'from/toが必要です' };
  const rows = ss.getSheetByName(SHEET_RECORD).getDataRange().getValues().slice(1);
  const records = rows
    .filter(r => {
      const d = toDateStr(r[1]);
      return d >= from && d <= to && !r[15];
    })
    .map(r => ({
      id:             r[0],
      date:           toDateStr(r[1]),
      mgmtNo:         String(r[2]),
      empName:        String(r[3]),
      store:          String(r[4]),
      kubun:          String(r[5]),
      in:             toTimeStr(r[6]),
      out:            toTimeStr(r[7]),
      minutes:        r[8] !== '' ? Number(r[8]) : null,
      roundedIn:      r[12] ? toTimeStr(r[12]) : '',
      roundedOut:     r[13] ? toTimeStr(r[13]) : '',
      roundedMinutes: r[14] !== '' && r[14] != null ? Number(r[14]) : null,
    }));
  return { ok: true, records: records };
}

function getMonthlyCsv(ss, body) {
  const from = body.from;
  const to   = body.to;
  if (!from || !to) return { ok: false, error: 'from/toが必要です' };
  // 正社員の管理番号セットを取得（CSV出力から除外）
  const empRows = ss.getSheetByName(SHEET_EMP).getDataRange().getValues().slice(1);
  const seishaSet = new Set();
  empRows.forEach(r => { if (String(r[9] || '') === '正社員') seishaSet.add(String(r[0])); });
  const rows = ss.getSheetByName(SHEET_RECORD).getDataRange().getValues().slice(1);
  const recs = rows.filter(r => {
    const d = toDateStr(r[1]);
    return d >= from && d <= to && r[8] !== '' && !r[15] && !seishaSet.has(String(r[2]));
  });
  const byEmp = {};
  recs.forEach(r => {
    const key = String(r[2]);
    if (!byEmp[key]) byEmp[key] = {
      empNo:   String(r[11] || ''),
      mgmtNo:  String(r[2]),
      name:    String(r[3]),
      days:    { '本店': new Set(), 'east': new Set(), 'ASAHI': new Set() },
      eigyo:   { '本店': 0, 'east': 0, 'ASAHI': 0 },
      shikomi: { '本店': 0, 'east': 0, 'ASAHI': 0 },
    };
    const e    = byEmp[key];
    const mins = (r[14] !== '' && r[14] != null) ? Number(r[14]) : Number(r[8]);
    const date = toDateStr(r[1]);
    if (e.days[r[4]])    e.days[r[4]].add(date);
    if (r[5] === '営業') e.eigyo[r[4]]   = (e.eigyo[r[4]]   || 0) + mins;
    if (r[5] === '仕込') e.shikomi[r[4]] = (e.shikomi[r[4]] || 0) + mins;
    if (r[5] === '通し') e.eigyo[r[4]]   = (e.eigyo[r[4]]   || 0) + mins; // 通しは営業時間に合算
  });
  const toDate = new Date(to);
  toDate.setDate(toDate.getDate() + 6);
  const payDate = Utilities.formatDate(toDate, TZ, 'yyyy/MM/dd');
  const BOM    = '\uFEFF';
  const header = ['社員番号','出勤日数 本店','営業時間 本店','仕込時間 本店','出勤日数 east','営業時間 east','仕込時間 east','出勤日数 ASAHI','営業時間 ASAHI','仕込時間 ASAHI','日付','給与在籍','集計開始','集計終了','氏名'].join(',');
  const lines = Object.values(byEmp)
    .sort((a, b) => Number(a.empNo) - Number(b.empNo) || a.mgmtNo.localeCompare(b.mgmtNo))
    .map(e => [
      e.empNo,
      e.days['本店'].size,  toH(e.eigyo['本店']),   toH(e.shikomi['本店']),
      e.days['east'].size,  toH(e.eigyo['east']),   toH(e.shikomi['east']),
      e.days['ASAHI'].size, toH(e.eigyo['ASAHI']),  toH(e.shikomi['ASAHI']),
      payDate, '', from.replace(/-/g,'/'), to.replace(/-/g,'/'), e.name
    ].join(','));
  return { ok: true, csv: BOM + header + '\n' + lines.join('\n'), rowCount: lines.length };
}

function toH(mins) { return Math.round(mins / 60 * 100) / 100; }
