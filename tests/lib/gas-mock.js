// Minimal in-memory mock of the Apps Script globals used by Code.gs.
'use strict';
const fs = require('fs');
const vm = require('vm');
const crypto = require('crypto');

const CODE_PATH = require('path').resolve(__dirname, '..', '..', 'apps-script', 'Code.gs');

function makeEnv(opts) {
  opts = Object.assign({ maxRows: 1000, maxCols: 26, apostropheLiteralInText: true, mailQuota: 100, owner: 'owner@example.com', settings: null }, opts || {});
  const log = { mails: [], errors: [], cachePuts: [], triggers: [] };

  class Cell { constructor() { this.v = ''; this.fmt = null; this.formula = null; this.dv = null; this.checkbox = false; } }

  class Sheet {
    constructor(ss, name) { this.ss = ss; this.name = name; this.maxRows = opts.maxRows; this.maxCols = opts.maxCols; this.cells = new Map(); this.frozen = 0; this.cf = []; this.hidden = new Set(); }
    getName() { return this.name; }
    cell(r, c) { const k = r + ':' + c; if (!this.cells.has(k)) this.cells.set(k, new Cell()); return this.cells.get(k); }
    peek(r, c) { return this.cells.get(r + ':' + c); }
    getLastRow() { let m = 0; for (const [k, cell] of this.cells) { if (cell.v !== '' && cell.v !== null) { const r = +k.split(':')[0]; if (r > m) m = r; } } return m; }
    getMaxRows() { return this.maxRows; }
    getRange(r, c, nr, nc) {
      if (typeof r === 'string') { const m = /^([A-Z])(\d+):([A-Z])$/.exec(r); if (!m) throw new Error('A1 not mocked'); const col = m[1].charCodeAt(0) - 64; const row = +m[2]; return new Range(this, row, col, this.maxRows - row + 1, 1); }
      nr = nr == null ? 1 : nr; nc = nc == null ? 1 : nc;
      if (nr < 1 || nc < 1) throw new Error('Exception: The number of rows in the range must be at least 1.');
      if (r < 1 || c < 1 || r + nr - 1 > this.maxRows || c + nc - 1 > this.maxCols) throw new Error('Exception: The coordinates of the range are outside the dimensions of the sheet.');
      return new Range(this, r, c, nr, nc);
    }
    setFrozenRows(n) { this.frozen = n; }
    setRowHeight() { return this; }
    setColumnWidth() { return this; }
    hideColumns(i) { this.hidden.add(i); }
    getConditionalFormatRules() { return this.cf.slice(); }
    setConditionalFormatRules(r) { this.cf = r.slice(); }
    insertRowsAfter(after, n) { this.maxRows += n; return this; }
  }

  function store(cell, v) {
    // Model of Sheets user-entered semantics.
    if (typeof v === 'string') {
      if (cell.fmt === '@') { cell.v = v; cell.formula = null; return; } // plain text: literal
      if (v.startsWith("'")) { cell.v = v.slice(1); cell.formula = null; return; }
      if (/^[=+\-@]/.test(v) && v.length > 1 && /^=/.test(v)) { cell.formula = v; cell.v = '#FORMULA'; return; }
      cell.v = v; cell.formula = null; return;
    }
    cell.v = v; cell.formula = null;
  }

  class Range {
    constructor(sheet, r, c, nr, nc) { this.sheet = sheet; this.r = r; this.c = c; this.nr = nr; this.nc = nc; }
    each(fn) { for (let i = 0; i < this.nr; i++) for (let j = 0; j < this.nc; j++) fn(this.sheet.cell(this.r + i, this.c + j), i, j); }
    getValues() { const out = []; for (let i = 0; i < this.nr; i++) { const row = []; for (let j = 0; j < this.nc; j++) { const cell = this.sheet.peek(this.r + i, this.c + j); row.push(cell ? cell.v : ''); } out.push(row); } return out; }
    getValue() { return this.getValues()[0][0]; }
    setValues(vals) {
      if (vals.length !== this.nr || vals.some(r => r.length !== this.nc)) throw new Error(`Exception: The number of columns in the data does not match the number of columns in the range. The data has ${vals[0].length} but the range has ${this.nc}.`);
      vals.forEach(r => r.forEach(v => { if (typeof v === 'string' && v.length > 50000) throw new Error('Exception: Your input contains more than the maximum of 50000 characters in a single cell.'); }));
      this.each((cell, i, j) => store(cell, vals[i][j])); return this;
    }
    setValue(v) { log.setValueCalls=(log.setValueCalls||0)+1; if (opts.failAfterSetValues!=null && log.setValueCalls>opts.failAfterSetValues) throw new Error('Exceeded maximum execution time'); this.each(cell => store(cell, v)); return this; }
    setNumberFormat(f) { this.each(cell => { cell.fmt = f; }); return this; }
    setNumberFormats(f) { if (f.length !== this.nr || f.some(r => r.length !== this.nc)) throw new Error('Exception: setNumberFormats dims mismatch'); this.each((cell, i, j) => { cell.fmt = f[i][j]; }); return this; }
    getNumberFormats() { const o=[]; for (let i=0;i<this.nr;i++){const r=[];for(let j=0;j<this.nc;j++){const c=this.sheet.peek(this.r+i,this.c+j);r.push(c&&c.fmt||'General');}o.push(r);} return o; }
    setFontWeight() { return this; } setBackground() { return this; } setVerticalAlignment() { return this; } setWrap() { return this; }
    setDataValidation(dv) { this.each(cell => { cell.dv = dv; }); return this; }
    insertCheckboxes() { this.each(cell => { cell.checkbox = true; if (cell.v === '') cell.v = false; }); return this; }
    getRow() { return this.r; } getColumn() { return this.c; } getLastColumn() { return this.c + this.nc - 1; } getNumRows() { return this.nr; } getLastRow() { return this.r + this.nr - 1; }
    getSheet() { return this.sheet; }
    createTextFinder(text) {
      const range = this; let entire = false;
      const tf = {
        matchEntireCell(b) { entire = b; return tf; },
        findNext() {
          for (let i = 0; i < range.nr; i++) for (let j = 0; j < range.nc; j++) {
            const cell = range.sheet.peek(range.r + i, range.c + j); if (!cell) continue;
            const disp = String(cell.v).toLowerCase(); const t = String(text).toLowerCase();
            if (entire ? disp === t : disp.includes(t)) return new Range(range.sheet, range.r + i, range.c + j, 1, 1);
          }
          return null;
        },
      };
      return tf;
    }
  }

  class Spreadsheet {
    constructor() { this.sheets = [new Sheet(this, 'Sheet1')]; }
    getSheetByName(n) { return this.sheets.find(s => s.name === n) || null; }
    insertSheet(n) { const s = new Sheet(this, n); this.sheets.push(s); return s; }
    getSheets() { return this.sheets.slice(); }
    deleteSheet(s) { this.sheets = this.sheets.filter(x => x !== s); }
    getUrl() { return 'https://docs.google.com/spreadsheets/d/abc/edit'; }
  }
  const ss = new Spreadsheet();

  const cacheMap = new Map();
  let fakeNow = null;
  const nowMs = () => (fakeNow != null ? fakeNow : Date.now());
  let lockHeld = false;
  const cache = {
    get(k) { if (k.startsWith('rate:') && !lockHeld) log.rateOutsideLock=(log.rateOutsideLock||0)+1; if (k.length > 250) throw new Error('Exception: Argument too large: key'); const e = cacheMap.get(k); if (!e) return null; if (e.exp < nowMs()) { cacheMap.delete(k); return null; } return e.v; },
    put(k, v, s) {
      if (k.length > 250) throw new Error('Exception: Argument too large: key');
      if (typeof v !== 'string') v = String(v);
      if (Buffer.byteLength(v) > 102400) throw new Error('Exception: Argument too large: value');
      log.cachePuts.push({ k, s });
      const eff = Math.min(s == null ? 600 : s, 21600); // documented max 6h
      cacheMap.set(k, { v, exp: nowMs() + eff * 1000 });
    },
  };

  const props = new Map();
  const ctx = {
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => (props.has(k) ? props.get(k) : null), setProperty(k, v) { if (typeof v !== 'string') throw new Error('string'); if (v.length > 9000) throw new Error('Exception: value too large'); props.set(k, v); return this; }, deleteProperty(k) { props.delete(k); } }) },
    console: { log: () => {}, error: (...a) => log.errors.push(a.join(' ')), info: () => {}, warn: () => {} },
    SpreadsheetApp: {
      getActive: () => ss, getActiveSpreadsheet: () => ss, flush() {},
      newDataValidation() { const dv = { list: null, allowInvalid: true }; const b = { requireValueInList(l, show) { dv.list = l; dv.show = show; return b; }, setAllowInvalid(x) { dv.allowInvalid = x; return b; }, build() { return dv; } }; return b; },
      newConditionalFormatRule() { const rule = { ranges: [] }; const b = { whenTextEqualTo(t) { rule.text = t; return b; }, setBackground(c) { rule.bg = c; return b; }, setFontColor(c) { rule.fc = c; return b; }, setRanges(r) { rule.ranges = r; return b; }, build() { return { getRanges: () => rule.ranges, rule }; } }; return b; },
    },
    ContentService: { MimeType: { JSON: 'application/json' }, createTextOutput(s) { const o = { s, mime: null, setMimeType(m) { o.mime = m; return o; }, getContent() { return o.s; } }; return o; } },
    CacheService: { getScriptCache: () => cache },
    LockService: { getScriptLock: () => ({ waitLock() { if (lockHeld) throw new Error('Lock timeout'); lockHeld = true; }, releaseLock() { lockHeld = false; } }) },
    MailApp: {
      getRemainingDailyQuota: () => opts.mailQuota,
      sendEmail(m) {
        if (typeof m !== 'object') throw new Error('object form expected');
        if (/[\r\n]/.test(m.subject || '')) log.mails.push({ warnSubjectNewline: true });
        if (!/^[^,;\s]+@[^,;\s]+$/.test(m.to)) throw new Error('Exception: Invalid email: ' + m.to);
        opts.mailQuota--; log.mails.push(m);
      },
    },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
      computeDigest(alg, value, charset) { const buf = crypto.createHash(alg).update(Buffer.from(String(value), 'utf8')).digest(); return Array.from(buf, b => (b > 127 ? b - 256 : b)); },
      base64EncodeWebSafe(bytes) { return Buffer.from(bytes.map(b => (b + 256) % 256)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_'); },
      getUuid: () => crypto.randomUUID(),
      formatDate(d, tz, fmt) { if (tz !== 'UTC') throw new Error('tz'); const p = n => String(n).padStart(2, '0'); return fmt.replace('yyyy', d.getUTCFullYear()).replace('MM', p(d.getUTCMonth() + 1)).replace('dd', p(d.getUTCDate())).replace('HH', p(d.getUTCHours())); },
    },
    Session: { getEffectiveUser: () => ({ getEmail: () => opts.owner }) },
    ScriptApp: {
      getProjectTriggers: () => log.triggers.map(t => ({ getHandlerFunction: () => t })),
      newTrigger(fn) { const b = { timeBased: () => b, everyDays: () => b, atHour: () => b, create() { log.triggers.push(fn); } }; return b; },
    },
  };
  // Date: allow fake clock
  const RealDate = Date;
  class FakeDate extends RealDate { constructor(...a) { if (a.length === 0) super(nowMs()); else super(...a); } static now() { return nowMs(); } }
  ctx.Date = FakeDate;
  vm.createContext(ctx);
  let src = fs.readFileSync(CODE_PATH, 'utf8');
  if (opts.settings) src += '\n;Object.assign(SETTINGS, ' + JSON.stringify(opts.settings) + ');';
  src += '\n;this.__exports = { doPost, doGet, setup, onEdit, cleanUpOldOrders, sendTestRequest, clean_, cell_, withinRateLimits_, takeConfirmationSlot_, writeOrder_, itemText_, sendEmails_, looksSensitive_, validate_, SETTINGS, ORDER_COLUMNS, ITEM_COLUMNS };';
  vm.runInContext(src, ctx, { filename: 'Code.gs' });
  const X = ctx.__exports;
  return {
    X, ss, log, ctx, cacheMap, props,
    setNow(ms) { fakeNow = ms; },
    post(body) { const raw = typeof body === 'string' ? body : JSON.stringify(body); return JSON.parse(X.doPost({ postData: { contents: raw, type: 'text/plain' } }).getContent()); },
    sheet(name) { return ss.getSheetByName(name); },
    rowObj(name, r) { const sh = ss.getSheetByName(name); const cols = name === 'Orders' ? X.ORDER_COLUMNS : X.ITEM_COLUMNS; const o = {}; cols.forEach((h, i) => { const c = sh.peek(r, i + 1); o[h] = c ? c.v : undefined; }); return o; },
    setLock(v) { lockHeld = v; },
  };
}

module.exports = { makeEnv };
