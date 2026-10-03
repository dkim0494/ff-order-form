/* ==========================================================================
   Friends & Family order request — app
   Plain JavaScript, no dependencies, no build step.
   Data:   data/catalog.js (window.FF_CATALOG), data/world.js (window.FF_WORLD)
   Config: config.js (window.FF_CONFIG)
   ========================================================================== */
(function () {
  'use strict';

  /* ------------------------------------------------------------- config */

  const CFG = Object.assign({
    title: 'Friends & Family',
    subtitle: 'Order requests',
    endpoint: '',
    inviteCodeRequired: false,
    defaultCountry: '',
    maxQuantity: 5,
    maxTradeIns: 3,
    engravingMaxLength: 30,
    contactMethods: ['iMessage', 'WhatsApp', 'Text message', 'Email', 'Phone call'],
    paymentMethods: ['Bank transfer', 'Cash', 'Other'],
    askBudget: true,
    acknowledgements: [],
    fallbackEmail: '',
    footerNote: '',
  }, window.FF_CONFIG || {});

  const CATALOG = window.FF_CATALOG || {};
  const WORLD = window.FF_WORLD || {};
  const PROGRAMS = CATALOG.programs || {};
  const PRODUCTS = Array.isArray(CATALOG.products) ? CATALOG.products : [];
  const PRODUCT = new Map(PRODUCTS.map(p => [p.id, p]));
  const CATEGORIES = (CATALOG.categories || []).filter(c => PRODUCTS.some(p => p.category === c.id));
  const CATEGORY_NAME = new Map((CATALOG.categories || []).map(c => [c.id, c.name]));
  const COUNTRIES = (WORLD.countries || []).slice().sort((a, b) => a.name.localeCompare(b.name));
  const COUNTRY = new Map(COUNTRIES.map(c => [c.code, c]));
  const STORES = WORLD.stores || {};
  const ONLINE = new Set(WORLD.onlineStoreCountries || []);
  const CURRENCIES = Array.from(new Set(COUNTRIES.map(c => c.currency).filter(Boolean))).sort();

  /* ---------------------------------------------------------- utilities */

  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
        else if (k === 'dataset') Object.assign(el.dataset, v);
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
        else if (['value', 'checked', 'disabled', 'selected', 'hidden', 'required', 'readOnly', 'type'].includes(k)) el[k] = v;
        else el.setAttribute(k, v === true ? '' : String(v));
      }
    }
    add(el, kids);
    return el;
  }
  function add(el, kids) {
    for (const k of [kids].flat(Infinity)) {
      if (k == null || k === false || k === '') continue;
      el.append(k instanceof Node ? k : document.createTextNode(String(k)));
    }
    return el;
  }
  // replaceChildren() that skips null/false/'' like h() does.
  function setKids(el, ...kids) {
    el.replaceChildren();
    return add(el, kids);
  }
  function svg(markup) {
    // Only ever called with static, trusted markup from this file.
    const t = document.createElement('template');
    t.innerHTML = markup.trim();
    return t.content.firstChild;
  }
  const ICON = {
    globe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z"/></svg>',
    bag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true"><path d="M4.8 8h14.4l-1.1 12.5H5.9z"/><path d="M9 8V6.6a3 3 0 0 1 6 0V8"/></svg>',
    chevron: '<svg class="chev" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 4.5 6 8l3.5-3.5"/></svg>',
    close: '<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M2 2l10 10M12 2 2 12"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 20 20"/></svg>',
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v6" stroke-linecap="round"/><circle cx="12" cy="7.6" r="1.1" fill="currentColor" stroke="none"/></svg>',
    alert: '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm-.75 3.25h1.5v5h-1.5zM8 12.5a1 1 0 1 1 0-2 1 1 0 0 1 0 2z"/></svg>',
    lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/></svg>',
    done: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  };
  const icon = name => svg(ICON[name]);

  // Product illustrations: generic, model-agnostic silhouettes (an iPhone, not an
  // iPhone 14), tinted with the chosen finish through --art-fill. Front views for
  // screens, so no camera plateaus, lens counts, ports or grilles date them.
  // Classes: c tinted body, d dark screen/part, k shade, hl highlight, o outline,
  // ot thick outline, cs tinted stroke. Every tinted body is .c so the --art-line
  // stroke keeps near-white finishes visible on white cards.
  const ART = {
    phone: '<rect class="c" x="24" y="8" width="32" height="64" rx="9"/><rect class="d" x="28" y="12" width="24" height="56" rx="6"/>',
    fold: '<rect class="c" x="13" y="10" width="54" height="60" rx="8"/><rect class="d" x="17" y="14" width="46" height="52" rx="5"/><rect class="hl" x="39.4" y="14" width="1.2" height="52"/>',
    tablet: '<rect class="c" x="14" y="6" width="52" height="68" rx="6"/><rect class="d" x="18" y="10" width="44" height="60" rx="3"/>',
    folio: '<rect class="c" x="8" y="9" width="22" height="62" rx="4"/><rect class="k" x="15" y="11" width="1.2" height="58"/><rect class="k" x="22" y="11" width="1.2" height="58"/><rect class="c" x="28" y="6" width="44" height="68" rx="6"/><rect class="d" x="31.5" y="9.5" width="37" height="61" rx="3"/>',
    laptop: '<rect class="c" x="12" y="16" width="56" height="38" rx="4"/><rect class="d" x="15.5" y="19.5" width="49" height="31" rx="2"/><path class="c" d="M4 56h72v1.5c0 2.5-2 4.5-4.5 4.5h-63C6 62 4 60 4 57.5z"/>',
    desktop: '<rect class="c" x="8" y="10" width="64" height="46" rx="4"/><rect class="d" x="11" y="13" width="58" height="34" rx="1.5"/><path class="c" d="M35 56h10l2.5 12h-15z"/><rect class="c" x="24" y="68" width="32" height="3" rx="1.5"/>',
    display: '<rect class="c" x="5" y="10" width="70" height="46" rx="3"/><rect class="d" x="8" y="13" width="64" height="40" rx="1"/><path class="c" d="M34 56h12l2.5 13h-17z"/><rect class="c" x="26" y="69" width="28" height="3" rx="1.5"/>',
    box: '<rect class="c" x="16" y="30" width="48" height="22" rx="5"/><rect class="hl" x="19" y="32" width="42" height="4" rx="2"/>',
    'box-tall': '<rect class="c" x="16" y="22" width="48" height="36" rx="6"/><rect class="hl" x="19" y="24.5" width="42" height="4" rx="2"/>',
    tower: '<path class="o" d="M27 10V7.5A3.5 3.5 0 0 1 30.5 4h3A3.5 3.5 0 0 1 37 7.5V10M43 10V7.5A3.5 3.5 0 0 1 46.5 4h3A3.5 3.5 0 0 1 53 7.5V10"/><rect class="c" x="22" y="10" width="36" height="62" rx="5"/><rect class="hl" x="25" y="12.5" width="30" height="4" rx="2"/>',
    watch: '<rect class="c" x="29" y="3" width="22" height="16" rx="3"/><rect class="c" x="29" y="61" width="22" height="16" rx="3"/><rect class="c" x="20" y="17" width="40" height="46" rx="12"/><rect class="d" x="24" y="21" width="32" height="38" rx="9"/><rect class="c" x="60" y="30" width="3.5" height="9" rx="1.75"/>',
    vision: '<path class="o" d="M8 41c-4 0-6 3-6 7M72 41c4 0 6 3 6 7"/><rect class="c" x="8" y="26" width="64" height="30" rx="15"/><rect class="d" x="11" y="29" width="58" height="24" rx="12"/>',
    buds: '<rect class="c" x="20" y="22" width="40" height="38" rx="12"/><path class="o" d="M20.5 37h39"/><rect class="hl" x="24" y="25" width="14" height="4" rx="2"/>',
    headphones: '<path class="o ob" d="M18 48V38a22 22 0 0 1 44 0v10"/><path class="cs" d="M18 48V38a22 22 0 0 1 44 0v10"/><rect class="c" x="11" y="40" width="16" height="26" rx="7"/><rect class="c" x="53" y="40" width="16" height="26" rx="7"/>',
    pill: '<rect class="c" x="8" y="28" width="64" height="26" rx="13"/><circle class="k" cx="21" cy="41" r="7"/><circle class="k" cx="59" cy="41" r="7"/>',
    homepod: '<rect class="c" x="23" y="14" width="34" height="54" rx="15"/><ellipse class="k" cx="40" cy="20" rx="10" ry="3"/>',
    homepodmini: '<circle class="c" cx="40" cy="44" r="22"/><ellipse class="k" cx="40" cy="28" rx="11" ry="3.5"/>',
    tv: '<rect class="c" x="14" y="31" width="52" height="18" rx="6"/><rect class="hl" x="17" y="33" width="46" height="3.5" rx="1.75"/><circle class="k" cx="58" cy="44" r="1.6"/>',
    remote: '<rect class="c" x="33" y="8" width="14" height="64" rx="7"/><circle class="o" cx="40" cy="22" r="5.5"/><circle class="k" cx="40" cy="22" r="2"/><circle class="k" cx="36.5" cy="36" r="1.6"/><circle class="k" cx="43.5" cy="36" r="1.6"/><circle class="k" cx="40" cy="44" r="1.6"/>',
    pencil: '<g transform="rotate(-40 40 40)"><rect class="c" x="36.5" y="6" width="7" height="58" rx="3.5"/><path class="c" d="M36.5 63h7L40 74z"/><path class="d" d="M38.9 70.5h2.2L40 74z"/></g>',
    keyboard: '<rect class="c" x="6" y="27" width="68" height="28" rx="4"/><rect class="k" x="11" y="31.5" width="58" height="4" rx="2"/><rect class="k" x="11" y="37.5" width="58" height="4" rx="2"/><rect class="k" x="11" y="43.5" width="58" height="4" rx="2"/><rect class="k" x="24" y="49.5" width="32" height="3" rx="1.5"/>',
    mouse: '<rect class="c" x="27" y="13" width="26" height="50" rx="13"/><rect class="hl" x="31" y="17" width="7" height="14" rx="3.5"/>',
    trackpad: '<rect class="c" x="13" y="17" width="54" height="46" rx="7"/><rect class="hl" x="17" y="21" width="10" height="6" rx="3"/>',
    airtag: '<circle class="c" cx="40" cy="40" r="23"/><circle class="k" cx="40" cy="40" r="15"/>',
    power: '<rect class="d" x="33" y="15" width="3" height="10" rx="1"/><rect class="d" x="44" y="15" width="3" height="10" rx="1"/><rect class="c" x="25" y="24" width="30" height="30" rx="7"/><path class="o" d="M40 54v6c0 6 10 6 10 14"/>',
    magsafe: '<circle class="c" cx="40" cy="33" r="18"/><circle class="k" cx="40" cy="33" r="10"/><path class="o" d="M40 51v5c0 7 12 7 12 16"/>',
    cable: '<path class="o ot" d="M20 22c0 26 40 10 40 36"/><rect class="c" x="16" y="10" width="8" height="14" rx="2"/><rect class="c" x="56" y="56" width="8" height="14" rx="2"/>',
    dongle: '<path class="o" d="M14 40h14M52 40h14"/><rect class="c" x="28" y="30" width="24" height="20" rx="5"/>',
    case: '<rect class="c" x="22" y="6" width="36" height="68" rx="10"/><rect class="k" x="26" y="10" width="28" height="60" rx="7"/>',
    strap: '<ellipse class="o ob" cx="40" cy="38" rx="18" ry="27"/><ellipse class="cs" cx="40" cy="38" rx="18" ry="27"/><rect class="c" x="34" y="60" width="12" height="9" rx="2.5"/>',
    wallet: '<rect class="c" x="18" y="20" width="44" height="40" rx="6"/><rect class="k" x="22" y="24" width="36" height="6" rx="3"/>',
    battery: '<rect class="c" x="22" y="10" width="36" height="60" rx="9"/><path class="d" d="M43 24l-10 17h7l-3 15 11-18h-7z"/>',
    cloth: '<rect class="c" x="18" y="20" width="44" height="40" rx="5"/><path class="hl" d="M62 20v15a15 15 0 0 1-15-15z"/>',
    bag: '<path class="c" d="M17 27h46l-3.5 42h-39z"/><path class="o" d="M30 27v-4a10 10 0 0 1 20 0v4"/>',
    other: '<circle class="o" cx="40" cy="40" r="22"/><path class="o" d="M40 31v18M31 40h18"/>',
  };
  const CATEGORY_ART = { mac: 'laptop', ipad: 'tablet', iphone: 'phone', watch: 'watch', vision: 'vision', airpods: 'buds', 'tv-home': 'tv', accessories: 'pencil', other: 'other' };

  function artKey(p) {
    if (!p) return 'bag';
    const n = String(p.name || '').toLowerCase();
    const g = String(p.group || '').toLowerCase();
    switch (p.category) {
      case 'iphone': return /duo|fold/.test(n) ? 'fold' : 'phone';
      case 'ipad': return 'tablet';
      case 'mac':
        if (/display/.test(n) || /display/.test(g)) return 'display';
        if (/imac/.test(n)) return 'desktop';
        if (/mac pro/.test(n)) return 'tower';
        if (/studio/.test(n)) return 'box-tall';
        if (/mini/.test(n)) return 'box';
        return 'laptop';
      case 'watch': return 'watch';
      case 'vision': return 'vision';
      case 'airpods':
        if (/pill|speaker/.test(n)) return 'pill';
        if (/buds/.test(n)) return 'buds';
        if (/max|studio|solo|headphone/.test(n)) return 'headphones';
        return 'buds';
      case 'tv-home':
        if (/remote/.test(n)) return 'remote';
        if (/mini/.test(n)) return 'homepodmini';
        if (/homepod/.test(n)) return 'homepod';
        return 'tv';
      case 'accessories':
        if (/battery/.test(n)) return 'battery';
        if (/magsafe charger|watch.*charger/.test(n)) return 'magsafe';
        if (/power adapter|charger/.test(n)) return 'power';
        if (/pencil/.test(n)) return 'pencil';
        if (/adapter/.test(n)) return 'dongle';
        if (/cable|cord/.test(n)) return 'cable';
        if (/wallet/.test(n)) return 'wallet';
        if (/strap|lanyard/.test(n)) return 'strap';
        if (/folio/.test(n) && /ipad|keyboard/.test(n)) return 'folio';
        if (/keyboard/.test(n)) return 'keyboard';
        if (/mouse/.test(n)) return 'mouse';
        if (/trackpad/.test(n)) return 'trackpad';
        if (/airtag/.test(n)) return 'airtag';
        if (/cloth/.test(n)) return 'cloth';
        if (/case|bumper|folio|cover|sleeve/.test(n)) return 'case';
        return 'bag';
      case 'other': return 'other';
    }
    return 'bag';
  }
  // The first colour choice, so cards and the configurator header start tinted alike.
  function firstHex(p) {
    const o = ((p && p.options) || []).find(x => x.type === 'color' && (x.choices || []).length);
    return (o && o.choices[0].hex) || '';
  }
  function art(key, hex) {
    const span = h('span', { class: 'art', 'aria-hidden': 'true' });
    span.append(svg(`<svg viewBox="0 0 80 80" xmlns="http://www.w3.org/2000/svg">${ART[key] || ART.bag}</svg>`));
    if (hex) span.style.setProperty('--art-fill', hex);
    return span;
  }

  function newId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    const b = new Uint8Array(16);
    (window.crypto || {}).getRandomValues ? crypto.getRandomValues(b) : b.forEach((_, i) => { b[i] = Math.floor(Math.random() * 256); });
    return Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
  }
  function todayISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  function formatDate(iso) {
    if (!iso) return '';
    const [y, m, d] = iso.split('-').map(Number);
    try { return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }); }
    catch (e) { return iso; }
  }
  const plural = (n, one, many) => `${n} ${n === 1 ? one : (many || one + 's')}`;
  const countryName = code => (COUNTRY.get(code) || {}).name || code;
  const regionOk = (x, country) => !x || !Array.isArray(x.regions) || !x.regions.length || x.regions.includes(country);
  // Products Apple doesn't sell in a country with an Apple online store.
  const soldIn = (p, country) => !Array.isArray(p.regions) || !p.regions.length || p.regions.includes(country) || (ONLINE.size > 0 && !ONLINE.has(country));
  const listFor = (list, country) => (list || []).map(x => (typeof x === 'string' ? { value: x } : x)).filter(x => regionOk(x, country));

  const storage = {
    get(k) { try { return JSON.parse(window.localStorage.getItem(k)); } catch (e) { return null; } },
    set(k, v) { try { window.localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
    del(k) { try { window.localStorage.removeItem(k); } catch (e) { /* ignore */ } },
  };

  /* --------------------------------------------------- sensitive data */

  function luhn(digits) {
    let sum = 0, alt = false;
    for (let i = digits.length - 1; i >= 0; i--) {
      let n = digits.charCodeAt(i) - 48;
      if (alt) { n *= 2; if (n > 9) n -= 9; }
      sum += n; alt = !alt;
    }
    return sum % 10 === 0;
  }
  // Mirrored by looksSensitive_() in Code.gs. Checks every run of whole digit
  // groups, so "4111 1111 1111 1111 12/28" or "x2 4111…" can't hide a card.
  function sensitiveKind(value, opts) {
    if (!value) return null;
    const s = String(value);
    const runs = /(\+?)\d+(?:[ .\-]{1,3}\d+)*/g;
    let m;
    while ((m = runs.exec(s))) {
      if (m[1]) continue; // "+49 151 …" is a phone number
      const g = m[0].split(/[ .\-]+/);
      for (let i = 0; i < g.length; i++) {
        let d = '';
        for (let j = i; j < g.length && d.length < 19; j++) {
          d += g[j];
          if (d.length >= 13 && d.length <= 19 && /^(?:4|5[0-8]|2[2-7]|3|6|8[12]|9792)/.test(d) &&
              (d.length !== 15 || /^3[47]/.test(d)) && luhn(d)) return 'card';
        }
      }
    }
    const gift = /\bX[A-Z0-9]{3}[ -]?[A-Z0-9]{4}[ -]?[A-Z0-9]{4}[ -]?[A-Z0-9]{4}\b/gi;
    while ((m = gift.exec(s))) if (/\d/.test(m[0])) return 'giftcard';
    if (/\b\d{3}-\d{2}-\d{4}\b/.test(s)) return 'id';
    // Not on address fields: India's postal code is called a "PIN code".
    if (!(opts && opts.address) && /\b(password|passcode)\s*[:=]|\bpin(?: code)?\s*[:=]\s*\d{4,6}\b/i.test(s)) return 'password';
    return null;
  }
  const SENSITIVE_MSG = {
    card: "This looks like a card number. Please don't share payment card details here.",
    giftcard: "This looks like a gift card code. Don't enter it here. You'll be asked for it when the order is placed.",
    id: "Please don't share ID numbers here.",
    password: "Please don't share passwords or passcodes here.",
  };
  function checkSensitive(errs, key, value, opts) {
    const k = sensitiveKind(value, opts);
    if (k && !errs.has(key)) errs.set(key, SENSITIVE_MSG[k]);
  }

  /* -------------------------------------------------------------- state */

  const DRAFT_KEY = 'ff-order-draft-v1';

  function detectCountry() {
    const want = String(CFG.defaultCountry || '').toUpperCase();
    if (COUNTRY.has(want)) return want;
    const langs = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || ''];
    for (const l of langs) {
      const m = /[-_]([A-Za-z]{2})(?:$|[-_])/.exec(l || '');
      if (m && COUNTRY.has(m[1].toUpperCase())) return m[1].toUpperCase();
    }
    return COUNTRY.has('US') ? 'US' : (COUNTRIES[0] || { code: 'US' }).code;
  }

  function blankState() {
    const country = detectCountry();
    const c = COUNTRY.get(country) || {};
    return {
      v: 1,
      sid: newId(),
      startedAt: Date.now(),
      country,
      items: [],
      tradeIn: { has: '', devices: [] },
      you: { first: '', last: '', email: '', dial: c.dial || '1', dialCountry: country, phone: '', contact: '' },
      delivery: {
        method: '', store: '', storeOther: '', date: '',
        pickupBy: 'me', altFirst: '', altLast: '', altEmail: '',
        recipient: 'me', recFirst: '', recLast: '', recPhone: '',
        addr: {}, instructions: '', neededBy: '',
      },
      pay: { method: '', methodOther: '', gift: 'no', giftAmount: '', currency: c.currency || 'USD', budget: '' },
      notes: '',
      acks: {},
      invite: '',
      inviteFromLink: false,
      inviteOk: false,   // verified with the backend (or accepted in preview mode)
      inviteName: '',
      maxStep: 0,
    };
  }

  const DRAFT_TTL = 14 * 86400000; // forget unfinished drafts after two weeks (shared devices)

  function loadDraft() {
    const d = storage.get(DRAFT_KEY);
    if (!d || d.v !== 1 || !Array.isArray(d.items)) return null;
    if (!(Date.now() - (d.savedAt || d.startedAt || 0) < DRAFT_TTL)) {
      storage.del(DRAFT_KEY);
      if (!d.inviteFromLink || !d.invite) return null;
      const b = blankState(); // keep only the invite code from the link
      b.invite = d.invite; b.inviteFromLink = true;
      return b;
    }
    const b = blankState();
    const merged = Object.assign(b, d, {
      tradeIn: Object.assign(b.tradeIn, d.tradeIn),
      you: Object.assign(b.you, d.you),
      delivery: Object.assign(b.delivery, d.delivery, { addr: Object.assign({}, (d.delivery || {}).addr) }),
      pay: Object.assign(b.pay, d.pay),
      acks: Object.assign({}, d.acks),
    });
    if (!COUNTRY.has(merged.country)) merged.country = b.country;
    if (!Array.isArray(merged.tradeIn.devices)) merged.tradeIn.devices = [];
    return merged;
  }

  let S = loadDraft();
  const RESTORED = !!(S && (S.items.length || S.you.first));
  if (!S) S = blankState();
  let saveTimer = 0;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { S.savedAt = Date.now(); storage.set(DRAFT_KEY, S); }, 250);
  }
  function resetAll() {
    storage.del(DRAFT_KEY);
    S = blankState();
  }

  /* ------------------------------------------------------- catalog logic */

  function resolveOption(o, country) {
    if (!regionOk(o, country)) return null;
    let choices = o.choices || [];
    if (o.choicesRef === 'keyboardLayouts') {
      choices = PROGRAMS.keyboardLayouts || [];
      const local = (PROGRAMS.keyboardLayoutsByCountry || {})[country];
      if (Array.isArray(local) && local.length) {
        const master = choices;
        choices = local.map(v => master.find(c => c.value === v) || { value: v });
      }
    }
    else if (o.choicesRef === 'carriers') {
      choices = (PROGRAMS.carriers || {})[country];
      if (!choices || !choices.length) return null;
    }
    // Choice-level availability only applies where Apple has an online store;
    // elsewhere show the full list rather than leaving nothing to pick.
    const strict = !ONLINE.size || ONLINE.has(country);
    choices = choices.map(c => (typeof c === 'string' ? { value: c } : c)).filter(c => !strict || regionOk(c, country));
    if (o.type !== 'text' && !choices.length) return null;
    return {
      id: o.id, label: o.label, type: o.type || 'tiles', help: o.help || '', placeholder: o.placeholder || '',
      required: o.required !== false, ref: o.choicesRef || '', choices,
    };
  }

  function appleCareFor(product, country) {
    if (!product || !product.applecare) return null;
    const def = (PROGRAMS.applecare || {})[product.applecare];
    if (!def || !Array.isArray(def.plans)) return null;
    const countries = PROGRAMS.applecareCountries;
    if (Array.isArray(countries) && countries.length && !countries.includes(country)) return null;
    // The form only asks whether to add AppleCare+; the plan list says where it's sold.
    const plans = def.plans.filter(p => regionOk(p, country));
    if (!plans.length) return null;
    return { plans };
  }
  function appleCareText(ac) {
    if (!ac || !ac.plan) return '';
    if (ac.plan === 'none') return 'No AppleCare';
    if (ac.plan === 'yes') return 'AppleCare+';
    if (ac.plan === 'advise') return 'AppleCare: help me choose'; // saved by an older version
    return ac.billing ? `${ac.plan} (${ac.billing})` : ac.plan; // older drafts with a specific plan
  }

  // Only items with country-specific choices (keyboard, carrier, AppleCare) carry a country.
  const configuredElsewhere = item => !!(item.country && item.country !== S.country && item.depends !== false && !item.custom);

  function itemLines(item) {
    const lines = [];
    const spec = (item.spec || []).map(s => (s.kind === 'text' || s.kind === 'select' ? `${s.label}: ${s.value}` : s.value));
    if (spec.length) lines.push(spec.join(' · '));
    const ac = appleCareText(item.ac);
    if (ac) lines.push(ac);
    if (item.engraving) lines.push(`Engraving: “${item.engraving}”`);
    if (item.link) lines.push(item.link);
    if (item.notes) lines.push(`Note: ${item.notes}`);
    if (configuredElsewhere(item)) lines.push(`Configured for ${countryName(item.country)}`);
    return lines;
  }

  /* --------------------------------------------------------- addresses */

  const ZIP_LABEL = { zip: 'ZIP code', postal: 'Postal code', pin: 'PIN code', eircode: 'Eircode' };
  const STATE_LABEL = {
    state: 'State', province: 'Province', prefecture: 'Prefecture', county: 'County', region: 'Region', area: 'Area',
    island: 'Island', emirate: 'Emirate', district: 'District', department: 'Department', do_si: 'Province',
    oblast: 'Region', parish: 'Parish',
  };
  const CITY_LABEL = { city: 'City', post_town: 'Town or city', district: 'District', suburb: 'Suburb' };
  const SUBLOCALITY_LABEL = { suburb: 'Suburb', district: 'District', neighborhood: 'Neighborhood', village_township: 'Village or township', townland: 'Townland' };
  const TOKEN_FIELD = { A: 'address1', D: 'sublocality', C: 'city', S: 'state', Z: 'postal', X: 'sorting' };

  function addressSpec(code) {
    const c = COUNTRY.get(code) || {};
    const fmt = c.fmt || '%N%n%O%n%A%n%C';
    const req = c.require || 'AC';
    const seen = new Set();
    const rows = [];
    for (const line of fmt.split('%n')) {
      const toks = Array.from(new Set((line.match(/%[A-Z]/g) || []).map(t => t[1]))).filter(t => TOKEN_FIELD[t] && !seen.has(t));
      toks.forEach(t => seen.add(t));
      if (!toks.length) continue;
      if (toks.includes('A')) {
        rows.push(['address1'], ['address2']);
        const rest = toks.filter(t => t !== 'A').map(t => TOKEN_FIELD[t]);
        if (rest.length) rows.push(rest);
      } else rows.push(toks.map(t => TOKEN_FIELD[t]));
    }
    if (!seen.has('A')) rows.unshift(['address1'], ['address2']);
    const required = new Set(['address1']);
    for (const ch of req) if (TOKEN_FIELD[ch]) required.add(TOKEN_FIELD[ch]);
    let zipRe = null;
    if (c.zip) { try { zipRe = new RegExp(`^(?:${c.zip})$`, 'i'); } catch (e) { zipRe = null; } }
    const labels = {
      address1: 'Street address',
      address2: 'Apt, suite, etc.',
      sublocality: SUBLOCALITY_LABEL[c.sublocalityType] || 'Neighborhood',
      city: CITY_LABEL[c.localityType] || 'City',
      state: STATE_LABEL[c.stateType] || 'State or province',
      postal: ZIP_LABEL[c.zipType] || 'Postal code',
      sorting: 'Sorting code',
    };
    return { rows, required, zipRe, zipEx: c.zipEx || '', labels, states: c.states || null, fmt, upper: c.upper || '' };
  }

  function formatAddress(code, addr, name) {
    const c = COUNTRY.get(code) || {};
    const fmt = c.fmt || '%N%n%O%n%A%n%C';
    const a = addr || {};
    const stateLabel = (c.states || []).find(s => s[0] === a.state);
    const vals = {
      N: name || '', O: '',
      A: [a.address1, a.address2].filter(Boolean).join('\n'),
      D: a.sublocality || '', C: a.city || '', S: a.state ? (stateLabel && stateLabel[0] !== stateLabel[1] ? a.state : a.state) : '',
      Z: a.postal || '', X: a.sorting || '',
    };
    let out = fmt.replace(/%([NOADCSZX])/g, (_, t) => vals[t] || '').replace(/%[A-Z]/g, '').split('%n')
      .map(l => l.replace(/\s+,/g, ',').replace(/^[\s,–-]+|[\s,–-]+$/g, '').replace(/\s{2,}/g, ' '))
      .filter(Boolean).join('\n');
    if (!/%A/.test(fmt) && vals.A) out = vals.A + '\n' + out;
    return (out + '\n' + countryName(code)).trim();
  }

  /* -------------------------------------------------------------- steps */

  const STEPS = [
    { id: 'products', label: 'Products' },
    { id: 'trade-in', label: 'Trade-in' },
    { id: 'you', label: 'Your details' },
    { id: 'delivery', label: 'Delivery' },
    { id: 'review', label: 'Review' },
  ];
  const stepIndex = id => STEPS.findIndex(s => s.id === id);

  const EMAIL_RE = /^[^\s@<>,;:"()[\]\\]+@[^\s@<>,;:"()[\]\\]+\.[^\s@<>,;:"()[\]\\]{2,}$/;
  const MAX_LINES = 30; // Code.gs accepts up to 30 product lines per request
  // "2 000", "1,500", "€150" -> number. The raw text is what gets sent.
  const parseAmount = v => Number(String(v || '').replace(/[\s\u00a0\u202f,'’$€£¥₹]/g, ''));
  // A number typed with its own country code ("+44 …", "0044 …") is kept as is.
  const fullPhone = (dial, phone) => {
    const n = String(phone || '').trim();
    if (/^(\+|00)/.test(n)) return n;
    // Drop the national trunk 0 ("0151…" -> "+49 151…"), except in Italy where it's part of the number.
    return `+${dial} ${dial === '39' ? n : n.replace(/^0(?=\d)/, '')}`;
  };
  // "Street address" -> "street address", but keep "ZIP code", "PIN code".
  const lowerFirst = s => (/^[A-Z]{2}/.test(s) ? s : s.charAt(0).toLowerCase() + s.slice(1));
  const normSerial = s => String(s || '').replace(/[\s-]/g, '').toUpperCase();
  const phoneDigits = s => String(s || '').replace(/\D/g, '');
  const NAME_MAX = 60;

  function checkName(errs, key, value, what) {
    const v = String(value || '').trim();
    if (!v) errs.set(key, `Enter ${what}.`);
    else if (/\d/.test(v)) errs.set(key, 'Names can’t contain numbers.');
    else if (v.length > NAME_MAX) errs.set(key, 'That’s too long.');
  }
  function checkFutureDate(errs, key, iso) {
    if (iso && iso < todayISO()) errs.set(key, 'Choose a date that hasn’t passed.');
  }

  function errorsFor(id) {
    const e = new Map();
    if (id === 'products') {
      if (!S.items.length) e.set('bag', 'Add at least one product to continue.');
      else if (S.items.length > MAX_LINES) e.set('bag', `You can request up to ${MAX_LINES} different products at once. Send the rest in a second request.`);
    }
    if (id === 'trade-in') {
      const t = S.tradeIn;
      if (t.has !== 'yes' && t.has !== 'no') e.set('ti.has', 'Choose Yes or No.');
      if (t.has === 'yes') {
        t.devices.forEach((d, i) => {
          if (!d.type) e.set(`ti.${i}.type`, 'Choose the kind of device.');
          if (!String(d.model || '').trim()) e.set(`ti.${i}.model`, 'Enter the model, for example “iPhone 13 mini”.');
          checkSensitive(e, `ti.${i}.model`, d.model);
          const sn = normSerial(d.serial);
          if (!sn) e.set(`ti.${i}.serial`, 'Enter the serial number or IMEI.');
          else if (!/^[A-Z0-9]{8,17}$/.test(sn)) e.set(`ti.${i}.serial`, 'That doesn’t look like a serial number or IMEI. Check for typos.');
          else if (/^\d+$/.test(sn) && sn.length !== 15 && sn.length !== 14) e.set(`ti.${i}.serial`, 'That looks like a phone number. Enter the serial number or 15-digit IMEI.');
          if (!d.works) e.set(`ti.${i}.works`, 'Choose Yes or No.');
          if (!d.damage) e.set(`ti.${i}.damage`, 'Choose Yes or No.');
        });
      }
    }
    if (id === 'you') {
      const y = S.you;
      checkName(e, 'you.first', y.first, 'your first name');
      checkName(e, 'you.last', y.last, 'your last name');
      if (!y.email.trim()) e.set('you.email', 'Enter your email address.');
      else if (!EMAIL_RE.test(y.email.trim())) e.set('you.email', 'Enter a valid email address.');
      const pd = phoneDigits(y.phone);
      if (!pd) e.set('you.phone', 'Enter your phone number.');
      else if (pd.length < 5 || pd.length > 15) e.set('you.phone', 'Enter a valid phone number.');
      if (!y.contact || !contactChoices().some(c => c.value === y.contact)) e.set('you.contact', 'Choose how you’d like to be contacted.');
    }
    if (id === 'delivery') {
      const d = S.delivery;
      if (!d.method) e.set('del.method', 'Choose pickup or delivery.');
      if (d.method === 'pickup') {
        if (!d.store) e.set('del.store', 'Choose a store.');
        else if (d.store === '__other' && !d.storeOther.trim()) e.set('del.storeOther', 'Enter the store name.');
        if (d.store === '__other') checkSensitive(e, 'del.storeOther', d.storeOther);
        checkFutureDate(e, 'del.date', d.date);
        if (d.pickupBy === 'other') {
          checkName(e, 'del.altFirst', d.altFirst, 'their first name');
          checkName(e, 'del.altLast', d.altLast, 'their last name');
          if (!d.altEmail.trim()) e.set('del.altEmail', 'Enter their email address.');
          else if (!EMAIL_RE.test(d.altEmail.trim())) e.set('del.altEmail', 'Enter a valid email address.');
        }
      }
      if (d.method === 'delivery') {
        if (d.recipient === 'other') {
          checkName(e, 'del.recFirst', d.recFirst, 'their first name');
          checkName(e, 'del.recLast', d.recLast, 'their last name');
          const rp = phoneDigits(d.recPhone);
          if (d.recPhone && (rp.length < 5 || rp.length > 15)) e.set('del.recPhone', 'Enter a valid phone number.');
        }
        const spec = addressSpec(S.country);
        for (const row of spec.rows) for (const f of row) {
          const v = String(d.addr[f] || '').trim();
          const key = `addr.${f}`;
          const noun = lowerFirst(spec.labels[f]);
          const art = /^[aeiou]/i.test(noun) ? 'an' : 'a';
          if (spec.required.has(f) && !v) e.set(key, f === 'state' && spec.states ? `Choose ${art} ${noun}.` : `Enter the ${noun}.`);
          else if (f === 'postal' && v && spec.zipRe && !spec.zipRe.test(v) && !spec.zipRe.test(v.replace(/[\s\u00a0]/g, ''))) e.set(key, `Enter a valid ${noun}${spec.zipEx ? `, like ${spec.zipEx.split(',')[0]}` : ''}.`);
          checkSensitive(e, key, v, { address: true });
        }
        checkSensitive(e, 'del.instructions', d.instructions, { address: true });
      }
      checkFutureDate(e, 'del.neededBy', d.neededBy);
    }
    if (id === 'review') {
      const p = S.pay;
      if (!p.method || !listFor(CFG.paymentMethods, S.country).some(m => m.value === p.method)) e.set('pay.method', 'Choose how you’ll pay.');
      if (p.method === 'Other' && !p.methodOther.trim()) e.set('pay.methodOther', 'Tell us how you’ll pay.');
      checkSensitive(e, 'pay.methodOther', p.methodOther);
      if (p.gift === 'yes') {
        const n = parseAmount(p.giftAmount);
        if (!p.giftAmount || !isFinite(n) || n <= 0) e.set('pay.giftAmount', 'Enter the total gift card amount.');
        checkSensitive(e, 'pay.giftAmount', p.giftAmount);
      }
      if (p.budget) {
        const n = parseAmount(p.budget);
        if (!isFinite(n) || n <= 0) e.set('pay.budget', 'Enter a number, or leave it blank.');
      }
      checkSensitive(e, 'notes', S.notes);
      (CFG.acknowledgements || []).forEach((_, i) => { if (!S.acks[i]) e.set(`ack.${i}`, 'Please confirm to continue.'); });
    }
    return e;
  }

  /* --------------------------------------------------------- form parts */

  let ERR = new Map(); // errors shown on the current step

  // Errors are tied to their fields with aria-describedby (no burst of alerts).
  function errorEl(msg, id) {
    return h('p', { class: 'field-error', id }, icon('alert'), h('span', { text: msg }));
  }
  const describedBy = (...ids) => ids.filter(Boolean).join(' ') || null;
  function stripErrorRefs(root) {
    root.querySelectorAll('[aria-invalid]').forEach(x => x.removeAttribute('aria-invalid'));
    root.querySelectorAll('[aria-describedby]').forEach(x => {
      const v = x.getAttribute('aria-describedby').split(' ').filter(i => !i.endsWith('-err')).join(' ');
      if (v) x.setAttribute('aria-describedby', v); else x.removeAttribute('aria-describedby');
    });
  }
  function clearFieldEl(el) {
    el.classList.remove('invalid');
    el.querySelectorAll(':scope > .field-error, :scope > .choice-error').forEach(x => x.remove());
    el.querySelectorAll(':scope .check.invalid').forEach(x => x.classList.remove('invalid'));
    stripErrorRefs(el);
  }
  function clearError(key) {
    if (!ERR.has(key)) return;
    ERR.delete(key);
    document.querySelectorAll(`[data-field="${CSS.escape(key)}"]`).forEach(clearFieldEl);
  }
  function clearErrorIn(wrap, key, errs) {
    if (errs) { errs.delete(key); clearFieldEl(wrap); }
    else clearError(key);
  }
  const fid = key => 'f-' + key.replace(/[^a-zA-Z0-9]+/g, '-');

  // When a change re-renders the part of the page holding the control the user
  // just used, put keyboard focus back on its replacement.
  function refocus(el, selector) {
    if (el.isConnected || !selector) return;
    const open = document.querySelectorAll('dialog[open]');
    const scope = open.length ? open[open.length - 1] : document;
    const next = scope.querySelector(selector);
    if (next && !next.disabled) next.focus({ preventScroll: true });
  }
  const reduceMotion = () => !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const smooth = () => (reduceMotion() ? 'auto' : 'smooth');

  function textField(o) {
    const key = o.key;
    const id = fid(key);
    const err = o.errs ? o.errs.get(key) : ERR.get(key);
    const tag = o.textarea ? 'textarea' : 'input';
    const input = h(tag, {
      id, name: key, placeholder: o.placeholder || ' ',
      autocomplete: o.autocomplete || 'off', inputmode: o.inputmode, maxlength: o.maxlength || 120,
      autocapitalize: o.autocapitalize, spellcheck: o.spellcheck === false ? 'false' : null, enterkeyhint: o.enterkeyhint,
      min: o.min, max: o.max, 'aria-invalid': err ? 'true' : null,
      'aria-describedby': describedBy(err && id + '-err', o.hint && id + '-hint'), rows: o.textarea ? 3 : null,
    });
    if (!o.textarea) input.type = o.type || 'text';
    input.value = o.value || '';
    input.addEventListener('input', () => { o.onInput(input.value); clearErrorIn(wrap, key, o.errs); });
    const wrap = h('div', { class: 'field' + (err ? ' invalid' : '') + (o.type === 'date' ? ' filled' : ''), 'data-field': key },
      h('div', { class: 'field-control' }, input, h('label', { class: 'float', for: id, text: o.label + (o.optional ? ' (optional)' : '') })),
      o.hint ? h('p', { class: 'field-hint', id: id + '-hint', text: o.hint }) : null,
      err ? errorEl(err, id + '-err') : null);
    return wrap;
  }

  function selectField(o) {
    const key = o.key;
    const id = fid(key);
    const err = o.errs ? o.errs.get(key) : ERR.get(key);
    const sel = h('select', {
      id, name: key, autocomplete: o.autocomplete || 'off', 'aria-invalid': err ? 'true' : null,
      'aria-describedby': describedBy(err && id + '-err', o.hint && id + '-hint'),
    });
    sel.append(h('option', { value: '', text: o.placeholder || 'Choose', disabled: true }));
    const addOpt = (parent, c) => parent.append(h('option', { value: c.value, text: c.label || c.value, disabled: !!c.disabled }));
    for (const c of o.options) {
      if (c.group) { const g = h('optgroup', { label: c.group }); c.options.forEach(x => addOpt(g, x)); sel.append(g); }
      else addOpt(sel, c);
    }
    sel.value = o.value || '';
    if (!sel.value) sel.selectedIndex = 0;
    sel.addEventListener('change', () => {
      clearErrorIn(wrap, key, o.errs);
      o.onChange(sel.value);
      refocus(sel, '#' + CSS.escape(id));
    });
    const wrap = h('div', { class: 'field' + (err ? ' invalid' : ''), 'data-field': key },
      h('div', { class: 'field-control' }, sel, h('label', { class: 'float', for: id, text: o.label + (o.optional ? ' (optional)' : '') }), icon('chevron')),
      o.hint ? h('p', { class: 'field-hint', id: id + '-hint', text: o.hint }) : null,
      err ? errorEl(err, id + '-err') : null);
    wrap._select = sel;
    return wrap;
  }

  let groupSeq = 0;
  function choiceGroup(o) {
    const key = o.key;
    const err = o.errs ? o.errs.get(key) : ERR.get(key);
    const name = 'g' + (++groupSeq);
    const gid = fid(key) + '-' + groupSeq;
    const chosen = h('span', { class: 'chosen' });
    const legend = h('legend', { class: 'choice-legend' }, h('span', { text: o.legend }), chosen);
    const fs = h('fieldset', { class: 'choice' + (err ? ' invalid' : ''), 'data-field': key }, legend);
    if (o.help) fs.append(h('p', { class: 'choice-help', id: gid + '-hint', text: o.help }));
    const desc = describedBy(err && gid + '-err', o.help && gid + '-hint');
    const kind = o.kind || 'tiles';
    const box = h('div', { class: kind === 'swatches' ? 'swatches' : 'tiles' + (o.cols ? ' cols-' + o.cols : '') });
    const inputs = new Map();
    for (const c of o.choices) {
      const input = h('input', {
        type: 'radio', name, value: c.value, checked: c.value === o.value, disabled: !!c.disabled,
        'aria-describedby': desc, 'aria-invalid': err ? 'true' : null,
      });
      if (kind === 'swatches') {
        input.setAttribute('aria-label', c.label || c.value);
        const dot = h('span', { class: 'swatch-dot', title: c.label || c.value });
        dot.style.background = /^#[0-9a-f]{6}$/i.test(c.hex || '') ? c.hex : '#cccccc';
        box.append(h('label', { class: 'swatch' }, input, dot));
      } else {
        const body = h('span', { class: 'tile-body' });
        const text = [h('span', { class: 'tile-title', text: c.label || c.value }), c.detail ? h('span', { class: 'tile-detail', text: c.detail }) : null];
        if (c.art) add(body, h('span', { class: 'tile-row' }, art(c.art), h('span', null, text)));
        else add(body, text);
        box.append(h('label', { class: 'tile' }, input, body));
      }
      input.addEventListener('change', () => {
        if (!input.checked) return;
        clearErrorIn(fs, key, o.errs);
        o.onChange(c.value);
        if (kind === 'swatches') chosen.textContent = c.label || c.value;
        refocus(input, `[data-field="${CSS.escape(key)}"] input[value="${CSS.escape(c.value)}"]`);
      });
      inputs.set(c.value, input);
    }
    fs.append(box);
    if (kind === 'swatches' && o.value) chosen.textContent = o.value;
    if (err) fs.append(h('div', { class: 'choice-error' }, errorEl(err, gid + '-err')));
    fs._inputs = inputs;
    fs._chosen = chosen;
    return fs;
  }

  function checkbox(o) {
    const err = ERR.get(o.key);
    const id = fid(o.key);
    const input = h('input', { type: 'checkbox', id, checked: !!o.checked, 'aria-invalid': err ? 'true' : null, 'aria-describedby': err ? id + '-err' : null });
    input.addEventListener('change', () => { o.onChange(input.checked); clearError(o.key); });
    const wrap = h('div', { 'data-field': o.key, class: err ? 'invalid' : '' },
      h('label', { class: 'check' + (err ? ' invalid' : '') }, input, h('span', { text: o.label })),
      err ? errorEl(err, id + '-err') : null);
    return wrap;
  }

  function note(text, kind) {
    return h('div', { class: 'note' + (kind ? ' ' + kind : '') }, icon(kind === 'lock' ? 'lock' : 'info'), h('div', null, text));
  }

  const stepEyebrow = i => `Step ${i + 1} of ${STEPS.length}`;
  function stepHead(eyebrow, title, sub) {
    return h('header', { class: 'step-head' },
      eyebrow ? h('p', { class: 'eyebrow', text: eyebrow }) : null,
      h('h1', { class: 'step-title', tabindex: '-1', text: title }),
      sub ? h('p', { class: 'step-sub', text: sub }) : null);
  }

  /* ------------------------------------------------------------- toast */

  // One toast at a time. While a sheet is open the toast mounts inside it: a modal dialog
  // makes the rest of the page inert (even top-layer popovers), so that's the only place
  // where an Undo button can be seen and pressed.
  let toastTimer = 0;
  function toastWrap() {
    const dlgs = document.querySelectorAll('dialog[open]:not(.closing)');
    const dlg = dlgs[dlgs.length - 1];
    if (!dlg) return document.getElementById('toasts');
    let w = dlg.querySelector('.toast-wrap');
    if (!w) { w = h('div', { class: 'toast-wrap in-sheet', role: 'status', 'aria-live': 'polite' }); dlg.append(w); }
    return w;
  }
  function toast(msg, o) {
    const wrap = toastWrap();
    if (!wrap) return;
    o = o || {};
    const t = h('div', { class: 'toast' + (o.action ? ' has-action' : '') }, h('span', { text: msg }));
    const hide = () => {
      if (!t.isConnected) return;
      t.classList.add('out');
      setTimeout(() => t.remove(), 320);
    };
    if (o.action) {
      t.append(h('button', {
        class: 'toast-action', type: 'button', text: o.action,
        onclick: () => { clearTimeout(toastTimer); hide(); if (o.onAction) o.onAction(); },
      }));
    }
    document.querySelectorAll('.toast').forEach(el => { if (el !== t) el.remove(); });
    wrap.replaceChildren(t);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hide, o.duration || (o.action ? 6000 : 2800));
  }

  /* ------------------------------------------------------------- sheets */

  let openSheets = 0;
  // A selector that finds a control again after its region re-renders: stable keys first,
  // the accessible name last (two bag rows of the same product share one).
  function selectorFor(el) {
    if (!el || el === document.body || !el.getAttribute) return '';
    if (el.id) return '#' + CSS.escape(el.id);
    const d = el.dataset || {};
    if (d.pid) return `[data-pid="${CSS.escape(d.pid)}"]`;
    if (d.act && d.id) return `[data-act="${CSS.escape(d.act)}"][data-id="${CSS.escape(d.id)}"]`;
    const label = el.getAttribute('aria-label');
    return label ? `button[aria-label="${CSS.escape(label)}"]` : '';
  }
  function openSheet(o) {
    const titleId = 'sheet-' + (++groupSeq);
    const closeBtn = h('button', { class: 'sheet-close', type: 'button', 'aria-label': 'Close' }, icon('close'));
    const head = h('div', { class: 'sheet-head' },
      o.art || null,
      h('div', null, h('h2', { id: titleId, tabindex: '-1', autofocus: true, text: o.title }), o.sub ? h('p', { text: o.sub }) : null),
      closeBtn);
    const body = h('div', { class: 'sheet-body' });
    const foot = h('div', { class: 'sheet-foot' });
    const dlg = h('dialog', { class: 'sheet' + (o.small ? ' small' : ''), 'aria-labelledby': titleId }, head, body, foot);
    // The control that opened the sheet may be re-rendered while it's open
    // (e.g. after Save Changes), so remember how to find its replacement.
    const opener = document.activeElement;
    const openerSel = selectorFor(opener);
    const stepAtOpen = CUR;
    let closing = false;
    // Animate out where the browser can report the animation's end; close at once elsewhere.
    // (jsdom has no animations, and the tests expect a synchronous close.)
    function closeSheet() {
      if (closing || !dlg.isConnected) return;
      closing = true;
      const finish = () => { if (dlg.hasAttribute('open')) dlg.close(); };
      if (typeof dlg.getAnimations !== 'function' || document.visibilityState === 'hidden') { finish(); return; }
      dlg.classList.add('closing');
      const anims = dlg.getAnimations({ subtree: true });
      if (!anims.length) { finish(); return; }
      let done = false;
      const once = () => { if (!done) { done = true; finish(); } };
      Promise.all(anims.map(a => a.finished.catch(() => {}))).then(once, once);
      setTimeout(once, 450);
    }
    closeBtn.addEventListener('click', closeSheet);
    dlg.addEventListener('click', e => { if (e.target === dlg) closeSheet(); });
    dlg.addEventListener('cancel', e => { e.preventDefault(); closeSheet(); });
    dlg.addEventListener('close', () => {
      dlg.remove();
      openSheets = Math.max(0, openSheets - 1);
      if (!openSheets) document.body.classList.remove('locked');
      if (o.onClose) o.onClose();
      setTimeout(() => {
        if (document.querySelector('dialog[open]')) return; // another sheet took over
        if (document.activeElement && document.activeElement !== document.body) return;
        if (CUR !== stepAtOpen) { const t = document.querySelector('main .step-title'); if (t) t.focus({ preventScroll: true }); return; }
        // Prefer a visible match: the same control can exist in the hidden phone aside and the bag sheet.
        const visible = sel => Array.from(document.querySelectorAll(sel)).find(el => el.getClientRects().length) || document.querySelector(sel);
        const back = (opener && opener.isConnected && opener.getClientRects().length && opener) || (openerSel && visible(openerSel)) || document.getElementById('bag-button');
        if (back) back.focus({ preventScroll: true });
      }, 0);
    });
    body.addEventListener('scroll', () => head.classList.toggle('scrolled', body.scrollTop > 4), { passive: true });
    document.body.append(dlg);
    openSheets++;
    document.body.classList.add('locked');
    if (typeof dlg.showModal === 'function') dlg.showModal();
    else dlg.setAttribute('open', '');
    requestAnimationFrame(() => { const t = document.getElementById(titleId); if (t) t.focus({ preventScroll: true }); });
    return { dlg, head, body, foot, close: closeSheet };
  }

  // Quantity stepper. Uses aria-disabled so focus stays put at the limits.
  function qtyControl(get, set) {
    const out = h('output', { 'aria-live': 'polite' });
    const minus = h('button', { type: 'button', 'aria-label': 'Decrease quantity', text: '−' });
    const plus = h('button', { type: 'button', 'aria-label': 'Increase quantity', text: '+' });
    const paint = () => {
      out.textContent = String(get());
      minus.setAttribute('aria-disabled', String(get() <= 1));
      plus.setAttribute('aria-disabled', String(get() >= CFG.maxQuantity));
    };
    minus.addEventListener('click', () => { if (get() > 1) { set(get() - 1); paint(); } });
    plus.addEventListener('click', () => { if (get() < CFG.maxQuantity) { set(get() + 1); paint(); } });
    paint();
    return h('div', { class: 'opt-section' },
      h('p', { class: 'choice-legend', text: 'Quantity' }),
      h('div', { class: 'qty', role: 'group', 'aria-label': 'Quantity' }, minus, out, plus));
  }

  // Shows an error on a field that was rendered earlier (inside a sheet).
  function markInvalid(el, msg) {
    if (!el || el.classList.contains('invalid')) return;
    const control = el.querySelector('input, select, textarea');
    const id = (control && control.id ? control.id : fid(el.dataset.field || 'x')) + '-err';
    el.classList.add('invalid');
    el.append(errorEl(msg, id));
    if (control) {
      control.setAttribute('aria-invalid', 'true');
      control.setAttribute('aria-describedby', describedBy(id, control.getAttribute('aria-describedby')));
    }
  }

  /* ------------------------------------------------------ configurator */

  function atLineLimit(editId) {
    if (editId || S.items.length < MAX_LINES) return false;
    toast(`You can request up to ${MAX_LINES} different products at once. Send the rest in a second request.`);
    return true;
  }

  function openConfigurator(product, editId) {
    if (atLineLimit(editId)) return;
    const existing = editId ? S.items.find(i => i.id === editId) : null;
    const country = S.country;
    const opts = (product.options || []).map(o => resolveOption(o, country)).filter(Boolean);
    const sel = {};
    if (existing) {
      for (const o of opts) if (existing.sel && existing.sel[o.id] != null) sel[o.id] = existing.sel[o.id];
    }
    for (const o of opts) {
      if (sel[o.id] != null) continue;
      if (o.ref === 'keyboardLayouts') {
        const d = (PROGRAMS.keyboardDefaults || {})[country];
        if (d && o.choices.some(c => c.value === d)) sel[o.id] = d;
      }
    }
    let qty = existing ? existing.qty : 1;
    const acDef = appleCareFor(product, country);
    const ac = existing && existing.ac ? Object.assign({}, existing.ac) : { plan: '', billing: '' };
    // Older drafts stored a plan name or "help me choose"; both mean "yes" where AppleCare is sold.
    if (ac.plan && ac.plan !== 'none') ac.plan = acDef ? 'yes' : '';
    ac.billing = '';
    let engraveOn = !!(existing && existing.engraving);
    let engraving = existing ? existing.engraving || '' : '';
    let notes = existing ? existing.notes || '' : '';
    const errs = new Map();
    const resetNote = new Map(); // option id -> the value an earlier change cleared

    const available = c => !c.only || Object.entries(c.only).every(([dep, allowed]) => sel[dep] == null || (Array.isArray(allowed) && allowed.includes(sel[dep])));
    const isActive = o => o.type === 'text' || o.choices.some(available);
    function settle() {
      for (let pass = 0; pass < 12; pass++) {
        let changed = false;
        for (const o of opts) {
          if (o.type === 'text') continue;
          if (sel[o.id] != null) {
            const c = o.choices.find(x => x.value === sel[o.id]);
            if (!c || !available(c)) { resetNote.set(o.id, sel[o.id]); delete sel[o.id]; changed = true; }
          }
          if (sel[o.id] == null) {
            const av = o.choices.filter(available);
            if (av.length === 1 && o.required) { sel[o.id] = av[0].value; changed = true; }
          }
        }
        if (!changed) break;
      }
    }
    const colorHex = () => {
      for (const o of opts) if (o.type === 'color' && sel[o.id]) { const c = o.choices.find(x => x.value === sel[o.id]); if (c && c.hex) return c.hex; }
      return '';
    };

    const baseHex = firstHex({ options: opts });
    const headArt = art(artKey(product), colorHex() || baseHex);
    const sheet = openSheet({ title: product.name, sub: product.blurb || CATEGORY_NAME.get(product.category) || '', art: headArt });

    if (!soldIn(product, country)) {
      sheet.body.append(h('div', { class: 'pt-3' },
        note(`Apple doesn’t sell ${product.name} in ${countryName(country)}. You can still ask, and you’ll hear back about options.`, 'warn')));
    }

    const sections = [];
    function optionSection(o) {
      const wrap = h('div', { class: 'opt-section', 'data-opt': o.id });
      let fs = null, selWrap = null;
      function build() {
        wrap.replaceChildren();
        if (o.type === 'text') {
          wrap.append(textField({ key: o.id, label: o.label, hint: o.help, value: sel[o.id] || '', placeholder: o.placeholder, optional: !o.required, errs, maxlength: 120, onInput: v => { sel[o.id] = v; } }));
          return;
        }
        if (o.type === 'select') {
          selWrap = selectField({
            key: o.id, label: o.label, hint: o.help, value: sel[o.id] || '', errs, optional: !o.required,
            options: o.choices.map(c => ({ value: c.value, label: c.detail ? `${c.value} — ${c.detail}` : c.value, disabled: !available(c) })),
            onChange: v => { sel[o.id] = v; refresh(); },
          });
          wrap.append(selWrap);
          return;
        }
        fs = choiceGroup({
          key: o.id, legend: o.label, help: o.help, value: sel[o.id], errs,
          kind: o.type === 'color' ? 'swatches' : 'tiles',
          cols: o.choices.length === 2 && o.choices.every(c => c.value.length < 18) ? 2 : (o.choices.some(c => (c.detail || '').length > 34 || c.value.length > 30) ? 1 : 0),
          choices: o.choices.map(c => ({ value: c.value, label: c.value, detail: c.detail, hex: c.hex })),
          onChange: v => { sel[o.id] = v; refresh(); },
        });
        wrap.append(fs);
      }
      function update() {
        const show = isActive(o);
        if (show && wrap.hidden) {
          wrap.classList.add('reveal');
          wrap.addEventListener('animationend', () => wrap.classList.remove('reveal'), { once: true });
        }
        wrap.hidden = !show;
        // Say so when an earlier change cleared this choice, until it's picked again.
        const noteEl = wrap.querySelector('.opt-reset');
        if (show && o.type !== 'text' && sel[o.id] == null && resetNote.has(o.id)) {
          if (!noteEl) {
            const noun = /[A-Z]/.test(o.label.slice(1)) ? o.label : o.label.toLowerCase();
            const box = wrap.querySelector('.tiles, .swatches, .field');
            const msg = h('p', { class: 'opt-reset', role: 'status', text: `${resetNote.get(o.id)} isn’t available with that choice. Choose ${noun} again.` });
            if (box) box.before(msg); else wrap.prepend(msg);
          }
        } else {
          if (noteEl) noteEl.remove();
          if (sel[o.id] != null) resetNote.delete(o.id);
        }
        if (fs) {
          for (const c of o.choices) {
            const input = fs._inputs.get(c.value);
            if (!input) continue;
            input.disabled = !available(c);
            input.checked = sel[o.id] === c.value;
          }
          if (o.type === 'color') fs._chosen.textContent = sel[o.id] || '';
        }
        if (selWrap) {
          const s = selWrap._select;
          Array.from(s.options).forEach(op => {
            if (!op.value) return;
            const c = o.choices.find(x => x.value === op.value);
            op.disabled = !c || !available(c);
          });
          s.value = sel[o.id] || '';
          if (!s.value) s.selectedIndex = 0;
        }
      }
      build();
      return { o, wrap, build, update };
    }

    function refresh() {
      settle();
      sections.forEach(s => s.update());
      const hex = colorHex() || baseHex;
      if (hex) headArt.style.setProperty('--art-fill', hex); else headArt.style.removeProperty('--art-fill');
    }

    for (const o of opts) {
      const s = optionSection(o);
      sections.push(s);
      sheet.body.append(s.wrap);
    }

    // AppleCare: one question. The exact plan and billing are settled with the quote.
    const acWrap = h('div', { class: 'opt-section', 'data-opt': 'applecare' });
    function paintAppleCare() {
      if (!acDef) { acWrap.hidden = true; return; }
      setKids(acWrap, choiceGroup({
        key: 'applecare', legend: 'AppleCare+', errs, value: ac.plan, cols: 2,
        help: 'Covers accidental damage and battery service; the plan and price come with your quote. Want theft and loss cover? Say so in the notes.',
        choices: [
          { value: 'none', label: 'No' },
          { value: 'yes', label: 'Yes, add AppleCare+' },
        ],
        onChange: v => { ac.plan = v; },
      }));
    }
    sheet.body.append(acWrap);
    paintAppleCare();

    // Engraving
    if (product.engraving) {
      const engWrap = h('div', { class: 'opt-section' });
      const paintEng = () => {
        setKids(engWrap, 
          h('p', { class: 'choice-legend', text: 'Engraving' }),
          h('label', { class: 'check' },
            h('input', { type: 'checkbox', id: 'engrave-on', checked: engraveOn, onchange: e => { engraveOn = e.target.checked; paintEng(); refocus(e.target, '#engrave-on'); } }),
            h('span', { text: 'Add free engraving' })),
          engraveOn ? textField({
            key: 'engraving', label: 'Engraving text', value: engraving, errs, maxlength: CFG.engravingMaxLength,
            hint: 'Apple’s character limits and supported emoji vary by product. You’ll hear back if it doesn’t fit.',
            onInput: v => { engraving = v; },
          }) : null);
      };
      paintEng();
      sheet.body.append(engWrap);
    }

    // Quantity + notes
    const submitBtn = h('button', { class: 'btn', type: 'button' });
    const labelBtn = () => { submitBtn.textContent = existing ? 'Save Changes' : (qty > 1 ? `Add ${qty} to Bag` : 'Add to Bag'); };
    sheet.body.append(
      qtyControl(() => qty, v => { qty = v; labelBtn(); }),
      h('div', { class: 'opt-section' },
        textField({ key: 'notes', label: 'Notes for this item', textarea: true, optional: true, maxlength: 500, value: notes, errs, onInput: v => { notes = v; } })));

    refresh();

    labelBtn();
    sheet.foot.append(submitBtn);
    submitBtn.addEventListener('click', () => {
      errs.clear();
      settle();
      const active = opts.filter(isActive);
      for (const o of active) {
        const v = sel[o.id];
        const empty = v == null || (o.type === 'text' && !String(v).trim());
        const noun = /[A-Z]/.test(o.label.slice(1)) ? o.label : o.label.toLowerCase();
        if (o.required && empty) errs.set(o.id, o.error || (o.type === 'text' ? `Enter ${noun}.` : `Choose ${noun}.`));
        if (o.type === 'text') checkSensitive(errs, o.id, v);
      }
      if (acDef && !ac.plan) errs.set('applecare', 'Choose whether to add AppleCare+.');
      if (product.engraving && engraveOn) {
        if (!engraving.trim()) errs.set('engraving', 'Enter engraving text, or turn engraving off.');
        checkSensitive(errs, 'engraving', engraving);
      }
      checkSensitive(errs, 'notes', notes);
      if (errs.size) {
        sections.forEach(s => { s.build(); s.update(); });
        paintAppleCare();
        // Re-render the other error-bearing fields in place.
        sheet.body.querySelectorAll('[data-field="engraving"], [data-field="notes"]').forEach(el => {
          if (errs.has(el.dataset.field)) markInvalid(el, errs.get(el.dataset.field));
        });
        const first = sheet.body.querySelector('.invalid');
        if (first) {
          first.scrollIntoView({ block: 'center', behavior: smooth() });
          const f = first.querySelector('input:not([disabled]), select, textarea');
          if (f) setTimeout(() => f.focus({ preventScroll: true }), 300);
        }
        return;
      }
      // Keyboard, carrier and AppleCare depend on the country; colors and sizes don't.
      // Keyboard, carrier, AppleCare and region-limited choices (bands, cellular,
      // adapters…) depend on the country; colors and sizes don't.
      const regionalOpt = o => !!o.ref || o.choices.some(c => Array.isArray(c.regions) && c.regions.length);
      const regionalPick = o => !!sel[o.id] && (!!o.ref || o.choices.some(c => c.value === sel[o.id] && Array.isArray(c.regions) && c.regions.length));
      const depends = active.some(regionalPick) || !!(ac.plan && ac.plan !== 'none');
      const depChanged = !existing || active.some(o => regionalOpt(o) && sel[o.id] !== (existing.sel || {})[o.id]) ||
        ac.plan !== ((existing.ac || {}).plan || '') || (ac.billing || '') !== ((existing.ac || {}).billing || '');
      const item = {
        id: existing ? existing.id : newId(),
        pid: product.id,
        name: product.name,
        cat: product.category,
        sel: Object.fromEntries(active.filter(o => sel[o.id] != null && String(sel[o.id]).trim()).map(o => [o.id, String(sel[o.id]).trim()])),
        spec: active.filter(o => sel[o.id] != null && String(sel[o.id]).trim()).map(o => ({ id: o.id, label: o.label, value: String(sel[o.id]).trim(), kind: o.type })),
        hex: colorHex(),
        qty,
        ac: acDef ? { plan: ac.plan, billing: '' } : null,
        engraving: product.engraving && engraveOn ? engraving.trim() : '',
        notes: notes.trim(),
        country: existing && !depChanged ? existing.country : country,
        depends,
      };
      if (existing) S.items[S.items.indexOf(existing)] = item;
      else S.items.push(item);
      save();
      // Sheet slides away, the card's badge pops, the art flies to the bag, then the count bumps.
      const src = existing ? null : document.querySelector(`.product[data-pid="${CSS.escape(product.id)}"] .art`);
      if (!existing) sheet.dlg.addEventListener('close', () => flyToBag(src, item.hex, () => { bumpBagCount(); toast(`${product.name} added to your bag.`); }), { once: true });
      sheet.close();
      paintBag(false, item.id);
      if (existing) toast('Bag updated.');
    });
  }

  function openCustomItem(editId) {
    if (atLineLimit(editId)) return;
    const existing = editId ? S.items.find(i => i.id === editId) : null;
    const v = {
      name: existing ? existing.name : '',
      details: existing ? ((existing.spec || [])[0] || {}).value || '' : '',
      link: existing ? existing.link || '' : '',
    };
    let qty = existing ? existing.qty : 1;
    const errs = new Map();
    const sheet = openSheet({ title: existing ? 'Edit item' : 'Something else', sub: 'Describe anything that isn’t listed.', art: art('other'), small: true });
    const paint = () => {
      sheet.body.replaceChildren(
        h('div', { class: 'stack pt-3' },
          textField({ key: 'c.name', label: 'Product name', value: v.name, errs, maxlength: 120, onInput: x => { v.name = x; } }),
          textField({ key: 'c.details', label: 'Details (model, color, size, storage…)', textarea: true, value: v.details, errs, maxlength: 600, onInput: x => { v.details = x; } }),
          textField({ key: 'c.link', label: 'Link to the product', type: 'url', inputmode: 'url', value: v.link, errs, optional: true, maxlength: 400, spellcheck: false, autocapitalize: 'off', onInput: x => { v.link = x; } })),
        qtyControl(() => qty, x => { qty = x; }));
    };
    paint();
    const btn = h('button', { class: 'btn', type: 'button', text: existing ? 'Save Changes' : 'Add to Bag' });
    sheet.foot.append(btn);
    btn.addEventListener('click', () => {
      errs.clear();
      if (!v.name.trim()) errs.set('c.name', 'Enter the product name.');
      if (!v.details.trim()) errs.set('c.details', 'Add a few details so the right thing gets ordered.');
      if (v.link.trim() && !/^https?:\/\/\S+\.\S+/i.test(v.link.trim())) errs.set('c.link', 'Enter a full link starting with https://, or leave it blank.');
      checkSensitive(errs, 'c.name', v.name);
      checkSensitive(errs, 'c.details', v.details);
      if (errs.size) { paint(); const f = sheet.body.querySelector('.invalid input, .invalid textarea'); if (f) f.focus(); return; }
      const item = {
        id: existing ? existing.id : newId(), pid: '', custom: true, name: v.name.trim(), cat: 'other',
        sel: {}, spec: [{ id: 'details', label: 'Details', value: v.details.trim(), kind: 'tiles' }],
        link: v.link.trim(), qty, ac: null, engraving: '', notes: '', country: S.country, hex: '',
      };
      if (existing) S.items[S.items.indexOf(existing)] = item;
      else S.items.push(item);
      save();
      const src = existing ? null : document.querySelector('#product-other .art');
      if (!existing) sheet.dlg.addEventListener('close', () => flyToBag(src, '', () => { bumpBagCount(); toast(`${item.name} added to your bag.`); }), { once: true });
      sheet.close();
      paintBag(false, item.id);
      if (existing) toast('Bag updated.');
    });
  }

  function editItem(item) {
    if (item.custom) return openCustomItem(item.id);
    const p = PRODUCT.get(item.pid);
    if (!p) { toast('That product is no longer listed. Remove it and add it again.'); return; }
    openConfigurator(p, item.id);
  }
  function removeItem(item) {
    const i = S.items.indexOf(item);
    if (i < 0) return;
    const a = document.activeElement;
    const root = a && a.closest ? a.closest('dialog, #bag-panel') : null;
    S.items.splice(i, 1);
    save();
    paintBag(false);
    toast(`${item.name} removed.`, {
      action: 'Undo',
      onAction: () => {
        if (S.items.includes(item)) return;
        S.items.splice(Math.min(i, S.items.length), 0, item);
        save();
        paintBag(true, item.id);
        // The first visible Edit for this row (the desktop aside is hidden on phones).
        const back = Array.from(document.querySelectorAll(`[data-act="edit"][data-id="${CSS.escape(item.id)}"]`)).find(el => el.getClientRects().length);
        if (back) back.focus({ preventScroll: true });
      },
    });
    // Keep keyboard focus in the list: the next Remove button, or the list's heading.
    // (On phones the aside is hidden, so removal happens in the bag sheet or on Review.)
    if (root && root.isConnected) {
      const btns = root.querySelectorAll('.bag-item .link-btn.danger');
      let next = btns[Math.min(i, btns.length - 1)] || root.querySelector('h2');
      if (next && !next.getClientRects().length) next = document.querySelector('#main .step-title'); // panel hidden when empty on phones
      if (next) { if (next.tagName === 'H2') next.tabIndex = -1; next.focus({ preventScroll: true }); }
    }
  }

  /* --------------------------------------------------------------- bag */

  function bagList(opts) {
    if (!S.items.length) return h('p', { class: 'bag-empty', text: 'Your bag is empty.' });
    const ul = h('ul', { class: 'bag-list' });
    for (const item of S.items) {
      const p = PRODUCT.get(item.pid);
      ul.append(h('li', { class: 'bag-item', dataset: { id: item.id } },
        art(item.custom ? 'other' : artKey(p || { category: item.cat, name: item.name }), item.hex),
        h('div', null,
          h('div', { class: 'bag-item-name', text: item.qty > 1 ? `${item.name} × ${item.qty}` : item.name }),
          itemLines(item).map(l => h('div', { class: 'bag-item-meta', text: l })),
          opts && opts.readonly ? null : h('div', { class: 'bag-item-actions' },
            h('button', {
              class: 'link-btn', type: 'button', text: 'Edit', 'aria-label': `Edit ${item.name}`, dataset: { act: 'edit', id: item.id },
              onclick: () => { const run = () => editItem(item); if (opts && opts.onAction) opts.onAction(run); else run(); },
            }),
            h('button', { class: 'link-btn danger', type: 'button', text: 'Remove', 'aria-label': `Remove ${item.name}`, dataset: { act: 'remove', id: item.id }, onclick: () => removeItem(item) })))));
    }
    return ul;
  }

  let bagSheet = null;
  function openBag() {
    bagSheet = openSheet({ title: 'Your bag', sub: ' ', small: true, onClose: () => { bagSheet = null; } });
    const paint = () => {
      const sub = bagSheet.head.querySelector('p');
      if (sub) sub.textContent = S.items.length ? plural(totalQty(), 'item') : '';
      // Edit from here opens the configurator once this sheet has finished closing.
      bagSheet.body.replaceChildren(h('div', { class: 'pt-2' }, bagList({ onAction: run => {
        if (!bagSheet) { run(); return; }
        bagSheet.dlg.addEventListener('close', run, { once: true });
        bagSheet.close();
      } })));
    };
    paint();
    bagSheet.paint = paint;
    const cur = currentStep();
    const toReview = S.maxStep >= STEPS.length - 1;
    const btn = cur === 0
      ? h('button', { class: 'btn', type: 'button', text: toReview ? 'Review Request' : 'Continue', onclick: () => { bagSheet.close(); next(toReview ? STEPS.length - 1 : undefined); } })
      : h('button', { class: 'btn secondary', type: 'button', text: 'Done', onclick: () => bagSheet.close() });
    bagSheet.foot.append(btn);
  }

  const totalQty = () => S.items.reduce((n, i) => n + (i.qty || 1), 0);

  const replay = (el, cls) => { if (!el) return; el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); };
  function bumpBagCount() {
    replay(document.getElementById('bag-count'), 'bump');
    replay(document.getElementById('bag-button'), 'pulse');
  }
  // Decoration: a copy of the product art arcs from its card into the bag button.
  // Skipped (and `done` runs at once) without the Web Animations API or with reduced motion.
  function flyToBag(from, hex, done) {
    const to = document.getElementById('bag-button');
    if (!from || !to || typeof from.animate !== 'function' || reduceMotion() || document.visibilityState === 'hidden' || !from.getClientRects().length) { done(); return; }
    const a = from.getBoundingClientRect(), b = to.getBoundingClientRect();
    if (!a.width || !b.width) { done(); return; }
    const ghost = from.cloneNode(true);
    ghost.className = 'art fly';
    if (hex) ghost.style.setProperty('--art-fill', hex);
    Object.assign(ghost.style, { position: 'fixed', left: a.left + 'px', top: a.top + 'px', width: a.width + 'px', height: a.height + 'px', margin: '0', zIndex: '60', pointerEvents: 'none' });
    document.body.append(ghost);
    const dx = b.left + b.width / 2 - (a.left + a.width / 2);
    const dy = b.top + b.height / 2 - (a.top + a.height / 2);
    const anim = ghost.animate([
      { transform: 'none', opacity: 1 },
      { transform: `translate(${dx * 0.5}px, ${dy * 0.5 - 40}px) scale(0.7)`, opacity: 1, offset: 0.5 },
      { transform: `translate(${dx}px, ${dy}px) scale(0.2)`, opacity: 0.3 },
    ], { duration: 520, easing: 'cubic-bezier(0.28, 0.11, 0.32, 1)', fill: 'forwards' });
    let ended = false;
    const end = () => { if (ended) return; ended = true; ghost.remove(); done(); };
    anim.finished.then(end, end);
    setTimeout(end, 800);
  }

  function paintBag(bump, addedId) {
    const count = document.getElementById('bag-count');
    if (count) count.textContent = S.items.length ? String(totalQty()) : '';
    if (bump) bumpBagCount();
    const btn = document.getElementById('bag-button');
    if (btn) btn.setAttribute('aria-label', S.items.length ? `Bag, ${plural(totalQty(), 'item')}` : 'Bag, empty');
    const panel = document.getElementById('bag-panel');
    if (panel) {
      setKids(panel, bagPanelContent());
      panel.parentElement.classList.toggle('empty', !S.items.length);
    }
    document.querySelectorAll('[data-pid]').forEach(el => {
      const inBag = S.items.some(i => i.pid === el.dataset.pid);
      const badge = el.querySelector('.product-in-bag');
      if (inBag && !badge) el.append(h('span', { class: 'product-in-bag pop', title: 'In your bag' }, icon('check')));
      if (!inBag && badge) badge.remove();
    });
    if (bagSheet && bagSheet.paint) bagSheet.paint();
    const reviewBag = document.getElementById('review-bag');
    if (reviewBag) setKids(reviewBag, bagList({ readonly: true }));
    if (addedId) {
      // Highlight the new or updated row wherever the bag is shown, and keep it in view in the aside.
      document.querySelectorAll(`.bag-item[data-id="${CSS.escape(addedId)}"]`).forEach(row => {
        row.classList.add('just-added');
        row.addEventListener('animationend', () => row.classList.remove('just-added'), { once: true });
      });
      const row = panel && panel.querySelector(`.bag-item[data-id="${CSS.escape(addedId)}"]`);
      if (row && row.getClientRects().length) row.scrollIntoView({ block: 'nearest', behavior: smooth() });
    }
    paintActionbar();
  }

  function bagPanelContent() {
    return [
      h('div', { class: 'bag-title-row' },
        h('h2', { class: 'section-title', text: 'Your bag' }),
        S.items.length ? h('span', { class: 'bag-item-meta', text: plural(totalQty(), 'item') }) : null),
      bagList(),
    ];
  }

  /* ------------------------------------------------------- step: products */

  const UI = { cat: (CATEGORIES[0] || {}).id || '', q: '' };

  function productCard(p) {
    const hex = firstHex(p);
    const card = h('button', { class: 'product', type: 'button', dataset: { pid: p.id }, onclick: () => openConfigurator(p) },
      art(artKey(p), hex),
      p.isNew ? h('span', { class: 'product-new', text: 'New' }) : null,
      h('span', { class: 'product-name', text: p.name }),
      p.blurb ? h('span', { class: 'product-blurb', text: p.blurb }) : null,
      soldIn(p, S.country) ? null : h('span', { class: 'product-blurb muted', text: `Not sold in ${countryName(S.country)}` }));
    if (S.items.some(i => i.pid === p.id)) card.append(h('span', { class: 'product-in-bag', title: 'In your bag' }, icon('check')));
    return card;
  }
  function otherCard() {
    return h('button', { class: 'product other', id: 'product-other', type: 'button', onclick: () => openCustomItem() },
      art('other'),
      h('span', { class: 'product-name', text: 'Something else' }),
      h('span', { class: 'product-blurb', text: 'Can’t find it? Describe it.' }));
  }

  function renderProducts() {
    const grid = h('div');
    // Result counts live here so screen readers hear them; empty (and zero-height) while browsing.
    const status = h('p', { class: 'group-title search-status', role: 'status', 'aria-live': 'polite' });
    const catBar = h('div', { class: 'cats', role: 'tablist', 'aria-label': 'Product categories' });
    const searchInput = h('input', { type: 'search', placeholder: 'Search products', 'aria-label': 'Search products', value: UI.q, autocomplete: 'off', enterkeyhint: 'search' });
    const clearBtn = h('button', { class: 'search-clear', type: 'button', 'aria-label': 'Clear search', hidden: !UI.q }, icon('close'));
    let qTimer = 0;

    // One sliding surface under the selected tab (.cats::before), placed from layout.
    function placeIndicator() {
      const sel = catBar.querySelector('[aria-selected="true"]');
      catBar.classList.toggle('no-sel', !sel);
      if (!sel || !sel.offsetWidth) return; // not laid out yet: wait for the observer
      const first = !catBar.classList.contains('placed');
      if (first) catBar.classList.add('no-anim');
      catBar.style.setProperty('--ind-x', sel.offsetLeft + 'px');
      catBar.style.setProperty('--ind-w', sel.offsetWidth + 'px');
      catBar.classList.add('placed'); // until then the selected tab styles itself
      if (first) requestAnimationFrame(() => catBar.classList.remove('no-anim'));
    }
    // The tabs are built once; selecting only toggles attributes, so typing never rebuilds them.
    const tabs = CATEGORIES.map((c, i) => h('button', {
      class: 'cat', type: 'button', role: 'tab', id: 'tab-' + c.id, 'aria-controls': 'products-panel', 'aria-selected': 'false', tabindex: '-1',
      onclick: () => selectCat(i, true),
      onkeydown: e => {
        const to = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? CATEGORIES.length - 1 : null;
        if (to == null || !CATEGORIES[to]) return;
        e.preventDefault();
        selectCat(to, true);
        tabs[to].scrollIntoView({ block: 'nearest', inline: 'nearest' });
      },
    }, art(CATEGORY_ART[c.id] || 'bag'), h('span', { text: c.name })));
    catBar.append(...tabs);
    function syncCats() {
      tabs.forEach((b, i) => {
        const selected = !UI.q && UI.cat === CATEGORIES[i].id;
        b.setAttribute('aria-selected', selected ? 'true' : 'false');
        b.tabIndex = selected || (UI.q && i === 0) ? 0 : -1;
      });
      placeIndicator();
    }
    function selectCat(i, focus) {
      clearTimeout(qTimer);
      UI.cat = CATEGORIES[i].id; UI.q = ''; searchInput.value = ''; clearBtn.hidden = true;
      syncCats(); paintGrid();
      if (focus) tabs[i].focus({ preventScroll: true });
    }
    function paintGrid() {
      const frag = document.createDocumentFragment();
      const q = UI.q.trim().toLowerCase();
      if (q) {
        const terms = q.split(/\s+/);
        const hits = PRODUCTS.filter(p => {
          const hay = `${p.name} ${p.blurb || ''} ${p.group || ''} ${CATEGORY_NAME.get(p.category) || ''}`.toLowerCase();
          return terms.every(t => hay.includes(t));
        });
        status.textContent = hits.length ? `${plural(hits.length, 'result')} for “${UI.q.trim()}”` : `No matches for “${UI.q.trim()}”`;
        if (!hits.length) frag.append(h('p', { class: 'empty-search', text: 'Try another name, or add it as “Something else”.' }));
        frag.append(h('div', { class: 'products' }, hits.map(productCard), otherCard()));
        grid.replaceChildren(frag);
        return;
      }
      status.textContent = '';
      const list = PRODUCTS.filter(p => p.category === UI.cat);
      const groups = [];
      for (const p of list) {
        const g = p.group || '';
        let entry = groups.find(x => x.name === g);
        if (!entry) groups.push(entry = { name: g, items: [] });
        entry.items.push(p);
      }
      groups.forEach((g, i) => {
        if (g.name && groups.length > 1) frag.append(h('h2', { class: 'group-title', text: g.name }));
        const box = h('div', { class: 'products' }, g.items.map(productCard));
        if (i === groups.length - 1) box.append(otherCard());
        frag.append(box);
      });
      if (!groups.length) frag.append(h('div', { class: 'products' }, otherCard()));
      grid.replaceChildren(frag);
    }
    const applySearch = () => { syncCats(); paintGrid(); };
    // A short debounce keeps fast typing smooth; clearing the field shows the category again at once.
    searchInput.addEventListener('input', () => {
      UI.q = searchInput.value;
      clearBtn.hidden = !UI.q;
      clearTimeout(qTimer);
      if (!UI.q.trim()) { applySearch(); return; }
      qTimer = setTimeout(applySearch, 120);
    });
    searchInput.addEventListener('keydown', e => { if (e.key === 'Enter') { clearTimeout(qTimer); applySearch(); } });
    clearBtn.addEventListener('click', () => { clearTimeout(qTimer); UI.q = ''; searchInput.value = ''; clearBtn.hidden = true; applySearch(); searchInput.focus(); });
    syncCats();
    paintGrid();
    // The step is built before it's attached, so measure once it has layout (and whenever it reflows).
    if (typeof ResizeObserver === 'function') new ResizeObserver(() => placeIndicator()).observe(catBar);
    requestAnimationFrame(placeIndicator);
    setTimeout(placeIndicator, 0); // frames don't run in a hidden tab; a timer still does

    return h('div', { class: 'step' },
      stepHead(stepEyebrow(0), 'What would you like?', 'Choose products and configure them the way you would in an Apple Store. Add as many as you need.'),
      h('div', { class: 'shop' },
        h('aside', { class: 'shop-aside' + (S.items.length ? '' : ' empty') }, h('div', { class: 'card', id: 'bag-panel' }, ...bagPanelContent())),
        h('div', null,
          h('div', { class: 'search' }, icon('search'), searchInput, clearBtn),
          catBar,
          h('div', { role: 'tabpanel', id: 'products-panel', 'aria-label': 'Products' }, status, grid))));
  }

  /* ------------------------------------------------------- step: trade-in */

  const DEVICE_TYPES = [
    { value: 'iPhone', art: 'phone' }, { value: 'iPad', art: 'tablet' }, { value: 'Mac', art: 'laptop' },
    { value: 'Apple Watch', art: 'watch' }, { value: 'Other', art: 'other' },
  ];
  const blankDevice = () => ({ id: newId(), type: '', model: '', serial: '', works: '', damage: '' });

  function renderTradeIn() {
    const t = S.tradeIn;
    const list = h('div');
    const countries = PROGRAMS.tradeInCountries;
    const unavailable = Array.isArray(countries) && countries.length && !countries.includes(S.country);

    function paintDevices() {
      list.replaceChildren();
      if (t.has !== 'yes') return;
      t.devices.forEach((d, i) => {
        const card = h('div', { class: 'card device' },
          h('div', { class: 'device-head' },
            h('h2', { text: t.devices.length > 1 ? `Device ${i + 1}` : 'Your device' }),
            h('button', {
              class: 'link-btn danger', type: 'button', text: 'Remove', 'aria-label': `Remove device ${i + 1}`, onclick: () => {
                t.devices.splice(i, 1);
                ERR = new Map(); // errors are keyed by position
                save();
                if (!t.devices.length) { t.has = 'no'; rerender(); } else paintDevices();
                const btns = document.querySelectorAll('main .device .link-btn.danger');
                const f = btns[Math.min(i, btns.length - 1)] || document.querySelector('[data-field="ti.has"] input:checked');
                if (f) f.focus();
              },
            })),
          h('div', { class: 'stack' },
            choiceGroup({ key: `ti.${i}.type`, legend: 'What is it?', value: d.type, choices: DEVICE_TYPES.map(x => ({ value: x.value, art: x.art })), onChange: v => { d.type = v; save(); } }),
            textField({ key: `ti.${i}.model`, label: 'Model', placeholder: 'e.g. iPhone 13 mini 128GB', value: d.model, maxlength: 80, onInput: v => { d.model = v; save(); } }),
            textField({
              key: `ti.${i}.serial`, label: 'Serial number or IMEI', value: d.serial, maxlength: 24, autocapitalize: 'characters', spellcheck: false,
              hint: 'On iPhone or iPad: Settings > General > About. On Mac: Apple menu > About This Mac. On Apple Watch: Settings > General > About.',
              onInput: v => { d.serial = v; save(); },
            }),
            choiceGroup({ key: `ti.${i}.works`, legend: 'Does it turn on and work normally?', value: d.works, cols: 2, choices: [{ value: 'Yes' }, { value: 'No' }], onChange: v => { d.works = v; save(); } }),
            choiceGroup({ key: `ti.${i}.damage`, legend: 'Any cracks, dents, or liquid damage?', value: d.damage, cols: 2, choices: [{ value: 'No' }, { value: 'Yes' }], onChange: v => { d.damage = v; save(); } })));
        list.append(card);
      });
      if (t.devices.length < CFG.maxTradeIns) {
        list.append(h('p', { class: 'mt-4 mb-0' },
          h('button', {
            class: 'link-btn', type: 'button', text: 'Add Another Device', onclick: () => {
              t.devices.push(blankDevice()); save(); paintDevices();
              const cards = list.querySelectorAll('.device');
              const f = cards.length && cards[cards.length - 1].querySelector('input');
              if (f) f.focus();
            },
          })));
      }
      list.append(h('div', { class: 'mt-5' },
        note('Before you hand it over: back it up, sign out of your Apple Account, and turn off Find My. Final credit depends on Apple’s inspection.')));
    }
    paintDevices();

    return h('div', { class: 'step narrow' },
      stepHead(stepEyebrow(1), 'Trading anything in?', 'Trade-in credit can lower the price of your new device. If you’re not trading anything in, choose No.'),
      h('div', { class: 'card' },
        choiceGroup({
          key: 'ti.has', legend: 'Do you have a device to trade in?', value: t.has, cols: 2,
          choices: [{ value: 'no', label: 'No' }, { value: 'yes', label: 'Yes' }],
          onChange: v => {
            t.has = v;
            if (v === 'yes' && !t.devices.length) t.devices.push(blankDevice());
            save(); paintDevices();
          },
        }),
        unavailable ? h('div', { class: 'mt-4' }, note(`Apple Trade In may not be available in ${countryName(S.country)}. You’ll hear back if it isn’t.`, 'warn')) : null),
      h('div', { class: 'mt-4' }, list));
  }

  /* ----------------------------------------------------------- step: you */

  function contactChoices() {
    return listFor(CFG.contactMethods, S.country).map(c => ({ value: c.value, label: c.label || c.value }));
  }

  function dialField(get, set, key) {
    const id = fid(key);
    const cur = get();
    const display = h('div', { class: 'fake', text: `+${cur.dial}` });
    const sel = h('select', { id, class: 'overlay', 'aria-label': 'Country calling code', autocomplete: 'tel-country-code' });
    for (const c of COUNTRIES) if (c.dial) sel.append(h('option', { value: c.code, text: `${c.name} (+${c.dial})` }));
    sel.value = cur.dialCountry && COUNTRY.has(cur.dialCountry) ? cur.dialCountry : S.country;
    sel.addEventListener('change', () => {
      const c = COUNTRY.get(sel.value);
      if (!c) return;
      set({ dial: c.dial, dialCountry: c.code });
      display.textContent = `+${c.dial}`;
    });
    return h('div', { class: 'field filled' }, h('div', { class: 'field-control' }, display, h('label', { class: 'float', for: id, text: 'Code' }), sel, icon('chevron')));
  }

  function renderYou() {
    const y = S.you;
    return h('div', { class: 'step narrow' },
      stepHead(stepEyebrow(2), 'Your details.', 'Use your name exactly as it appears on your photo ID. It’s checked at pickup.'),
      h('div', { class: 'card stack' },
        h('div', { class: 'row cols-2' },
          textField({ key: 'you.first', label: 'First name', value: y.first, autocomplete: 'given-name', maxlength: NAME_MAX, onInput: v => { y.first = v; save(); } }),
          textField({ key: 'you.last', label: 'Last name', value: y.last, autocomplete: 'family-name', maxlength: NAME_MAX, onInput: v => { y.last = v; save(); } })),
        textField({ key: 'you.email', label: 'Email', type: 'email', inputmode: 'email', autocomplete: 'email', spellcheck: false, autocapitalize: 'off', maxlength: 120, value: y.email, hint: 'Your confirmation and updates go here.', onInput: v => { y.email = v; save(); } }),
        h('div', { class: 'phone-row' },
          dialField(() => y, patch => { Object.assign(y, patch); save(); }, 'you.dial'),
          textField({ key: 'you.phone', label: 'Phone number', type: 'tel', inputmode: 'tel', autocomplete: 'tel-national', maxlength: 24, value: y.phone, onInput: v => { y.phone = v; save(); } }))),
      h('div', { class: 'card mt-4' },
        choiceGroup({ key: 'you.contact', legend: 'Best way to reach you', value: y.contact, choices: contactChoices(), onChange: v => { y.contact = v; save(); } })));
  }

  /* ------------------------------------------------------ step: delivery */

  function storeOptions(code) {
    const list = (STORES[code] || []).slice();
    const c = COUNTRY.get(code) || {};
    const stateName = new Map((c.states || []).map(([v, l]) => [v, l]));
    // City first so typing a city in the picker jumps to it; the stored value keeps Apple's full name.
    const short = s => s.name.replace(/^Apple\s+/, '');
    const label = s => (s.city && short(s).toLowerCase() !== s.city.toLowerCase() ? `${s.city} — ${short(s)}` : short(s))
      + (s.status === 'temporarilyClosed' ? ' (temporarily closed)' : '');
    const value = s => (s.city && !s.name.toLowerCase().includes(s.city.toLowerCase()) ? `${s.name}, ${s.city}` : s.name);
    const hasRegions = list.length > 12 && list.some(s => s.region);
    if (!hasRegions) {
      return list.sort((a, b) => (a.city || '').localeCompare(b.city || '') || a.name.localeCompare(b.name)).map(s => ({ value: value(s), label: label(s) }));
    }
    const groups = new Map();
    for (const s of list) {
      const g = stateName.get(s.region) || s.region || 'Other';
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(s);
    }
    return Array.from(groups.keys()).sort().map(g => ({
      group: g,
      options: groups.get(g).sort((a, b) => (a.city || '').localeCompare(b.city || '') || a.name.localeCompare(b.name)).map(s => ({ value: value(s), label: label(s) })),
    }));
  }

  function countrySelect(key, onChange) {
    const field = selectField({
      key, label: 'Country or region', value: S.country, autocomplete: 'country',
      options: COUNTRIES.map(c => ({ value: c.code, label: c.name })),
      onChange,
    });
    field._select.addEventListener('blur', () => { if (field._select.value !== S.country) applyDeliveryCountry(field._select.value); });
    return field;
  }

  let countryTimer = 0;
  function applyDeliveryCountry(v) {
    clearTimeout(countryTimer);
    if (v === S.country) return;
    const sel = document.getElementById('f-del-country');
    const hadFocus = sel && document.activeElement === sel;
    setCountry(v); rerender(); paintHeader();
    const next = document.getElementById('f-del-country');
    if (hadFocus && next) next.focus({ preventScroll: true });
  }

  function setCountry(code) {
    if (!COUNTRY.has(code) || code === S.country) return;
    const c = COUNTRY.get(code);
    const old = S.country;
    S.country = code;
    if (!phoneDigits(S.you.phone)) { S.you.dial = c.dial || S.you.dial; S.you.dialCountry = code; }
    if (!S.pay.giftAmount && !S.pay.budget && c.currency) S.pay.currency = c.currency;
    // Stores and address formats are per country. Remember what was typed for
    // the old country, and bring it back if they switch back.
    const d = S.delivery;
    d.addrBy = Object.assign({}, d.addrBy, { [old]: d.addr, [old + ':store']: { store: d.store, storeOther: d.storeOther } });
    const kept = d.addrBy[code + ':store'] || {};
    d.store = kept.store || '';
    d.storeOther = kept.storeOther || '';
    d.addr = d.addrBy[code] ? Object.assign({}, d.addrBy[code]) : { address1: d.addr.address1, address2: d.addr.address2 };
    if (S.delivery.method === 'pickup' && !(STORES[code] || []).length) S.delivery.method = '';
    save();
  }

  function addressFields() {
    const d = S.delivery;
    const spec = addressSpec(S.country);
    const box = h('div', { class: 'stack' });
    const auto = { address1: 'address-line1', address2: 'address-line2', sublocality: 'address-level3', city: 'address-level2', state: 'address-level1', postal: 'postal-code', sorting: 'off' };
    for (const row of spec.rows) {
      const cells = row.map(f => {
        const key = `addr.${f}`;
        const optional = !spec.required.has(f);
        if (f === 'state' && spec.states && spec.states.length) {
          return selectField({
            key, label: spec.labels.state, value: d.addr.state || '', autocomplete: auto.state, optional,
            options: spec.states.map(([v, l]) => ({ value: v, label: l })),
            onChange: v => { d.addr.state = v; save(); },
          });
        }
        return textField({
          key, label: spec.labels[f], value: d.addr[f] || '', autocomplete: auto[f], optional, maxlength: f === 'postal' ? 16 : 120,
          autocapitalize: f === 'postal' ? 'characters' : null, placeholder: f === 'postal' && spec.zipEx ? spec.zipEx.split(',')[0] : ' ',
          onInput: v => { d.addr[f] = v; save(); },
        });
      });
      box.append(cells.length > 1 ? h('div', { class: 'row ' + (cells.length === 3 ? 'cols-3' : 'cols-2') }, cells) : cells[0]);
    }
    return box;
  }

  function renderDelivery() {
    const d = S.delivery;
    const stores = STORES[S.country] || [];
    const details = h('div');

    function paintDetails() {
      details.replaceChildren();
      if (d.method === 'pickup') {
        const otherOpt = { value: '__other', label: 'Another store (type it in)' };
        const opts = storeOptions(S.country);
        // A store saved by an older version may use a different value; match it
        // up, or show it as typed so what's sent is what's on screen.
        if (d.store && d.store !== '__other') {
          const values = opts.flatMap(o => (o.group ? o.options : [o])).map(o => o.value);
          if (!values.includes(d.store)) {
            const match = values.find(v => v === d.store || v.startsWith(d.store + ','));
            if (match) d.store = match;
            else { d.storeOther = d.store; d.store = '__other'; }
            save();
          }
        }
        details.append(h('div', { class: 'card stack mt-4' },
          h('h2', { class: 'section-title', text: 'Pickup' }),
          selectField({
            key: 'del.store', label: 'Apple Store', value: d.store, placeholder: 'Choose a store',
            options: opts.concat([otherOpt]),
            onChange: v => {
              const toggled = (d.store === '__other') !== (v === '__other');
              d.store = v;
              if (v !== '__other') d.storeOther = '';
              save();
              if (toggled) paintDetails(); // don't rebuild the select while someone types a city
            },
          }),
          d.store === '__other' ? textField({ key: 'del.storeOther', label: 'Store name and city', value: d.storeOther, maxlength: 120, onInput: v => { d.storeOther = v; save(); } }) : null,
          textField({ key: 'del.date', label: 'Preferred pickup date', type: 'date', min: todayISO(), value: d.date, optional: true, hint: 'Pickup times depend on stock. You’ll get a confirmed time.', onInput: v => { d.date = v; save(); } }),
          h('div', { class: 'mt-6' },
            choiceGroup({
              key: 'del.pickupBy', legend: 'Who’s picking it up?', value: d.pickupBy, cols: 2,
              choices: [{ value: 'me', label: 'I am' }, { value: 'other', label: 'Someone else' }],
              onChange: v => { d.pickupBy = v; save(); paintDetails(); },
            })),
          d.pickupBy === 'other' ? h('div', { class: 'stack' },
            h('div', { class: 'row cols-2' },
              textField({ key: 'del.altFirst', label: 'Their first name', value: d.altFirst, maxlength: NAME_MAX, onInput: v => { d.altFirst = v; save(); } }),
              textField({ key: 'del.altLast', label: 'Their last name', value: d.altLast, maxlength: NAME_MAX, onInput: v => { d.altLast = v; save(); } })),
            textField({ key: 'del.altEmail', label: 'Their email', type: 'email', inputmode: 'email', spellcheck: false, autocapitalize: 'off', value: d.altEmail, maxlength: 120, hint: 'Apple sends them pickup instructions.', onInput: v => { d.altEmail = v; save(); } })) : null,
          note('Bring a photo ID that matches the pickup name exactly.')));
      }
      if (d.method === 'delivery') {
        const you = `${S.you.first} ${S.you.last}`.trim();
        details.append(h('div', { class: 'card stack mt-4' },
          h('h2', { class: 'section-title', text: 'Delivery address' }),
          choiceGroup({
            key: 'del.recipient', legend: 'Who’s it for?', value: d.recipient, cols: 2,
            choices: [{ value: 'me', label: you ? `Me (${you})` : 'Me' }, { value: 'other', label: 'Someone else' }],
            onChange: v => { d.recipient = v; save(); paintDetails(); },
          }),
          d.recipient === 'other' ? h('div', { class: 'stack' },
            h('div', { class: 'row cols-2' },
              textField({ key: 'del.recFirst', label: 'Recipient first name', value: d.recFirst, maxlength: NAME_MAX, onInput: v => { d.recFirst = v; save(); } }),
              textField({ key: 'del.recLast', label: 'Recipient last name', value: d.recLast, maxlength: NAME_MAX, onInput: v => { d.recLast = v; save(); } })),
            textField({ key: 'del.recPhone', label: 'Recipient phone', type: 'tel', inputmode: 'tel', value: d.recPhone, optional: true, maxlength: 24, hint: 'Include the country code if it’s different from yours.', onInput: v => { d.recPhone = v; save(); } })) : null,
          addressFields(),
          textField({ key: 'del.instructions', label: 'Delivery instructions', textarea: true, optional: true, maxlength: 300, value: d.instructions, onInput: v => { d.instructions = v; save(); } })));
      }
    }

    const methodChoices = [
      {
        value: 'pickup', label: 'Pick up at an Apple Store',
        detail: stores.length ? `${plural(stores.length, 'store')} in ${countryName(S.country)}` : `No Apple Stores in ${countryName(S.country)}`,
        disabled: !stores.length,
      },
      { value: 'delivery', label: 'Deliver it', detail: 'Shipped to an address you choose' },
    ];

    paintDetails();
    const online = !ONLINE.size || ONLINE.has(S.country);
    return h('div', { class: 'step narrow' },
      stepHead(stepEyebrow(3), 'How do you want to get it?', 'Pick up at an Apple Store or have it delivered.'),
      h('div', { class: 'card stack' },
        countrySelect('del.country', v => {
          // Keyboard type-ahead fires a change per letter; wait until it settles
          // so the select isn't rebuilt mid-word.
          clearTimeout(countryTimer);
          countryTimer = setTimeout(() => applyDeliveryCountry(v), 700);
        }),
        !online ? note(`Apple doesn’t have an online store in ${countryName(S.country)}. You’ll hear back about what’s possible.`, 'warn') : null,
        h('div', { class: 'mt-6' },
          choiceGroup({ key: 'del.method', legend: 'Pickup or delivery', value: d.method, cols: 1, choices: methodChoices, onChange: v => { d.method = v; save(); paintDetails(); } }))),
      details,
      h('div', { class: 'card mt-4' },
        textField({ key: 'del.neededBy', label: 'Need it by', type: 'date', min: todayISO(), optional: true, value: d.neededBy, hint: 'Only if there’s a date that matters, like a birthday.', onInput: v => { d.neededBy = v; save(); } })));
  }

  /* -------------------------------------------------------- step: review */

  function summaryCard(title, stepId, body, cls) {
    return h('section', { class: 'card review-card' + (cls ? ' ' + cls : '') },
      h('div', { class: 'review-card-head' },
        h('h2', { text: title }),
        h('button', { class: 'link-btn', type: 'button', text: 'Edit', 'aria-label': `Edit ${title}`, onclick: () => go(stepIndex(stepId)) })),
      body);
  }
  function kv(pairs) {
    const dl = h('dl', { class: 'kv' });
    for (const [k, v] of pairs) if (v) dl.append(h('dt', { text: k }), h('dd', { text: v }));
    return dl;
  }
  function fulfillmentText() {
    const d = S.delivery;
    if (d.method === 'pickup') {
      const store = d.store === '__other' ? d.storeOther.trim() : d.store;
      return [
        ['Method', 'Pickup'],
        ['Store', store],
        ['Preferred date', formatDate(d.date)],
        ['Picked up by', d.pickupBy === 'other' ? `${d.altFirst.trim()} ${d.altLast.trim()} (${d.altEmail.trim()})` : `${S.you.first.trim()} ${S.you.last.trim()}`],
      ];
    }
    if (d.method === 'delivery') {
      const name = d.recipient === 'other' ? `${d.recFirst.trim()} ${d.recLast.trim()}` : `${S.you.first.trim()} ${S.you.last.trim()}`;
      return [
        ['Method', 'Delivery'],
        ['Address', formatAddress(S.country, d.addr, name)],
        ['Recipient phone', d.recipient === 'other' ? d.recPhone.trim() : ''],
        ['Instructions', d.instructions.trim()],
      ];
    }
    return [];
  }

  let SUBMIT_ERROR = null;

  function renderReview() {
    const p = S.pay;
    const payBox = h('div');
    function paintPay() {
      const methods = listFor(CFG.paymentMethods, S.country);
      setKids(payBox, 
        choiceGroup({ key: 'pay.method', legend: 'How will you pay?', value: p.method, choices: methods.map(m => ({ value: m.value, label: m.label || m.value, detail: m.detail })), onChange: v => { p.method = v; save(); paintPay(); } }),
        p.method === 'Other' ? h('div', { class: 'mt-4' }, textField({ key: 'pay.methodOther', label: 'Payment method', value: p.methodOther, maxlength: 72, onInput: v => { p.methodOther = v; save(); } })) : null,
        h('hr', { class: 'divider' }),
        choiceGroup({ key: 'pay.gift', legend: 'Using an Apple Gift Card?', value: p.gift, cols: 2, choices: [{ value: 'no', label: 'No' }, { value: 'yes', label: 'Yes' }], onChange: v => { p.gift = v; save(); paintPay(); } }),
        p.gift === 'yes' ? h('div', { class: 'stack mt-4' },
          h('div', { class: 'row cols-2' },
            textField({ key: 'pay.giftAmount', label: 'Total gift card balance', inputmode: 'decimal', value: p.giftAmount, maxlength: 12, onInput: v => { p.giftAmount = v; save(); } }),
            currencyField()),
          note('Don’t enter gift card codes here. You’ll be asked for them privately when the order is placed.', 'lock')) : null,
        CFG.askBudget ? h('div', { class: 'mt-7' },
          h('p', { class: 'choice-legend', text: 'Budget' }),
          h('p', { class: 'choice-help', text: 'If the final price comes in above this, you’ll be asked before anything is ordered.' }),
          h('div', { class: 'row cols-2' },
            textField({ key: 'pay.budget', label: 'Maximum total', inputmode: 'decimal', value: p.budget, optional: true, maxlength: 12, onInput: v => { p.budget = v; save(); } }),
            p.gift === 'yes' ? h('div') : currencyField())) : null);
    }
    function currencyField() {
      return selectField({ key: 'pay.currency', label: 'Currency', value: p.currency, options: CURRENCIES.map(c => ({ value: c, label: c })), onChange: v => { p.currency = v; save(); } });
    }
    paintPay();

    const ti = S.tradeIn.has === 'yes'
      ? S.tradeIn.devices.map((d, i) => kv([[S.tradeIn.devices.length > 1 ? `Device ${i + 1}` : 'Device', `${d.type} · ${d.model.trim()}`], ['Serial / IMEI', normSerial(d.serial)], ['Condition', `${d.works === 'Yes' ? 'Works normally' : 'Doesn’t work normally'}, ${d.damage === 'Yes' ? 'has damage' : 'no damage'}`]]))
      : h('p', { class: 'bag-item-meta', text: 'No trade-in' });

    const honeypot = h('input', { type: 'text', id: 'hp-website', name: 'website', tabindex: '-1', autocomplete: 'off', 'aria-hidden': 'true' });
    const hpWrap = h('div', { class: 'sr-only', 'aria-hidden': 'true' }, h('label', { for: 'hp-website', text: 'Website' }), honeypot);

    const errBox = h('div', { id: 'submit-error' });
    if (SUBMIT_ERROR) errBox.append(submitErrorCard(SUBMIT_ERROR));

    return h('div', { class: 'step' },
      stepHead(stepEyebrow(4), 'Review and send.', 'Check everything, then send your request. Nothing is ordered until you approve the final price.'),
      h('div', { class: 'review-grid' },
        h('section', { class: 'card span-2' },
          h('h2', { class: 'section-title', text: 'Payment' }),
          h('p', { class: 'section-sub', text: 'You’ll pay once you’ve approved the final price. Never send card numbers by message.' }),
          payBox),
        summaryCard('Products', 'products', h('div', { id: 'review-bag' }, bagList({ readonly: true })), 'span-2'),
        summaryCard('Trade-in', 'trade-in', ti),
        summaryCard('Your details', 'you', kv([
          ['Name', `${S.you.first.trim()} ${S.you.last.trim()}`],
          ['Email', S.you.email.trim()],
          ['Phone', fullPhone(S.you.dial, S.you.phone)],
          ['Contact via', S.you.contact],
        ])),
        summaryCard('Delivery', 'delivery', kv(fulfillmentText().concat([['Country', countryName(S.country)], ['Need it by', formatDate(S.delivery.neededBy)]])), 'span-2'),
        h('section', { class: 'card span-2' },
          h('h2', { class: 'section-title', text: 'Anything else?' }),
          textField({ key: 'notes', label: 'Notes', textarea: true, optional: true, maxlength: 1000, value: S.notes, onInput: v => { S.notes = v; save(); } })),
        (CFG.acknowledgements || []).length ? h('section', { class: 'card span-2' },
          (CFG.acknowledgements || []).map((text, i) => checkbox({ key: `ack.${i}`, label: text, checked: S.acks[i], onChange: v => { S.acks[i] = v; save(); } }))) : null),
      hpWrap,
      errBox,
      h('div', { class: 'mt-6' },
        note('Your details are sent over an encrypted connection to a private spreadsheet and are used only for this request.', 'lock')));
  }

  function submitErrorCard(err) {
    const summary = plainSummary();
    const actions = h('div', { class: 'btn-row' },
      h('button', { class: 'btn small', type: 'button', text: 'Try Again', onclick: () => submit() }),
      h('button', {
        class: 'btn small secondary', type: 'button', text: 'Copy Details', onclick: async () => {
          try { await navigator.clipboard.writeText(summary); toast('Copied. Paste it into a message.'); }
          catch (e) { toast('Couldn’t copy. Try again.'); }
        },
      }),
      CFG.fallbackEmail ? h('a', {
        class: 'btn small secondary',
        href: `mailto:${encodeURIComponent(CFG.fallbackEmail)}?subject=${encodeURIComponent('Order request')}&body=${encodeURIComponent(summary.slice(0, 1800))}`,
        text: 'Email It Instead',
      }) : null);
    return h('div', { class: 'card alert mt-4', role: 'alert' },
      h('h2', { class: 'section-title', tabindex: '-1', text: 'Your request wasn’t sent.' }),
      h('p', { class: 'section-sub mb-0', text: err }),
      actions);
  }

  /* ------------------------------------------------------- step: done */

  let DONE = null;
  const DONE_KEY = 'ff-order-done-v1'; // sessionStorage: keeps the reference number across a reload

  // The reference number as a copy button where the clipboard is available, plain text otherwise.
  function refControl(ref) {
    if (!ref) return null;
    const code = h('span', { class: 'ref-code', text: ref });
    const clip = navigator.clipboard && typeof navigator.clipboard.writeText === 'function';
    if (!clip) return h('div', { class: 'ref' }, code);
    return h('button', {
      class: 'ref', type: 'button', 'aria-label': `Copy reference number ${ref}`,
      onclick: async () => {
        try { await navigator.clipboard.writeText(ref); toast('Reference copied.'); }
        catch (e) { toast('Couldn’t copy. Select the number instead.'); }
      },
    }, code, h('span', { class: 'ref-copy', 'aria-hidden': 'true', text: 'Copy' }));
  }

  function renderDone() {
    const d = DONE || {};
    return h('div', { class: 'step done-screen' },
      h('div', { class: 'done-check' }, svg(ICON.done)),
      h('h1', { class: 'step-title', tabindex: '-1', text: 'Request sent.' }),
      h('p', { class: 'step-sub', text: d.first ? `Thanks, ${d.first}. Here’s your reference number.` : 'Here’s your reference number.' }),
      refControl(d.ref || ''),
      d.emailed && d.email ? h('p', { class: 'bag-item-meta', text: `A confirmation was sent to ${d.email}.` }) : null,
      d.demo ? h('p', { class: 'bag-item-meta', text: 'Preview mode: nothing was actually sent.' }) : null,
      h('ol', { class: 'next-steps' },
        h('li', null, h('strong', { text: 'You’ll get a final price.' }), 'It includes any discount, trade-in credit, AppleCare, and tax. Nothing is ordered until you approve it.'),
        h('li', null, h('strong', { text: 'Pay once you approve.' }), 'Use the payment method you chose. Never send card numbers by message.'),
        h('li', null, h('strong', { text: d.method === 'pickup' ? 'Pick it up.' : 'Watch for delivery.' }), d.method === 'pickup' ? 'You’ll get the pickup details when it’s ready. Bring your photo ID.' : 'You’ll get tracking details once it ships.')),
      h('button', { class: 'btn secondary', type: 'button', text: 'Start a New Request', onclick: () => {
        DONE = null;
        try { window.sessionStorage.removeItem(DONE_KEY); } catch (e) { /* ignore */ }
        go(0, true);
      } }));
  }

  /* ------------------------------------------------------ submission */

  function plainSummary() {
    const lines = [];
    lines.push(`Order request (${countryName(S.country)})`, '');
    lines.push('PRODUCTS');
    S.items.forEach((i, n) => {
      lines.push(`${n + 1}. ${i.name}${i.qty > 1 ? ` × ${i.qty}` : ''}`);
      itemLines(i).forEach(l => lines.push(`   ${l}`));
    });
    if (S.tradeIn.has === 'yes') {
      lines.push('', 'TRADE-IN');
      S.tradeIn.devices.forEach(d => lines.push(`- ${d.type} ${d.model} (serial ${normSerial(d.serial)}), works: ${d.works}, damage: ${d.damage}`));
    }
    lines.push('', 'CONTACT', `${S.you.first} ${S.you.last}`, S.you.email, fullPhone(S.you.dial, S.you.phone), `Contact via ${S.you.contact}`);
    lines.push('', 'DELIVERY');
    fulfillmentText().forEach(([k, v]) => { if (v) lines.push(`${k}: ${v}`); });
    if (S.delivery.neededBy) lines.push(`Need it by: ${S.delivery.neededBy}`);
    lines.push('', 'PAYMENT', `Method: ${S.pay.method === 'Other' ? S.pay.methodOther : S.pay.method}`);
    if (S.pay.gift === 'yes') lines.push(`Gift card balance: ${S.pay.giftAmount} ${S.pay.currency}`);
    if (S.pay.budget) lines.push(`Budget: ${S.pay.budget} ${S.pay.currency}`);
    if (S.notes.trim()) lines.push('', 'NOTES', S.notes.trim());
    return lines.join('\n');
  }

  function buildPayload() {
    const d = S.delivery;
    const youName = { firstName: S.you.first.trim(), lastName: S.you.last.trim() };
    let fulfillment;
    if (d.method === 'pickup') {
      fulfillment = {
        method: 'pickup',
        store: d.store === '__other' ? d.storeOther.trim() : d.store,
        preferredDate: d.date || '',
        pickupBy: d.pickupBy === 'other' ? 'someone else' : 'requester',
        pickupPerson: d.pickupBy === 'other' ? { firstName: d.altFirst.trim(), lastName: d.altLast.trim(), email: d.altEmail.trim() } : youName,
      };
    } else {
      const rec = d.recipient === 'other' ? { firstName: d.recFirst.trim(), lastName: d.recLast.trim(), phone: d.recPhone.trim() } : Object.assign({ phone: '' }, youName);
      const spec = addressSpec(S.country);
      const fields = {};
      spec.rows.flat().forEach(f => { if (d.addr[f]) fields[f] = String(d.addr[f]).trim(); });
      if (fields.postal && spec.zipRe && !spec.zipRe.test(fields.postal)) {
        const compact = fields.postal.replace(/[\s\u00a0]/g, '');
        if (spec.zipRe.test(compact)) fields.postal = compact;
      }
      fulfillment = {
        method: 'delivery',
        recipient: rec,
        address: fields,
        formattedAddress: formatAddress(S.country, d.addr, `${rec.firstName} ${rec.lastName}`),
        instructions: d.instructions.trim(),
      };
    }
    const honeypot = document.getElementById('hp-website');
    return {
      v: 1,
      submissionId: S.sid,
      hp: honeypot ? honeypot.value : '',
      elapsedMs: Date.now() - (S.startedAt || Date.now()),
      invite: S.invite.trim(),
      catalogVersion: CATALOG.version || '',
      country: S.country,
      countryName: countryName(S.country),
      contact: {
        firstName: S.you.first.trim(),
        lastName: S.you.last.trim(),
        email: S.you.email.trim(),
        phone: fullPhone(S.you.dial, S.you.phone),
        preferredContact: S.you.contact,
      },
      items: S.items.map(i => ({
        product: i.name,
        productId: i.pid || '',
        category: CATEGORY_NAME.get(i.cat) || (i.custom ? 'Other' : i.cat),
        custom: !!i.custom,
        options: (i.spec || []).map(s => ({ label: s.label, value: s.value })),
        quantity: i.qty || 1,
        applecare: appleCareText(i.ac),
        engraving: i.engraving || '',
        notes: i.notes || '',
        link: i.link || '',
        configuredFor: configuredElsewhere(i) ? i.country : S.country,
      })),
      tradeIns: S.tradeIn.has === 'yes' ? S.tradeIn.devices.map(x => ({
        type: x.type, model: x.model.trim(), serial: normSerial(x.serial), worksNormally: x.works, damage: x.damage,
      })) : [],
      fulfillment,
      neededBy: d.neededBy || '',
      payment: {
        method: S.pay.method === 'Other' ? `Other: ${S.pay.methodOther.trim()}` : S.pay.method,
        giftCard: S.pay.gift === 'yes',
        giftCardAmount: S.pay.gift === 'yes' ? String(S.pay.giftAmount).trim() : '',
        budget: String(S.pay.budget || '').trim(),
        currency: S.pay.currency,
      },
      notes: S.notes.trim(),
    };
  }

  async function postJSON(url, data) {
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = setTimeout(() => ctrl && ctrl.abort(), 30000);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(data),
        redirect: 'follow',
        credentials: 'omit',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
        signal: ctrl ? ctrl.signal : undefined,
      });
      const text = await res.text();
      try { return JSON.parse(text); } catch (e) { return { ok: false, error: 'bad_response' }; }
    } finally {
      clearTimeout(timer);
    }
  }

  const SERVER_MSG = {
    invite: 'That invite isn’t valid any more. Ask for a new link.',
    rate: 'Too many requests right now. Wait a few minutes and try again.',
    invalid: 'Something in the form needs another look.',
    sensitive: 'Remove any card numbers, gift card codes, or passwords and try again.',
    too_large: 'This request is too large. Try fewer items or shorter notes.',
    closed: 'Requests are paused right now. Try again later.',
    bad_response: 'The server sent an unexpected response.',
  };

  let SUBMITTING = false;
  // While a request is in flight only the action bar stays live: no edits, no navigation.
  function setBusy(on) {
    ['.topbar', '#main', '.site-foot'].forEach(sel => { const el = document.querySelector(sel); if (el) el.toggleAttribute('inert', on); });
    const main = document.getElementById('main');
    if (main) { if (on) main.setAttribute('aria-busy', 'true'); else main.removeAttribute('aria-busy'); }
  }
  async function submit() {
    if (SUBMITTING) return;
    for (let i = 0; i < STEPS.length; i++) {
      const e = errorsFor(STEPS[i].id);
      if (e.size) {
        if (i === currentStep()) { ERR = e; rerender(); focusFirstError(); }
        else {
          go(i);
          setTimeout(() => { ERR = errorsFor(STEPS[i].id); rerender(); focusFirstError(); }, 0);
          toast(`Check ${STEPS[i].label.toLowerCase()} first.`);
        }
        return;
      }
    }
    SUBMITTING = true;
    SUBMIT_ERROR = null;
    const errBox = document.getElementById('submit-error');
    const fromCard = !!(errBox && errBox.contains(document.activeElement));
    setBusy(true);
    paintActionbar();
    paintProgress();
    if (errBox) errBox.replaceChildren();
    if (fromCard) { const b = document.querySelector('#actionbar .btn:not(.secondary)'); if (b) b.focus({ preventScroll: true }); }
    const payload = buildPayload();
    // A failed send may still have arrived. Resending the same content reuses
    // its id (the server answers "already received"); changed content gets a
    // new id so the edits aren't dropped as a duplicate.
    const fp = JSON.stringify(Object.assign({}, payload, { submissionId: '', elapsedMs: 0, hp: '' }));
    if (S.lastFp && S.lastFp !== fp) { S.sid = newId(); payload.submissionId = S.sid; }
    S.lastFp = fp;
    clearTimeout(saveTimer);
    S.savedAt = Date.now();
    storage.set(DRAFT_KEY, S);
    let res;
    try {
      if (!CFG.endpoint) {
        await new Promise(r => setTimeout(r, 900));
        console.info('[preview] payload that would be sent:', payload);
        res = { ok: true, id: 'FF-PREVIEW', demo: true, emailed: false };
      } else {
        res = await postJSON(CFG.endpoint, payload);
      }
    } catch (e) {
      res = { ok: false, error: navigator.onLine === false ? 'offline' : 'network' };
    }
    SUBMITTING = false;
    setBusy(false);
    paintProgress();
    if (res && res.ok) {
      DONE = { ref: res.id, email: S.you.email.trim(), emailed: !!res.emailed, demo: !!res.demo, first: S.you.first.trim(), method: S.delivery.method };
      try { window.sessionStorage.setItem(DONE_KEY, JSON.stringify(DONE)); } catch (e) { /* ignore */ }
      const keep = (S.inviteFromLink || S.inviteOk) && S.invite ? { invite: S.invite, fromLink: S.inviteFromLink, ok: S.inviteOk, name: S.inviteName } : null;
      resetAll();
      if (keep) { S.invite = keep.invite; S.inviteFromLink = keep.fromLink; S.inviteOk = keep.ok; S.inviteName = keep.name; save(); }
      location.hash = 'done';
      return;
    }
    const code = (res && res.error) || 'server';
    if (code === 'invite') {
      S.inviteOk = false; S.inviteNeeded = true; S.inviteFromLink = false; UI.gateTried = true;
      save();
      CUR = -2; // so the gate counts as a new screen
      onRoute();
      toast(SERVER_MSG.invite);
      return;
    }
    if (code === 'invalid' && res.field) {
      SUBMIT_ERROR = `${SERVER_MSG.invalid} (${res.message || res.field})`;
    } else if (code === 'offline') {
      SUBMIT_ERROR = 'You appear to be offline. Check your connection and try again. Your progress is saved on this device.';
    } else if (code === 'network') {
      SUBMIT_ERROR = 'Couldn’t reach the server. Check your connection and try again. Your progress is saved on this device.';
    } else {
      SUBMIT_ERROR = SERVER_MSG[code] || 'Something went wrong on our end. Try again, or copy your details and send them by message.';
    }
    rerender();
    const box = document.getElementById('submit-error');
    if (box) {
      box.scrollIntoView({ block: 'center', behavior: smooth() });
      const t = box.querySelector('h2');
      if (t) t.focus({ preventScroll: true });
    }
  }

  /* -------------------------------------------------- chrome: header etc */

  function paintHeader() {
    const sel = document.getElementById('country-select');
    if (sel) sel.value = S.country;
    const lbl = document.getElementById('country-label');
    if (lbl) lbl.textContent = countryName(S.country);
  }

  // The segments are created once and only change state, so their fill can animate.
  function paintProgress() {
    const bar = document.getElementById('progress');
    if (!bar) return;
    const cur = currentStep();
    bar.hidden = cur < 0;
    if (bar.childElementCount !== STEPS.length) {
      bar.replaceChildren(...STEPS.map((s, i) => h('button', { class: 'progress-seg', type: 'button', onclick: () => go(i) },
        h('span', { class: 'progress-label', 'aria-hidden': 'true', text: s.label }))));
    }
    Array.from(bar.children).forEach((b, i) => {
      const done = i < cur, current = i === cur;
      const reachable = !SUBMITTING && (done || (i <= S.maxStep && !current));
      b.classList.toggle('done', done);
      b.classList.toggle('current', current);
      b.disabled = !reachable;
      b.setAttribute('aria-label', `Step ${i + 1}: ${STEPS[i].label}${done ? ' (done)' : current ? ' (current)' : ''}`);
      if (current) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current');
    });
  }

  function paintActionbar() {
    const bar = document.getElementById('actionbar');
    if (!bar) return;
    const cur = currentStep();
    document.body.classList.toggle('no-actionbar', cur < 0);
    if (cur < 0) { bar.hidden = true; return; }
    bar.hidden = false;
    const info = cur === 0
      ? h('div', { class: 'actionbar-info' },
          h('strong', { text: S.items.length ? plural(totalQty(), 'item') : 'Your bag is empty' }),
          S.items.length ? h('button', { class: 'link-btn', id: 'view-bag', type: 'button', text: 'View Bag', onclick: openBag }) : h('span', { text: 'Add products to continue' }))
      : h('div', { class: 'actionbar-info' }, h('strong', { text: STEPS[cur].label }), h('span', { text: `Step ${cur + 1} of ${STEPS.length}` }));
    const back = cur > 0 ? h('button', { class: 'btn secondary', type: 'button', text: 'Back', disabled: SUBMITTING, onclick: () => go(cur - 1) }) : null;
    const last = cur === STEPS.length - 1;
    // After reaching Review once, editing an earlier step goes straight back to it.
    const toReview = !last && S.maxStep >= STEPS.length - 1;
    const primary = h('button', {
      class: 'btn', type: 'button', 'aria-disabled': SUBMITTING ? 'true' : null,
      onclick: () => (last ? submit() : next(toReview ? STEPS.length - 1 : undefined)),
    }, SUBMITTING ? [h('span', { class: 'spinner', 'aria-hidden': 'true' }), 'Sending…'] : (last ? 'Send Request' : toReview ? 'Review Request' : 'Continue'));
    const hadFocus = bar.contains(document.activeElement) && document.activeElement.classList.contains('btn') && !document.activeElement.classList.contains('secondary');
    setKids(bar.firstChild, info, back, primary);
    if (hadFocus) primary.focus({ preventScroll: true });
  }

  /* ------------------------------------------------------------- gate */
  // With inviteCodeRequired (or after the server refused a code) nothing shows until the
  // invite is verified. #invite=CODE links verify on their own; preview mode accepts any code.
  const gateNeeded = () => !!(CFG.inviteCodeRequired || S.inviteNeeded) && !S.inviteOk;
  async function verifyInvite(code) {
    code = String(code || '').trim();
    if (!code) return { ok: false, error: 'empty' };
    if (!CFG.endpoint) return { ok: true, name: '' };
    try {
      const url = CFG.endpoint + (CFG.endpoint.includes('?') ? '&' : '?') + 'invite=' + encodeURIComponent(code);
      const res = await fetch(url, { redirect: 'follow', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer' });
      const data = await res.json();
      return data && data.ok ? { ok: true, name: data.name || '' } : { ok: false, error: 'invalid' };
    } catch (e) {
      return { ok: false, error: 'network' };
    }
  }
  let inviteCheck = null;
  function renderGate() {
    const field = textField({
      key: 'invite', label: 'Invite code', value: S.invite, maxlength: 64, autocapitalize: 'off', spellcheck: false, autocomplete: 'off',
      hint: 'It’s in the link or message you were sent.', onInput: v => { S.invite = v; },
    });
    const btn = h('button', { class: 'btn', type: 'button', text: 'Continue' });
    const status = h('p', { class: 'gate-status', role: 'status', 'aria-live': 'polite' });
    async function attempt(fromLink) {
      if (inviteCheck) return;
      const code = String(S.invite || '').trim();
      btn.setAttribute('aria-disabled', 'true');
      btn.replaceChildren(h('span', { class: 'spinner', 'aria-hidden': 'true' }), 'Checking…');
      status.textContent = fromLink ? 'Checking your invite…' : '';
      inviteCheck = verifyInvite(code);
      const r = await inviteCheck;
      inviteCheck = null;
      if (r.ok) {
        S.invite = code; S.inviteOk = true; S.inviteName = r.name || ''; S.inviteNeeded = false;
        save();
        CUR = -2;
        onRoute();
        if (r.name) toast(`Welcome, ${r.name}.`);
        return;
      }
      btn.removeAttribute('aria-disabled');
      btn.textContent = 'Continue';
      status.textContent = '';
      UI.gateTried = true;
      S.inviteFromLink = false;
      const msg = r.error === 'network' ? 'Couldn’t check the invite. Check your connection and try again.'
        : r.error === 'empty' ? 'Enter the invite code you were sent.'
        : SERVER_MSG.invite;
      markInvalid(field, msg);
      const input = field.querySelector('input');
      if (input) input.focus({ preventScroll: true });
    }
    btn.addEventListener('click', () => attempt(false));
    field.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); attempt(false); } });
    const step = h('div', { class: 'step narrow gate' },
      stepHead('Invitation only', 'You’ll need an invite.', `${CFG.title} takes order requests from friends and family. Open the link you were sent, or enter your invite code.`),
      h('div', { class: 'card gate-card' }, field, h('div', { class: 'btn-row' }, btn), status));
    if (S.inviteFromLink && S.invite && !UI.gateTried) setTimeout(() => attempt(true), 0);
    return step;
  }

  /* ---------------------------------------------------------- routing */

  const RENDER = { products: renderProducts, 'trade-in': renderTradeIn, you: renderYou, delivery: renderDelivery, review: renderReview };
  let CUR = -1;
  const currentStep = () => CUR;

  function go(i, fresh) {
    if (SUBMITTING) return;
    if (fresh) { ERR = new Map(); window.location.hash = STEPS[0].id; return; }
    const id = STEPS[Math.max(0, Math.min(STEPS.length - 1, i))].id;
    if (window.location.hash === '#' + id) onRoute();
    else window.location.hash = id;
  }
  function next(target) {
    const cur = currentStep();
    const e = errorsFor(STEPS[cur].id);
    if (e.size) {
      ERR = e;
      if (cur === 0) {
        toast(e.get('bag'));
        replay(document.querySelector('.actionbar-info'), 'attention');
        const cats = document.querySelector('.cats');
        if (cats) cats.scrollIntoView({ block: 'nearest', behavior: smooth() });
        return;
      }
      rerender();
      focusFirstError();
      return;
    }
    S.maxStep = Math.max(S.maxStep, cur + 1);
    save();
    go(target != null ? target : cur + 1);
  }
  function focusFirstError() {
    requestAnimationFrame(() => {
      const el = document.querySelector('main .invalid');
      if (!el) { const t = document.querySelector('main .step-title'); if (t) t.focus({ preventScroll: true }); return; }
      el.scrollIntoView({ block: 'center', behavior: smooth() });
      const f = el.querySelector('input:not([disabled]):not([type="radio"]), select, textarea, input[type="radio"]:not([disabled])');
      if (f) setTimeout(() => f.focus({ preventScroll: true }), 350);
    });
  }

  function rerender() {
    const main = document.getElementById('main');
    const y = window.scrollY;
    const cur = currentStep();
    main.replaceChildren(cur < 0 ? renderDone() : RENDER[STEPS[cur].id]());
    main.firstChild.style.animation = 'none';
    window.scrollTo(0, y);
    paintActionbar();
  }

  function onRoute() {
    let raw = window.location.hash.replace(/^#\/?/, '');
    try { raw = decodeURIComponent(raw); } catch (e) { /* malformed % escape: use as is */ }
    // Browser Back during a send would lose the error card; stay on Review until it's over.
    if (SUBMITTING && raw !== STEPS[STEPS.length - 1].id) { history.replaceState(null, '', '#' + STEPS[STEPS.length - 1].id); return; }
    if (raw.startsWith('invite=')) {
      const code = raw.slice(7).trim();
      if (code !== S.invite) { S.inviteOk = false; S.inviteName = ''; }
      S.invite = code;
      S.inviteFromLink = !!code;
      UI.gateTried = false;
      save();
      history.replaceState(null, '', '#' + STEPS[0].id);
      return onRoute();
    }
    let i;
    let blocked = false;
    if (raw === 'done') {
      if (!DONE) { try { DONE = JSON.parse(window.sessionStorage.getItem(DONE_KEY)); } catch (e) { DONE = null; } }
      if (!DONE) { history.replaceState(null, '', '#' + STEPS[0].id); return onRoute(); }
      i = -1;
    } else {
      i = stepIndex(raw);
      if (i < 0) i = 0;
      DONE = null;
      for (let j = 0; j < i; j++) {
        if (errorsFor(STEPS[j].id).size) { i = j; blocked = true; break; }
      }
      if (STEPS[i].id !== raw) history.replaceState(null, '', '#' + STEPS[i].id);
    }
    const changed = i !== CUR;
    CUR = i;
    if (i >= 0) S.maxStep = Math.max(S.maxStep || 0, i);
    if (changed) { ERR = new Map(); SUBMIT_ERROR = null; }
    if (i >= 0 && gateNeeded()) {
      const main = document.getElementById('main');
      main.replaceChildren(renderGate());
      document.title = `Invite · ${CFG.title}`;
      document.getElementById('progress').hidden = true;
      document.getElementById('actionbar').hidden = true;
      document.body.classList.add('no-actionbar');
      paintHeader();
      if (changed) window.scrollTo(0, 0);
      if (booted && changed) { const t = main.querySelector('.step-title'); if (t) t.focus({ preventScroll: true }); }
      return;
    }
    // Sent back to an earlier step that still needs something: say why.
    if (blocked && booted && (S.items.length || S.maxStep > 0)) {
      ERR = errorsFor(STEPS[i].id);
      toast(i === 0 ? ERR.get('bag') : `Check ${STEPS[i].label.toLowerCase()} first.`);
    }
    const main = document.getElementById('main');
    main.replaceChildren(i < 0 ? renderDone() : RENDER[STEPS[i].id]());
    if (!changed && main.firstChild) main.firstChild.style.animation = 'none';
    document.title = i < 0 ? `Request sent · ${CFG.title}` : `${STEPS[i].label} · ${CFG.title}`;
    paintProgress();
    paintActionbar();
    paintBag(false);
    paintHeader();
    if (blocked && booted && ERR.size) focusFirstError();
    else if (changed) {
      window.scrollTo(0, 0);
      if (booted) { const t = main.querySelector('.step-title'); if (t) t.focus({ preventScroll: true }); }
    }
  }

  /* ------------------------------------------------------------- boot */

  let booted = false;
  function boot() {
    const app = document.getElementById('app');
    const countrySel = h('select', { id: 'country-select', 'aria-label': 'Country or region' },
      COUNTRIES.map(c => h('option', { value: c.code, text: c.name })));
    countrySel.value = S.country;
    countrySel.addEventListener('change', () => {
      const d = S.delivery;
      const had = !!(d.store || d.addr.city || d.addr.postal || d.addr.state);
      setCountry(countrySel.value);
      paintHeader();
      if (currentStep() >= 0) rerender();
      toast(`Shopping in ${countryName(S.country)}.${had ? ' Check your delivery details.' : ''}`);
    });

    const header = h('header', { class: 'topbar' },
      h('div', { class: 'topbar-inner' },
        h('div', { class: 'brand' }, h('span', { class: 'brand-title', text: CFG.title }), CFG.subtitle ? h('span', { class: 'brand-sub', text: CFG.subtitle }) : null),
        h('label', { class: 'pill-select', title: 'Country or region' }, icon('globe'), h('span', { id: 'country-label', text: countryName(S.country) }), countrySel),
        h('button', { class: 'bag-button', id: 'bag-button', type: 'button', 'aria-label': 'Bag', onclick: openBag }, icon('bag'), h('span', { class: 'bag-count', id: 'bag-count' }))),
      h('nav', { class: 'progress', id: 'progress', 'aria-label': 'Progress' }));

    const banner = !CFG.endpoint
      ? h('div', { class: 'demo-banner', role: 'note' }, h('strong', { text: 'Preview mode. ' }), 'Requests aren’t sent anywhere until an endpoint is added in config.js.')
      : null;

    const footer = h('footer', { class: 'site-foot' },
      h('p', { text: 'Your details are used only for this request. Phone numbers, addresses, serial numbers, and notes are erased about two months after your order is complete. Your name, email, and what you ordered are kept as a purchase record. Never enter card numbers, passwords, or gift card codes in this form.' }),
      CFG.footerNote ? h('p', { text: CFG.footerNote }) : null,
      h('p', { text: 'This is a personal order request form. It isn’t affiliated with Apple Inc. Product names are trademarks of their owners.' }),
      h('p', null, h('button', {
        class: 'link-btn', type: 'button', text: 'Clear this form and start over',
        onclick: () => {
          if (!window.confirm('Clear everything you’ve entered on this device?')) return;
          resetAll();
          paintHeader();
          go(0, true);
          if (window.location.hash === '#' + STEPS[0].id) onRoute();
          toast('Form cleared.');
        },
      })));

    setKids(app,
      header,
      banner,
      h('main', { id: 'main' }),
      footer,
      h('div', { class: 'actionbar', id: 'actionbar' }, h('div', { class: 'actionbar-inner' })),
      h('div', { class: 'toast-wrap', id: 'toasts', 'aria-live': 'polite', role: 'status' }));

    if (!PRODUCTS.length) {
      document.getElementById('main').append(h('div', { class: 'card' }, 'The product catalog didn’t load. Check that data/catalog.js is present.'));
    }

    window.addEventListener('hashchange', onRoute);
    if (!window.location.hash) history.replaceState(null, '', '#' + STEPS[0].id);
    onRoute();
    booted = true;
    if (RESTORED) toast('Welcome back. Your progress was saved.');
    // A stored invite may have been revoked since: check quietly, and only act on a definite no.
    if (S.inviteOk && S.invite && CFG.endpoint && CFG.inviteCodeRequired) {
      verifyInvite(S.invite).then(r => {
        if (r.ok || r.error !== 'invalid') return;
        S.inviteOk = false; S.inviteNeeded = true; S.inviteFromLink = false; UI.gateTried = true;
        save();
        CUR = -2;
        onRoute();
        toast(SERVER_MSG.invite);
      });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
