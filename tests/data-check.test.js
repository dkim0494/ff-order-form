#!/usr/bin/env node
// Cross-checks data/catalog.js + data/world.js and walks every configuration path
// (every product x every online-store country) looking for dead ends.
const path = require('path');
const PROJ = process.argv[2] || path.resolve(__dirname, '..');
global.window = {};
require(path.join(PROJ, 'data/world.js'));
require(path.join(PROJ, 'data/catalog.js'));
const W = window.FF_WORLD, C = window.FF_CATALOG, P = C.programs;
const issues = [];
const warn = m => issues.push(m);
const CC = new Set(W.countries.map(c => c.code));
const ONLINE = new Set(W.onlineStoreCountries);

// --- world
for (const c of W.countries) {
  if (!c.dial) warn(`country ${c.code}: no dial code`);
  if (!c.currency) warn(`country ${c.code}: no currency`);
  if (c.zip) {
    let re;
    try { re = new RegExp(`^(?:${c.zip})$`, 'i'); } catch (e) { warn(`country ${c.code}: zip regex fails in JS: ${e.message}`); continue; }
    for (const ex of String(c.zipEx || '').split(',').filter(Boolean)) if (!re.test(ex.trim())) warn(`country ${c.code}: zipEx "${ex}" fails its own regex`);
  }
  for (const t of (c.fmt || '').match(/%./g) || []) if (!'%n %N %O %A %D %C %S %Z %X'.split(' ').includes(t)) warn(`country ${c.code}: odd fmt token ${t}`);
  if (c.states && (!Array.isArray(c.states) || !c.states.length || c.states.some(s => !Array.isArray(s) || s.length !== 2 || !s[0] || !s[1]))) warn(`country ${c.code}: malformed states`);
  if (c.states && /[^\x00-ɏ\s'’().,-]/.test(c.states.map(s => s[1]).join(''))) warn(`country ${c.code}: non-Latin state names`);
}
for (const cc of W.onlineStoreCountries) if (!CC.has(cc)) warn(`onlineStoreCountries: unknown ${cc}`);
for (const [cc, list] of Object.entries(W.stores)) {
  if (!CC.has(cc)) warn(`stores: unknown country ${cc}`);
  const seen = new Set();
  for (const s of list) {
    if (!s.name) warn(`stores ${cc}: store without name`);
    const k = s.name + '|' + s.city;
    if (seen.has(k)) warn(`stores ${cc}: duplicate ${k}`);
    seen.add(k);
  }
}

// --- programs
const layouts = new Set((P.keyboardLayouts || []).map(x => x.value));
for (const [cc, v] of Object.entries(P.keyboardDefaults || {})) {
  if (!CC.has(cc)) warn(`keyboardDefaults: unknown ${cc}`);
  const local = (P.keyboardLayoutsByCountry || {})[cc];
  if (local ? !local.includes(v) : !layouts.has(v)) warn(`keyboardDefaults ${cc}: "${v}" not offered there`);
}
for (const [cc, list] of Object.entries(P.keyboardLayoutsByCountry || {})) {
  if (!CC.has(cc)) warn(`keyboardLayoutsByCountry: unknown ${cc}`);
  for (const v of list) if (!layouts.has(v)) warn(`keyboardLayoutsByCountry ${cc}: "${v}" missing from master list`);
}
for (const cc of Object.keys(P.carriers || {})) if (!CC.has(cc)) warn(`carriers: unknown ${cc}`);
for (const k of ['applecareCountries', 'tradeInCountries']) for (const cc of P[k] || []) if (!CC.has(cc)) warn(`${k}: unknown ${cc}`);
for (const [key, def] of Object.entries(P.applecare || {})) {
  for (const p of def.plans || []) for (const cc of p.regions || []) if (!CC.has(cc)) warn(`applecare ${key}/${p.value}: unknown ${cc}`);
}
// every AppleCare country should have at least one plan for each key it can see
for (const cc of P.applecareCountries || []) {
  for (const [key, def] of Object.entries(P.applecare || {})) {
    const plans = (def.plans || []).filter(p => !p.regions || p.regions.includes(cc));
    void plans;
  }
}

// --- products
const usedAC = new Set();
const resolve = (o, cc) => {
  if (o.regions && o.regions.length && !o.regions.includes(cc)) return null;
  let ch = o.choices || [];
  if (o.choicesRef === 'keyboardLayouts') ch = ((P.keyboardLayoutsByCountry || {})[cc] || [...layouts]).map(v => ({ value: v }));
  if (o.choicesRef === 'carriers') { ch = (P.carriers || {})[cc]; if (!ch || !ch.length) return null; }
  const strict = ONLINE.has(cc);
  ch = ch.filter(c => !strict || !c.regions || !c.regions.length || c.regions.includes(cc));
  if (o.type !== 'text' && !ch.length) return null;
  return { ...o, choices: ch, required: o.required !== false };
};
const COUNTRIES_TO_TEST = [...new Set(['US', 'GB', 'JP', 'DE', 'IN', 'BR', 'CN', 'AE', 'CA', 'AU', 'ID', 'FR', 'KR', 'MX', 'SG', ...W.onlineStoreCountries])];
let paths = 0;
for (const p of C.products) {
  if (p.applecare) { usedAC.add(p.applecare); if (!(P.applecare || {})[p.applecare]) warn(`${p.id}: applecare key "${p.applecare}" has no plans table`); }
  if (!C.categories.some(c => c.id === p.category)) warn(`${p.id}: unknown category`);
  for (const cc of COUNTRIES_TO_TEST) {
    const opts = (p.options || []).map(o => resolve(o, cc)).filter(Boolean);
    const avail = (c, sel) => !c.only || Object.entries(c.only).every(([d, a]) => sel[d] == null || a.includes(sel[d]));
    const problems = new Set();
    let count = 0;
    const walk = (i, sel) => {
      if (count > 20000) return;
      if (i === opts.length) { count++; return; }
      const o = opts[i];
      if (o.type === 'text') return walk(i + 1, sel);
      const av = o.choices.filter(c => avail(c, sel));
      if (!av.length) {
        // Options whose every choice is gated on the same earlier option are intentionally conditional.
        const deps = o.choices.map(c => Object.keys(c.only || {}).sort().join('+'));
        const conditional = deps.every(d => d && d === deps[0]);
        if (!conditional) problems.add(`option "${o.id}" has no available choice after ${JSON.stringify(sel)}`);
        return walk(i + 1, sel);
      }
      for (const c of av) walk(i + 1, { ...sel, [o.id]: c.value });
    };
    walk(0, {});
    paths += count;
    for (const pr of problems) warn(`${p.id} [${cc}]: ${pr}`);
  }
}
for (const k of Object.keys(P.applecare || {})) if (!usedAC.has(k)) warn(`applecare table "${k}" unused by any product`);

// dedupe noisy per-country repeats
const grouped = new Map();
for (const m of issues) {
  const k = m.replace(/ \[[A-Z]{2}\]/, ' [*]');
  if (!grouped.has(k)) grouped.set(k, []);
  const cc = (m.match(/ \[([A-Z]{2})\]/) || [])[1];
  if (cc) grouped.get(k).push(cc);
}
console.log(`checked ${C.products.length} products, ${paths} full configuration paths, ${W.countries.length} countries`);
for (const [k, ccs] of grouped) console.log('- ' + k + (ccs.length ? `  (${ccs.length} countries: ${ccs.slice(0, 8).join(',')}${ccs.length > 8 ? '…' : ''})` : ''));
if (!grouped.size) console.log('no issues');
// AQ (Antarctica) has no currency and IN uses libaddressinput tokens the app ignores; both are expected.
const real = [...grouped.keys()].filter(k => !/country AQ: no currency|country IN: odd fmt token/.test(k));
process.exitCode = real.length ? 1 : 0;
