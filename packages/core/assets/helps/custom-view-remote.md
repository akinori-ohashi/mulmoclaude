# Remote custom views (LLM-authored HTML for the phone)

A **remote custom view** is an HTML file you write that renders a collection's
records **on the user's phone**, inside the mobile remote app. Same idea as a
desktop custom view (`config/helps/custom-view.md`) — the user asks in plain
language, you author one HTML file and register it — but the runtime contract
is **different and incompatible**: the phone cannot reach this machine, so
there is **no token, no dataUrl, and no `fetch` of any kind**. Records arrive
through an async bridge instead. Never mix the two contracts in one file.

Read `config/helps/collection-skills.md` first for the collection/schema DSL.
This file is only about the **remote view** layer.

## Where the files go

Same place as desktop views — the HTML lives under `views/` and must end in
`.html`. Register it in the collection's `schema.json` with
**`target: "mobile"`** (that's the whole difference in registration):

```jsonc
{
  "views": [{ "id": "phone", "label": "Phone", "target": "mobile", "file": "views/phone.html" }],
}
```

- **`target: "mobile"`** — required; without it the view is treated as a
  desktop view and is never served to the phone.
- `id` / `label` / `icon` / `i18n` — as for desktop views. The selector icon
  defaults to `smartphone`.
- **Read-only by default.** A view with no `editableFields` and no `allowDelete`
  cannot mutate anything — its `updateItem` / `deleteItem` reject. Declare a
  write surface only when the user asks the view to _change_ data (toggle a
  checkbox, delete a row); see **Writing records** below. For anything more
  open-ended (compose a message, kick off a task) use `startChat`.

Feed collections register theirs in `feeds/<slug>/schema.json` with the HTML
at `feeds/<slug>/views/<name>.html`, like desktop views.

## Previewing without a phone

After you Write + register the view, its button appears in the collection's
view selector **on the desktop** and renders inside a **phone-sized frame
(390×844)** — the exact same wrapped document the phone receives, with the same
sandbox rules and the same data bridge. A caption under the frame shows the
file's size against its **900 KB budget** (the view travels to the phone inside
a size-capped message — stay well under it; a normal view is tens of KB).
Iterate against this preview; if it works there, it works on the phone.

## The runtime contract — `window.__MC_VIEW`

The host injects a bootstrap into your page **before any of your scripts run**:

```js
window.__MC_VIEW = {
  slug: "annual-plan", // this collection
  locale: "en", // active app locale ("" when no translations)
  target: "mobile",
  protocol: 2,
  writable: false, // true iff the view declared editableFields / allowDelete
  getItems: (opts) => Promise, // the ONLY way to read records — see below
  updateItem: (id, patch) => Promise, // patch declared fields (see Writing records)
  deleteItem: (id) => Promise, // remove a record (requires allowDelete)
  startChat: (prompt, role) => void, // draft a new chat for the user
  t: (key, named) => string, // vue-i18n-style dict lookup (same as desktop)
};
```

What is deliberately **absent** compared to the desktop contract: `token`,
`dataUrl` (nothing to fetch), `onChange` (no live refresh yet — re-call
`getItems` after a mutate resolves), and `openItem` (no host record panel on
the phone yet).

### Reading records — `getItems` (paginated, always)

```js
const page = await window.__MC_VIEW.getItems({
  offset: 0,
  limit: 50, // clamped to [1, 200]
  fields: ["title", "start", "status"], // project — list ONLY what you render
});
// page = { items: [...], total: 123, offset: 0, limit: 50 }
```

- **Pagination is mandatory.** Each page travels to the phone through a
  size-capped channel; you can never assume one call returns everything.
  Render the first page, then offer a **"Load more"** affordance while
  `items.length < total` (see the example).
- **A page may come back SHORTER than the `limit` you asked for.** When inlined
  thumbnails would overflow the channel budget, the host ends the page early and
  the remaining records arrive on the next one — with their images intact. So
  advance by what you RECEIVED, never by the limit you requested:
  `offset: loaded.length` (both examples below do this), and stop on
  `loaded.length >= total`. `total` always counts every record behind the view,
  never just this page. A short page is normal, not an error.
