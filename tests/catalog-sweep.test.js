// For every product x country: open configurator via UI, pick first enabled choice for
// each visible option in order, choose AppleCare (mode), Add to Bag, verify saved spec.
const { make, type, choose, P } = require('./lib/app-harness');
const fs = require('fs'), vm = require('vm');
const gctx = vm.createContext({ console });
vm.runInContext(fs.readFileSync(P + 'apps-script/Code.gs', 'utf8') + '\nthis.validate_ = validate_;', gctx);
let validated = 0;
function checkServer(T, cc, problems) {
  if (!T.S.items.length) return;
  Object.assign(T.S.you, { first: 'Ana', last: 'Lopez', email: 'ana@example.com', phone: '4155550132', contact: 'Email' });
  T.S.tradeIn = { has: 'no', devices: [] };
  Object.assign(T.S.delivery, { method: 'delivery', recipient: 'me', addr: { address1: '1 Main St', city: 'Town', postal: '12345' } });
  Object.assign(T.S.pay, { method: 'Cash' });
  const pl = JSON.parse(JSON.stringify(T.buildPayload()));
  try { gctx.validate_(pl); validated += pl.items.length; } catch (e) { problems.push(`${cc}: SERVER REJECTS items [${pl.items.map(i => i.product).join(', ')}]: ${e.code}:${e.field}:${e.message}`); }
}
const COUNTRIES = process.argv[2] ? process.argv[2].split(',') : ['US', 'GB', 'JP', 'DE', 'IN', 'BR', 'CN', 'AE', 'CA', 'AU', 'ID'];
const AC_MODE = process.argv[3] || 'none'; // 'none' (No) | 'plan' (Yes) | 'last' (second-to-last radio)

function sectionState(w, sec) {
  const radios = Array.from(sec.querySelectorAll('input[type=radio]'));
  const sel = sec.querySelector('select');
  const text = sec.querySelector('input[type=text], textarea');
  if (radios.length) return { kind: 'radio', radios, picked: radios.find(r => r.checked), enabled: radios.filter(r => !r.disabled) };
  if (sel) { const opts = Array.from(sel.options).filter(o => o.value); return { kind: 'select', sel, picked: sel.value || null, enabled: opts.filter(o => !o.disabled) }; }
  if (text) return { kind: 'text', text, picked: text.value.trim() || null, enabled: [1] };
  return { kind: 'none' };
}

