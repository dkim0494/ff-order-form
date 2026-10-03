# Friends & Family order form: notes for agents

A static, Apple-style web form for collecting friends-and-family Apple purchase requests from anywhere in the world. Requests go to a Google Apps Script web app, which writes them into the owner's private Google Sheet. `README.md` is the owner-facing guide (setup, deploy, privacy). This file covers what an agent needs to change the code safely.

## Goals the owner set (keep them)

- **Apple-like, elegant, simple.** System fonts, Apple spacing and colors, tiles, swatches and floating labels. Sentence case for labels and help, Title Case for buttons ("Add to Bag", "Review Request"). Copy is short and friendly.
- **Robust.** No dependencies, no build step, vanilla JS, works from any static host.
- **Every product category, worldwide.**
- **Privacy- and security-conscious.** Never collect card numbers, gift card codes, passwords, ID numbers or prescriptions. Keep data minimal.

## Files

| Path | Role |
|---|---|
| `index.html` | Shell. Loads `config.js`, `data/world.js`, `data/catalog.js`, `app.js` in that order. No inline JS. |
| `styles.css` | All styling. Tokens on `:root`, dark mode via `prefers-color-scheme`, forced-colors and reduced-motion blocks at the end. |
| `app.js` | The whole UI, one IIFE (~2,200 lines). Map below. |
| `config.js` | Owner settings (`window.FF_CONFIG`): endpoint, payment/contact methods (optionally per country), acknowledgements, limits. |
| `data/catalog.js` | `window.FF_CATALOG`: `categories`, `programs` (keyboard layouts, carriers, AppleCare, trade-in countries) and `products`. Researched from apple.com on 2026-10-02/03. |
| `data/world.js` | `window.FF_WORLD`: 252 countries (Google libaddressinput formats, Latin `lfmt` preferred, dial codes, currencies, states), `stores` (535 Apple Stores by country), `onlineStoreCountries`. |
| `apps-script/Code.gs` | Backend. Pasted into the owner's Sheet (Extensions > Apps Script). `@OnlyCurrentDoc`, V8 runtime. |
| `tests/` | Dev-only tests (see Testing). Not needed for hosting. |
| `_headers` | Optional security headers for Netlify/Cloudflare Pages. |
| `.claude/launch.json` | Preview server config `order-form` on http://localhost:8765. |

## How to run

- Start the `order-form` preview (python `http.server`, port 8765) and open `http://localhost:8765/`.
- With `endpoint: ''` in `config.js` the app runs in **preview mode**: a banner shows, nothing is sent, and the final payload is logged to the console (`[preview] payload that would be sent:`) with a fake reference `FF-PREVIEW`.
- `python -m http.server` lets the browser cache files. Hard-reload after edits, or serve with a `Cache-Control: no-store` handler.
- The draft autosaves to `localStorage['ff-order-draft-v1']`. Clear it between manual test runs (the footer has a "Clear this form" link). The done page uses `sessionStorage['ff-order-done-v1']`.

## Testing

```bash
npm install --prefix tests
npm test --prefix tests
```

- `tests/data-check.test.js`: cross-checks the catalog and world data and walks every configuration path for every product in every online-store country (about 1.2M paths), looking for dead ends and broken references. Run it after any catalog edit. Two expected notes are ignored: AQ has no currency, and IN uses address tokens the app skips.
- `tests/backend.test.js`: runs `Code.gs` against an in-memory mock of SpreadsheetApp, CacheService, LockService, MailApp, PropertiesService and the rest (`tests/lib/gas-mock.js`). Covers validation, formula injection, rate limits, idempotency, sheet growth past 1,000 rows, emails, retention clean-up and setup.
- `tests/catalog-sweep.test.js`: drives the real UI in jsdom (`tests/lib/app-harness.js`). For every product and 11 countries it configures the item, adds it to the bag, builds the payload and runs it through the server's `validate_()`. Expect `server-validated 946; problems: 0`.
- `app-harness.js` exposes internals as `window.__T` by inserting a hook before the line `  if (document.readyState === 'loading')` at the end of `app.js`. Keep that line, or update the harness.
- Visual and a11y checks were done in headless Chrome (puppeteer-core with the system Chrome). Those scripts were throwaway. For UI changes, check 375×812 and 1280×800, light and dark.
- None of this has run against a real Apps Script deployment. The owner should run `sendTestRequest()` after deploying.

## app.js map (search by name; line numbers drift)

- **config/data:** `CFG` (defaults merged with `FF_CONFIG`), `PRODUCTS`, `PRODUCT`, `COUNTRY`, `STORES`, `ONLINE`, `PROGRAMS`.
- **utilities:**
  - `h(tag, props, ...kids)` is the DOM builder. Text goes through `textContent` and attributes through `setAttribute`. **Never put user or catalog data into `innerHTML`.** `svg()` is the only `innerHTML` use, and only for static markup in this file.
  - `setKids()` is a null-safe `replaceChildren`.
  - `ICON`, `ART`, `artKey()`, `art(key, hex)` draw the product illustrations, tinted with the chosen color.
- **sensitive data:** `sensitiveKind(value, {address})` catches card numbers (checks every window of digit groups, card prefixes, Luhn), Apple gift card codes, US SSNs and passwords/PINs (the password rule is skipped for address fields because India calls postal codes "PIN code"). **Mirrored in `Code.gs` `looksSensitive_()`: change both together.**
- **state:** `S` is the whole form state. `blankState()`, `loadDraft()` (14-day TTL that keeps an invite code from a link), `save()` (debounced), `resetAll()`.
- **catalog logic:**
  - `resolveOption(o, country)` applies option/choice `regions`, `choicesRef` (`keyboardLayouts` honors `keyboardLayoutsByCountry`; `carriers` hides the option where none exist), and relaxes choice regions in countries without an Apple online store.
  - `appleCareFor()` and `billingFor()` filter plans and billing by country.
  - `soldIn()` flags products whose `regions` exclude the country; they can still be requested.