- **Always pass `fields`.** The projection keeps pages small (the primary key
  is always included). List the columns your view actually renders — including
  any `image`-type field you want inlined (see **Displaying images**).
- The promise **rejects** on failure or after a 30 s timeout — catch it and
  show the message; don't fail silently.
- **Computed fields resolve host-side, exactly as on desktop.** `derived`
  formulas — including ones that dereference a `ref` into another collection
  (e.g. `ticker.price`, `shares * ticker.price`) — plus `toggle` and `embed`
  fields all come back fully resolved. The host does the join before serializing
  the page; the phone just receives the plain values. A `ref` target that's
  missing resolves that field to `null` (same fail-soft as desktop), so guard
  for `null` rather than assuming a number is always present.

### Writing records — `updateItem` / `deleteItem`

A remote view may **change** data too — flip a todo's `done`, edit a status,
delete a row — but only within a surface the view **declares** and the host
**enforces**. Nothing is writable by default.

**1. Declare the surface** in the `views[]` entry:

```jsonc
{
  "id": "phone",
  "label": "Todos",
  "target": "mobile",
  "file": "views/phone.html",
  "editableFields": ["done"], // ONLY these fields may be patched
  "allowDelete": true, // omit / false ⇒ deleteItem is refused
}
```

**2. Call the methods** (both resolve/reject like `getItems`):

```js
const { item } = await window.__MC_VIEW.updateItem(id, { done: true });
// patch is a partial record; the host merges it onto the stored record and
// returns the merged { item }.

const { id: removed } = await window.__MC_VIEW.deleteItem(id);
```

- **The host is the authority, not the view.** Every mutate is re-checked
  server-side: a patch key not in `editableFields` (or the primary key) is
  **refused**; `deleteItem` without `allowDelete` is **refused**. The promise
  rejects with the reason — surface it. Declaring the surface honestly is how
  you keep the blast radius small.
- **No `writable` declaration ⇒ the methods reject** (`"this view is
  read-only"`). Check `window.__MC_VIEW.writable` before showing edit affordances
  if you want to degrade gracefully.
- **`editableFields` never includes the primary key** — a record's id is fixed.
- **Re-render after a mutate resolves.** There is no live `onChange` yet: either
  optimistically update your local copy from the returned `item`, or re-call
  `getItems` to refetch. The preview's real write also refreshes the desktop
  collection, so you see the true result while iterating.
- **The returned `item` is shaped like a `getItems` item** — host-computed fields
  (`derived`, including ref-crossing formulas, `toggle`, `embed`) are resolved and
  the view's declared `imageFields` come back inlined as `data:` URLs (not bare
  paths), so merging the result (`items[i] = { ...items[i], ...res.item }`) keeps
  computed columns and thumbnails intact — no refetch needed just to recompute them.
- **Create is not available** in this phase — `updateItem` only patches an
  existing record; use `startChat` to ask the agent to add a new one.

### Displaying images — `imageFields`

A collection's `image`-type field holds a **workspace path** (`data/attachments/…`,
`artifacts/images/…`) that the phone can't fetch. To render it, list the field in
the view's **`imageFields`** and the host inlines it as a **downscaled JPEG
`data:` URL thumbnail** inside each `getItems` page — the value your view reads is
then a ready-to-use `data:` URL, not a path.

**1. Declare the image fields** in the `views[]` entry:

```jsonc
{
  "id": "gallery",
  "label": "Gallery",
  "target": "mobile",
  "file": "views/gallery.html",
  "imageFields": ["photo"], // inline these image-type fields as thumbnails
  "imageMaxEdge": 384        // optional longest-edge px (default 512, clamped [64, 1024])
}
```