(async () => {
  const problems = [];
  let count = 0;
  for (const cc of COUNTRIES) {
    const A = make({ config: { defaultCountry: cc } });
    await A.wait(20);
    const { w, T, $, $$ } = A;
    if (T.S.country !== cc) { problems.push(`${cc}: country not applied (${T.S.country})`); continue; }
    const cats = $$('.cats .cat');
    for (const p of T.PRODUCTS) {
      // Click category, then product card
      const catBtn = cats.length ? $$('.cats .cat').find(b => b.textContent.trim() === (w.FF_CATALOG.categories.find(c => c.id === p.category) || {}).name) : null;
      if (!catBtn) { problems.push(`${cc} ${p.id}: no category tab`); continue; }
      catBtn.click();
      const card = $(`[data-pid="${p.id}"]`);
      if (!card) { problems.push(`${cc} ${p.id}: no card`); continue; }
      card.click();
      const dlg = $('dialog.sheet[open]');
      if (!dlg) { problems.push(`${cc} ${p.id}: dialog did not open`); continue; }
      const picks = {};
      let guard = 0, dead = null;
      for (; guard < 80; guard++) {
        const secs = Array.from(dlg.querySelectorAll('.opt-section[data-opt]')).filter(s => !s.hidden && s.dataset.opt !== 'applecare');
        let acted = false;
        for (const sec of secs) {
          const st = sectionState(w, sec);
          if (st.kind === 'none') continue;
          if (st.picked) continue;
          if (st.kind === 'text') {
            const label = sec.querySelector('label.float').textContent;
            if (/optional/.test(label)) continue;
            type(w, st.text, 'Test value'); picks[sec.dataset.opt] = 'Test value'; acted = true; break;
          }
          if (!st.enabled.length) { dead = `${sec.dataset.opt}: visible with zero enabled choices`; break; }
          // Optional tiles? Leave unpicked if optional to also test optional path? pick anyway.
          if (st.kind === 'radio') { st.enabled[0].click(); picks[sec.dataset.opt] = st.enabled[0].value; }
          else { choose(w, st.sel, st.enabled[0].value); picks[sec.dataset.opt] = st.enabled[0].value; }
          acted = true; break;
        }
        if (dead || !acted) break;
      }
      if (guard >= 80) problems.push(`${cc} ${p.id}: constraint loop`);
      if (dead) problems.push(`${cc} ${p.id}: DEAD END ${dead}`);
      // AppleCare
      const acSec = dlg.querySelector('.opt-section[data-opt=applecare]');
      if (acSec && !acSec.hidden) {
        const fsets = acSec.querySelectorAll('fieldset');
        const radios = Array.from(fsets[0].querySelectorAll('input[type=radio]'));
        const pick = AC_MODE === 'none' ? radios[0] : AC_MODE === 'plan' ? radios[1] : radios[radios.length - 2];
        if (pick) pick.click();
        const fs2 = acSec.querySelectorAll('fieldset')[1];
        if (fs2) { const r = fs2.querySelector('input[type=radio]:not([disabled])'); if (r) r.click(); }
      }
      if (T.S.items.length >= 25) { checkServer(T, cc, problems); T.S.items.splice(0); }
      const before = T.S.items.length;
      const btn = dlg.querySelector('.sheet-foot .btn');
      btn.click();
      if (dlg.isConnected && dlg.hasAttribute('open')) {
        const errs = Array.from(dlg.querySelectorAll('.invalid')).map(e => (e.dataset.field || e.dataset.opt || e.className) + ': ' + (e.querySelector('.field-error') || {}).textContent);
        problems.push(`${cc} ${p.id}: could not add. errors=${JSON.stringify(errs)} picks=${JSON.stringify(picks)}`);
        dlg.querySelector('.sheet-close').click();
        continue;
      }
      if (T.S.items.length !== before + 1) { problems.push(`${cc} ${p.id}: item not added`); continue; }
      const item = T.S.items[T.S.items.length - 1];
      count++;
      // Verify spec: every pick on a still-visible option is in sel; no extra keys
      for (const [k, v] of Object.entries(picks)) {
        if (item.sel[k] !== v) problems.push(`${cc} ${p.id}: picked ${k}=${v} but saved ${item.sel[k]}`);
      }
      for (const k of Object.keys(item.sel)) if (!(k in picks)) {
        // auto-selected by settle; verify it's valid
        const o = T.resolveOption(p.options.find(x => x.id === k), cc);
        const c = o.choices.find(x => x.value === item.sel[k]);
        const ok = c && (!c.only || Object.entries(c.only).every(([d, al]) => item.sel[d] == null || al.includes(item.sel[d])));
        if (!ok) problems.push(`${cc} ${p.id}: auto-selected ${k}=${item.sel[k]} invalid`);
      }
      // every saved selection must satisfy constraints
      for (const [k, v] of Object.entries(item.sel)) {
        const o = T.resolveOption(p.options.find(x => x.id === k), cc);
        if (!o) { problems.push(`${cc} ${p.id}: saved ${k} for unresolvable option`); continue; }
        if (o.type === 'text') continue;
        const c = o.choices.find(x => x.value === v);
        if (!c) problems.push(`${cc} ${p.id}: saved ${k}=${v} not a choice`);
        else if (c.only && !Object.entries(c.only).every(([d, al]) => item.sel[d] != null && al.includes(item.sel[d])))
          problems.push(`${cc} ${p.id}: saved ${k}=${v} violates only=${JSON.stringify(c.only)} sel=${JSON.stringify(item.sel)}`);
      }
      // required active options must be present
      for (const raw of p.options || []) {
        const o = T.resolveOption(raw, cc);
        if (!o || !o.required) continue;
        const active = o.type === 'text' || o.choices.some(c => !c.only || Object.entries(c.only).every(([d, al]) => item.sel[d] == null || al.includes(item.sel[d])));
        if (active && item.sel[o.id] == null) problems.push(`${cc} ${p.id}: required active option ${o.id} missing in saved sel`);
      }
      if (AC_MODE === 'plan' && acSec && !acSec.hidden && (!item.ac || item.ac.plan !== 'yes')) problems.push(`${cc} ${p.id}: AppleCare "yes" not saved (${item.ac && item.ac.plan})`);
      if (acSec && acSec.hidden && item.ac) problems.push(`${cc} ${p.id}: AppleCare saved although not offered`);
    }
    checkServer(T, cc, problems); T.S.items.splice(0);
    // check errors in console
    for (const l of A.logs) if (l[0] === 'error' || l[0] === 'jsdomError') problems.push(`${cc} console: ${String(l[1]).slice(0, 300)}`);
    A.w.close();
  }
  console.log(`added ${count} items; server-validated ${validated}; problems: ${problems.length}`);
  for (const p of problems) console.log(' -', p);
  process.exitCode = problems.length ? 1 : 0;
})();
