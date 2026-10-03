// A saved draft can outlive a catalog refresh. When a chosen option is gone, no
// longer allowed, or a required one was added, the bag says which item changed,
// the steps after Products are blocked, and Edit fixes it through the
// configurator's own reset notice.
const { make } = require('./lib/app-harness');

(async () => {
  const problems = [];
  const expect = (cond, msg) => { if (!cond) problems.push(msg); };
  const dlg = A => A.$('dialog.sheet[open]');
  const noErrors = (A, tag) => { for (const l of A.logs) if (l[0] === 'error' || l[0] === 'jsdomError') problems.push(`${tag} console: ${String(l[1]).slice(0, 200)}`); };
  const configure = (A, pid, picks = []) => {
    A.T.openConfigurator(A.T.PRODUCT.get(pid));
    for (const [opt, value] of picks) {
      const r = A.$(`.opt-section[data-opt="${opt}"] input[type=radio][value="${value}"]`, dlg(A));
      expect(r && !r.disabled, `${pid}: radio ${opt}=${value}`);
      if (r) r.click();
    }
    for (let guard = 0; guard < 30 && dlg(A); guard++) {
      const sec = A.$$('.opt-section[data-opt]', dlg(A)).find(s => !s.hidden && s.dataset.opt !== 'applecare' && !s.querySelector('input:checked') && s.querySelector('input[type=radio]:not([disabled])'));
      if (!sec) break;
      sec.querySelector('input[type=radio]:not([disabled])').click();
    }
    const ac = A.$('.opt-section[data-opt="applecare"] input[type=radio]', dlg(A));
    if (ac) ac.click();
    A.$('.sheet-foot .btn', dlg(A)).click();
    expect(!dlg(A), `${pid}: configurator closed after add`);
  };

  // 1. A real draft: Mac Studio configured through the UI.
  const A = make({ config: { defaultCountry: 'US' } });
  await A.wait(20);
  // The 40-core chip offers three memory tiers, so dropping one leaves a real choice to make.
  configure(A, 'mac-studio', [['chip', 'M5 Max 18-core CPU, 40-core GPU']]);
  const item0 = A.T.S.items[0];
  expect(item0 && item0.sel.memory && item0.sel.chip, 'draft item has chip and memory');
  expect(A.T.staleOptions(item0).length === 0, 'fresh item is not stale');
  const mem = item0.sel.memory;
  A.T.next(); // Products → Trade-in, records maxStep
  await A.wait(30);
  expect(A.w.location.hash === '#trade-in', `moved on with a fresh item (${A.w.location.hash})`);
  await A.wait(400); // the autosave is debounced
  const draft = A.w.localStorage.getItem('ff-order-draft-v1');
  expect(draft && JSON.parse(draft).items.length === 1, 'draft saved');
  noErrors(A, 'A');
  A.w.close();

  const storage = { 'ff-order-draft-v1': draft };
  const studio = w => w.FF_CATALOG.products.find(p => p.id === 'mac-studio');

  // 2. The memory tier disappears from the catalog: the item is flagged, the route is held at Products, Edit repairs it.
  {
    const B = make({ config: { defaultCountry: 'US' }, storage, hash: '#trade-in', mutate(w) {
      const o = studio(w).options.find(x => x.id === 'memory');
      o.choices = o.choices.filter(c => c.value !== mem);
    } });
    await B.wait(30);
    const { $, $$, T } = B;
    expect(B.w.location.hash === '#products', `sent back to Products (${B.w.location.hash})`);
    const err = T.errorsFor('products').get('bag') || '';
    expect(/changed since you picked them/.test(err), `products step error: "${err}"`);
    const warn = $('#bag-panel .bag-item.stale .bag-item-warn');
    expect(warn && warn.textContent === `Changed since you picked it: Memory ${mem}. Edit to choose again.`, `inline warning "${warn && warn.textContent}"`);
    T.next();
    await B.wait(30);
    expect(B.w.location.hash === '#products' && /changed since you picked them/.test($('#toasts').textContent), 'Continue is refused with the toast');
    expect(T.buildPayload().items[0].options.some(o => o.value === mem), 'payload would still carry the old value (so the block matters)');
    // Edit: the configurator explains and asks for memory again.
    $('#bag-panel [data-act="edit"]').click();
    expect(dlg(B), 'configurator opened from the bag');
    const note = $('.opt-section[data-opt="memory"] .opt-reset', dlg(B));
    expect(note && note.textContent === `${mem} is no longer offered. Choose memory again.`, `reset notice "${note && note.textContent}"`);
    const btnBefore = $('.sheet-foot .btn', dlg(B));
    btnBefore.click();
    expect(dlg(B) && $('.opt-section[data-opt="memory"] .invalid, .opt-section[data-opt="memory"].invalid', dlg(B)), 'cannot save without choosing memory');
    const choice = $('.opt-section[data-opt="memory"] input[type=radio]:not([disabled])', dlg(B));
    choice.click();
    $('.sheet-foot .btn', dlg(B)).click();
    expect(!dlg(B), 'saved after choosing');
    expect(T.S.items[0].sel.memory === choice.value && T.S.items[0].sel.memory !== mem, 'item carries the new memory');
    expect(T.errorsFor('products').size === 0 && !$('.bag-item.stale'), 'no longer stale');
    T.next();
    await B.wait(30);
    expect(B.w.location.hash === '#trade-in', `moves on after the fix (${B.w.location.hash})`);
    noErrors(B, 'B');
    B.w.close();
  }

  // 3. A required option Apple added since (nothing chosen for it yet).
  {
    const C = make({ config: { defaultCountry: 'US' }, storage, mutate(w) {
      studio(w).options.push({ id: 'glass', label: 'Display glass', type: 'tiles', choices: [{ value: 'Standard' }, { value: 'Nano-texture' }] });
    } });
    await C.wait(30);
    const warn = C.$('#bag-panel .bag-item.stale .bag-item-warn');
    expect(warn && warn.textContent === 'Changed since you picked it: Display glass (new choice). Edit to choose again.', `new-option warning "${warn && warn.textContent}"`);
    C.$('#bag-panel [data-act="edit"]').click();
    C.$('.opt-section[data-opt="glass"] input[type=radio][value="Standard"]', dlg(C)).click();
    C.$('.sheet-foot .btn', dlg(C)).click();
    expect(!dlg(C) && C.T.S.items[0].sel.glass === 'Standard' && C.T.errorsFor('products').size === 0, 'fixed by choosing the new option');
    noErrors(C, 'C');
    C.w.close();
  }

  // 4. A whole option removed: the item still carries its text, so it is flagged; Edit drops it.
  {
    const D = make({ config: { defaultCountry: 'US' }, storage, mutate(w) {
      const p = studio(w);
      p.options = p.options.filter(o => o.id !== 'memory');
    } });
    await D.wait(30);
    const warn = D.$('#bag-panel .bag-item.stale .bag-item-warn');
    expect(warn && warn.textContent === `Changed since you picked it: Memory ${mem}. Edit to choose again.`, `removed-option warning "${warn && warn.textContent}"`);
    D.$('#bag-panel [data-act="edit"]').click();
    D.$('.sheet-foot .btn', dlg(D)).click();
    expect(!dlg(D) && !('memory' in D.T.S.items[0].sel) && !D.T.S.items[0].spec.some(s => s.id === 'memory') && D.T.errorsFor('products').size === 0, 'saved without the vanished option');
    noErrors(D, 'D');
    D.w.close();
  }

  // 5. A choice that still exists but is no longer allowed with the chosen chip.
  {
    const E = make({ config: { defaultCountry: 'US' }, storage, mutate(w) {
      const o = studio(w).options.find(x => x.id === 'memory');
      const c = o.choices.find(x => x.value === mem);
      c.only = { chip: ['no-such-chip'] };
    } });
    await E.wait(30);
    expect(E.$('#bag-panel .bag-item.stale'), 'blocked combination is flagged');
    E.$('#bag-panel [data-act="edit"]').click();
    const note = E.$('.opt-section[data-opt="memory"] .opt-reset', dlg(E));
    expect(note && /isn’t available with that choice/.test(note.textContent), `combination notice "${note && note.textContent}"`);
    E.w.close();
  }

  // 6. Unaffected: a custom item, a product removed from the catalog, a country switch, and an untouched draft.
  {
    const F = make({ config: { defaultCountry: 'US' }, storage });
    await F.wait(30);
    const { T } = F;
    expect(T.errorsFor('products').size === 0 && !F.$('.bag-item.stale'), 'unchanged catalog: nothing flagged');
    expect(T.staleOptions({ id: 'c', pid: '', custom: true, name: 'Thing', cat: 'other', sel: {}, spec: [{ id: 'details', label: 'Details', value: 'x', kind: 'tiles' }], qty: 1 }).length === 0, 'custom items are never stale');
    expect(T.staleOptions(Object.assign({}, T.S.items[0], { pid: 'gone-product' })).length === 0, 'a removed product is left alone');
    T.setCountry('JP');
    expect(T.staleOptions(T.S.items[0]).length === 0, 'changing country does not flag an item configured elsewhere');
    noErrors(F, 'F');
    F.w.close();
  }

  if (problems.length) { console.log('stale problems: ' + problems.length + '\n - ' + problems.join('\n - ')); process.exitCode = 1; }
  else console.log('stale problems: 0');
})().catch(e => { console.error(e); process.exitCode = 1; });
