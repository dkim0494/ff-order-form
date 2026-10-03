/**
 * @OnlyCurrentDoc
 *
 * Friends & Family order requests: Google Apps Script backend.
 *
 * Paste this whole file into Extensions > Apps Script of the Google Sheet that
 * should receive requests, run setup() once, then deploy as a web app.
 * Step-by-step instructions are in README.md.
 *
 * The @OnlyCurrentDoc line above limits this script to the one spreadsheet it
 * is attached to. It can't open any of your other files.
 */

const SETTINGS = {
  // Who may send requests: one invite per person or household, managed in the
  // "Invites" tab (menu Friends & Family > Add an invite…). Each invite is a link
  // like https://your-site/#invite=CODE; untick Active to revoke one.
  // INVITE_CODE is an optional extra shared code that always works (leave '' to
  // rely on the tab alone). With no invites and no code, anyone can submit.
  INVITE_CODE: '',

  // The public address of the page, used to build the links that "Add an invite…" shows.
  SITE_URL: '',

  // Set to false to pause new requests (people see a friendly message).
  ACCEPTING: true,

  // Emails. The notice to you leaves out phone numbers and addresses. The
  // confirmation to the requester only contains the reference number and item
  // count, so the form can't be used to send other text to strangers.
  NOTIFY_ME: true,
  CONFIRM_TO_REQUESTER: true,
  MAX_CONFIRMATIONS_PER_DAY: 30,
  SENDER_NAME: 'Friends & Family Orders',

  // Personal details (phone, address, trade-in serials, engraving, notes) are
  // erased this many days after you mark an order Completed or Cancelled.
  RETENTION_DAYS: 60,

  // Abuse limits.
  MAX_PER_EMAIL_PER_6_HOURS: 6,
  MAX_PER_HOUR: 40,
  MIN_SECONDS_TO_FILL: 5,
};

const STATUSES = ['New', 'Quoted', 'Approved', 'Paid', 'Ordered', 'Ready / Shipped', 'Completed', 'Cancelled'];
const CLOSED_STATUSES = ['Completed', 'Cancelled'];

const ORDERS_SHEET = 'Orders';
const ITEMS_SHEET = 'Items';
const INVITES_SHEET = 'Invites';
const INVITE_COLUMNS = ['Name', 'Code', 'Active', 'Uses', 'Last used', 'Notes'];

const ORDER_COLUMNS = [
  'Order ID', 'Submitted', 'Status', 'Status updated', 'Name', 'Email', 'Phone', 'Contact via',
  'Country', 'Fulfillment', 'Store / Address', 'Picked up by / Recipient', 'Preferred date', 'Need by',
  'Products', 'Units', 'Trade-in', 'Payment', 'Gift card', 'Budget', 'Requester notes', 'My notes', 'Submission ID',
  'Invite', // appended last so sheets set up by older versions upgrade in place
];
const ITEM_COLUMNS = ['Order ID', 'Line', 'Category', 'Product', 'Configuration', 'Qty', 'AppleCare', 'Engraving', 'Item notes', 'Ordered'];

// Cleared by the retention clean-up.
const PERSONAL_ORDER_COLUMNS = ['Phone', 'Store / Address', 'Picked up by / Recipient', 'Trade-in', 'Requester notes'];
const PERSONAL_ITEM_COLUMNS = ['Engraving', 'Item notes'];
// Also cleared: 'Payment' when it's free text ("Other: …") and 'Configuration'
// of custom items (category Other), since both are typed by the requester.

const REMOVED = '[removed]';

/* ======================================================= web app entry */

function doGet(e) {
  // The page asks ?invite=CODE before showing the form, so a bad link is caught up front.
  const code = e && e.parameter && e.parameter.invite;
  if (code !== undefined) {
    const inv = checkInvite_(code);
    return reply_({ ok: !!inv.ok, name: inv.ok ? inv.name || '' : '', open: !!inv.open, accepting: SETTINGS.ACCEPTING });
  }
  return reply_({ ok: true, service: 'friends-and-family-orders', accepting: SETTINGS.ACCEPTING });
}

