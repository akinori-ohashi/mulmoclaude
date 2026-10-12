# Clients + Worklog — the client & time-tracking recipe

Read this when the user asks to **set up client tracking, a timesheet, or
"track my consulting work"** (sample query: *"Set up client and time tracking
for my consulting work"*). It scaffolds **two** collection skills that work
together:

- **`clients`** — a contact database (who you work for / bill).
- **`worklog`** — a timesheet; each entry references a client.

This is **Bundle A** of the billing suite. It is fully self-contained (no
dependency on anything else). The companion **Bundle B** (`invoice` + `profile`,
see `config/helps/billing-invoice.md`) builds on it: invoices reference these
`clients` and can pull billable hours from this `worklog`. **Recommended order:
set up this bundle first**, then invoicing.

Read `config/helps/collection-skills.md` first for the general schema DSL — this
file is the billing-specific specialization. Author everything under
`data/skills/<slug>/` (the bridge mirrors it to `.claude/skills/<slug>/`; the
user opens it at `/collections/<slug>`). **Do not use the `mc-` prefix.**

> **Follow this recipe verbatim — do NOT redesign.** The schemas below are
> fixed and known-good. Write them exactly as given (you may only adjust the
> `id`/`icon`/`title` if the user explicitly asks). Do **not** add fields, do
> **not** call `presentForm` to ask the user design questions, and do **not**
> mimic other collections in the workspace. The whole point is a reproducible
> billing suite. (If the user wants a *custom* collection instead, that's a
> different task — use `config/helps/collection-skills.md`.) Existing records
> under `data/clients/items` / `data/worklog/items` will render as-is **only
> when `worklog.clientId` values are already slugs AND a matching client
> record exists for each of them**. If either invariant is violated, the
> `ref` link breaks — the reconcile step below (§3) fixes both.

## Slug contract (do not change these)

Bundle B's `invoice` references `clients` by this exact slug, and its line-item
flow reads `worklog`. Author the two collections with **exactly** these slugs so
the cross-bundle links resolve:

| Collection | slug | `dataPath` |
|---|---|---|
| Clients | `clients` | `data/clients/items` |
| Worklog | `worklog` | `data/worklog/items` |

> The `dataPath` values are deliberately prefix-free. If the user previously used
> the legacy `mc-clients` / `mc-worklog` preset skills, these same paths hold
> their existing records — re-creating with these slugs **re-attaches to that
> data** (no migration, no data loss). Startup removes the old copied `mc-*`
> skills automatically; a symlinked one can be Unstarred in the skill manager.

## Order: `clients` before `worklog`

`worklog.clientId` is a `ref` to `clients`, so create `clients` first (its
records are what the worklog's client picker lists). Then create `worklog`.

---

## 1. `clients`

`data/skills/clients/schema.json`:

```json
{
  "title": "Clients",
  "icon": "people",
  "dataPath": "data/clients/items",
  "primaryKey": "id",
  "fields": {
    "id":      { "type": "string",   "label": "ID", "primary": true, "required": true },
    "name":    { "type": "string",   "label": "Name", "required": true },
    "email":   { "type": "email",    "label": "Email" },
    "address": { "type": "text",     "label": "Address" },
    "notes":   { "type": "markdown", "label": "Notes" }
  }
}
```

`data/skills/clients/SKILL.md`:

```markdown
---
name: clients
description: A simple client database. Use whenever the user asks to add, list,
  update, or delete a client. Records live at `data/clients/items/<id>.json`
  (one JSON file per client); the user views them at `/collections/clients`,
  rendered from `schema.json` by the host. You do all I/O via Read / Write /
  Edit on the JSON files.
---

# Clients (schema-driven collection)

## Record shape
- `id` — string, **primary key** (the filename, no extension). A short
  kebab-case slug derived from the name (e.g. `acme-corp`, `globex`); lowercase
  letters, digits, hyphens; 1–48 chars. Pick a fresh suffix (`acme-corp-2`) if
  the obvious slug is taken.
- `name` — string, **required**
- `email` — email
- `address` — multi-line text
- `notes` — markdown

Don't push for fields the user hasn't given you — leave optional fields out of
the JSON entirely.

## What to do
**Add**: derive an `id`, build the record, write via `manageCollection`
`putItems` with `mode: "create"` — an id collision comes back as a `rejected`
row instead of silently overwriting; pick a fresh slug and retry.

**List / look up**: `manageCollection` `getItems`, answer from the rows. Don't
recite the whole table in chat — the user sees it at `/collections/clients`. A
one-line confirmation ("Added Acme Corp.") is enough.

**Update**: `putItems` with `mode: "merge"` and a partial row
(`{ id, <changed fields> }`) — the default upsert replaces the whole record.

**Delete**: confirm once if the request is ambiguous, then `deleteItems` with
`ids`. Check `rejected` in the result — an id that didn't exist is reported
there, not as deleted.

## Linking to a client in chat
Link to the collection view, not the raw JSON path:
- Do: `[Acme Corp](/collections/clients?selected=acme-corp)`
- Don't: `[Acme Corp](data/clients/items/acme-corp.json)`

Always include `?selected=<id>` to open that client's detail view; omit it only
for a general reference to the whole list.

## When to ask vs. when to act
If the user gives a name and email in one sentence, just add the client. Use
`presentForm` only when you genuinely need information they haven't provided.
```

---

## 2. `worklog`

`data/skills/worklog/schema.json` (note `clientId` is a `ref` **to `clients`**):

```json
{
  "title": "Worklog",
  "icon": "schedule",
  "dataPath": "data/worklog/items",
  "primaryKey": "id",
  "fields": {
    "id":       { "type": "string",   "label": "ID", "primary": true, "required": true },
    "date":     { "type": "date",     "label": "Date", "required": true },
    "clientId": { "type": "ref",      "to": "clients", "label": "Client", "required": true },
    "hours":    { "type": "number",   "label": "Hours", "required": true },
    "billable": { "type": "boolean",  "label": "Billable" },
    "notes":    { "type": "markdown", "label": "Notes" }
  }
}
```

`data/skills/worklog/SKILL.md`:

```markdown
---
name: worklog
description: A simple timesheet — log billable / non-billable hours per client
  per day. Use whenever the user logs, lists, edits, or removes worked hours.
  Records live at `data/worklog/items/<id>.json`; the user views them at
  `/collections/worklog`. `clientId` references the `clients` collection.
---

# Worklog (schema-driven collection)

## Record shape
- `id` — string, **primary key** (the filename). Format
  `{date}-{clientId}-{4-char-hex}` (e.g. `2026-05-23-acme-corp-a1b2`); the hex
  suffix avoids collisions for multiple sessions in the same day for the same
  client. Generate it randomly and check the file doesn't already exist.
- `date` — ISO date `YYYY-MM-DD`, **required**
- `clientId` — ref → `clients`, **required** (the client record's slug)
- `hours` — decimal number, **required** (1.5 = 90 minutes)
- `billable` — boolean (default `true` unless the user says otherwise)
- `notes` — markdown (what was worked on)

## clientId resolution
`clientId` is a `ref` to the `clients` collection — write the raw client slug.
When the user says "log 2 hours for Acme":
- `manageCollection` `getItems` on `clients` (`fields: ["id", "name"]`) and
  find the slug whose `name` matches "Acme" (case-insensitive substring is
  fine).
- If no match: ask whether to create the client first (via the `clients` skill)
  or use a literal slug they supply. Never invent a clientId that doesn't exist —
  it renders as a broken link.

## What to do
**Log hours**: derive `id`, default `billable: true`, default `date` to today if
unspecified, write via `manageCollection` `putItems` (`mode: "create"`; fix any
`rejected` row from its `problem` text and retry). (This skill tracks total
hours per day per client — not start/end times.)

**List / summarize**: `manageCollection` `getItems`, answer from the rows. Don't
recite the table — point at `/collections/worklog`. For aggregates ("how many
hours did I bill Acme last month?") group by clientId + date range and answer in
one line.

**Edit / delete**: Read → merge / remove. Preserve untouched fields.

## Linking to an entry in chat
- Do: `[2026-05-24 Acme](/collections/worklog?selected=2026-05-24-acme-corp-a1b2)`
- Don't: link the raw JSON path.

## When to ask vs. when to act
If the user gives a clear "log N hours for X today", just write it. Use
`presentForm` only when genuinely ambiguous (e.g. several clients match the name).
```

---

## 3. Reconcile pre-existing worklog data (MANDATORY before "Done")

Both skills are now authored. Before telling the user setup is complete,
audit any records that were already on disk under `data/worklog/items/` —
they may have been written before the `clients` collection existed, so
`clientId` values can be either display names (`"Singularity Society"`) or
missing-slug references. Both break the `ref` link at render time.

Run this reconcile every time — even when the setup looks fine — because
"looks fine" from the LLM side (schemas written, files present) is
distinct from "the ref actually resolves" (clientId is a valid slug AND
`data/clients/items/<slug>.json` exists).

**Steps** (idempotent; safe to re-run):

1. **Inventory the existing worklog.** List `data/worklog/items/`. Read
   every record and collect the distinct `clientId` values seen.
   *Skip this step only when the directory does not exist at all.*
2. **For each distinct `clientId` value**, classify it:
   - **valid slug + matching client file exists** → no action.
   - **valid slug but no matching `data/clients/items/<slug>.json`** →
     create a stub client record: `id: <slug>`, `name` derived by
     title-casing the slug (`acme-corp` → "Acme Corp"), other fields blank
     so the user can fill them in later.
   - **not a valid slug** (contains uppercase, spaces, `&`, `.`, etc.) →
     (a) generate the slug (lowercase, spaces → `-`, drop punctuation,
     collapse repeat hyphens, strip leading/trailing hyphens); (b)
     **validate the generated slug against the `clients.id` contract**
     (see § 1 record shape: `[a-z0-9-]`, 1–48 chars): if it is empty
     (punctuation-only or all-whitespace input like `"!!!"`), or longer
     than 48 chars, **stop and ask the user** for a valid slug rather
     than writing an invalid filename. If it is >48 chars but has
     meaningful prefix content, propose truncation at 48 (dropping any
     trailing hyphen) and confirm with the user before proceeding; (c)
     **check for slug collisions BEFORE writing anything**: if
     `data/clients/items/<slug>.json` already exists AND its `name`
     field does not match the display value being reconciled, stop and
     disambiguate — either append a numeric suffix (`acme-corp-2`)
     after confirming the new client is genuinely distinct, or ask the
     user which client the worklog entries belong to. Do **not**
     silently overwrite an existing client. Also stop when two
     different display values in the current inventory slugify to the
     same slug (e.g. `"ACME Corp"` and `"Acme Corp."`); ask the user
     whether they're the same client (merge to one slug) or distinct
     (assign each a suffixed slug); (d) create
     `data/clients/items/<slug>.json` with `id: <slug>`, `name:
     <original display value>`, other fields blank; (e) rewrite the raw
     display value inside every affected `data/worklog/items/*.json`
     to the new slug in the `clientId` field (preserve every other
     field untouched).
3. **Report** what changed: how many client records were created and how
   many worklog `clientId` values were rewritten. Do not summarise the
   raw records — point at `/collections/clients` and `/collections/worklog`.

If the worklog directory did not exist yet (fresh setup, no pre-existing
data), this step is a no-op and you can proceed straight to "Done".

**Don't skip this step because the LLM output says "existing records will
render as-is."** That claim only holds when both invariants (slug format
+ matching client file) are already true; the reconcile confirms them.

---

## Done

Tell the user the two collections are ready at `/collections/clients` and
`/collections/worklog`. The bridge mirrors the files and re-scans, so they appear
without a restart. If the reconcile in §3 created client stubs or rewrote
`clientId` values, mention the counts so the user knows to fill in the
stubs' contact info. If invoicing is the goal, point them at the next
step: run *"Set up invoicing for my business"* (the
`config/helps/billing-invoice.md` recipe, which references these
`clients` and pulls hours from this `worklog`).
