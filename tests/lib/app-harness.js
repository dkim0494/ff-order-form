// jsdom harness: loads the real project files (read-only) into a simulated browser
// and exposes app internals as window.__T for assertions.
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');
const P = path.resolve(__dirname, '..', '..') + path.sep;
const read = f => fs.readFileSync(P + f, 'utf8');
const SRC = {
  html: read('index.html'), config: read('config.js'), world: read('data/world.js'), catalog: read('data/catalog.js'), app: read('app.js'),
};

// Expose internals for assertions without editing the file on disk.
const HOOK = `
  window.__T = {
    get S() { return S; }, set S(v) { S = v; },
    get DONE() { return DONE; }, get ERR() { return ERR; }, get SUBMIT_ERROR() { return SUBMIT_ERROR; }, get SUBMITTING() { return SUBMITTING; },
    get CUR() { return CUR; },
    errorsFor, buildPayload, formatAddress, addressSpec, sensitiveKind, resolveOption, appleCareFor, plainSummary, setCountry, openConfigurator, PRODUCT, PRODUCTS, COUNTRIES, COUNTRY, STORES, ONLINE, storeOptions, submit, go, next, itemLines, CFG, artKey, ART, CATEGORY_ART, firstHex,
  };
  if (document.readyState === 'loading')`;

function make(opts = {}) {
  const logs = [];
  const vc = new VirtualConsole();
  vc.on('error', (...a) => logs.push(['error', a.map(String).join(' ')]));
  vc.on('warn', (...a) => logs.push(['warn', a.map(String).join(' ')]));
  vc.on('info', (...a) => logs.push(['info', a]));
  vc.on('log', (...a) => logs.push(['log', a.map(String).join(' ')]));
  vc.on('jsdomError', e => logs.push(['jsdomError', String(e && (e.stack || e.message || e))]));
  const html = SRC.html.replace(/<script src="[^"]+"><\/script>/g, '');
  const dom = new JSDOM(html, {
    url: 'http://localhost:8765/' + (opts.hash || ''),
    runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      w.CSS = { escape: s => String(s).replace(/[^a-zA-Z0-9_-]/g, c => '\\' + c) };
      w.HTMLElement.prototype.scrollIntoView = function () {};
      w.scrollTo = () => {};
      w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
      w.HTMLElement.prototype.showModal = function () { this.setAttribute('open', ''); };
      w.HTMLElement.prototype.close = function () {
        if (!this.hasAttribute('open')) return;
        this.removeAttribute('open');
        this.dispatchEvent(new w.Event('close'));
      };
      w.confirm = () => (opts.confirm !== undefined ? opts.confirm : true);
      if (opts.languages) Object.defineProperty(w.navigator, 'languages', { get: () => opts.languages });
      if (opts.storage) for (const [k, v] of Object.entries(opts.storage)) w.localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v));
      if (opts.fetch) w.fetch = opts.fetch;
      if (opts.clipboard) Object.defineProperty(w.navigator, 'clipboard', { value: opts.clipboard });
    },
  });
  const w = dom.window;
  const run = code => { const s = w.document.createElement('script'); s.textContent = code; w.document.body.appendChild(s); };
  let config = SRC.config;
  run(config);
  if (opts.config) w.FF_CONFIG = Object.assign(w.FF_CONFIG, opts.config);
  run(SRC.world);
  run(opts.catalogSrc || SRC.catalog);
  if (opts.mutate) opts.mutate(w);
  let app = SRC.app;
  const marker = "  if (document.readyState === 'loading')";
  if (!app.includes(marker)) throw new Error('hook marker missing');
  app = app.replace(marker, HOOK);
  for (const [a, b] of (opts.patch || [])) { if (!app.includes(a)) throw new Error("patch target missing: " + a.slice(0, 60)); app = app.replace(a, b); }
  run(app);
  const T = w.__T;
  const $ = (s, root) => (root || w.document).querySelector(s);
  const $$ = (s, root) => Array.from((root || w.document).querySelectorAll(s));
  const tick = (ms = 0) => new Promise(r => setTimeout(r, ms));
  // Wait for jsdom's timers (jsdom timers run on node's loop)
  const wait = ms => new Promise(r => w.setTimeout(r, ms));
  return { dom, w, T, $, $$, logs, tick, wait, doc: w.document };
}

// Fire input event after setting value
function type(w, el, val) {
  el.value = val;
  el.dispatchEvent(new w.Event('input', { bubbles: true }));
}
function choose(w, sel, val) {
  sel.value = val;
  sel.dispatchEvent(new w.Event('change', { bubbles: true }));
}

module.exports = { make, type, choose, SRC, P };
