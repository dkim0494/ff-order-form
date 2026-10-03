// Drives one complete request through the real UI in jsdom: products (configure, search,
// bag sheet with Undo), trade-in, details, delivery, review, send (preview mode), done,
// and start over. Fails on dead ends, wrong routes and console errors.
const { make, type, choose } = require('./lib/app-harness');

(async () => {
  const problems = [];
  const A = make({ config: { defaultCountry: 'US' } });
  await A.wait(20);
  const { w, T, $, $$ } = A;
  const expect = (cond, msg) => { if (!cond) problems.push(msg); };
  const radio = (key, value) => { const r = $(`[data-field="${key}"] input[type=radio][value="${value}"]`); expect(r, `no radio ${key}=${value}`); if (r) r.click(); return r; };
  const fill = (key, value) => {
    const wrap = $(`[data-field="${key}"]`);
    expect(wrap, `no field ${key}`);
    if (!wrap) return;
    const sel = wrap.querySelector('select');
    if (sel) { choose(w, sel, value); return; }
    const el = wrap.querySelector('input, textarea');
    expect(el, `no control in ${key}`);
    if (el) type(w, el, value);
  };
  const dlg = () => $('dialog.sheet[open]');

  // --- Products
  expect(w.location.hash === '#products', `start route ${w.location.hash}`);
  $$('.cats .cat').find(b => b.textContent.trim() === 'Mac').click();
  $('[data-pid="macbook-air"]').click();
  expect(dlg(), 'configurator did not open');
  for (let guard = 0; guard < 30 && dlg(); guard++) {
    const sec = $$('.opt-section[data-opt]', dlg()).find(s => !s.hidden && s.dataset.opt !== 'applecare' && !s.querySelector('input:checked') && s.querySelector('input[type=radio]:not([disabled])'));
    if (!sec) break;
    sec.querySelector('input[type=radio]:not([disabled])').click();
  }
  const ac = $('.opt-section[data-opt="applecare"] input[type=radio]', dlg());
  if (ac) ac.click();
  $('.qty button[aria-label="Increase quantity"]', dlg()).click();
  expect(/Add 2 to Bag/.test($('.sheet-foot .btn', dlg()).textContent), 'quantity label');
  $('.sheet-foot .btn', dlg()).click();
  expect(!dlg(), 'configurator should close after add');
  expect(T.S.items.length === 1 && T.S.items[0].qty === 2, 'item added with qty 2');
  expect($('[data-pid="macbook-air"] .product-in-bag'), 'in-bag badge');
  expect($('#bag-count').textContent === '2', `bag count ${$('#bag-count').textContent}`);

  // search (debounced) and a second item
  const search = $('.search input');
  type(w, search, 'pencil');
  await A.wait(200);
  expect(/results for/.test($('.search-status').textContent), `search status "${$('.search-status').textContent}"`);
  expect($$('.cat[aria-selected="true"]').length === 0, 'no tab selected while searching');
  $('[data-pid="apple-pencil-pro"]').click();
  expect(dlg(), 'pencil configurator');
  $('.sheet-foot .btn', dlg()).click();
  expect(T.S.items.length === 2, 'second item added');
  $('.search-clear').click();
  expect($('.cat[aria-selected="true"]'), 'tab selected again after clearing search');

  // bag sheet: remove + undo
  $('#bag-button').click();
  expect(dlg() && /Your bag/.test($('h2', dlg()).textContent), 'bag sheet');
  $('[data-act="remove"]', dlg()).click();
  expect(T.S.items.length === 1, 'removed');
  const undo = $('.toast-action', dlg());
  expect(undo, 'undo button inside the sheet');
  if (undo) undo.click();
  expect(T.S.items.length === 2, 'undo restored');
  $('.sheet-close', dlg()).click();
  expect(!dlg(), 'bag sheet closed');

  // --- Trade-in
  T.next();
  await A.wait(5);
  expect(w.location.hash === '#trade-in', `route after products ${w.location.hash}`);
  radio('ti.has', 'yes');
  radio('ti.0.type', 'iPhone');
  fill('ti.0.model', 'iPhone 13 mini');
  fill('ti.0.serial', 'ABC123XYZ9');
  radio('ti.0.works', 'Yes');
  radio('ti.0.damage', 'No');
  T.next();
  await A.wait(5);
  expect(w.location.hash === '#you', `route after trade-in ${w.location.hash} errors=${JSON.stringify([...T.ERR])}`);

  // --- Details
  fill('you.first', 'Ana'); fill('you.last', 'Lopez'); fill('you.email', 'ana@example.com'); fill('you.phone', '4155550132');
  radio('you.contact', 'Email');
  T.next();
  await A.wait(5);
  expect(w.location.hash === '#delivery', `route after details ${w.location.hash} errors=${JSON.stringify([...T.ERR])}`);

  // --- Delivery
  radio('del.method', 'delivery');
  radio('del.recipient', 'me');
  fill('addr.address1', '1 Infinite Loop'); fill('addr.city', 'Cupertino'); fill('addr.state', 'CA'); fill('addr.postal', '95014');
  T.next();
  await A.wait(5);
  expect(w.location.hash === '#review', `route after delivery ${w.location.hash} errors=${JSON.stringify([...T.ERR])}`);

  // --- Review + send
  radio('pay.method', 'Cash');
  $$('[data-field^="ack."] input[type=checkbox]').forEach(c => { if (!c.checked) c.click(); });
  expect($$('#review-bag .bag-item').length === 2, 'review lists both items');
  const payload = T.buildPayload();
  expect(payload.items.length === 2 && payload.items[0].quantity === 2, 'payload items');
  T.submit();
  await A.wait(20);
  expect($('#actionbar .btn:not(.secondary)').textContent.includes('Sending'), 'busy label while sending');
  expect($('#main').hasAttribute('inert') && $('.topbar').hasAttribute('inert'), 'page inert while sending');
  await A.wait(1200);
  expect(w.location.hash === '#done', `route after send ${w.location.hash}`);
  expect(!$('#main').hasAttribute('inert'), 'inert cleared after send');
  expect($('.ref-code') && $('.ref-code').textContent === 'FF-PREVIEW', 'reference shown');
  expect(w.document.body.classList.contains('no-actionbar'), 'action bar hidden on done');

  // --- Start over
  $$('main .btn').find(b => /New Request/.test(b.textContent)).click();
  await A.wait(5);
  expect(w.location.hash === '#products', `route after new request ${w.location.hash}`);
  expect(T.S.items.length === 0, 'bag empty after new request');
  expect(!w.document.body.classList.contains('no-actionbar'), 'action bar back');

  for (const l of A.logs) if (l[0] === 'error' || l[0] === 'jsdomError') problems.push(`console: ${String(l[1]).slice(0, 300)}`);
  console.log(`journey problems: ${problems.length}`);
  for (const x of problems) console.log(' -', x);
  A.w.close();
  process.exitCode = problems.length ? 1 : 0;
})();
