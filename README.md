# Friends & Family order form

A clean, Apple-style order request page that replaces the Google Form. People pick products from the current Apple lineup and configure them like they would in the Apple Store. They also add a trade-in, choose pickup or delivery anywhere in the world, and say how they'll pay you back. Each request lands as one tidy row in your own Google Sheet.

- No accounts, no database, no monthly cost. The page is static files and the backend is a free Google Apps Script attached to your Sheet.
- Works on phones and desktops, in light and dark mode, and saves progress on the device if someone leaves halfway.
- Covers all product categories, with every configuration Apple offers (chip, memory, storage, colors, band sizes, carriers, keyboard languages, AppleCare, engraving).
- Handles 250 countries and regions, with local address formats, postal-code checks, phone codes, currencies, and all ~535 Apple Store locations for pickup.

## What's in the folder

| File | What it is | Edit it? |
|---|---|---|
| `index.html`, `styles.css`, `app.js` | The page | Rarely |
| `config.js` | Your settings: endpoint URL, payment methods, checkboxes, limits | **Yes** |
| `data/catalog.js` | Products and options (Apple lineup as of October 2026) | Once a year |
| `data/world.js` | Countries, address formats, Apple Store list | Rarely |
| `apps-script/Code.gs` | The backend you paste into your Google Sheet | Settings at the top |
| `apps-script/Invites.html` | The "Manage invites…" panel, pasted into the same script | No |
| `_headers` | Optional security headers for Netlify or Cloudflare Pages | No |
| `.github/workflows/pages.yml`, `.nojekyll` | Publishes the page on GitHub Pages on every push | No |
| `tests/` | Automated checks for development (`npm install --prefix tests`, then `npm test --prefix tests`) | No; not needed online |
| `CLAUDE.md` | Notes for AI coding agents working on this project | No |

## Setup (about 10 minutes)

### 1. Create the Sheet and backend

1. Create a new Google Sheet, for example "F&F Orders". Start fresh rather than reusing the old Form responses sheet, because the columns are different.
2. In the Sheet, open **Extensions > Apps Script**.
3. Delete what's there, paste in all of `apps-script/Code.gs`, and click **Save**.
4. Click **+** next to **Files**, choose **HTML**, name it `Invites`, replace its contents with all of `apps-script/Invites.html`, and click **Save**. This is the invites panel (step 4 below).
5. In the function dropdown, pick **setup** and click **Run**. Google asks you to authorize it. Because the script is yours, you'll see an "unverified app" warning: click **Advanced**, then **Go to (project name)**. The script can only touch this one spreadsheet. It creates the **Orders**, **Items** and **Invites** tabs.

### 2. Deploy it as a web app

1. Click **Deploy > New deployment**. Under "Select type", choose **Web app**.
2. Set **Execute as: Me** and **Who has access: Anyone**.
3. Click **Deploy** and copy the **Web app URL**. It ends in `/exec`.
4. Optional check: open that URL in a browser. You should see `{"ok":true,...}`.
5. Optional: in the editor, run **sendTestRequest**. A test row appears in Orders and you get an email.

### 3. Connect the page

Open `config.js` and paste the URL into `endpoint: ''`. While it's empty, the page runs in preview mode, so you can try everything without sending anything.

### 4. Decide who can send requests (recommended)

The page address is public, so lock submissions to the people you invite. Invites live in your Sheet, one per person or household, and each one is a link. You manage them from a panel inside the Sheet; nobody else can open it, because nobody else has the Sheet.

1. Open the Sheet. After `setup()` ran once you'll see a **Friends & Family** menu (reload the Sheet if it isn't there yet). Choose **Manage invites…**. A panel opens on the right.
2. The first time, the panel asks for your page address (the one from step 5). Paste it and click **Save**. It's stored with the script, so no code edit or redeploy is needed.
3. Type a name such as "Lopez family" and click **Add**. The panel shows the link; click **Copy** and send it to them by message. Repeat for each person or household.
4. In `config.js`, set `inviteCodeRequired: true` and publish the page (step 5). From then on the page checks the invite before showing anything, so a wrong or revoked link is caught up front. Every request in the Orders tab shows which invite it came from.
5. To cut someone off, flip their switch off in the panel. Flip it back on to let them back in. The panel also shows how many requests each invite has sent and when it was last used. The same data is in the **Invites** tab, where you can edit names and add notes.

`INVITE_CODE` in `Code.gs` is still there as an optional shared code that always works. With no invites and no code, anyone with the address can submit, which is fine while you try things out.

#### Keep the Sheet private

The Sheet is your database. Keep it that way:

- Don't share the Sheet or its link; it only needs to be open to you. The script runs as you and writes on your behalf, so nobody else needs access.
- Turn on 2-step verification for the Google account that owns it.
- The web app must be deployed with **Who has access: Anyone** so the page can post to it. That is the only public surface, and it only accepts complete, validated requests with a valid invite.
- Personal fields are erased automatically 60 days after an order is Completed or Cancelled (`RETENTION_DAYS`). File > Version history lets you look back or restore if something goes wrong.