function doPost(e) {
  try {
    const raw = (e && e.postData && e.postData.contents) || '';
    if (raw.length > 100000) return reply_({ ok: false, error: 'too_large' });

    let body;
    try { body = JSON.parse(raw); } catch (err) { return reply_({ ok: false, error: 'invalid', field: 'request', message: 'Malformed request.' }); }
    if (!body || typeof body !== 'object') return reply_({ ok: false, error: 'invalid', field: 'request', message: 'Empty request.' });

    if (!SETTINGS.ACCEPTING) return reply_({ ok: false, error: 'closed' });

    // Bots: the hidden field is filled in, or the form was "filled" in seconds.
    // Pretend it worked so they don't adapt.
    const elapsed = Number(body.elapsedMs);
    if (body.hp || (isFinite(elapsed) && elapsed < SETTINGS.MIN_SECONDS_TO_FILL * 1000)) {
      return reply_({ ok: true, id: makeOrderId_(), emailed: false });
    }

    const invite = checkInvite_(body.invite);
    if (!invite.ok) return reply_({ ok: false, error: 'invite' });

    const order = validate_(body);

    const cache = CacheService.getScriptCache();
    const dupKey = 'sub:' + hash_(order.submissionId);
    const cached = cache.get(dupKey);
    if (cached) return reply_({ ok: true, id: cached, duplicate: true, emailed: false });

    let id;
    let confirm = false;
    const lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      const existing = findOrderBySubmission_(order.submissionId);
      if (existing) {
        cache.put(dupKey, existing, 21600);
        return reply_({ ok: true, id: existing, duplicate: true, emailed: false });
      }
      // Checked under the lock so parallel requests can't slip past the limits.
      if (!withinRateLimits_(cache, order.contact.email)) return reply_({ ok: false, error: 'rate' });
      id = writeOrder_(order, invite);
      if (invite.row) recordInviteUse_(invite.row);
      confirm = SETTINGS.CONFIRM_TO_REQUESTER && takeConfirmationSlot_();
      SpreadsheetApp.flush();
      cache.put(dupKey, id, 21600);
    } finally {
      lock.releaseLock();
    }

    const emailed = sendEmails_(order, id, confirm);
    return reply_({ ok: true, id: id, emailed: emailed });
  } catch (err) {
    if (err && err.code) return reply_({ ok: false, error: err.code, field: err.field || '', message: err.message || '' });
    console.error(err && err.stack ? err.stack : err);
    return reply_({ ok: false, error: 'server' });
  }
}

function reply_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/* ========================================================== validation */

function fail_(field, message, code) {
  const e = new Error(message);
  e.code = code || 'invalid';
  e.field = field;
  throw e;
}

function clean_(v, max) {
  if (v == null) return '';
  return String(v)
    // Control characters, zero-width space, direction marks and bidi overrides.
    // ZWNJ/ZWJ (U+200C/U+200D) are kept: Persian and Indic names need them.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, '')
    .replace(/\r\n?/g, '\n')
    .trim()
    .slice(0, max);
}

function req_(v, max, field) {
  const s = clean_(v, max);
  if (!s) fail_(field, field + ' is missing.');
  return s;
}

const EMAIL_RE = /^[^\s@<>,;:"()\[\]\\]+@[^\s@<>,;:"()\[\]\\]+\.[^\s@<>,;:"()\[\]\\]{2,}$/;

function validate_(b) {
  const submissionId = req_(b.submissionId, 64, 'Submission ID');
  const country = clean_(b.country, 2).toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) fail_('Country', 'Country is missing.');

  const c = b.contact || {};
  const contact = {
    firstName: req_(c.firstName, 60, 'First name'),
    lastName: req_(c.lastName, 60, 'Last name'),
    email: req_(c.email, 120, 'Email'),
    phone: req_(c.phone, 30, 'Phone'),
    preferredContact: clean_(c.preferredContact, 40),
  };
  if (!EMAIL_RE.test(contact.email)) fail_('Email', 'Email address looks wrong.');
  if (contact.phone.replace(/\D/g, '').length < 5) fail_('Phone', 'Phone number looks wrong.');

  if (!Array.isArray(b.items) || !b.items.length) fail_('Products', 'No products were selected.');
  if (b.items.length > 30) fail_('Products', 'Too many products in one request.');
  const items = b.items.map(function (it) {
    it = it || {};
    return {
      product: req_(it.product, 120, 'Product'),
      category: clean_(it.category, 40),
      custom: !!it.custom,
      options: (Array.isArray(it.options) ? it.options.slice(0, 30) : [])
        .map(function (o) { return { label: clean_(o && o.label, 60), value: clean_(o && o.value, 600) }; })
        .filter(function (o) { return o.value; }),
      quantity: Math.max(1, Math.min(20, parseInt(it.quantity, 10) || 1)),
      applecare: clean_(it.applecare, 120),
      engraving: clean_(it.engraving, 80),
      notes: clean_(it.notes, 500),
      link: /^https?:\/\//i.test(clean_(it.link, 400)) ? clean_(it.link, 400) : '',
      configuredFor: clean_(it.configuredFor, 2).toUpperCase(),
    };
  });

  const tradeIns = (Array.isArray(b.tradeIns) ? b.tradeIns.slice(0, 5) : []).map(function (t) {
    t = t || {};
    const serial = clean_(t.serial, 24).toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!serial) fail_('Trade-in', 'Trade-in serial number is missing.');
    return {
      type: clean_(t.type, 30),
      model: req_(t.model, 80, 'Trade-in model'),
      serial: serial,
      worksNormally: clean_(t.worksNormally, 5),
      damage: clean_(t.damage, 5),
    };
  });

  const f = b.fulfillment || {};
  let fulfillment;
  if (f.method === 'pickup') {
    const pp = f.pickupPerson || {};
    fulfillment = {
      method: 'pickup',
      store: req_(f.store, 160, 'Store'),
      preferredDate: clean_(f.preferredDate, 10),
      pickupBy: f.pickupBy === 'someone else' ? 'someone else' : 'requester',
      pickupPerson: { firstName: clean_(pp.firstName, 60), lastName: clean_(pp.lastName, 60), email: clean_(pp.email, 120) },
    };
    if (fulfillment.pickupBy === 'someone else') {
      if (!fulfillment.pickupPerson.firstName || !fulfillment.pickupPerson.lastName) fail_('Pickup person', 'Pickup person’s name is missing.');
      if (!EMAIL_RE.test(fulfillment.pickupPerson.email)) fail_('Pickup person', 'Pickup person’s email looks wrong.');
    }
  } else if (f.method === 'delivery') {
    const r = f.recipient || {};
    fulfillment = {
      method: 'delivery',
      recipient: { firstName: req_(r.firstName, 60, 'Recipient first name'), lastName: req_(r.lastName, 60, 'Recipient last name'), phone: clean_(r.phone, 30) },
      formattedAddress: req_(f.formattedAddress, 600, 'Address'),
      address: {},
      instructions: clean_(f.instructions, 300),
    };
    const a = f.address || {};
    ['address1', 'address2', 'sublocality', 'city', 'state', 'postal', 'sorting'].forEach(function (k) {
      if (a[k]) fulfillment.address[k] = clean_(a[k], 120);
    });
    if (!fulfillment.address.address1) fail_('Address', 'Street address is missing.');
  } else {
    fail_('Fulfillment', 'Choose pickup or delivery.');
  }

  const p = b.payment || {};
  const payment = {
    method: req_(p.method, 100, 'Payment method'),
    giftCard: !!p.giftCard,
    giftCardAmount: clean_(p.giftCardAmount, 16),
    budget: clean_(p.budget, 16),
    currency: clean_(p.currency, 3).toUpperCase(),
  };

  const order = {
    submissionId: submissionId,
    country: country,
    countryName: clean_(b.countryName, 60) || country,
    contact: contact,
    items: items,
    tradeIns: tradeIns,
    fulfillment: fulfillment,
    neededBy: clean_(b.neededBy, 10),
    payment: payment,
    notes: clean_(b.notes, 1000),
    catalogVersion: clean_(b.catalogVersion, 20),
  };

  // Refuse anything that looks like card numbers, gift card codes, or ID numbers.
  // Trade-in serials and phone numbers are skipped (IMEIs pass the card checksum).
  const texts = [contact.firstName, contact.lastName, order.notes, payment.method, payment.giftCardAmount, payment.budget];
  items.forEach(function (it) {
    texts.push(it.product, it.engraving, it.notes); // not links: they often hold long numeric IDs
    it.options.forEach(function (o) { texts.push(o.value); });
  });
  tradeIns.forEach(function (t) { texts.push(t.model); });
  if (fulfillment.method === 'pickup') texts.push(fulfillment.store);
  else texts.push(fulfillment.formattedAddress, fulfillment.instructions);
  texts.forEach(function (t) { if (looksSensitive_(t)) fail_('Sensitive', 'Sensitive data found.', 'sensitive'); });

  return order;
}

