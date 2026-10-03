'use strict';
// Runs apps-script/Code.gs against an in-memory mock of the Apps Script services.
const { makeEnv } = require('./lib/gas-mock');
const crypto = require('crypto');
let n = 0, fails = 0;
function ok(cond, msg, extra) { if (!cond) fails++; console.log((cond ? 'PASS ' : 'FAIL ') + msg + (extra !== undefined ? ' :: ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)) : '')); }
function section(t) { console.log('\n=== ' + t); }
function payload(over) {
  return Object.assign({
    v: 1, submissionId: crypto.randomUUID(), hp: '', elapsedMs: 120000, invite: '', catalogVersion: '2026-10',
    country: 'US', countryName: 'United States',
    contact: { firstName: 'Ana', lastName: 'García', email: `ana${n++}@example.com`, phone: '+1 415 555 0100', preferredContact: 'iMessage' },
    items: [
      { product: 'iPhone 18 Pro', category: 'iPhone', custom: false,
        options: [{ label: 'Model', value: 'Pro Max' }, { label: 'Color', value: 'Cosmic Orange' }, { label: 'Storage', value: '1TB' }],
        quantity: 2, applecare: 'AppleCare+ (Monthly)', engraving: '', notes: 'Gift for mom', link: '', configuredFor: 'US' },
      { product: 'AirPods Pro 3', category: 'AirPods', custom: false, options: [], quantity: 1, applecare: 'No AppleCare', engraving: 'Love you Mom', notes: '', link: '', configuredFor: 'US' },
    ],
    tradeIns: [],
    fulfillment: { method: 'pickup', store: 'Apple Union Square', preferredDate: '2026-10-20', pickupBy: 'requester', pickupPerson: {} },
    neededBy: '', payment: { method: 'Venmo', giftCard: false, giftCardAmount: '', budget: '', currency: 'USD' }, notes: '',
  }, over || {});
}
const deliveryF = { method: 'delivery', recipient: { firstName: 'Bob', lastName: 'Lee', phone: '+44 7700 900123' },
  address: { address1: '10 Downing St', city: 'London', postal: 'SW1A 2AA' },
  formattedAddress: 'Bob Lee\n10 Downing St\nLONDON\nSW1A 2AA', instructions: 'Gate code 4321' };

// 1. happy paths
section('happy paths');
{
  const env = makeEnv(); env.X.setup();
  let r = env.post(payload());
  ok(r.ok && /^FF-[A-Z2-9]{5}$/.test(r.id) && r.emailed === true, 'pickup ok', r);
  r = env.post(payload({ country: 'GB', countryName: 'United Kingdom', fulfillment: deliveryF,
    tradeIns: [{ type: 'iPhone', model: 'iPhone 13 mini', serial: 'F2LXK1ABCD12', worksNormally: 'Yes', damage: 'No' }],
    payment: { method: 'Other: Revolut @handle', giftCard: true, giftCardAmount: '250', budget: '3,000', currency: 'GBP' } }));
  ok(r.ok, 'delivery ok', r);
  const o2 = env.rowObj('Orders', 2), o3 = env.rowObj('Orders', 3);
  ok(o2.Status === 'New' && o2.Units === 3, 'orders row 2 fields', { status: o2.Status, units: o2.Units });
  ok(o3['Store / Address'].includes('10 Downing') && o3['Picked up by / Recipient'].includes('Gate code'), 'delivery row');
  ok(o3['Gift card'] === '250 GBP' && o3.Budget === '3,000 GBP', 'gift/budget', [o3['Gift card'], o3.Budget]);
  ok(env.sheet('Items').getLastRow() === 5, 'items rows=4 (+header)', env.sheet('Items').getLastRow());
  ok(env.log.errors.length === 0, 'no errors', env.log.errors);
  ok(!env.log.rateOutsideLock, 'rate counters read only under lock', env.log.rateOutsideLock);
  // GET
  ok(JSON.parse(env.X.doGet().getContent()).ok, 'doGet');
  // checkbox + status validation
  const it = env.sheet('Items').peek(2, 10); ok(it.checkbox && it.v === false, 'Ordered checkbox');
  ok(env.sheet('Orders').peek(2, 3).dv && env.sheet('Orders').peek(2, 3).dv.list.length === 8, 'status DV');
}

// 2. writeRows_ past 1000 rows; items-before-orders
section('row growth');
{
  const env = makeEnv(); env.X.setup();
  const big = payload({ items: Array.from({ length: 30 }, (_, i) => ({ product: 'P' + i, category: 'Mac', options: [{ label: 'x', value: 'y' }], quantity: 1 })) });
  let bad = 0;
  for (let i = 0; i < 40; i++) {
    const r = env.post(Object.assign(payload(), { items: big.items, submissionId: crypto.randomUUID(), contact: { firstName: 'A', lastName: 'B', email: 'u' + i + '@x.com', phone: '+1 415 555 0100' } }));
    if (!r.ok) { bad++; if (bad < 3) console.log('  err', r); }
    if (i === 34) env.setNow(Date.now() + 3601e3);
  }
  const items = env.sheet('Items');
  ok(bad === 0, '40 x 30-item orders accepted (1200 item rows)', { bad, last: items.getLastRow(), max: items.getMaxRows() });
  ok(items.getLastRow() === 1201, 'items lastRow 1201', items.getLastRow());
  const fmts = items.getRange(1201, 1, 1, 10).getNumberFormats()[0];
  ok(fmts.join('|') === '@|0|@|@|@|0|@|@|@|General', 'formats on grown rows', fmts);
  const oFmt = env.sheet('Orders').getRange(2, 1, 1, 23).getNumberFormats()[0];
  ok(oFmt[1] === 'yyyy-mm-dd hh:mm' && oFmt[3] === 'yyyy-mm-dd hh:mm' && oFmt[15] === '0' && oFmt[6] === '@', 'order formats', oFmt);
  // Orders past 1000
  const env2 = makeEnv({ maxRows: 3 }); env2.X.setup();
  for (let i = 0; i < 5; i++) { const r = env2.post(payload()); if (!r.ok) console.log('  err', r); }
  ok(env2.sheet('Orders').getLastRow() === 6, 'orders grows past max', env2.sheet('Orders').getLastRow());
  // items-before-orders: make items write throw, then retry
  const env3 = makeEnv(); env3.X.setup();
  const p = payload();
  const items3 = env3.sheet('Items'); const orig = items3.getRange.bind(items3); let boom = true;
  items3.getRange = function (r, c, nr, nc) { if (boom && r > 1) throw new Error('Service error'); return orig(r, c, nr, nc); };
  const a = env3.post(p);
  ok(!a.ok && a.error === 'server', 'items failure -> server', a);
  ok(env3.sheet('Orders').getLastRow() === 1, 'no orphan Orders row', env3.sheet('Orders').getLastRow());
  boom = false;
  const b = env3.post(p);
  ok(b.ok && !b.duplicate && env3.log.mails.length === 2, 'retry writes fresh + emails', b);
  // orders write fails after items written -> retry duplicates items?
  const env4 = makeEnv(); env4.X.setup();
  const q = payload();
  const ord = env4.sheet('Orders'); const og = ord.getRange.bind(ord); let boom2 = true;
  ord.getRange = function (r, c, nr, nc) { if (boom2 && r > 1 && nc === 23 && nr === 1) throw new Error('Service error'); return og(r, c, nr, nc); };
  const a4 = env4.post(q); boom2 = false; const b4 = env4.post(q);
  const ids = []; for (let r = 2; r <= env4.sheet('Items').getLastRow(); r++) ids.push(env4.sheet('Items').peek(r, 1).v);
  console.log('  INFO orders-write failure then retry:', a4.error, b4.ok, 'Items order IDs:', ids.join(','), 'Orders rows:', env4.sheet('Orders').getLastRow() - 1);
}

// 3. rate limits
section('rate limits');
{
  const t0 = Date.UTC(2026, 9, 3, 1, 0, 0);
  const env = makeEnv(); env.setNow(t0);
  const em = 'same@example.com'; const res = [];
  const pc = () => payload({ contact: { firstName: 'A', lastName: 'B', email: em, phone: '+1 415 555 0100' } });
  for (let i = 0; i < 7; i++) res.push(env.post(pc()).error || 'ok');
  ok(res.join(',') === 'ok,ok,ok,ok,ok,ok,rate', '6 per email', res.join(','));
  ok(env.post(payload({ contact: { firstName: 'A', lastName: 'B', email: 'SAME@example.com', phone: '+1 415 555 0100' } })).error === 'rate', 'case-insensitive email key');
  env.setNow(t0 + 4 * 3600e3 + 59 * 60e3); // 05:59 same block
  ok(env.post(pc()).error === 'rate', 'still blocked at 05:59');
  env.setNow(t0 + 5 * 3600e3 + 60e3); // 06:01 next block
  console.log('  INFO fixed 6h windows: 6 at 05:59 + 6 at 06:01 => 12 in 2 minutes');
  ok(env.post(pc()).ok, 'new block at 06:01 accepts');
  const puts = env.log.cachePuts.filter(p => p.k.startsWith('rate:'));
  ok(puts.every(p => p.s <= 21600), 'all rate expirations <= 21600', [...new Set(puts.map(p => p.s))]);
  // hourly cap
  const env2 = makeEnv(); env2.setNow(t0); const out = [];
  for (let i = 0; i < 42; i++) out.push(env2.post(payload()).error || 'ok');
  ok(out.filter(x => x === 'ok').length === 40 && out[40] === 'rate', '40/h cap', out.slice(38).join(','));
  ok(!env2.log.rateOutsideLock, 'rate read under lock');
  // a duplicate submit doesn't use rate quota
  const env3 = makeEnv(); const p = payload({ contact: { firstName: 'A', lastName: 'B', email: em, phone: '+1 415 555 0100' } });
  env3.post(p); env3.cacheMap.forEach((v, k) => { if (k.startsWith('sub:')) env3.cacheMap.delete(k); });
  const before = [...env3.cacheMap].filter(([k]) => k.startsWith('rate:e')).map(([, v]) => v.v);
  env3.post(p);
  const after = [...env3.cacheMap].filter(([k]) => k.startsWith('rate:e')).map(([, v]) => v.v);
  ok(before.join() === after.join(), 'dup (cache miss) does not consume rate', [before, after]);
  // rate rejected order: lock released?
  const env4 = makeEnv(); env4.setNow(t0);
  for (let i = 0; i < 41; i++) env4.post(payload());
  ok(env4.post(payload()).error === 'rate', 'still rate (lock not stuck)');
}

// 4. confirmation email content + cap
section('confirmation email');
{
  const env = makeEnv(); const evil = payload({
    contact: { firstName: 'Visit evil.example/x 123 José-María O’Neil', lastName: 'L', email: 'victim@x.org', phone: '+1 415 555 0100' },
    items: [{ product: 'Claim at https://evil.example', category: 'Other', custom: true, options: [{ label: 'Details', value: 'Sign in at https://evil.example/id' }], quantity: 1, engraving: 'ENGRAVEX', notes: 'NOTESX https://n.example', link: 'https://link.example/l' }],
    fulfillment: { method: 'pickup', store: 'store evil-store.example', pickupBy: 'requester', pickupPerson: {} },
    payment: { method: 'Other: PAYX', currency: 'USD' }, notes: 'ORDERNOTESX' });
  const r = env.post(evil);
  const conf = env.log.mails.find(m => m.to === 'victim@x.org');
  ok(r.ok && conf, 'confirmation sent', r);
  const txt = conf.subject + '\n' + conf.body + '\n' + conf.htmlBody;
  for (const bad of ['evil', 'Claim', 'Sign in', 'ENGRAVEX', 'NOTESX', 'link.example', 'PAYX', 'ORDERNOTESX', 'store', '123']) ok(!txt.includes(bad), 'conf excludes ' + bad);
  ok(/^Hi [^\s,]+,$/.test(conf.body.split('\n')[0]), 'greeting is one word');
  console.log('  greeting:', JSON.stringify(conf.body.split('\n')[0]));
  ok(!/[.\/0-9:]/.test(conf.body.split('\n')[0].replace(/^Hi /, '').replace(/,$/, '')), 'greeting has no dots/slashes/digits');
  const g2 = makeEnv(); g2.post(payload({ contact: { firstName: '12345', lastName: 'L', email: 'a@b.co', phone: '+1 415 555 0100' } }));
  ok(g2.log.mails.find(m => m.to === 'a@b.co').body.startsWith('Hi there,'), 'digits-only name -> there');
  const g3 = makeEnv(); g3.post(payload({ contact: { firstName: 'evil.com', lastName: 'L', email: 'a@b.co', phone: '+1 415 555 0100' } }));
  console.log('  name "evil.com" greeting:', JSON.stringify(g3.log.mails.find(m => m.to === 'a@b.co').body.split('\n')[0]));
  const g4 = makeEnv(); g4.post(payload({ contact: { firstName: 'علی\u200cرضا', lastName: 'L', email: 'a@b.co', phone: '+1 415 555 0100' } }));
  console.log('  ZWNJ name greeting:', JSON.stringify(g4.log.mails.find(m => m.to === 'a@b.co').body.split('\n')[0]), 'has ZWNJ', g4.log.mails.find(m => m.to === 'a@b.co').body.includes('\u200c'));
  const g5 = makeEnv(); g5.post(payload({ contact: { firstName: "<script>'", lastName: 'L', email: 'a@b.co', phone: '+1 415 555 0100' } }));
  console.log('  html greeting:', JSON.stringify(g5.log.mails.find(m => m.to === 'a@b.co').htmlBody.match(/Hi [^,]*,/)[0]));
  // EMAIL_RE rejects display-name form
  const e1 = makeEnv(); ok(e1.post(payload({ contact: { firstName: 'A', lastName: 'B', email: 'x<victim@x.org>', phone: '+1 415 555 0100' } })).error === 'invalid', 'EMAIL_RE rejects <>');
  // owner notice content
  const owner = env.log.mails.find(m => m.to === 'owner@example.com');
  ok(owner && !owner.body.includes('+1 415') && !owner.body.includes('Gate'), 'owner notice no phone');
  // cap: 30/day via properties
  const t0 = Date.UTC(2026, 9, 3, 1, 0, 0);
  const env2 = makeEnv({ mailQuota: 1000, settings: { MAX_PER_HOUR: 1000 } }); env2.setNow(t0);
  let confs = 0; for (let i = 0; i < 35; i++) { const rr = env2.post(payload()); if (rr.emailed) confs++; }
  ok(confs === 30, 'confirmation cap 30/day', confs);
  ok(env2.log.mails.filter(m => m.to === 'owner@example.com').length === 35, 'owner notices all 35');
  console.log('  props:', env2.props.get('confirmations'));
  env2.setNow(t0 + 24 * 3600e3);
  ok(env2.post(payload()).emailed === true, 'resets next UTC day');
  // corrupt property
  env2.props.set('confirmations', 'garbage{'); ok(env2.post(payload()).emailed === true, 'corrupt property tolerated');
  // quota reserve
  const env3 = makeEnv({ mailQuota: 21 }); const r3 = env3.post(payload());
  ok(r3.ok && r3.emailed === false && env3.log.mails.length === 1, 'quota 21: owner only (owner takes 1 -> 20 left)', { r3, m: env3.log.mails.length });
  const env3b = makeEnv({ mailQuota: 22 }); const r3b = env3b.post(payload());
  console.log('  quota 22 ->', r3b.emailed, env3b.log.mails.length);
  // NOTIFY_ME off
  const env4 = makeEnv({ settings: { NOTIFY_ME: false } }); ok(env4.post(payload()).emailed === true && env4.log.mails.length === 1, 'NOTIFY_ME off');
  // CONFIRM off doesn't consume slot
  const env5 = makeEnv({ settings: { CONFIRM_TO_REQUESTER: false } }); env5.post(payload()); ok(!env5.props.has('confirmations'), 'confirm off: no slot');
  // client-side meaning of emailed:false
}

// 5. retention
section('retention');
{
  const t0 = Date.UTC(2026, 6, 1, 12);
  const env = makeEnv(); env.setNow(t0); env.X.setup();
  const custom = { product: 'Something else', category: 'Other', custom: true, options: [{ label: 'Details', value: 'For my wife Sarah, 500 Main St' }], quantity: 1, link: 'https://x.example/p', notes: 'NOTE1', engraving: '' };
  env.post(payload({ items: [custom, { product: 'AirPods', category: 'AirPods', options: [{ label: 'Color', value: 'White' }], quantity: 1, engraving: 'For Jamie', notes: 'Deliver to office' }],
    payment: { method: 'Other: pay from Jane Doe acct', currency: 'USD' }, notes: 'Req notes', fulfillment: deliveryF,
    tradeIns: [{ type: 'iPhone', model: 'iPhone 12', serial: 'ABCDEF123456', worksNormally: 'Yes', damage: 'No' }] }));
  env.post(payload()); // stays New
  const o = env.sheet('Orders');
  const pre = env.rowObj('Orders', 2);
  console.log('  Products cell before:', JSON.stringify(pre.Products));
  ok(!/Sarah|Jamie|Deliver to office|x\.example|NOTE1/.test(pre.Products), 'Products summary has no free text');
  o.getRange(2, 3).setValue('Completed'); o.getRange(2, 4).setValue(new (env.ctx).Date(t0));
  env.setNow(t0 + 61 * 86400e3);
  env.X.cleanUpOldOrders();
  const a = env.rowObj('Orders', 2);
  ['Phone', 'Store / Address', 'Picked up by / Recipient', 'Trade-in', 'Requester notes', 'Payment'].forEach(k => ok(a[k] === '[removed]', 'cleared ' + k, a[k]));
  ok(a.Name && a.Email && a.Products === pre.Products, 'kept name/email/products');
  const i1 = env.rowObj('Items', 2), i2 = env.rowObj('Items', 3);
  ok(i1.Configuration === '[removed]', 'custom Configuration cleared', i1.Configuration);
  ok(i2.Configuration !== '[removed]', 'normal Configuration kept', i2.Configuration);
  ok(i2.Engraving === '[removed]' && i1['Item notes'] === '[removed]' && i2['Item notes'] === '[removed]', 'item engraving/notes cleared');
  ok(env.rowObj('Orders', 3).Phone !== '[removed]', 'open order untouched');
  const calls = env.log.setValueCalls; env.X.cleanUpOldOrders();
  ok(env.log.setValueCalls === calls, 're-run idempotent (no writes)', env.log.setValueCalls - calls);
  // Venmo payment kept
  const envV = makeEnv(); envV.setNow(t0); envV.post(payload()); envV.sheet('Orders').getRange(2, 3).setValue('Cancelled'); envV.sheet('Orders').getRange(2, 4).setValue(new (envV.ctx).Date(t0));
  envV.setNow(t0 + 61 * 86400e3); envV.X.cleanUpOldOrders(); ok(envV.rowObj('Orders', 2).Payment === 'Venmo', 'non-Other payment kept');
  // partial run then resume
  const env2 = makeEnv(); env2.setNow(t0);
  env2.post(payload({ items: [{ product: 'AirPods', category: 'AirPods', options: [], quantity: 1, engraving: 'ENG', notes: 'N' }], fulfillment: deliveryF, notes: 'x' }));
  env2.sheet('Orders').getRange(2, 3).setValue('Completed'); env2.sheet('Orders').getRange(2, 4).setValue(new (env2.ctx).Date(t0));
  env2.setNow(t0 + 61 * 86400e3);
  const base = env2.log.setValueCalls || 0;
  // simulate a run killed after the Orders cells were cleared
  const ctx = env2.ctx; const realItems = env2.sheet('Items'); const g = realItems.getRange.bind(realItems); let kill = true;
  realItems.getRange = function (...a) { if (kill && a[0] > 1 && a.length === 2) throw new Error('Exceeded maximum execution time'); return g(...a); };
  try { env2.X.cleanUpOldOrders(); } catch (e) { console.log('  run 1 died:', e.message); }
  kill = false; env2.X.cleanUpOldOrders();
  const it = env2.rowObj('Items', 2);
  ok(it.Engraving === '[removed]' && it['Item notes'] === '[removed]', 'partial run resumed for Items', it);
  // Status updated not a Date (string) -> never cleaned
  const env3 = makeEnv(); env3.setNow(t0); env3.post(payload());
  env3.sheet('Orders').getRange(2, 3).setValue('Completed');
  console.log('  Status updated cell type after write:', typeof env3.rowObj('Orders', 2)['Status updated'], env3.rowObj('Orders', 2)['Status updated'] instanceof env3.ctx.Date);
}

// 6. cell_, formats, injection
section('cell_ / formats / clean_');
{
  const X = makeEnv().X;
  ok(X.cell_('=1+1') === "'=1+1" && X.cell_('+1 415') === '+1 415' && X.cell_('-x') === '-x' && X.cell_('@x') === '@x' && X.cell_(' =x') === "' =x" && X.cell_(5) === 5, 'cell_ only guards leading =');
  const env = makeEnv();
  env.post(payload({ contact: { firstName: '=HYPERLINK("http://e","x")', lastName: '+1', email: 'a@b.co', phone: '+1 415 555 0100', preferredContact: '@x' }, notes: '=IMPORTXML("x")' }));
  const sh = env.sheet('Orders'); let formulas = 0; for (let c = 1; c <= 23; c++) { const cc = sh.peek(2, c); if (cc && cc.formula) formulas++; }
  ok(formulas === 0, 'no formulas in Orders');
  const row = env.rowObj('Orders', 2);
  console.log('  Phone stored:', JSON.stringify(row.Phone), 'Name:', JSON.stringify(row.Name), 'notes:', JSON.stringify(row['Requester notes']));
  ok(row.Phone === '+1 415 555 0100', 'phone without apostrophe');
  // clean_
  ok(X.clean_('علی\u200cرضا', 60).length === 7, 'ZWNJ kept');
  ok(X.clean_('👨\u200d👩\u200d👧', 60) === '👨\u200d👩\u200d👧', 'ZWJ kept');
  ok(X.clean_('a\u200bb\u200ec\u200fd\u202ee\u2066f\u0007g', 60) === 'abcdefg', 'strips ZWSP/LRM/RLM/bidi/control');
  ok(X.clean_('a\r\nb\rc\td', 60) === 'a\nb\nc\td', 'newlines normalized, tab kept');
  ok(X.clean_(' x ', 60), 'LS/PS', JSON.stringify(X.clean_(' x ', 60)));
  // BE-11
  const env2 = makeEnv(); const m = 'Other: ' + 'h'.repeat(73) + 'HANDLE7';
  env2.post(payload({ payment: { method: m, currency: 'USD' } }));
  ok(env2.rowObj('Orders', 2).Payment === m, 'Other payment 87 chars intact', env2.rowObj('Orders', 2).Payment.length);
  // BE-6
  const env3 = makeEnv(); const r = env3.post(payload({ items: [{ product: 'X', category: 'Other', custom: true, options: [], quantity: 1, link: 'https://www.aliexpress.com/item/1005006000000000.html' }] }));
  ok(r.ok, 'link with 16-digit id accepted', r);
  // BE-8
  const env4 = makeEnv(); env4.post(payload({ items: [{ product: 'MacBook Air', category: 'Mac', options: [{ label: 'Keyboard', value: 'Japanese' }], quantity: 1, configuredFor: 'JP' }] }));
  const it = env4.rowObj('Items', 2), od = env4.rowObj('Orders', 2), om = env4.log.mails.find(x => x.to === 'owner@example.com');
  ok(/Configured for: JP/.test(it.Configuration) && /Configured for JP/.test(od.Products) && /Configured for JP/.test(om.body), 'configuredFor in Items, Orders, owner email');
  console.log('  owner html has JP?', /JP/.test(om.htmlBody));
  // sensitive still rejected
  const env5 = makeEnv(); ok(env5.post(payload({ notes: '4111 1111 1111 1111' })).error === 'sensitive', 'card number rejected');
  // invite
  const env6 = makeEnv({ settings: { INVITE_CODE: 'Sunny2026xxxxxxxxxxxx' } });
  ok(env6.post(payload()).error === 'invite' && env6.post(payload({ invite: ' sunny2026XXXXXXXXXXXX ' })).ok, 'invite check');
  ok([...env6.cacheMap.keys()].filter(k => k.startsWith('rate')).length === 2, 'wrong invite does not touch rate counters');
}

// 7. setup + sendTestRequest
section('setup / sendTestRequest');
{
  const env = makeEnv(); env.X.setup(); env.X.setup();
  ok(env.log.triggers.length === 1, 'trigger once');
  ok(!env.ss.getSheetByName('Sheet1'), 'Sheet1 removed');
  ok(env.sheet('Orders').cf.length === 8, 'cf rules not duplicated', env.sheet('Orders').cf.length);
  env.X.sendTestRequest();
  const o = env.rowObj('Orders', 2);
  ok(o.Status === 'Cancelled', 'test row cancelled', o.Status);
  ok(env.log.mails.length === 2, 'test emails (owner + confirmation to owner)', env.log.mails.map(m => m.to));
  console.log('  test Payment:', o.Payment, '| errors:', env.log.errors);
  const envI = makeEnv({ settings: { INVITE_CODE: 'abcdefghij0123456789xyz' } }); envI.X.setup(); envI.X.sendTestRequest();
  ok(envI.rowObj('Orders', 2).Status === 'Cancelled', 'sendTestRequest with invite');
  // sendTestRequest when not set up (fresh)
  const env2 = makeEnv(); env2.X.sendTestRequest(); ok(env2.rowObj('Orders', 2).Status === 'Cancelled', 'sendTestRequest without setup');
  // short invite warn
  const warns = []; const env3 = makeEnv({ settings: { INVITE_CODE: 'short' } }); env3.ctx.console.warn = (m) => warns.push(m); env3.X.setup(); ok(warns.length === 1, 'short invite warning');
  // sendTestRequest when a requester row lands at same time? lastRow semantics
  // onEdit stamp
  const env4 = makeEnv(); env4.X.setup(); env4.post(payload());
  const sh = env4.sheet('Orders'); env4.setNow(Date.now() + 1e6);
  env4.X.onEdit({ range: sh.getRange(2, 3) });
  ok(env4.rowObj('Orders', 2)['Status updated'] instanceof env4.ctx.Date, 'onEdit stamps date');
}
// 9. invites tab: per-person codes, GET check, use counting, header upgrade
section('invites');
{
  const env = makeEnv(); env.X.setup();
  const inv = env.sheet('Invites');
  ok(inv && inv.getRange(1, 1, 1, 6).getValues()[0].join('|') === 'Name|Code|Active|Uses|Last used|Notes', 'Invites tab created', inv && inv.getRange(1, 1, 1, 6).getValues()[0]);
  ok(env.X.ORDER_COLUMNS[env.X.ORDER_COLUMNS.length - 1] === 'Invite', 'Invite is the last Orders column');
  // Nothing configured: open.
  ok(env.post(payload()).ok, 'open when no invites exist');
  ok(JSON.parse(env.X.doGet({ parameter: { invite: 'whatever' } }).getContent()).open === true, 'doGet reports open');
  // Two invites, one revoked.
  inv.getRange(2, 1, 2, 6).setValues([['Lopez family', 'aaaabbbbccccddddeeeeffff', true, 0, '', ''], ['Old friend', 'zzzzyyyyxxxxwwwwvvvvuuuu', false, 3, '', '']]);
  ok(env.post(payload()).error === 'invite', 'no code refused once invites exist');
  ok(env.post(payload({ invite: 'nope' })).error === 'invite', 'unknown code refused');
  ok(env.post(payload({ invite: 'zzzzyyyyxxxxwwwwvvvvuuuu' })).error === 'invite', 'revoked code refused');
  const r = env.post(payload({ invite: ' AAAABBBBCCCCDDDDEEEEFFFF ' }));
  ok(r.ok, 'active code accepted (trimmed, case-insensitive)', r);
  const last = env.sheet('Orders').getLastRow();
  ok(env.rowObj('Orders', last).Invite === 'Lopez family', 'order records the invite name', env.rowObj('Orders', last).Invite);
  ok(inv.getRange(2, 4).getValue() === 1 && inv.getRange(2, 5).getValue() instanceof env.ctx.Date, 'uses counted and dated', [inv.getRange(2, 4).getValue()]);
  env.post(payload({ invite: 'aaaabbbbccccddddeeeeffff' }));
  ok(inv.getRange(2, 4).getValue() === 2, 'uses increment');
  // GET check used by the page gate.
  const g1 = JSON.parse(env.X.doGet({ parameter: { invite: 'aaaabbbbccccddddeeeeffff' } }).getContent());
  const g2 = JSON.parse(env.X.doGet({ parameter: { invite: 'zzzzyyyyxxxxwwwwvvvvuuuu' } }).getContent());
  const g3 = JSON.parse(env.X.doGet({ parameter: { invite: '' } }).getContent());
  ok(g1.ok && g1.name === 'Lopez family' && !g1.open, 'doGet accepts an active invite', g1);
  ok(!g2.ok && !g3.ok, 'doGet refuses revoked and empty', [g2, g3]);
  ok(JSON.parse(env.X.doGet().getContent()).service, 'doGet without parameters still answers');
  // The shared code keeps working next to the tab.
  const env2 = makeEnv({ settings: { INVITE_CODE: 'sharedsharedsharedshared' } }); env2.X.setup();
  env2.sheet('Invites').getRange(2, 1, 1, 6).setValues([['Ana', 'aaaabbbbccccddddeeeeffff', true, 0, '', '']]);
  ok(env2.post(payload({ invite: 'sharedsharedsharedshared' })).ok && env2.post(payload({ invite: 'aaaabbbbccccddddeeeeffff' })).ok && env2.post(payload({ invite: 'x' })).error === 'invite', 'shared code and invites both work');
  ok(env2.rowObj('Orders', 2).Invite === 'Shared link', 'shared code labelled');
  // sendTestRequest picks an active invite when there is no shared code.
  const env3 = makeEnv(); env3.X.setup();
  env3.sheet('Invites').getRange(2, 1, 1, 6).setValues([['Tester', 'testtesttesttesttesttest', true, 0, '', '']]);
  env3.X.sendTestRequest();
  ok(env3.rowObj('Orders', 2).Status === 'Cancelled' && env3.rowObj('Orders', 2).Invite === 'Tester', 'sendTestRequest uses an active invite', env3.rowObj('Orders', 2).Invite);
  // A sheet created by an older version gains the Invite column in place.
  const env4 = makeEnv();
  const oldHeaders = env4.X.ORDER_COLUMNS.slice(0, -1);
  const orders = env4.ss.insertSheet('Orders');
  orders.getRange(1, 1, 1, oldHeaders.length).setValues([oldHeaders]);
  env4.X.setup();
  ok(orders.getRange(1, oldHeaders.length + 1).getValue() === 'Invite', 'old Orders sheet upgraded with Invite header');
  ok(env4.post(payload()).ok && env4.rowObj('Orders', 2)['Order ID'], 'orders still write after the upgrade');
  ok(env.log.errors.length === 0 && env2.log.errors.length === 0 && env4.log.errors.length === 0, 'no errors in invite scenarios', [env.log.errors, env4.log.errors]);
}

// 10. invites panel: menu, sidebar, owner-only admin functions, JSON-safe state
section('invites panel');
{
  const env = makeEnv(); env.X.setup();
  const menu = env.log.menus[env.log.menus.length - 1];
  ok(menu && menu.items.map(i => i[1]).join(',') === 'openInvites,addInvite,sendTestRequest', 'menu: panel, dialog fallback, test request', menu && menu.items);
  env.X.openInvites();
  const side = env.log.sidebars[0];
  ok(env.log.sidebars.length === 1 && side.title === 'Invites' && /google\.script\.run/.test(side.getContent()) && !/innerHTML/.test(side.getContent()), 'sidebar shows Invites.html (no innerHTML)');
  let st = env.X.adminListInvites();
  ok(Array.isArray(st.invites) && st.invites.length === 0 && st.siteUrl === '' && st.sharedCode === false && st.accepting === true, 'empty state', st);
  // add
  st = env.X.adminAddInvite('  Lopez   family ');
  const first = st.invites[0];
  ok(st.invites.length === 1 && first.name === 'Lopez family' && /^[0-9a-f]{24}$/.test(first.code) && st.added === first.code, 'add writes a row with a 24-hex code', first);
  ok(first.link === '#invite=' + first.code && first.active === true && first.uses === 0 && first.lastUsed === '', 'new invite: hash-only link, on, unused', first);
  const inv = env.sheet('Invites');
  ok(inv.peek(2, 3).checkbox === true && inv.peek(3, 3) === undefined && inv.getRange(2, 1).getNumberFormats()[0][0] === '@', 'checkbox on that row only; name is plain text');
  let threw = ''; try { env.X.adminAddInvite('   '); } catch (e) { threw = e.message; }
  ok(/name/i.test(threw) && env.X.adminListInvites().invites.length === 1, 'empty name refused', threw);
  env.X.adminAddInvite('=HYPERLINK("x")');
  ok(inv.peek(3, 1).formula === null && String(inv.peek(3, 1).v).includes('HYPERLINK'), 'formula-looking name stays text', inv.peek(3, 1).v);
  // page address
  threw = ''; try { env.X.adminSetSiteUrl('ftp://nope'); } catch (e) { threw = e.message; }
  ok(/https/.test(threw), 'non-https address refused', threw);
  threw = ''; try { env.X.adminSetSiteUrl('me.github.io/ff-order-form'); } catch (e) { threw = e.message; }
  ok(/https/.test(threw) && env.X.siteUrl_() === '', 'bare host refused, nothing stored', threw);
  st = env.X.adminSetSiteUrl(' https://me.github.io/ff-order-form/#invite=old ');
  ok(st.siteUrl === 'https://me.github.io/ff-order-form' && st.invites[0].link === 'https://me.github.io/ff-order-form/#invite=' + first.code, 'address saved without hash or trailing slash; links complete', [st.siteUrl, st.invites[0].link]);
  ok(env.X.adminSetSiteUrl('http://localhost:8765/').siteUrl === 'http://localhost:8765' && env.X.inviteLink_('abc') === 'http://localhost:8765/#invite=abc', 'localhost allowed for trying things out');
  env.X.adminSetSiteUrl('https://example.com/form/index.html');
  ok(env.X.inviteLink_('abc') === 'https://example.com/form/index.html#invite=abc', 'no slash after a file name');
  ok(env.X.adminSetSiteUrl('').siteUrl === '' && env.X.inviteLink_('abc') === '#invite=abc', 'address can be cleared');
  env.X.adminSetSiteUrl('https://me.github.io/ff-order-form');
  // switch off and on
  ok(env.post(payload({ invite: first.code })).ok, 'new invite accepted by doPost');
  st = env.X.adminSetInviteActive(2, first.code, false);
  ok(st.invites[0].active === false && inv.getRange(2, 3).getValue() === false, 'switched off', st.invites[0]);
  ok(env.post(payload({ invite: first.code })).error === 'invite', 'switched-off invite refused');
  st = env.X.adminSetInviteActive('2', first.code.toUpperCase(), true);
  ok(st.invites[0].active === true && env.post(payload({ invite: first.code })).ok, 'switched back on (row as a string, code case-insensitive)');
  st = env.X.adminListInvites();
  ok(st.invites[0].uses === 2 && /^\d{4}-\d{2}-\d{2}T/.test(st.invites[0].lastUsed), 'uses and last used (ISO string) in the view', st.invites[0]);
  // stale-row guard
  threw = ''; try { env.X.adminSetInviteActive(2, 'ffffffffffffffffffffffff', false); } catch (e) { threw = e.message; }
  ok(/changed/.test(threw) && inv.getRange(2, 3).getValue() === true, 'code mismatch refused and nothing changed', threw);
  threw = ''; try { env.X.adminSetInviteActive(9, first.code, false); } catch (e) { threw = e.message; }
  ok(/Refresh/.test(threw), 'row past the end refused', threw);
  threw = ''; try { env.X.adminSetInviteActive(1, first.code, false); } catch (e) { threw = e.message; }
  ok(!!threw, 'header row refused');
  // a row typed by hand in the tab (TRUE as text, no checkbox)
  inv.getRange(4, 1, 1, 6).setValues([['Manual', 'manualmanualmanualmanual', 'TRUE', 0, '', '']]);
  ok(env.post(payload({ invite: 'manualmanualmanualmanual' })).ok, 'hand-typed TRUE counts as active');
  st = env.X.adminSetInviteActive(4, 'manualmanualmanualmanual', false);
  ok(st.invites[2].active === false && inv.peek(4, 3).checkbox && env.post(payload({ invite: 'manualmanualmanualmanual' })).error === 'invite', 'hand-typed row gets a checkbox and switches off');
  // google.script.run can't carry Dates: the state must be JSON-safe
  const hasDate = v => v instanceof env.ctx.Date || v instanceof Date || (v && typeof v === 'object' && Object.values(v).some(hasDate));
  ok(!hasDate(env.X.adminListInvites()) && !hasDate(env.X.adminAddInvite('Z')), 'panel state has no Date objects');
  // a full tab grows
  const envF = makeEnv({ maxRows: 3 }); envF.X.setup();
  envF.X.adminAddInvite('A'); envF.X.adminAddInvite('B');
  ok(envF.X.adminAddInvite('C').invites.length === 3 && envF.sheet('Invites').getMaxRows() > 3, 'adding past the last row grows the tab');
  // the HTML file wasn't added: a helpful alert, no crash
  const envM = makeEnv(); envM.X.setup();
  envM.ctx.HtmlService.createHtmlOutputFromFile = () => { throw new Error('Exception: No HTML file named Invites was found.'); };
  envM.X.openInvites();
  ok(envM.log.sidebars.length === 0 && envM.log.alerts.length === 1 && /Invites\.html/.test(envM.log.alerts[0][1]), 'missing Invites.html explains what to do', envM.log.alerts[0]);
  // Add an invite… through dialogs (for browsers where the panel can't call the script).
  const envD = makeEnv(); envD.X.setup();
  envD.log.promptAnswers.push({ button: 'CANCEL', text: '' });
  envD.X.addInvite();
  ok(envD.log.prompts.length === 1 && /Page address/.test(envD.log.prompts[0][0]) && envD.log.alerts.length === 0 && envD.X.adminListInvites().invites.length === 0, 'asks for the page address first; cancel adds nothing');
  envD.log.promptAnswers.push({ button: 'OK', text: ' https://me.github.io/ff-order-form/ ' }, { button: 'OK', text: 'Lopez family' });
  envD.X.addInvite();
  const dl = envD.X.adminListInvites();
  ok(dl.siteUrl === 'https://me.github.io/ff-order-form' && dl.invites.length === 1 && dl.invites[0].name === 'Lopez family', 'dialog flow stores the address and the invite', dl);
  ok(envD.log.alerts.length === 1 && envD.log.alerts[0][1].includes(dl.invites[0].link) && /Invites tab/.test(envD.log.alerts[0][1]), 'alert shows the link', envD.log.alerts[0]);
  envD.log.promptAnswers.push({ button: 'OK', text: 'Uncle Ben' });
  envD.X.addInvite();
  ok(envD.log.prompts.length === 4 && envD.X.adminListInvites().invites.length === 2, 'address not asked again once stored');
  envD.log.promptAnswers.push({ button: 'OK', text: '   ' });
  envD.X.addInvite();
  ok(envD.log.alerts.length === 3 && /Couldn’t add/.test(envD.log.alerts[2][0]) && envD.X.adminListInvites().invites.length === 2, 'empty name shows the error in a dialog');
  ok(env.log.errors.length === 0 && envF.log.errors.length === 0 && envD.log.errors.length === 0, 'no errors in panel scenarios', env.log.errors);
}

console.log('\nFAILS:', fails);
process.exitCode = fails ? 1 : 0;
