'use strict';
// The "Manage invites…" panel (apps-script/Invites.html) in jsdom, wired to the
// real Code.gs (in the Apps Script mock) through a fake google.script.run that
// behaves like the real one: asynchronous, JSON-only, errors to the failure handler.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { JSDOM, VirtualConsole } = require('jsdom');
const { makeEnv } = require('./lib/gas-mock');

const HTML = fs.readFileSync(path.resolve(__dirname, '..', 'apps-script', 'Invites.html'), 'utf8');
const problems = [];
const expect = (cond, msg, extra) => { if (!cond) problems.push(msg + (extra !== undefined ? ' :: ' + JSON.stringify(extra) : '')); };

function order(invite) {
  return {
    v: 1, submissionId: crypto.randomUUID(), hp: '', elapsedMs: 120000, invite, country: 'US', countryName: 'United States',
    contact: { firstName: 'Ana', lastName: 'García', email: 'ana' + crypto.randomUUID().slice(0, 6) + '@example.com', phone: '+1 415 555 0100', preferredContact: 'iMessage' },
    items: [{ product: 'iPhone 18', category: 'iPhone', options: [], quantity: 1, applecare: 'No AppleCare' }],
    tradeIns: [], fulfillment: { method: 'pickup', store: 'Apple Union Square', pickupBy: 'requester', pickupPerson: {} },
    payment: { method: 'Venmo', currency: 'USD' }, notes: '',
  };
}

// What google.script.run accepts: primitives, plain objects and arrays. No Dates, no functions.
function jsonSafe(v) {
  if (v == null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return true;
  if (typeof v === 'function' || v instanceof Date || Object.prototype.toString.call(v) === '[object Date]') return false;
  if (Array.isArray(v)) return v.every(jsonSafe);
  return Object.values(v).every(jsonSafe);
}
function fakeRun(env, calls) {
  function chain(ok, fail) {
    const base = { withSuccessHandler: f => chain(f, fail), withFailureHandler: f => chain(ok, f) };
    return new Proxy(base, {
      get(t, name) {
        if (name in t) return t[name];
        return (...args) => {
          calls.push([name, ...args]);
          setTimeout(() => {
            let res;
            try {
              if (typeof env.X[name] !== 'function') throw new Error('Script function not found: ' + String(name));
              if (!args.every(jsonSafe)) throw new Error('Illegal argument');
              res = env.X[name](...JSON.parse(JSON.stringify(args)));
              if (!jsonSafe(res)) throw new Error('Return value is not JSON-safe');
              res = res === undefined ? null : JSON.parse(JSON.stringify(res));
            } catch (e) { if (fail) fail({ message: e.message, name: 'Error' }); return; }
            if (ok) ok(res);
          }, 0);
        };
      },
    });
  }
  return chain(null, null);
}

function open(env, opts = {}) {
  const calls = [], copied = [], logs = [];
  const vc = new VirtualConsole();
  for (const lvl of ['error', 'warn', 'jsdomError']) vc.on(lvl, (...a) => logs.push([lvl, a.map(x => String(x && x.stack || x)).join(' ')]));
  const dom = new JSDOM(HTML, {
    url: 'https://n-abc.googleusercontent.com/userCodeAppPanel', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      w.google = { script: { run: fakeRun(env, calls) } };
      const clip = opts.clipboard === 'blocked'
        ? { writeText: () => Promise.reject(new Error('NotAllowedError')) }
        : { writeText: t => { copied.push(t); return Promise.resolve(); } };
      Object.defineProperty(w.navigator, 'clipboard', { value: clip });
    },
  });
  const w = dom.window;
  const $ = s => w.document.querySelector(s);
  const $$ = s => Array.from(w.document.querySelectorAll(s));
  const wait = (ms = 15) => new Promise(r => setTimeout(r, ms));
  const type = (el, v) => { el.value = v; el.dispatchEvent(new w.Event('input', { bubbles: true })); };
  return { w, $, $$, wait, type, calls, copied, logs };
}