### 5. Put the page online (GitHub Pages, free)

The folder is a git repository with a deploy workflow included, so publishing is: put it on GitHub once, then every push goes live by itself.

1. Create the repository and push. With the GitHub CLI installed and signed in, from this folder:

   ```bash
   gh repo create ff-order-form --public --source=. --remote=origin --push
   ```

   Without the CLI: create an empty repository on github.com, then run `git remote add origin <its URL>` and `git push -u origin main`. GitHub Pages on a free account needs a public repository; that's fine, because nothing secret lives in these files (invites live in your Sheet; the backend URL is visible to anyone who opens the page anyway).
2. Watch the **Actions** tab. The "Deploy to GitHub Pages" run takes about a minute and prints the address, normally `https://YOUR-USER.github.io/ff-order-form/`. If the first run stops with a Pages permission error, open **Settings > Pages**, set **Source** to **GitHub Actions**, and re-run it (or run `gh api -X POST repos/YOUR-USER/ff-order-form/pages -f build_type=workflow` once).
3. Paste that address into the invites panel (**Friends & Family > Manage invites…**) so the links are complete.
4. Share invite links (section 4).

**Updating later:** edit, then

```bash
git add -A && git commit -m "Describe the change" && git push
```

The page is live again about a minute later. Keep `INVITE_CODE` empty in the repository copy of `Code.gs`; if you want a shared code, set it in the Apps Script editor only.

Any other static host works too: Netlify Drop (drag the folder onto app.netlify.com/drop; delete `tests/node_modules` first if it exists) or Cloudflare Pages. Those two also read the included `_headers` file, which adds a few standard security headers.

### Updating the backend later

After editing `Code.gs`, go to **Deploy > Manage deployments**, click the pencil icon, pick **New version**, and click **Deploy**. The URL stays the same. Changes to `Invites.html` (the panel) take effect as soon as you save; the panel isn't part of the web app.

## Day to day

- **Orders tab:** one row per request. Change **Status** as you go: New → Quoted → Approved → Paid → Ordered → Ready / Shipped → Completed (or Cancelled). "Status updated" is stamped automatically. Use **My notes** for anything internal.
- **Items tab:** one row per product with its full configuration. Tick **Ordered** as you place each one.
- You get a short email for each new request, and the requester gets a confirmation with a reference number like `FF-7K3QH`.
- If a requester configured something for another country (say, a Japanese keyboard), the item says "Configured for JP".

## Privacy and security

**What the form collects:** name (as on photo ID), email, phone, preferred contact app, products, trade-in model and serial, pickup store or delivery address, payment method (just the name, like "Venmo"), gift card amount (not the code), and optional budget and notes.

**What it asks people not to share:** card numbers, gift card codes, passwords, and ID numbers. Both the page and the backend reject text that looks like a payment card number (including one followed by an expiry date or CVV), an Apple Gift Card code, or a US Social Security number. Phone numbers, IMEIs, and postal codes are allowed. People are told to share gift card codes privately when the order is placed.

**Where the data goes:**

- Over HTTPS straight to your Sheet. There are no third-party scripts, fonts, analytics, or trackers, and the page makes no requests except to your endpoint.
- The Sheet is private to you. The script uses `@OnlyCurrentDoc`, so it can't open your other files.
- Your notification email includes the products, notes, and engraving, but not phone numbers or addresses. Those copies stay in your Gmail until you delete them.
- The requester's confirmation contains only their first name, the reference number, and the item count, so it can't be used to send anyone else's text to a stranger. It's capped at 30 a day and stops when fewer than 20 emails are left, so confirmations can't use up the quota for your own notices. Without an invite code, though, a flood of fake requests could still use up your daily email quota.

**How long it's kept:** every day, a clean-up erases phone numbers, addresses, pickup/recipient details, trade-in serials, engraving text, item notes, custom-item descriptions, and "Other" payment text from orders that have been **Completed** or **Cancelled** for 60 days. Change `RETENTION_DAYS` in Code.gs. Names, emails, and products are kept as a purchase record. Orders you never close are never cleaned up, so mark them as you finish.

**Abuse protection:** a hidden bot trap, a minimum fill time, rate limits (40 requests an hour overall, 6 per email address every 6 hours), size limits, server-side validation, duplicate-submit protection, and plain-text cells so nothing typed can run as a spreadsheet formula. The invite code (setup step 4) is the main lock: without it, anyone who finds the endpoint can post to it within those limits.

**On shared devices:** an unfinished form is saved on that device so people can come back to it. Drafts expire after 14 days, and the footer has a link to clear the form.

**Pausing:** set `ACCEPTING: false` in Code.gs to stop new requests.

## Keeping the catalog current

Apple's lineup changes every September and October. `data/catalog.js` is plain data: no code, no build step. Adding a product takes about five minutes.

### Add a product