function luhn_(digits) {
  let sum = 0, alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = digits.charCodeAt(i) - 48;
    if (alt) { n *= 2; if (n > 9) n -= 9; }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

// Mirrors sensitiveKind() in app.js. Checks every run of whole digit groups,
// so "4111 1111 1111 1111 12/28" or "x2 4111…" can't hide a card number.
function looksSensitive_(s) {
  if (!s) return false;
  const text = String(s);
  const runs = /(\+?)\d+(?:[ .\-]{1,3}\d+)*/g;
  let m;
  while ((m = runs.exec(text))) {
    if (m[1]) continue; // "+49 151 …" is a phone number
    const g = m[0].split(/[ .\-]+/);
    for (let i = 0; i < g.length; i++) {
      let d = '';
      for (let j = i; j < g.length && d.length < 19; j++) {
        d += g[j];
        if (d.length >= 13 && d.length <= 19 && /^(?:4|5[0-8]|2[2-7]|3|6|8[12]|9792)/.test(d) &&
            (d.length !== 15 || /^3[47]/.test(d)) && luhn_(d)) return true;
      }
    }
  }
  const gifts = text.match(/\bX[A-Z0-9]{3}[ -]?[A-Z0-9]{4}[ -]?[A-Z0-9]{4}[ -]?[A-Z0-9]{4}\b/gi) || [];
  for (let i = 0; i < gifts.length; i++) if (/\d/.test(gifts[i])) return true;
  if (/\b\d{3}-\d{2}-\d{4}\b/.test(text)) return true;
  return false;
}

/* ============================================================== invites */
// One row per person or household in the Invites tab, or the shared SETTINGS.INVITE_CODE.
function inviteRows_() {
  const sheet = SpreadsheetApp.getActive().getSheetByName(INVITES_SHEET);
  if (!sheet || sheet.getLastRow() < 2) return [];
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, INVITE_COLUMNS.length).getValues().map(function (r, i) {
    return { row: i + 2, name: String(r[0] || '').trim(), code: String(r[1] || '').trim(), active: r[2] === true || String(r[2]).trim().toUpperCase() === 'TRUE', uses: Number(r[3]) || 0 };
  }).filter(function (x) { return x.code; });
}
// { ok, name, row } for an accepted code; { ok: true, open: true } when nothing is configured.
function checkInvite_(code) {
  const rows = inviteRows_();
  if (!rows.length && !SETTINGS.INVITE_CODE) return { ok: true, open: true };
  const c = String(code || '').trim();
  if (!c) return { ok: false };
  if (SETTINGS.INVITE_CODE && sameCode_(c, SETTINGS.INVITE_CODE)) return { ok: true, name: 'Shared link' };
  for (var i = 0; i < rows.length; i++) {
    if (sameCode_(c, rows[i].code)) return rows[i].active ? { ok: true, name: rows[i].name, row: rows[i].row } : { ok: false };
  }
  return { ok: false };
}
function recordInviteUse_(row) {
  try {
    const sheet = SpreadsheetApp.getActive().getSheetByName(INVITES_SHEET);
    if (!sheet) return;
    const usesCol = INVITE_COLUMNS.indexOf('Uses') + 1;
    const uses = Number(sheet.getRange(row, usesCol).getValue()) || 0;
    sheet.getRange(row, usesCol).setValue(uses + 1);
    sheet.getRange(row, INVITE_COLUMNS.indexOf('Last used') + 1).setValue(new Date());
  } catch (err) { console.warn('Could not record the invite use: ' + err); }
}
function newInviteCode_() {
  // 24 hex characters (96 random bits) from two v4 UUIDs: easy to paste, impossible to guess.
  return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '').slice(0, 24).toLowerCase();
}
function inviteLink_(code) {
  const base = String(SETTINGS.SITE_URL || '').trim().replace(/\/+$/, '');
  return (base ? base + '/' : '') + '#invite=' + code;
}
// Sheet menu: Friends & Family > Add an invite…
function onOpen() {
  try {
    SpreadsheetApp.getUi().createMenu('Friends & Family')
      .addItem('Add an invite…', 'addInvite')
      .addItem('Send a test request', 'sendTestRequest')
      .addToUi();
  } catch (err) { /* no UI when run from a trigger */ }
}
function addInvite() {
  const ui = SpreadsheetApp.getUi();
  const res = ui.prompt('Add an invite', 'Who is it for? For example "Lopez family" or "Uncle Ben".', ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  const name = String(res.getResponseText() || '').trim().slice(0, 80);
  if (!name) return;
  const sheet = ensureSheet_(SpreadsheetApp.getActive(), INVITES_SHEET, INVITE_COLUMNS);
  const code = newInviteCode_();
  const row = sheet.getLastRow() + 1;
  sheet.getRange(row, 1, 1, INVITE_COLUMNS.length).setNumberFormats([['@', '@', 'General', '0', 'yyyy-mm-dd hh:mm', '@']])
    .setValues([[name, code, true, 0, '', '']]);
  sheet.getRange(row, INVITE_COLUMNS.indexOf('Active') + 1).insertCheckboxes();
  const link = inviteLink_(code);
  ui.alert('Invite for ' + name, 'Share this link:\n\n' + link + (SETTINGS.SITE_URL ? '' : '\n\n(Set SITE_URL in Code.gs to get full links.)') + '\n\nTo revoke it, untick Active in the Invites tab.', ui.ButtonSet.OK);
}

function sameCode_(a, b) {
  const x = String(a || '').trim().toLowerCase();
  const y = String(b || '').trim().toLowerCase();
  return x.length > 0 && hash_(x) === hash_(y);
}

function hash_(s) {
  return Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(s), Utilities.Charset.UTF_8));
}