(async () => {
  const env = makeEnv(); env.X.setup();
  const P = open(env);
  const { $, $$, wait, type, calls, copied } = P;
  await wait();

  // Empty state: asks for the page address first, nothing in the list.
  expect(calls.length === 1 && calls[0][0] === 'adminListInvites', 'loads the state once', calls);
  expect(!$('#empty').hidden && $$('.inv').length === 0, 'empty list message');
  expect(!$('#site').hidden && $('#site-foot').hidden, 'page address requested while missing');
  expect($('#share').hidden && $('#shared').hidden && $('#paused').hidden, 'share, shared-code and paused notices hidden');

  // A bad address is refused inline; a good one is saved and moves to the footer.
  type($('#site-url'), 'me.github.io/ff-order-form');
  $('#site-form button').click();
  await wait();
  expect($('#status').classList.contains('error') && /https/.test($('#status').textContent), 'bad address shows the error', $('#status').textContent);
  type($('#site-url'), 'https://me.github.io/ff-order-form/');
  $('#site-form button').click();
  await wait();
  expect($('#site').hidden && !$('#site-foot').hidden && $('#site-cur').textContent === 'https://me.github.io/ff-order-form', 'address saved and shown in the footer', $('#site-cur').textContent);
  expect(/saved/.test($('#status').textContent) && !$('#status').classList.contains('error'), 'saved status');
  expect(env.X.siteUrl_() === 'https://me.github.io/ff-order-form', 'address stored in script properties');

  // Empty name: nothing sent.
  const before = calls.length;
  type($('#name'), '   ');
  $('#add-btn').click();
  await wait();
  expect(calls.length === before && $$('.inv').length === 0, 'blank name sends nothing');

  // Add an invite: row appears highlighted, link shown, name field cleared and focused.
  type($('#name'), ' Lopez  family ');
  $('#add-btn').click();
  await wait();
  const rows = $$('.inv');
  expect(rows.length === 1 && rows[0].querySelector('.name').textContent === 'Lopez family' && rows[0].classList.contains('new'), 'invite listed and highlighted', rows.map(r => r.textContent));
  const code = rows[0].getAttribute('data-code');
  expect(/^[0-9a-f]{24}$/.test(code), '24-hex code in the row', code);
  expect(!$('#share').hidden && $('#share-name').textContent === 'Lopez family' && $('#share-link').value === 'https://me.github.io/ff-order-form/#invite=' + code, 'share card shows the complete link', $('#share-link').value);
  expect($('#name').value === '' && P.w.document.activeElement === $('#name'), 'name field cleared and focused');
  expect(rows[0].querySelector('.meta').textContent === 'No requests yet', 'meta: no requests yet', rows[0].querySelector('.meta').textContent);
  expect(env.sheet('Invites').getRange(2, 2).getValue() === code && env.sheet('Invites').peek(2, 3).checkbox, 'row written to the Invites tab with a checkbox');
  expect(env.post(order(code)).ok, 'the new invite is accepted by doPost');

  // Copy from the share card and from the row.
  $('#share-copy').click();
  await wait();
  expect(copied[copied.length - 1] === 'https://me.github.io/ff-order-form/#invite=' + code && $('#share-copy').textContent === 'Copied', 'share Copy writes the link', copied);
  $$('.inv .copy')[0].click();
  await wait();
  expect(copied.length === 2 && copied[1].endsWith('#invite=' + code) && $$('.inv .copy')[0].textContent === 'Copied', 'row Copy link writes the link');

  // Switch off: the backend refuses the code at once; switch on: accepted again and the use count shows.
  const toggle = () => $$('.inv input[type=checkbox]')[0];
  toggle().click();
  await wait();
  expect(toggle().checked === false && $$('.inv')[0].classList.contains('off') && /^Off/.test($$('.inv .meta')[0].textContent), 'row shows off', $$('.inv .meta')[0].textContent);
  expect(/off/.test($('#status').textContent) && !$('#status').classList.contains('error'), 'status says it is off', $('#status').textContent);
  expect(env.post(order(code)).error === 'invite', 'switched-off invite refused by doPost');
  toggle().click();
  await wait();
  expect(toggle().checked === true && !$$('.inv')[0].classList.contains('off'), 'row back on');
  expect(env.post(order(code)).ok, 'switched-on invite accepted again');
  toggle().click(); await wait(); toggle().click(); await wait();
  expect(/^2 requests · last /.test($$('.inv .meta')[0].textContent), 'meta shows the use count and date', $$('.inv .meta')[0].textContent);

  // Change the page address from the footer; the share link follows.
  $('#site-edit').click();
  expect(!$('#site').hidden && P.w.document.activeElement === $('#site-url'), 'Change reveals the address field');
  type($('#site-url'), 'https://orders.example.com');
  $('#site-form button').click();
  await wait();
  expect($('#site').hidden && $('#site-cur').textContent === 'https://orders.example.com', 'new address saved', $('#site-cur').textContent);
  expect($('#share-link').value === 'https://orders.example.com/#invite=' + code, 'share link follows the new address', $('#share-link').value);

  // The tab changed under the panel: the switch is refused, reverted and the list refreshed.
  env.sheet('Invites').getRange(2, 2).setValue('ffffffffffffffffffffffff');
  toggle().click();
  await wait(30);
  expect($('#status').classList.contains('error') && /changed/.test($('#status').textContent), 'stale row refused with an explanation', $('#status').textContent);
  expect(toggle().checked === true && env.sheet('Invites').getRange(2, 3).getValue() === true, 'switch reverted, sheet untouched');
  expect($$('.inv')[0].getAttribute('data-code') === 'ffffffffffffffffffffffff', 'list refreshed with the new code');
  expect($('#share').hidden, 'share card for the vanished invite is hidden');
  toggle().click();
  await wait();
  expect(toggle().checked === false && env.sheet('Invites').getRange(2, 3).getValue() === false, 'toggle works again after the refresh');

  // Shared code and paused notices.
  env.X.SETTINGS.INVITE_CODE = 'sharedsharedsharedshared'; env.X.SETTINGS.ACCEPTING = false;
  toggle().click(); await wait();
  expect(!$('#shared').hidden && !$('#paused').hidden, 'shared-code and paused notices shown when set');
  env.X.SETTINGS.INVITE_CODE = ''; env.X.SETTINGS.ACCEPTING = true;

  // Every call carried JSON-safe arguments and none threw unexpectedly.
  for (const l of P.logs) problems.push('console: ' + l.join(' ').slice(0, 300));
  P.w.close();

  // Blocked clipboard (the sidebar iframe can refuse it): the link is shown selected instead.
  const env2 = makeEnv(); env2.X.setup(); env2.X.adminSetSiteUrl('https://me.github.io/ff-order-form');
  env2.X.adminAddInvite('Uncle Ben');
  const Q = open(env2, { clipboard: 'blocked' });
  await Q.wait();
  Q.$$('.inv .copy')[0].click();
  await Q.wait();
  expect(!Q.$('#share').hidden && Q.$('#share-name').textContent === 'Uncle Ben' && Q.w.document.activeElement === Q.$('#share-link') && /Select the link/.test(Q.$('#status').textContent), 'blocked clipboard falls back to a selected link', Q.$('#status').textContent);
  for (const l of Q.logs) problems.push('console (blocked clipboard): ' + l.join(' ').slice(0, 300));
  Q.w.close();

  // Google's multi-account failure gets a hint on top of the raw message.
  {
    const env3 = makeEnv(); env3.X.setup();
    env3.X.adminListInvites = () => { throw new Error('We\'re sorry, a server error occurred while reading from storage. Error code PERMISSION_DENIED.'); };
    const R = open(env3);
    await R.wait();
    expect(R.$('#status').classList.contains('error') && /PERMISSION_DENIED/.test(R.$('#status').textContent) && /several Google accounts/.test(R.$('#status').textContent) && /Add an invite/.test(R.$('#status').textContent), 'storage permission error explained', R.$('#status').textContent);
    R.w.close();
  }

  // Outside Google Sheets (file opened directly) the panel explains instead of breaking.
  {
    const vc = new VirtualConsole(); const logs = [];
    vc.on('jsdomError', e => logs.push(String(e)));
    const dom = new JSDOM(HTML, { runScripts: 'dangerously', virtualConsole: vc });
    await new Promise(r => setTimeout(r, 15));
    expect(/Google Sheets/.test(dom.window.document.getElementById('status').textContent) && logs.length === 0, 'no google.script.run: friendly message', logs);
    dom.window.close();
  }

  // Static checks on the file itself.
  expect(/<base target="_top">/.test(HTML) && !/innerHTML/.test(HTML) && !/<script[^>]+src=/.test(HTML) && !/<link[^>]+href=/.test(HTML), 'self-contained page: base target, no innerHTML, no external files');

  if (problems.length) { console.log('FAIL\n' + problems.map(p => ' - ' + p).join('\n')); process.exitCode = 1; }
  else console.log('sidebar: PASS (' + calls.length + ' panel calls)');
})().catch(e => { console.error(e); process.exitCode = 1; });
