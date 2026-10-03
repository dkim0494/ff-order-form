// Every product gets a real illustration, and the generic glyphs map as intended.
const { make } = require('./lib/app-harness');

(async () => {
  const A = make();
  await A.wait(20);
  const { T } = A;
  const problems = [];
  const keys = Object.keys(T.ART);
  const counts = {};
  for (const p of T.PRODUCTS) {
    const k = T.artKey(p);
    counts[k] = (counts[k] || 0) + 1;
    if (!keys.includes(k)) problems.push(`${p.id}: unknown art key ${k}`);
    if (k === 'bag') problems.push(`${p.id}: fell back to the bag glyph`);
  }
  const expect = {
    'iphone-duo': 'fold', 'iphone-17': 'phone', 'iphone-16': 'phone', 'ipad-pro-m5': 'tablet', 'ipad-mini-a17-pro': 'tablet',
    'macbook-air': 'laptop', 'imac-24-m4': 'desktop', 'mac-mini': 'box', 'mac-studio': 'box-tall', 'studio-display-xdr': 'display',
    'airpods-max-2': 'headphones', 'beats-studio-pro': 'headphones', 'beats-solo-4': 'headphones',
    'airpods-pro-3': 'buds', 'earpods': 'buds', 'beats-solo-buds': 'buds', 'beats-studio-buds-plus': 'buds', 'beats-pill': 'pill',
    'apple-tv-4k': 'tv', 'siri-remote': 'remote', 'homepod': 'homepod', 'homepod-mini': 'homepodmini',
    'apple-pencil-pro': 'pencil', 'apple-pencil-tips-4-pack': 'pencil', 'usb-c-to-apple-pencil-adapter': 'pencil',
    'smart-folio-ipad-air-m4': 'folio', 'magic-keyboard-folio-ipad-a16': 'folio', 'magic-keyboard-ipad-pro-m5': 'keyboard', 'magic-keyboard-touch-id': 'keyboard',
    'magic-mouse': 'mouse', 'magic-trackpad': 'trackpad', 'airtag': 'airtag',
    'iphone-duo-folio-with-kickstand': 'case', 'iphone-duo-case': 'case', 'iphone-air-bumper': 'case', 'clear-case-with-magsafe': 'case',
    'iphone-finewoven-wallet-with-magsafe': 'wallet', 'crossbody-strap': 'strap', 'wrist-strap': 'strap',
    'usb-c-charge-cable': 'cable', 'usb-c-to-magsafe-3-cable': 'cable', 'thunderbolt-pro-cable': 'cable',
    'magsafe-charger': 'magsafe', 'apple-watch-charger': 'magsafe', 'usb-c-power-adapter': 'power', 'apple-adapters': 'dongle',
    'iphone-air-magsafe-battery': 'battery', 'apple-vision-pro-battery': 'battery', 'polishing-cloth': 'cloth',
    'apple-watch-ultra-4': 'watch', 'apple-vision-pro': 'vision',
  };
  for (const [id, k] of Object.entries(expect)) {
    const p = T.PRODUCT.get(id);
    if (!p) { problems.push(`missing product ${id}`); continue; }
    const got = T.artKey(p);
    if (got !== k) problems.push(`${id}: expected ${k}, got ${got}`);
  }
  for (const [cat, k] of Object.entries(T.CATEGORY_ART)) if (!keys.includes(k)) problems.push(`category ${cat}: unknown art key ${k}`);
  // Nothing model-specific sneaks back in: no inline styles, no removed classes.
  for (const [k, m] of Object.entries(T.ART)) {
    if (/style=/.test(m)) problems.push(`${k}: inline style attribute`);
    if (/class="l"/.test(m)) problems.push(`${k}: uses the removed .l class`);
    if (!/class="(c|cs|o)/.test(m)) problems.push(`${k}: no tinted body or outline`);
  }
  // Missing products (a removed catalog entry still in a saved bag) and custom items fall back cleanly.
  if (T.artKey({ category: 'iphone', name: 'Old phone' }) !== 'phone') problems.push('artKey: missing product fallback');
  if (T.artKey(null) !== 'bag') problems.push('artKey: null fallback');
  // firstHex picks the first colour choice, or nothing.
  const i17 = T.PRODUCT.get('iphone-17');
  if (T.firstHex(i17) !== i17.options.find(o => o.type === 'color').choices[0].hex) problems.push('firstHex: wrong hex');
  if (T.firstHex(T.PRODUCT.get('mac-mini')) !== '') problems.push('firstHex: expected empty for mac-mini');
  for (const l of A.logs) if (l[0] === 'error' || l[0] === 'jsdomError') problems.push(`console: ${String(l[1]).slice(0, 200)}`);
  console.log(`art keys used: ${Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', ')}`);
  console.log(`art problems: ${problems.length}`);
  for (const x of problems) console.log(' -', x);
  A.w.close();
  process.exitCode = problems.length ? 1 : 0;
})();