function withinRateLimits_(cache, email) {
  const now = new Date();
  const hourKey = 'rate:h:' + Utilities.formatDate(now, 'UTC', 'yyyyMMddHH');
  // CacheService entries live at most 6 hours, so the per-email window is 6 hours.
  const block = Math.floor(now.getUTCHours() / 6);
  const emailKey = 'rate:e:' + hash_(email.toLowerCase()) + ':' + Utilities.formatDate(now, 'UTC', 'yyyyMMdd') + block;
  const perHour = Number(cache.get(hourKey) || 0);
  const perEmail = Number(cache.get(emailKey) || 0);
  if (perHour >= SETTINGS.MAX_PER_HOUR || perEmail >= SETTINGS.MAX_PER_EMAIL_PER_6_HOURS) return false;
  cache.put(hourKey, String(perHour + 1), 3600);
  cache.put(emailKey, String(perEmail + 1), 21600);
  return true;
}

/* ============================================================= writing */

// Text columns are set to Plain text on every written row (see writeRows_), so
// nothing typed by a requester is evaluated. As a second guard, a value
// starting with "=" gets a leading apostrophe.
function cell_(v) {
  if (typeof v !== 'string') return v;
  return /^\s*=/.test(v) ? "'" + v : v;
}

function formatsFor_(headers) {
  return headers.map(function (h) {
    if (h === 'Submitted' || h === 'Status updated') return 'yyyy-mm-dd hh:mm';
    if (['Units', 'Line', 'Qty'].indexOf(h) >= 0) return '0';
    if (h === 'Ordered') return 'General';
    return '@';
  });
}