**2. Render the value as an image**, and **request the field** so it survives the
projection (a field you don't list in `fields` is never inlined):

```js
const page = await window.__MC_VIEW.getItems({ offset: 0, limit: 20, fields: ["title", "photo"] });
// page.items[0].photo === "data:image/jpeg;base64,…"  → <img src="…">
```

- **Only `image`-type fields listed in `imageFields` are inlined.** A non-image
  field name is ignored; a field the page's `fields` projection dropped is not
  inlined (so paging without the image column costs nothing).
- **Thumbnails are downscaled**, longest edge `imageMaxEdge` (default 512). Every
  inlined image travels inside the size-capped page, so the host enforces a
  **per-page byte budget** — when the next thumbnail would overflow it, the page
  **ends there** and those records arrive on the following page with their images.
  You get a short page, never a page with a hole in it. A smaller `imageMaxEdge`
  fits more thumbnails per page, so it costs FEWER round-trips; a smaller `limit`
  costs more. Neither changes whether an image eventually appears — that is no
  longer something the budget can take away.
  For scale: a real photo at `imageMaxEdge: 384` inlines to roughly 15 KB, so a
  page holds on the order of 50 of them before it is cut.
- **A field may still come back as a path, not a `data:` URL** — for a missing
  file or an undecodable source, which a smaller page cannot fix; and, on the
  FIRST item of a page only, for an image so large it does not fit an empty
  budget (deferring that one would return an empty page and stall paging).
  Handle both: `onerror` a placeholder, or check for the `data:` prefix before
  rendering.
- **Cost**: inlined thumbnails are the one thing that grows a page's bytes;
  they're opt-in per view and per projection precisely so a view pays only for the
  images it shows. The preview's caption reports `N images (M placeholders)` —
  `M` counts every image the page hands back as a path, which is what you will
  see as a placeholder. An image that merely did not fit is deferred to the next
  page and is NOT counted; what remains is the unresolvable ones, plus the rare
  first-item-too-large case above.

### Starting a chat — `startChat`

Identical to the desktop helper: opens a **new chat with your prompt prefilled
as an editable draft** — it does NOT auto-send; the user reviews and sends.
This is the only way a remote view "does" anything beyond display:

```js
window.__MC_VIEW.startChat("Mark task " + item.id + " as done.");
```

### Translations — `t`

Same contract as desktop: declare `"i18n": "views/<name>.i18n.json"` in the
`views[]` entry (vue-i18n locale-message shape); the host picks the active
locale's flat dict server-side and `t(key, named)` interpolates `{name}`
placeholders, falling back to the key.

## Design for the phone — not a shrunken desktop

The frame is a real phone viewport. **Do not miniaturize a desktop layout**
(a 12-month grid becomes an unreadable postage stamp); pick a vertically
composable idiom instead — a scrolling agenda, a card list, stacked sections.

- **Required `<head>`**: build a full document with
  `<meta charset="utf-8">` and
  `<meta name="viewport" content="width=device-width, initial-scale=1">`.
- **Single column, vertical scroll.** No fixed pixel widths, no horizontal
  scroll, percentages / flex / grid over absolute positioning.
- **Touch, not pointer**: tap targets ≥ 44px tall, generous spacing, **no
  hover-dependent affordances** (there is no hover).
- **Respect the notch**: pad fixed headers/footers with
  `env(safe-area-inset-top)` / `env(safe-area-inset-bottom)`.
- **System fonts** (`system-ui, sans-serif`) render instantly; heavy chart
  libraries that feel fine on desktop are sluggish on a phone — prefer plain
  DOM/SVG unless a chart is the point.

## Sandbox rules (what the view may and may not do)

The view runs in a `sandbox="allow-scripts"` iframe with a CSP **stricter**
than desktop views:

- **`fetch` / XHR / WebSocket are blocked to EVERY origin** (`connect-src
'none'`). There is nothing to fetch — records come only through
  `getItems`. Never write `fetch(...)` in a remote view.
- **Inline `<script>` / `<style>` work**, and external scripts/styles/fonts
  may load from the same curated CDNs as desktop views (`cdn.jsdelivr.net`,
  `unpkg.com`, `cdnjs.cloudflare.com`, Google Fonts, `cdn.plot.ly`) — the
  phone has internet; only this machine is unreachable. Prefer self-contained
  HTML anyway (see the size budget).
- **`<img>` / `<audio>` / `<video>` may load any `https:` URL** (plus `data:`
  / `blob:`) — a record's public image/media URL renders. A **workspace file
  path does not** by itself (it lives on this machine, which the phone can't
  reach) — but the host **can inline a workspace `image`-type field** as a
  downscaled `data:` URL thumbnail when the view declares it in `imageFields`;
  see **Displaying images** below. `audio` / `video` and non-declared image
  paths stay desktop-only (skip or placeholder them).
- **Outbound links**: `<a href="…" target="_blank" rel="noopener">` opens
  normally; a same-tab `<a href>` is blocked by the sandbox.
- No cookies, no `localStorage`, no parent access — and no token exists in
  this contract at all.

## Editing / iterating

Read + Edit the `views/<name>.html` file under the collection's skill dir,
exactly like a desktop view; the desktop preview re-renders on reload. To
remove one, delete the file and its `views[]` entry.

---

## Example — mobile card list with "Load more"

A phone-first record list: single column, 44px+ tap targets, paginated through
`getItems`, a `startChat` action per card. Schema has `title` (string),
`status` (enum), `start` (date). Registration:
`{ "id": "phone", "label": "Phone", "target": "mobile", "file": "views/phone.html" }`.

`data/skills/annual-plan/views/phone.html`:

```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      body {
        font-family: system-ui, sans-serif;
        margin: 0;
        padding: 12px;
        padding-bottom: calc(12px + env(safe-area-inset-bottom));
        background: #f8fafc;
        color: #1e293b;
      }
      h1 {
        font-size: 17px;
        margin: 4px 4px 12px;
      }
      .card {
        background: white;
        border: 1px solid #e2e8f0;
        border-radius: 12px;
        padding: 12px 14px;
        margin-bottom: 10px;
        min-height: 44px;
      }
      .card b {
        font-size: 15px;
      }
      .meta {
        display: flex;
        gap: 8px;
        margin-top: 6px;
        font-size: 13px;
        color: #64748b;
        align-items: center;
      }
      .badge {
        background: #eef2ff;
        color: #3730a3;
        border-radius: 999px;
        padding: 2px 10px;
        font-size: 12px;
      }
      button {
        min-height: 44px;
        border: 0;
        border-radius: 10px;
        font-size: 15px;
        font-weight: 600;
      }
      .chat {
        margin-left: auto;
        background: #f1f5f9;
        color: #334155;
        padding: 0 14px;
      }
      .more {
        width: 100%;
        background: #4f46e5;
        color: white;
        margin-top: 4px;
      }
      .err {
        color: #b91c1c;
        padding: 12px;
      }
    </style>
  </head>
  <body>
    <h1>Annual plan</h1>
    <div id="list"></div>
    <button id="more" class="more" hidden>Load more</button>
    <script>
      var FIELDS = ["title", "status", "start"]; // project ONLY what we render
      var PAGE = 50;
      var loaded = [];
      var total = 0;

      function card(item) {
        var el = document.createElement("div");
        el.className = "card";
        var meta =
          '<div class="meta"><span class="badge">' +
          (item.status || "-") +
          "</span><span>" +
          (item.start || "") +
          "</span>" +
          '<button class="chat" data-id="' +
          item.id +
          '">Chat</button></div>';
        el.innerHTML = "<b></b>" + meta;
        el.querySelector("b").textContent = item.title || item.id;
        return el;
      }

      function render(items) {
        var list = document.getElementById("list");
        items.forEach(function (item) {
          list.appendChild(card(item));
        });
        document.getElementById("more").hidden = loaded.length >= total;
      }

      async function loadMore() {
        var page = await window.__MC_VIEW.getItems({ offset: loaded.length, limit: PAGE, fields: FIELDS });
        total = page.total;
        loaded = loaded.concat(page.items);
        render(page.items);
      }

      document.getElementById("more").onclick = function () {
        loadMore().catch(showError);
      };
      document.getElementById("list").onclick = function (e) {
        var btn = e.target.closest(".chat");
        if (!btn) return;
        var item = loaded.find(function (r) {
          return String(r.id) === btn.dataset.id;
        });
        if (item) window.__MC_VIEW.startChat("Give me an update plan for: " + (item.title || item.id));
      };

      function showError(err) {
        document.getElementById("list").innerHTML = '<div class="err">Could not load: ' + err.message + "</div>";
      }
      loadMore().catch(showError);
    </script>
  </body>
</html>
```

## Example — writable todo (toggle `done`, delete)

A phone-first todo list that **checks off** and **deletes** records. Schema has
`title` (string) and `done` (boolean). Registration declares the write surface:
`{ "id": "phone", "label": "Todos", "target": "mobile", "file": "views/phone.html", "editableFields": ["done"], "allowDelete": true }`.

The core of `views/phone.html` (styles/`<head>` as above):

```html
<div id="list"></div>
<script>
  var items = [];

  function row(item) {
    var el = document.createElement("div");
    el.className = "card";
    el.innerHTML =
      '<label class="meta"><input type="checkbox" data-toggle="' +
      item.id +
      '"' +
      (item.done ? " checked" : "") +
      ' style="width:22px;height:22px"><b></b>' +
      '<button class="chat" data-del="' +
      item.id +
      '" style="margin-left:auto">Delete</button></label>';
    el.querySelector("b").textContent = item.title || item.id;
    if (item.done) el.style.opacity = 0.5;
    return el;
  }

  function render() {
    var list = document.getElementById("list");
    list.innerHTML = "";
    items.forEach(function (item) {
      list.appendChild(row(item));
    });
  }

  async function load() {
    var page = await window.__MC_VIEW.getItems({ offset: 0, limit: 200, fields: ["title", "done"] });
    items = page.items;
    render();
  }

  document.getElementById("list").addEventListener("change", async function (e) {
    var id = e.target.dataset.toggle;
    if (!id) return;
    try {
      // Host merges the patch and returns the merged record; reflect it.
      var res = await window.__MC_VIEW.updateItem(id, { done: e.target.checked });
      var i = items.findIndex(function (r) {
        return String(r.id) === id;
      });
      if (i >= 0) items[i] = res.item;
      render();
    } catch (err) {
      e.target.checked = !e.target.checked; // revert on refusal
      alert(err.message);
    }
  });

  document.getElementById("list").addEventListener("click", async function (e) {
    var id = e.target.dataset.del;
    if (!id) return;
    try {
      await window.__MC_VIEW.deleteItem(id);
      items = items.filter(function (r) {
        return String(r.id) !== id;
      });
      render();
    } catch (err) {
      alert(err.message);
    }
  });

  load().catch(function (err) {
    document.getElementById("list").innerHTML = '<div class="err">' + err.message + "</div>";
  });
</script>
```

## Example — image gallery (inlined thumbnails)

A phone-first photo grid. Schema has `title` (string) and `photo` (image, a
workspace path). Registration declares the image field + a small edge:
`{ "id": "gallery", "label": "Gallery", "target": "mobile", "file": "views/gallery.html", "imageFields": ["photo"], "imageMaxEdge": 384 }`.
`getItems` must **request `photo`** (else it isn't inlined); the host returns it
as a `data:` URL, and a small `limit` keeps each page under the byte budget.

The core of `views/gallery.html` (styles/`<head>` as in the first example):

```html
<div id="grid" style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px"></div>
<button id="more" class="more" hidden>Load more</button>
<script>
  var loaded = [];
  var total = 0;
  var PAGE = 20; // small: every inlined thumbnail travels inside the page

  function tile(item) {
    var el = document.createElement("div");
    el.className = "card";
    var src = typeof item.photo === "string" && item.photo.indexOf("data:") === 0 ? item.photo : "";
    el.innerHTML =
      '<img loading="lazy" alt="" style="width:100%;aspect-ratio:1;object-fit:cover;border-radius:10px;background:#e2e8f0">' + "<b></b>";
    if (src) el.querySelector("img").src = src; // else leave the placeholder background
    el.querySelector("b").textContent = item.title || item.id;
    return el;
  }

  async function loadMore() {
    var page = await window.__MC_VIEW.getItems({ offset: loaded.length, limit: PAGE, fields: ["title", "photo"] });
    total = page.total;
    loaded = loaded.concat(page.items);
    var grid = document.getElementById("grid");
    page.items.forEach(function (item) {
      grid.appendChild(tile(item));
    });
    document.getElementById("more").hidden = loaded.length >= total;
  }

  document.getElementById("more").onclick = function () {
    loadMore().catch(function (e) {
      alert(e.message);
    });
  };
  loadMore().catch(function (e) {
    document.getElementById("grid").innerHTML = '<div class="err">' + e.message + "</div>";
  });
</script>
```