- **addresses:** `addressSpec(code)` turns libaddressinput `fmt`/`require`/`zip`/`states` into field rows and labels. `formatAddress()` renders the label sent to the Sheet.
- **validation:** `errorsFor(stepId)` returns a `Map` of field key to message for each step. `MAX_LINES = 30` matches `Code.gs`. `fullPhone()` adds the dial code and drops a trunk `0` (not for Italy). `parseAmount()` handles "2 000" and "1,500".
- **form parts:**
  - `textField`, `selectField`, `choiceGroup` (tiles or swatches built on real radio inputs), `checkbox`.
  - Errors live in `ERR` (or a local `errs` map inside sheets). They render with `aria-describedby`, not `role=alert`, and `clearError()`/`clearErrorIn()` remove them on input.
  - `refocus()` puts keyboard focus back on the replacement control after a change re-renders its region. Every re-render must keep focus.
- **sheets:** `openSheet()` builds a `<dialog>` with title autofocus and restores focus to the opener (or its replacement) on close. Used by `openConfigurator()` (option sections, `only`-constraint engine in `settle()`, AppleCare, engraving, quantity, notes), `openCustomItem()` ("Something else") and `openBag()`.
- **steps:**
  - `renderProducts` (search, category tablist with arrow keys, product grid, bag aside), `renderTradeIn`, `renderYou`, `renderDelivery` (country, pickup store or address, recipient), `renderReview` (payment, summary cards, acknowledgements, invite), `renderDone`.
  - `paintBag()` refreshes the bag panel, product badges, the bag sheet and the review list.
- **submission:**
  - `buildPayload()` produces exactly what `Code.gs` `validate_()` expects.
  - `submit()` reuses the submission id when the content is unchanged (fingerprint), so retries are idempotent. Changed content gets a new id.
  - `postJSON()` sends `text/plain` (no CORS preflight; the Apps Script `/exec` endpoint 302s to googleusercontent).
- **routing:** hash routes (`#products`, `#trade-in`, `#you`, `#delivery`, `#review`, `#done`, plus `#invite=CODE`, which is consumed and stripped). `onRoute()` blocks skipping past invalid steps, says why, and focuses the first error. After Review has been reached once, the primary button says "Review Request" and jumps back to Review.

## Catalog format (data/catalog.js)

Products: `{ id, name, category, group?, blurb?, isNew?, engraving?, applecare?, regions?, options: [...] }`.

Options: `{ id, label, type: color|tiles|select|text, help?, required?, placeholder?, regions?, choicesRef?, error?, choices: [{ value, detail?, hex?, regions?, only? }] }`.

- `only: { optionId: [values] }` makes a choice available only when an **earlier** option has one of those values. An option whose choices are all gated on the same earlier option is hidden until relevant, and required once shown (e.g. iPad carrier after "Wi-Fi + Cellular").
- Colors need `hex`.
- Don't add prices (they vary by country and discount) or AppleCare as an option (it comes from `programs.applecare` via the product's `applecare` key).
- Run `npm run test:data --prefix tests` after edits.

## Backend contract and gotchas (apps-script/Code.gs)

- `validate_()` is the source of truth for field names and limits. Keep `buildPayload()` and the client limits (`maxlength`, `MAX_LINES`) in step with it.
- Writes happen under `LockService`: duplicate check (`findOrderBySubmission_`), then rate limits, then `writeOrder_` (Items rows first, then the Orders row, with rollback on failure; `writeRows_` grows the tab and sets Plain-text formats per row), then the confirmation slot. Emails go out after the lock is released.
- The requester confirmation deliberately contains only a letters-only first word, the reference number and the item count. It's capped per day (`PropertiesService`) and keeps 20 sends in reserve. Don't add requester-typed text to it.
- `cleanUpOldOrders()` runs daily from the trigger `setup()` installs. It erases personal columns 60 days after Completed/Cancelled, including free-text Payment ("Other: …") and custom-item Configuration. The Orders "Products" summary deliberately leaves out engraving, notes and links so it can be kept.
- The owner must **deploy a new version** after any `Code.gs` change (Deploy > Manage deployments > edit > New version).
- Decisions made on purpose:
  - There is no lockout after wrong invite codes, because a lockout would let anyone block real requesters. A long random code is recommended instead.
  - The owner's notification email includes item notes but not phone numbers or addresses.

## Editing pitfalls seen in this project

- Write `\u200B`-style escapes carefully. A file-writing tool once turned them into literal invisible characters. Check with `grep -n 'u200' apps-script/Code.gs`.
- Don't rebuild a `<select>` on every `change`. Keyboard type-ahead fires a change per letter, and rebuilding resets it (this happened with the country, store and currency pickers). Re-render only when the structure changes, or after typing pauses.
- CSS `[hidden] { display: none !important; }` exists because component `display` rules override the attribute.
- Floating labels shrink with `font-size`, not `transform: scale`. Scaling widened the page on phones mid-transition.
- Focus rings use `outline` (with `--focus-ring`), because component `box-shadow`s used to hide them. Forced-colors mode shows selection with borders and focus with outlines.

## Open items and ideas

- The form is English only.
- `config.js` payment methods are a guess (Apple Cash, Venmo and Zelle are US-only). Confirm with the owner.
- The catalog needs a refresh each September. iPhone Duo is listed with a pre-order note (pre-orders open Oct 16, 2026). The Mac Studio 512GB memory option ("coming late October") isn't in the data yet.