// Adds rows when a tab is full (new tabs start with 1000), then writes.
function writeRows_(sheet, headers, rows) {
  const first = sheet.getLastRow() + 1;
  const last = first + rows.length - 1;
  const max = sheet.getMaxRows();
  if (last > max) sheet.insertRowsAfter(max, Math.max(last - max, 500));
  const fmt = formatsFor_(headers);
  const range = sheet.getRange(first, 1, rows.length, headers.length);
  range.setNumberFormats(rows.map(function () { return fmt; }));
  range.setValues(rows.map(function (r) { return r.map(cell_); }));
  return first;
}

function makeOrderId_() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Utilities.getUuid());
  for (let i = 0; i < 5; i++) s += alphabet[(bytes[i] + 256) % alphabet.length];
  return 'FF-' + s;
}

function findOrderBySubmission_(submissionId) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(ORDERS_SHEET);
  if (!sheet || sheet.getLastRow() < 2) return '';
  const col = ORDER_COLUMNS.indexOf('Submission ID') + 1;
  const hit = sheet.getRange(2, col, sheet.getLastRow() - 1, 1).createTextFinder(submissionId).matchEntireCell(true).findNext();
  return hit ? String(sheet.getRange(hit.getRow(), 1).getValue()) : '';
}

function uniqueOrderId_(sheet) {
  for (let i = 0; i < 8; i++) {
    const id = makeOrderId_();
    if (sheet.getLastRow() < 2) return id;
    const hit = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).createTextFinder(id).matchEntireCell(true).findNext();
    if (!hit) return id;
  }
  return makeOrderId_() + Utilities.getUuid().slice(0, 2).toUpperCase();
}

function personName_(p) {
  return [p.firstName, p.lastName].filter(String).join(' ');
}

// brief: leave out text typed by the requester (engraving, notes, links,
// custom-item details). Used for the Orders summary, which is kept after the
// retention clean-up.
function itemText_(it, i, brief, country) {
  const lines = [];
  const spec = it.options.map(function (o) { return o.value; }).join(' · ');
  if (spec && !(brief && it.custom)) lines.push(spec);
  if (it.applecare) lines.push(it.applecare);
  if (it.configuredFor && country && it.configuredFor !== country) lines.push('Configured for ' + it.configuredFor);
  if (it.engraving && !brief) lines.push('Engraving: “' + it.engraving + '”');
  if (it.link && !brief) lines.push(it.link);
  if (it.notes && !brief) lines.push('Note: ' + it.notes);
  return (i + 1) + '. ' + it.product + (it.quantity > 1 ? ' × ' + it.quantity : '') + (lines.length ? '\n    ' + lines.join('\n    ') : '');
}

function money_(amount, currency) {
  return amount ? (amount + (currency ? ' ' + currency : '')) : '';
}

function writeOrder_(o, invite) {
  const ss = SpreadsheetApp.getActive();
  const orders = ensureSheet_(ss, ORDERS_SHEET, ORDER_COLUMNS);
  const items = ensureSheet_(ss, ITEMS_SHEET, ITEM_COLUMNS);
  const id = uniqueOrderId_(orders);
  const now = new Date();
  const f = o.fulfillment;

  const where = f.method === 'pickup' ? f.store : f.formattedAddress;
  const who = f.method === 'pickup'
    ? (f.pickupBy === 'someone else'
      ? personName_(f.pickupPerson) + ' (' + f.pickupPerson.email + ')'
      : personName_(o.contact))
    : personName_(f.recipient) + (f.recipient.phone ? ' · ' + f.recipient.phone : '') + (f.instructions ? '\nInstructions: ' + f.instructions : '');
  const tradeIn = o.tradeIns.map(function (t) {
    return t.type + ' · ' + t.model + ' · ' + t.serial + ' · works: ' + t.worksNormally + ', damage: ' + t.damage;
  }).join('\n');
  const units = o.items.reduce(function (n, it) { return n + it.quantity; }, 0);

  const row = [
    id, now, 'New', now,
    personName_(o.contact), o.contact.email, o.contact.phone, o.contact.preferredContact,
    o.countryName, f.method === 'pickup' ? 'Pickup' : 'Delivery', where, who,
    f.method === 'pickup' ? f.preferredDate : '', o.neededBy,
    o.items.map(function (it, i) { return itemText_(it, i, true, o.country); }).join('\n'), units, tradeIn,
    o.payment.method,
    o.payment.giftCard ? money_(o.payment.giftCardAmount, o.payment.currency) : 'No',
    money_(o.payment.budget, o.payment.currency),
    o.notes, '', o.submissionId,
    (invite && invite.name) || '',
  ];

  const itemRows = o.items.map(function (it, i) {
    return [
      id, i + 1, it.category, it.product,
      it.options.map(function (x) { return x.label ? x.label + ': ' + x.value : x.value; }).join('\n') +
        (it.link ? '\n' + it.link : '') +
        (it.configuredFor && it.configuredFor !== o.country ? '\nConfigured for: ' + it.configuredFor : ''),
      it.quantity, it.applecare, it.engraving, it.notes, false,
    ];
  });

  // Items first: if a write fails, there's no Orders row that a retry could
  // mistake for a finished order.
  const ir = writeRows_(items, ITEM_COLUMNS, itemRows);
  try {
    items.getRange(ir, ITEM_COLUMNS.indexOf('Ordered') + 1, itemRows.length, 1).insertCheckboxes();
    const r = writeRows_(orders, ORDER_COLUMNS, [row]);
    orders.getRange(r, ORDER_COLUMNS.indexOf('Status') + 1).setDataValidation(statusRule_());
  } catch (err) {
    // Don't leave item rows without an order: remove them so a retry starts clean.
    try { items.deleteRows(ir, itemRows.length); } catch (e) { /* best effort */ }
    throw err;
  }
  return id;
}

