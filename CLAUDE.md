# Friends & Family order form: notes for agents

A static, Apple-style web form for collecting friends-and-family Apple purchase requests from anywhere in the world. Requests go to a Google Apps Script web app, which writes them into the owner's private Google Sheet. `README.md` is the owner-facing guide (setup, invites, deploy, privacy, adding products). This file covers what an agent needs to change the code safely.

## Goals the owner set (keep them)

- **Apple-like, elegant, simple.** System fonts, Apple spacing and colors, filled tiles, swatches and floating labels. Sentence case for labels and help, Title Case for buttons ("Add to Bag", "Review Request"). Copy is short and friendly.
- **Every critical detail, as few buttons as possible.** Short explanations are welcome; extra choices are not. AppleCare is a single No/Yes question on purpose; the payment step stays as it is (owner's decision).
- **Robust.** No dependencies, no build step, vanilla JS, works from any static host.
- **Every product category, worldwide.** Illustrations are generic (a phone, a tablet), never model-specific, so a new product needs no artwork.
- **Privacy- and security-conscious.** Never collect card numbers, gift card codes, passwords, ID numbers or prescriptions. Keep data minimal. Only invited people can submit.
- **Easy to keep up.** New products are a data edit plus one check command; deploy is a push.

## Files

| Path | Role |
|---|---|
| `index.html` | Shell. Loads `config.js`, `data/world.js`, `data/catalog.js`, `app.js` in that order, all by relative path (the page works under a subfolder). No inline JS. |
| `styles.css` | All styling. Tokens on `:root` (colour, depth, radius, spacing `--sp-*`, type `--fs-*`, motion `--dur-1/2/3`, `--header-h`, `--actionbar-h`), dark mode via `prefers-color-scheme`, then hover (guarded by `hover: hover`), forced-colors, reduced-motion and print blocks at the end. |
| `app.js` | The whole UI, one IIFE (~2,500 lines). Map below. |
| `config.js` | Owner settings (`window.FF_CONFIG`): endpoint, `inviteCodeRequired`, payment/contact methods (optionally per country), acknowledgements, limits. Nothing secret. |
| `data/catalog.js` | `window.FF_CATALOG`: `categories`, `programs` (keyboard layouts, carriers, AppleCare availability, trade-in countries) and `products`. Researched from apple.com on 2026-10-02/03. |
| `data/world.js` | `window.FF_WORLD`: 252 countries (Google libaddressinput formats, Latin `lfmt` preferred, dial codes, currencies, states), `stores` (535 Apple Stores by country), `onlineStoreCountries`. |
| `apps-script/Code.gs` | Backend. Pasted into the owner's Sheet (Extensions > Apps Script). `@OnlyCurrentDoc`, V8 runtime. Keep `INVITE_CODE` empty in this copy; the repository is public. |
| `apps-script/Invites.html` | The "Manage invites…" sidebar (HtmlService), pasted into the same script project as a file named `Invites`. Self-contained: no external files, no `innerHTML`, talks to the `admin*` functions through `google.script.run`. |
| `tests/` | Dev-only tests (see Testing). Not needed for hosting and never deployed. |
| `.github/workflows/pages.yml`, `.nojekyll` | GitHub Pages deploy on push to `main`. The workflow copies only the page files into the artifact. |
| `_headers` | Optional security headers for Netlify/Cloudflare Pages (GitHub Pages ignores it). |
| `.claude/launch.json` | Preview server config `order-form` on http://localhost:8765. `.claude/plan*.md` are agent working notes and are git-ignored. |

## How to run

- Start the `order-form` preview (python `http.server`, port 8765) and open `http://localhost:8765/`.
- With `endpoint: ''` in `config.js` the app runs in **preview mode**: a banner shows, nothing is sent, the invite gate (if `inviteCodeRequired`) accepts any code, and the final payload is logged to the console (`[preview] payload that would be sent:`) with a fake reference `FF-PREVIEW`.
- `python -m http.server` lets the browser cache files. Hard-reload after edits (or `fetch(url, { cache: 'reload' })` to confirm what is served).
- The draft autosaves to `localStorage['ff-order-draft-v1']` (debounced; don't read it back immediately after an action). Clear it between manual runs (footer link "Clear this form"). The done page uses `sessionStorage['ff-order-done-v1']`.
- The Claude desktop browser pane freezes CSS animations and transitions while it is hidden, and its screenshots then show stale or mid-animation frames (ghosted sheets, labels over values, dimmed steps). Check `document.visibilityState`, verify through the DOM or computed styles, and re-take screenshots once the pane is visible.

## Testing

```bash
npm install --prefix tests
npm test --prefix tests          # everything below
npm run check --prefix tests     # data check + art mapping only; what the README tells the owner to run after a catalog edit
```

- `tests/data-check.test.js`: cross-checks the catalog and world data and walks every configuration path for every product in every online-store country (about 1.2M paths). Two expected notes are ignored: AQ has no currency, and IN uses address tokens the app skips.
- `tests/art.test.js`: every product maps to an existing glyph (no `bag` fallback) and the keyword mapping in `artKey()` holds for a list of representative products.
- `tests/journey.test.js`: one whole request through the real UI in jsdom: configure with quantity, search, bag sheet remove + Undo, trade-in, details, delivery, review, preview send, done, start over. Fails on wrong routes, dead ends and console errors.
- `tests/gate.test.js`: the invite gate with a stubbed backend: locked page, wrong and right codes, `#invite=` links, a revoked invite in a saved draft, preview mode, flag off.
- `tests/stale.test.js`: a saved draft outliving a catalog change (harness `storage` + `mutate` on `FF_CATALOG`): a dropped memory tier, a required option added, a whole option removed, a combination newly blocked by `only`; checks the inline warning, the route held at Products, the configurator's reset notice and the repaired item; plus the cases that must not flag (custom item, removed product, country switch, unchanged catalog). `catalog-sweep` also asserts that every freshly configured item is not stale.
- `tests/backend.test.js`: runs `Code.gs` against an in-memory mock of SpreadsheetApp (including `getUi()`), HtmlService, CacheService, LockService, MailApp, PropertiesService and the rest (`tests/lib/gas-mock.js`). Covers validation, formula injection, rate limits, idempotency, sheet growth past 1,000 rows, emails, retention clean-up, setup, the Invites tab, the header upgrade and the invites panel's server functions (section "invites panel").
- `tests/sidebar.test.js`: the real `Invites.html` in jsdom, wired to the real `Code.gs` in the mock through a fake `google.script.run` (asynchronous, JSON round trip, Dates rejected, errors to the failure handler). Walks: empty state, page address (refused and saved), add, copy (clipboard and the blocked-clipboard fallback), switch off/on with `doPost` refusing in between, the stale-row guard, the footer address editor, notices, and the page opened outside Sheets.
- `tests/catalog-sweep.test.js`: for every product and 11 countries it configures the item through the UI, adds it to the bag, builds the payload and runs it through the server's `validate_()`. Expect `server-validated 946; problems: 0`. Third argument `plan` or `last` picks the AppleCare answer.
- `app-harness.js` exposes internals as `window.__T` by inserting a hook before the line `  if (document.readyState === 'loading')` at the end of `app.js`. Keep that line, or update the harness. It accepts `config`, `hash`, `storage`, `fetch` and `patch` options.
- **Harness compatibility rules** (jsdom has no Web Animations API, no popover, no CSS animations, no layout, and its `showModal`/`close` stubs fire `close` synchronously): feature-detect `getAnimations`, `animate`, `ResizeObserver`, `navigator.clipboard`; `closeSheet()` must close synchronously when there are no animations; attach `close` listeners before calling `sheet.close()`; option sections keep using the `hidden` property; `.cats .cat` text must equal the category name; the AppleCare section stays `[data-opt="applecare"]` with its radios in the first `fieldset`.
- None of this has run against a real Apps Script deployment. The owner should run `sendTestRequest()` after deploying (it uses the first active invite when there is no shared code).

## app.js map (search by name; line numbers drift)

- **config/data:** `CFG` (defaults merged with `FF_CONFIG`), `PRODUCTS`, `PRODUCT`, `COUNTRY`, `STORES`, `ONLINE`, `PROGRAMS`.
- **utilities:**
  - `h(tag, props, ...kids)` is the DOM builder. Text goes through `textContent` and attributes through `setAttribute`. **Never put user or catalog data into `innerHTML`.** `svg()` is the only `innerHTML` use, and only for static markup in this file.
  - `setKids()` is a null-safe `replaceChildren`. `replay(el, cls)` re-triggers a CSS animation class.
  - `reduceMotion()` / `smooth()` read `prefers-reduced-motion`.
- **illustrations:** `ART` holds 35 generic 80×80 glyphs (phone, fold, tablet, folio, laptop, desktop, box, box-tall, tower, display, watch, vision, buds, headphones, pill, homepod, homepodmini, tv, remote, pencil, keyboard, mouse, trackpad, airtag, power, magsafe, cable, dongle, case, strap, wallet, battery, cloth, bag, other). SVG classes: `.c` tinted body (`--art-fill`, always with the `--art-line` stroke so near-white finishes stay visible), `.d` dark screen, `.k` shade, `.hl` highlight, `.o` outline, `.ot` thick outline, `.ob` hairline under a tinted band, `.cs` tinted stroke. Stroke width scales per size through `--art-stroke` set by the sizing selectors in CSS. `artKey(p)` picks a glyph from category + name keywords; `CATEGORY_ART` maps tabs; `firstHex(p)` is the first colour choice and tints both the card and the configurator header; `art(key, hex)` builds the span. No inline `style` attributes inside glyphs.
- **sensitive data:** `sensitiveKind(value, {address})` catches card numbers (checks every window of digit groups, card prefixes, Luhn), Apple gift card codes, US SSNs and passwords/PINs (the password rule is skipped for address fields because India calls postal codes "PIN code"). **Mirrored in `Code.gs` `looksSensitive_()`: change both together.**
- **state:** `S` is the whole form state, including `invite`, `inviteFromLink`, `inviteOk`, `inviteName`. `blankState()`, `loadDraft()` (14-day TTL that keeps an invite code from a link), `save()` (debounced), `resetAll()` (a verified invite survives "Start a New Request").
- **catalog logic:**
  - `resolveOption(o, country)` applies option/choice `regions`, `choicesRef` (`keyboardLayouts` honors `keyboardLayoutsByCountry`; `carriers` hides the option where none exist), and relaxes choice regions in countries without an Apple online store.
  - `appleCareFor(product, country)` only decides whether the AppleCare+ question is offered in that country. `appleCareText(ac)` turns `ac.plan` (`none` | `yes`; older drafts may hold a plan name or `advise`) into the Sheet text.
  - `soldIn()` flags products whose `regions` exclude the country; they can still be requested.
- **addresses:** `addressSpec(code)` turns libaddressinput `fmt`/`require`/`zip`/`states` into field rows and labels. `formatAddress()` renders the label sent to the Sheet.
- **validation:** `errorsFor(stepId)` returns a `Map` of field key to message for each step. `MAX_LINES = 30` matches `Code.gs`. The products step also fails (key `bag`) when any item is stale: `staleOptions(item)` re-resolves the product's options for `item.country` and lists chosen values that no longer exist or are no longer allowed by the item's other choices, required options added since, and whole options that disappeared; `staleText()` is the line `bagList()` shows under the item (`.bag-item.stale .bag-item-warn`). Custom items and removed products are never stale (a removed product keeps working by design). Because `onRoute()`, `next()` and `submit()` all consult `errorsFor`, a stale draft is held on the Products step until the item is edited; the configurator's `settle()` then shows the reset notice ("… is no longer offered" when the value vanished, "… isn't available with that choice" when another choice blocks it). `fullPhone()` adds the dial code and drops a trunk `0` (not for Italy). `parseAmount()` handles "2 000" and "1,500".
- **form parts:**
  - `textField`, `selectField`, `choiceGroup` (tiles or swatches built on real radio inputs), `checkbox`, `qtyControl`.
  - Errors live in `ERR` (or a local `errs` map inside sheets). They render with `aria-describedby`, not `role=alert`, and `clearError()`/`clearErrorIn()`/`markInvalid()` manage them in place.
  - `refocus()` puts keyboard focus back on the replacement control after a change re-renders its region. Every re-render must keep focus.
- **toasts:** `toast(msg, { action, onAction, duration })`. One at a time. While a sheet is open the toast mounts inside the top-most `dialog[open]:not(.closing)` (`toastWrap()`), because a modal dialog makes everything else inert, popovers included; otherwise it lives in `#toasts`. `removeItem()` offers Undo this way.
- **sheets:** `openSheet()` builds a `<dialog>` with title autofocus and returns `close` = `closeSheet()`, which adds `.closing`, waits for `getAnimations()` to finish (450ms fallback) and closes at once in jsdom, under reduced motion, or while the page is hidden. Escape goes through the `cancel` event. Focus returns to the opener found by `selectorFor()` (`#id` → `[data-pid]` → `[data-act][data-id]` → `aria-label`, preferring a visible match); if the route changed meanwhile the new step title gets focus. Used by `openConfigurator()` (option sections with `.reveal` on show, `settle()` for `only` constraints with a `resetNote` notice when it clears a choice, the AppleCare+ question, engraving, quantity with "Add N to Bag", notes), `openCustomItem()` ("Something else") and `openBag()` (Edit opens the configurator after the bag sheet has closed, via `onAction(run)`).
- **bag feedback:** on add, `sheet.close()` then `paintBag(false, item.id)`; a once-`close` listener runs `flyToBag(cardArt, hex, done)` (Web Animations API, skipped without it, under reduced motion or when hidden) and then `bumpBagCount()` + the toast. `paintBag(bump, addedId)` repaints the count, aside, badges (`.product-in-bag.pop`), bag sheet and review list and highlights `.bag-item[data-id].just-added`. The aside is hidden under 1000px by CSS; phones use the action bar's "View Bag" and the bag sheet.
- **steps:**
  - `renderProducts`: the 8 category tabs are built once (`tabs[]`, `syncCats()`, `selectCat()`, Home/End supported, `aria-controls="products-panel"`); the sliding selected surface is `.cats::before` placed by `placeIndicator()` from layout (`--ind-x`/`--ind-w`, class `placed`; until then the selected tab styles itself). Search is debounced 120ms, repaints only the grid (into a fragment) and announces counts in `p.search-status[role=status]`. `otherCard()` has `id="product-other"`.
  - `renderTradeIn`, `renderYou`, `renderDelivery` (country, pickup store or address, recipient), `renderReview` (payment, summary cards, acknowledgements), `renderDone` (`refControl()`: the reference as a copy button when the clipboard exists). `stepEyebrow(i)` writes "Step N of 5".
- **submission:**
  - `buildPayload()` produces exactly what `Code.gs` `validate_()` expects, including `invite`.
  - `submit()` reuses the submission id when the content is unchanged (fingerprint), so retries are idempotent. While sending, `setBusy(true)` makes `.topbar`, `#main` and `.site-foot` inert, `go()` refuses to navigate and `onRoute()` pins the hash to `#review`; the primary button says "Sending…". A server `invite` error sends the page back to the gate.
  - `postJSON()` sends `text/plain` (no CORS preflight; the Apps Script `/exec` endpoint 302s to googleusercontent).
- **invite gate:** `gateNeeded()` is true when `CFG.inviteCodeRequired` (or `S.inviteNeeded` after a server refusal) and the invite isn't verified. `onRoute()` then renders `renderGate()` instead of the step and hides progress and action bar. `verifyInvite(code)` GETs `endpoint?invite=CODE` (preview mode accepts anything); `#invite=CODE` links verify automatically once (`UI.gateTried` stops loops); `boot()` re-checks a stored invite quietly and only acts on a definite no.
- **progress and routing:** `paintProgress()` creates the five segment buttons once and then only toggles classes, so the fill animates; labels show at ≥720px. Hash routes (`#products`, `#trade-in`, `#you`, `#delivery`, `#review`, `#done`, plus `#invite=CODE`, which is consumed and stripped). `onRoute()` blocks skipping past invalid steps, says why, focuses the first error, and skips the `step-in` animation when the step didn't change. After Review has been reached once, the primary button says "Review Request" and jumps back to Review.

## Catalog format (data/catalog.js)

The README section "Keeping the catalog current" is the owner-facing recipe; keep it in step with this.

Products: `{ id, name, category, group?, blurb?, isNew?, engraving?, applecare?, regions?, options: [...] }`.

Options: `{ id, label, type: color|tiles|select|text, help?, required?, placeholder?, regions?, choicesRef?, error?, choices: [{ value, detail?, hex?, regions?, only? }] }`.

- `only: { optionId: [values] }` makes a choice available only when an **earlier** option has one of those values. An option whose choices are all gated on the same earlier option is hidden until relevant, and required once shown (e.g. iPad carrier after "Wi-Fi + Cellular").
- Colors need `hex`. The first colour tints the card and the configurator header.
- Don't add prices (they vary by country and discount) or AppleCare as an option (the question comes from `programs.applecare` via the product's `applecare` key; only availability by country matters now).
- Keep `detail` strings to one short sentence; they render inside tiles.
- Run `npm run check --prefix tests` after edits.

## Backend contract and gotchas (apps-script/Code.gs)

- `validate_()` is the source of truth for field names and limits. Keep `buildPayload()` and the client limits (`maxlength`, `MAX_LINES`) in step with it.
- **Invites:** the `Invites` tab (`Name, Code, Active, Uses, Last used, Notes`) is created by `setup()`. `checkInvite_(code)` accepts an active row or the optional shared `SETTINGS.INVITE_CODE`, and reports `open` when neither exists (then anyone can submit). `doGet(e)` answers `?invite=CODE` with `{ ok, name }` for the page gate; `doPost` refuses with `error: 'invite'`, writes the invite name into the last Orders column `Invite`, and `recordInviteUse_()` bumps Uses/Last used under the lock. Don't insert checkboxes on a whole column: Sheets counts checkbox cells as content and `getLastRow()` would stop meaning anything.
- **Invites panel (owner-only UI):** `onOpen()` adds the "Friends & Family" menu with "Manage invites…" (`openInvites()` shows `Invites.html` as a sidebar; if the file wasn't added it alerts with the instructions instead of throwing), "Add an invite…" (`addInvite()`: the same through `ui.prompt`/`ui.alert`, asking for the page address first when none is stored; kept because sidebar calls carry the Google sign-in as a third-party cookie, which Safari and private windows block, and a multi-account browser may send the wrong one; menu functions run server-side as the Sheet's user and don't have this problem; in the Executions log such failed panel calls show as type Unknown, 0 s) and "Send a test request". The sidebar calls `adminListInvites()`, `adminAddInvite(name)` (24-hex code, plain-text name through `cell_`, checkbox on that row only, grows the tab, under the lock; returns the state plus `added`), `adminSetInviteActive(row, code, active)` (refuses unless `code` is still on that row, so a tab edited meanwhile can't flip the wrong person) and `adminSetSiteUrl(url)` (https, or http://localhost for trials; stored in script properties as `siteUrl`, read by `siteUrl_()` and `inviteLink_()`; there is no `SITE_URL` setting any more). These functions are reachable only through `google.script.run` from the bound sidebar, never through the web app, so they are owner-only as long as the Sheet is private. `google.script.run` can't carry `Date` objects: `inviteView_()` sends `lastUsed` as an ISO string, and the tests check the whole state is JSON-safe. The page is a plain HtmlService file (IFRAME sandbox): `<base target="_top">`, no external resources, `navigator.clipboard` with an `execCommand('copy')` fallback and a selected read-only field as the last resort, every mutation re-renders from the returned state, and `load()` after an error keeps the status line so the explanation stays readable.
- `ORDER_COLUMNS` may only grow at the end. `ensureSheet_()` appends missing header columns to sheets created by older versions; inserting a column in the middle would misalign existing data.
- Writes happen under `LockService`: duplicate check (`findOrderBySubmission_`), then rate limits, then `writeOrder_` (Items rows first, then the Orders row, with rollback on failure; `writeRows_` grows the tab and sets Plain-text formats per row), then the invite use, then the confirmation slot. Emails go out after the lock is released.
- The requester confirmation deliberately contains only a letters-only first word, the reference number and the item count. It's capped per day (`PropertiesService`) and keeps 20 sends in reserve. Don't add requester-typed text to it.
- `cleanUpOldOrders()` runs daily from the trigger `setup()` installs. It erases personal columns 60 days after Completed/Cancelled, including free-text Payment ("Other: …") and custom-item Configuration. The Orders "Products" summary deliberately leaves out engraving, notes and links so it can be kept.
- The owner must **deploy a new version** after any `Code.gs` change (Deploy > Manage deployments > edit > New version).
- Decisions made on purpose:
  - There is no lockout after wrong invite codes, because a lockout would let anyone block real requesters. Codes are 24 random hex characters instead, and revocation is a checkbox.
  - The owner's notification email includes item notes but not phone numbers or addresses.

## Editing pitfalls seen in this project

- Write `​`-style escapes carefully. A file-writing tool once turned them into literal invisible characters. Check with `grep -n 'u200' apps-script/Code.gs`.
- Don't rebuild a `<select>` on every `change`. Keyboard type-ahead fires a change per letter, and rebuilding resets it (this happened with the country, store and currency pickers). Re-render only when the structure changes, or after typing pauses.
- Don't rebuild the category tabs on keystrokes either (they carry SVG art); `syncCats()` toggles attributes only.
- CSS `[hidden] { display: none !important; }` exists because component `display` rules override the attribute.
- Floating labels shrink with `font-size`, not `transform: scale`. Scaling widened the page on phones mid-transition.
- Focus rings use `outline` (with `--focus-ring`), because component `box-shadow`s used to hide them. Forced-colors mode shows selection with borders and focus with outlines.
- Hover rules live in one `@media (hover: hover) and (pointer: fine)` block so they never stick after a tap on iOS. Press states (`:active`) stay unguarded.
- A `popover="manual"` element above a modal `<dialog>` is in the top layer but inert in Chrome; interactive toasts must be mounted inside the dialog.
- Measuring layout (`offsetLeft`) before a node is attached returns 0; `placeIndicator()` waits for a real width and also fires from `setTimeout`, because `requestAnimationFrame` and `ResizeObserver` don't run in a hidden tab.
- `inert` is toggled with `toggleAttribute`, which is harmless where unsupported.

## Open items and ideas

- The form is English only.
- `config.js` payment methods are a guess (Apple Cash, Venmo and Zelle are US-only). The owner chose to keep the payment step as is; trim the list in `config.js` to what is actually accepted.
- The catalog needs a refresh each September (README has the checklist). iPhone Duo is listed with a pre-order note (pre-orders open Oct 16, 2026). The Mac Studio 512GB memory option ("coming late October") isn't in the data yet.
- Deployment: the repository exists locally with the Pages workflow; the owner creates the GitHub repository and pushes (README section 5), pastes `Code.gs` and `Invites.html` into the Sheet's script, runs `setup()`, deploys, and sets the page address in the invites panel.