1. Open `data/catalog.js` and find the `"products"` list. Paste a new entry next to similar products (order on the page follows the order in the file).
2. The smallest valid product is three fields:

   ```js
   { "id": "iphone-19", "name": "iPhone 19", "category": "iphone" }
   ```

   `id` is lowercase with hyphens and must be unique. `category` is one of `mac`, `ipad`, `iphone`, `watch`, `vision`, `airpods`, `tv-home`, `accessories`.
3. Add what people need to choose. Everything below is optional:

   ```js
   {
     "id": "iphone-19",
     "name": "iPhone 19",
     "category": "iphone",
     "group": "iPhone",                 // subheading within the category
     "blurb": "6.3-inch, A21",          // one short line under the name
     "isNew": true,                     // orange "New" label; remove it next year
     "applecare": "iphone",             // offers the AppleCare+ question (keys: iphone, ipad, mac, display, watch, vision, airpods, beats, tv-home)
     "engraving": true,                 // offers free engraving (iPad, AirPods, Pencil, AirTag)
     "regions": ["US", "CA"],           // only sold in these countries (people elsewhere can still ask)
     "options": [
       { "id": "finish", "label": "Finish", "type": "color",
         "choices": [{ "value": "Black", "hex": "#434647" }, { "value": "White", "hex": "#fcfcfc" }] },
       { "id": "storage", "label": "Storage", "type": "tiles",
         "choices": [{ "value": "256GB" }, { "value": "512GB" }, { "value": "1TB", "only": { "finish": ["Black"] } }] },
       { "id": "carrier", "label": "Carrier", "type": "tiles", "choicesRef": "carriers" },
       { "id": "layout", "label": "Keyboard language", "type": "select", "choicesRef": "keyboardLayouts" },
       { "id": "name", "label": "Name on the label", "type": "text", "required": false, "placeholder": "Optional" }
     ]
   }
   ```

   - Option `type`: `color` (swatches; every choice needs a `hex`), `tiles` (buttons), `select` (long lists), `text`.
   - Options are required unless you add `"required": false`.
   - `only` makes a choice available only when an **earlier** option has one of the listed values. That is how the form blocks impossible combinations (128GB of memory on a base chip). If every choice in an option is gated, the option stays hidden until it applies, like a carrier list that appears after "Wi-Fi + Cellular".
   - `regions: ["US"]` on a product, an option or a single choice shows it only in those countries.
   - `choicesRef` pulls a shared list from `programs` at the top of the file: `carriers` (per country), `keyboardLayouts`, with `keyboardLayoutsByCountry` and `keyboardDefaults` deciding what each country sees first.
   - The first colour's `hex` tints the product picture on the card.
4. Check it. From the project folder:

   ```bash
   npm run check --prefix tests
   ```

   (First time: `npm install --prefix tests`.) This verifies every product and option, walks every configuration path in every country for dead ends, and confirms each product gets a picture. All is well when it prints `checked … products`, `art problems: 0` and nothing else apart from four expected notes about AQ (no currency) and IN (address tokens). Anything wrong is listed with the product id.
5. Reload the page. The product appears in its category and in search.

### The pictures

Illustrations are generic, not model-specific, so a new iPhone looks right without any artwork. The picture is chosen from the product's category and name: for example `iphone` gives a phone, a name containing "Duo" or "fold" gives a foldable, `ipad` a tablet, "MacBook" a laptop, "iMac" a desktop, "mini"/"Studio" a box, "Max"/"Solo"/"Studio Pro" headphones, otherwise earbuds, "HomePod" a speaker, "Remote" a remote, and accessories by keyword (pencil, keyboard, folio, mouse, trackpad, AirTag, case, wallet, strap, cable, adapter, charger, battery, cloth). Anything unmatched shows a neutral bag. To change the mapping, edit `artKey()` in `app.js`.

### Every autumn

- Add the new products and set `"isNew": true` on them; remove `isNew` from last year's.
- Delete products Apple stopped selling. Saved drafts that still contain one keep working, and the Sheet keeps the name.
- Refresh `programs.carriers`, `programs.applecare` (which countries get the AppleCare+ question) and `programs.tradeInCountries` if Apple's programs changed.
- Run `npm run check --prefix tests`, reload, and deploy (see "Put the page online").

If something new isn't in the catalog yet, people can still order it with the **Something else** card, so an outdated catalog never blocks a request.

## Customizing

Everything in `config.js` is commented: title, payment and contact methods (each can be limited to certain countries), the confirmation checkboxes, the default country, and the quantity and trade-in limits.

## Troubleshooting

- **"Couldn't reach the server":** check that the deployment's access is **Anyone**, and that `endpoint` is the `/exec` URL, not `/dev`. Google Workspace accounts sometimes block "Anyone" access; if so, use a personal Google account.
- **Changes to Code.gs don't take effect:** deploy a new version (see "Updating the backend later").
- **No emails:** Gmail allows about 100 script emails per day on personal accounts. Requests are still saved if email fails.
- **"Too many requests":** the rate limits in Code.gs (`MAX_PER_HOUR`, `MAX_PER_EMAIL_PER_6_HOURS`) were hit. Raise them if your family is big and busy.