function statusRule_() {
  return SpreadsheetApp.newDataValidation().requireValueInList(STATUSES, true).setAllowInvalid(false).build();
}

function ensureSheet_(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  const first = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
  if (first.join('') === '') {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers])
      .setFontWeight('bold').setBackground('#f5f5f7').setVerticalAlignment('middle');
    sheet.setFrozenRows(1);
    sheet.setRowHeight(1, 32);
    sheet.getRange(2, 1, sheet.getMaxRows() - 1, headers.length).setVerticalAlignment('top').setWrap(true);
  } else {
    // A sheet set up by an older version: add the columns appended since then.
    headers.forEach(function (h, i) {
      if (first[i] === '') sheet.getRange(1, i + 1).setValue(h).setFontWeight('bold').setBackground('#f5f5f7').setVerticalAlignment('middle');
    });
  }
  return sheet;
}

/* ============================================================== emails */

function esc_(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function emailShell_(title, inner) {
  return '<div style="font-family:-apple-system,BlinkMacSystemFont,Helvetica,Arial,sans-serif;color:#1d1d1f;max-width:560px;margin:0 auto;padding:24px">' +
    '<h1 style="font-size:24px;font-weight:600;letter-spacing:-0.02em;margin:0 0 16px">' + esc_(title) + '</h1>' + inner +
    '</div>';
}

function itemsHtml_(o) {
  return '<ol style="padding-left:20px;margin:0 0 20px">' + o.items.map(function (it) {
    const meta = [it.options.map(function (x) { return x.value; }).join(' · '), it.applecare,
      it.configuredFor && it.configuredFor !== o.country ? 'Configured for ' + it.configuredFor : '',
      it.engraving ? 'Engraving: “' + it.engraving + '”' : '']
      .filter(String).map(esc_).join('<br>');
    return '<li style="margin-bottom:10px"><strong>' + esc_(it.product) + (it.quantity > 1 ? ' × ' + it.quantity : '') + '</strong>' +
      (meta ? '<br><span style="color:#6e6e73;font-size:14px">' + meta + '</span>' : '') + '</li>';
  }).join('') + '</ol>';
}

function sendEmails_(o, id, confirm) {
  let confirmed = false;
  try {
    if (MailApp.getRemainingDailyQuota() < 2) return false;
    const f = o.fulfillment;
    const units = o.items.reduce(function (n, it) { return n + it.quantity; }, 0);
    const itemsWord = units + (units === 1 ? ' item' : ' items');

    if (SETTINGS.NOTIFY_ME) {
      const me = Session.getEffectiveUser().getEmail();
      if (me) {
        const url = SpreadsheetApp.getActive().getUrl();
        const how = f.method === 'pickup' ? 'Pickup at ' + f.store : 'Delivery in ' + o.countryName;
        MailApp.sendEmail({
          to: me,
          subject: 'New request ' + id + ': ' + personName_(o.contact) + ' (' + itemsWord + ')',
          name: SETTINGS.SENDER_NAME,
          body: 'New request ' + id + ' from ' + personName_(o.contact) + '\n' + how + '\n\n' +
            o.items.map(function (it, i) { return itemText_(it, i, false, o.country); }).join('\n') +
            (o.tradeIns.length ? '\n\nTrade-in: ' + o.tradeIns.length + ' device(s)' : '') +
            '\n\nOpen the sheet for contact and delivery details:\n' + url,
          htmlBody: emailShell_('New request ' + id,
            '<p style="margin:0 0 6px"><strong>' + esc_(personName_(o.contact)) + '</strong> · ' + esc_(how) + '</p>' +
            (o.tradeIns.length ? '<p style="margin:0 0 6px">Trade-in: ' + o.tradeIns.length + ' device(s)</p>' : '') +
            '<p style="margin:0 0 16px;color:#6e6e73">Payment: ' + esc_(o.payment.method) + '</p>' +
            itemsHtml_(o) +
            '<p><a href="' + esc_(url) + '" style="color:#0066cc">Open the sheet</a> for contact and delivery details.</p>'),
        });
      }
    }

    // The confirmation goes to an address anyone could type in, so it repeats
    // nothing the requester wrote except a letters-only first name. It's capped
    // per day and keeps quota in reserve for the notices to you.
    if (confirm && MailApp.getRemainingDailyQuota() > 20) {
      // First word of the first name, letters only: nothing here can form a link or a sentence.
      const hi = (o.contact.firstName.replace(/[^\p{L}\p{M}\u200C\u200D '’-]/gu, '').trim().split(/\s+/)[0] || '').slice(0, 24) || 'there';
      const next = [
        'You’ll get the final price to approve. Nothing is ordered before that.',
        'Pay once you approve. Never send card numbers by message.',
        'You’ll get pickup or tracking details when it’s ready.',
      ];
      MailApp.sendEmail({
        to: o.contact.email,
        subject: 'We got your request (' + id + ')',
        name: SETTINGS.SENDER_NAME,
        body: 'Hi ' + hi + ',\n\nThanks, your request for ' + itemsWord + ' is in. Your reference number is ' + id + '.\n\n' +
          'What happens next:\n' + next.map(function (t, i) { return (i + 1) + '. ' + t; }).join('\n') +
          '\n\nReply to this email if you have questions.',
        htmlBody: emailShell_('Your request is in.',
          '<p style="margin:0 0 16px">Hi ' + esc_(hi) + ', thanks. Your request for ' + itemsWord + ' is in. ' +
          'Your reference number is <strong>' + esc_(id) + '</strong>.</p>' +
          '<p style="margin:0 0 6px"><strong>What happens next</strong></p>' +
          '<ol style="padding-left:20px;margin:0 0 16px;color:#424245">' +
          next.map(function (t) { return '<li>' + esc_(t) + '</li>'; }).join('') + '</ol>' +
          '<p style="color:#6e6e73;font-size:14px">Reply to this email if you have questions.</p>'),
      });
      confirmed = true;
    }
  } catch (err) {
    console.error('Email failed: ' + (err && err.message));
  }
  return confirmed;
}

function takeConfirmationSlot_() {
  const props = PropertiesService.getScriptProperties();
  const today = Utilities.formatDate(new Date(), 'UTC', 'yyyyMMdd');
  let state = {};
  try { state = JSON.parse(props.getProperty('confirmations') || '{}'); } catch (e) { state = {}; }
  if (state.day !== today) state = { day: today, n: 0 };
  if (state.n >= SETTINGS.MAX_CONFIRMATIONS_PER_DAY) return false;
  state.n++;
  props.setProperty('confirmations', JSON.stringify(state));
  return true;
}

/* ===================================================== sheet behaviour */

// Simple trigger: stamps "Status updated" whenever you change a status.
function onEdit(e) {
  try {
    const sheet = e.range.getSheet();
    if (sheet.getName() !== ORDERS_SHEET || e.range.getRow() < 2) return;
    const statusCol = ORDER_COLUMNS.indexOf('Status') + 1;
    if (e.range.getColumn() > statusCol || e.range.getLastColumn() < statusCol) return;
    const updatedCol = ORDER_COLUMNS.indexOf('Status updated') + 1;
    sheet.getRange(e.range.getRow(), updatedCol, e.range.getNumRows(), 1).setValue(new Date());
  } catch (err) { /* never block an edit */ }
}

// Daily: erase personal details from orders closed more than RETENTION_DAYS ago.
// Safe to re-run: cells already cleared are skipped.
function cleanUpOldOrders() {
  const ss = SpreadsheetApp.getActive();
  const orders = ss.getSheetByName(ORDERS_SHEET);
  if (!orders || orders.getLastRow() < 2) return;
  const cutoff = new Date(Date.now() - SETTINGS.RETENTION_DAYS * 86400000);
  const data = orders.getRange(2, 1, orders.getLastRow() - 1, ORDER_COLUMNS.length).getValues();
  const col = function (name) { return ORDER_COLUMNS.indexOf(name); };
  const clear = function (sheet, r, c, value) {
    if (value !== '' && value !== REMOVED) sheet.getRange(r, c + 1).setValue(REMOVED);
  };
  const purgeIds = {};
  data.forEach(function (row, i) {
    const status = row[col('Status')];
    const updated = row[col('Status updated')];
    if (CLOSED_STATUSES.indexOf(status) < 0 || !(updated instanceof Date) || updated > cutoff) return;
    purgeIds[row[0]] = true;
    PERSONAL_ORDER_COLUMNS.forEach(function (name) { clear(orders, i + 2, col(name), row[col(name)]); });
    if (/^Other:/.test(String(row[col('Payment')]))) clear(orders, i + 2, col('Payment'), row[col('Payment')]);
  });
  const items = ss.getSheetByName(ITEMS_SHEET);
  if (!items || items.getLastRow() < 2 || !Object.keys(purgeIds).length) return;
  const idata = items.getRange(2, 1, items.getLastRow() - 1, ITEM_COLUMNS.length).getValues();
  const icol = function (name) { return ITEM_COLUMNS.indexOf(name); };
  idata.forEach(function (row, i) {
    if (!purgeIds[row[0]]) return;
    PERSONAL_ITEM_COLUMNS.forEach(function (name) { clear(items, i + 2, icol(name), row[icol(name)]); });
    if (row[icol('Category')] === 'Other') clear(items, i + 2, icol('Configuration'), row[icol('Configuration')]);
  });
}

/* =============================================================== setup */

// Run once from the Apps Script editor (select "setup" and press Run).
function setup() {
  const ss = SpreadsheetApp.getActive();
  const orders = ensureSheet_(ss, ORDERS_SHEET, ORDER_COLUMNS);
  const items = ensureSheet_(ss, ITEMS_SHEET, ITEM_COLUMNS);
  const invites = ensureSheet_(ss, INVITES_SHEET, INVITE_COLUMNS);
  [160, 260, 70, 60, 140, 240].forEach(function (w, i) { invites.setColumnWidth(i + 1, w); });
  if (SETTINGS.INVITE_CODE && SETTINGS.INVITE_CODE.length < 16) {
    console.warn('Your invite code is short. Use 20+ random letters and digits; the #invite= link fills it in for people.');
  }

  const widths = { 'Order ID': 96, 'Submitted': 130, 'Status': 130, 'Status updated': 130, 'Name': 150, 'Email': 200, 'Phone': 140,
    'Store / Address': 240, 'Picked up by / Recipient': 200, 'Products': 360, 'Trade-in': 240, 'Requester notes': 220, 'My notes': 220, 'Invite': 140 };
  ORDER_COLUMNS.forEach(function (h, i) { if (widths[h]) orders.setColumnWidth(i + 1, widths[h]); });
  [96, 48, 110, 200, 300, 48, 200, 140, 220, 80].forEach(function (w, i) { items.setColumnWidth(i + 1, w); });
  orders.hideColumns(ORDER_COLUMNS.indexOf('Submission ID') + 1);

  // Status dropdown + colours.
  const statusCol = ORDER_COLUMNS.indexOf('Status') + 1;
  // Open-ended (e.g. C2:C) so rows added later keep the dropdown and colours.
  const letter = String.fromCharCode(64 + statusCol); // Status is within the first 26 columns
  const statusRange = orders.getRange(letter + '2:' + letter);
  statusRange.setDataValidation(statusRule_());
  const colours = { 'New': ['#e8f1fd', '#0058b0'], 'Quoted': ['#fff4e5', '#a05a00'], 'Approved': ['#fff4e5', '#a05a00'], 'Paid': ['#eef7ee', '#1d6b2a'],
    'Ordered': ['#eef7ee', '#1d6b2a'], 'Ready / Shipped': ['#eef7ee', '#1d6b2a'], 'Completed': ['#f2f2f4', '#6e6e73'], 'Cancelled': ['#f2f2f4', '#86868b'] };
  const rules = orders.getConditionalFormatRules().filter(function (r) {
    return !r.getRanges().some(function (rg) { return rg.getColumn() === statusCol; });
  });
  Object.keys(colours).forEach(function (s) {
    rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(s).setBackground(colours[s][0]).setFontColor(colours[s][1]).setRanges([statusRange]).build());
  });
  orders.setConditionalFormatRules(rules);

  // Daily clean-up trigger (installed once).
  const has = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'cleanUpOldOrders'; });
  if (!has) ScriptApp.newTrigger('cleanUpOldOrders').timeBased().everyDays(1).atHour(3).create();

  const leftover = ss.getSheetByName('Sheet1');
  if (leftover && leftover.getLastRow() === 0 && ss.getSheets().length > 2) ss.deleteSheet(leftover);

  onOpen();
  console.log('Setup complete. Next: Deploy > New deployment > Web app (Execute as: Me, Who has access: Anyone). Copy the /exec URL into config.js. Then add invites from the Friends & Family menu.');
}

// Optional: run from the editor to check everything end to end.
// Adds a test row marked Cancelled (delete it afterwards) and emails you.
function sendTestRequest() {
  const sample = {
    submissionId: 'test-' + Utilities.getUuid(),
    elapsedMs: 60000,
    invite: SETTINGS.INVITE_CODE || (inviteRows_().filter(function (x) { return x.active; })[0] || {}).code || '',
    country: 'US',
    countryName: 'United States',
    contact: { firstName: 'Test', lastName: 'Person', email: Session.getEffectiveUser().getEmail() || 'test@example.com', phone: '+1 555 0100', preferredContact: 'Email' },
    items: [{ product: 'Test product', category: 'Other', options: [{ label: 'Details', value: 'Setup check' }], quantity: 1 }],
    tradeIns: [],
    fulfillment: { method: 'pickup', store: 'Test store', pickupBy: 'requester', pickupPerson: {} },
    payment: { method: 'Other: test', currency: 'USD' },
    notes: 'Created by sendTestRequest(). Safe to delete.',
  };
  const res = JSON.parse(doPost({ postData: { contents: JSON.stringify(sample) } }).getContent());
  console.log(JSON.stringify(res));
  if (res.ok) {
    const sheet = SpreadsheetApp.getActive().getSheetByName(ORDERS_SHEET);
    sheet.getRange(sheet.getLastRow(), ORDER_COLUMNS.indexOf('Status') + 1).setValue('Cancelled');
  }
}
