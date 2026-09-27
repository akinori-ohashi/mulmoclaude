# Collection registries — Discover, Contribute, and adding your own

MulmoClaude's `/collections` page has a **Discover** tab and a **Contribute**
button next to each Installed collection. Discover lists collections curated in
public **registries** that anyone can import into their workspace with one
click; Contribute lets you publish one of your own collections back to a
registry as a pull request. By default only the official registry
(`receptron/mulmoclaude-collections`) is shown — but you can add as many extra
registries as you like via a single config file.

> A registry is a public Git repo containing per-collection bundles plus a
> top-level `index.json` (published via GitHub Pages). MulmoClaude treats every
> registry as read-only catalog data: nothing from a registry is trusted
> implicitly, and every imported collection is re-validated locally on import.

## Discover — browse and import a collection

1. Open `/collections` and click **Discover**.
2. Each card shows the collection title, author, slug, field count, custom
   views, sample-record count, version, and a small badge with the source
   registry's name (e.g. `official`, or whatever name you gave a registry you
   added).
3. Click **Import**. The host fetches the bundle and re-validates the schema
   with its own gates, then:
   - writes the bundle to `data/skills/<slug>/`, plus an `.origin.json`
     provenance file that marks it as imported;
   - forces the schema's `dataPath` to `data/collections/<slug>/items`, whatever
     the registry authored, so imports can't collide on disk;
   - copies the seed records into that dataPath **only if it is empty or
     absent**;
   - mirrors `SKILL.md`, `schema.json` and `templates/` into
     `.claude/skills/<slug>/` through the same skill-bridge rules an
     agent-authored collection goes through. `views/`, `meta.json` and the seed
     stay in `data/skills/<slug>/`.
4. After import the card shows **Imported · Open** — click it to jump straight
   to the collection at `/collections/<slug>`.

Importing the same `registry/author/slug` again updates the bundle in place
(the card shows **Updated**). Records live in the dataPath and are left
untouched.

If the same `author/slug` is published by more than one registry both cards
appear; the registry badge tells them apart and the right one is followed when
you click Import. If the collection's local slug is already taken, the import
is renamed (e.g. `movies-2`) so nothing is overwritten.

## Contribute — publish your collection to a registry

The Contribute icon (`ios_share`) on each Installed-tab card hands off to the
agent in a fresh chat. The agent:

1. Forks and clones the registry with
   `gh repo fork receptron/mulmoclaude-collections --clone --remote` into
   `github/` under the workspace. It is a fork-and-PR flow because most
   contributors cannot push to the upstream.
2. Reads the registry's `CONTRIBUTING.md` for the bundle layout.
3. Asks for your GitHub username. It must equal the fork owner, the `<author>`
   path segment and `meta.author` — the registry's CI checks this against the
   PR author.
4. **Generates 3–5 synthetic dummy records** based on the collection's
   `schema.json` rather than copying your actual records — the published
   sample is always privacy-safe and gives importers a clean illustrative
   starting point.
5. Builds `collections/<author>/<slug>/` on a feature branch, runs
   `npm run validate` and `npm run build-index`, commits and pushes to your fork.
6. Runs `gh pr create --repo receptron/mulmoclaude-collections` after you confirm.

The agent needs a signed-in `gh`. Under the Docker sandbox that means opting in
with `SANDBOX_MOUNT_CONFIGS=gh` (see `config/helps/sandbox.md`).

The Contribute prompt currently targets the **official** registry. To
contribute to one of your own registries, walk the agent through the same
steps but point it at your registry repo.

## Adding extra registries

Drop a file at `~/mulmoclaude/config/collections-registries.json`:

```json
[
  {
    "name": "myorg",
    "indexUrl": "https://myorg.github.io/myorg-collections/index.json",
    "rawBaseUrl": "https://raw.githubusercontent.com/myorg/myorg-collections/main"
  },
  {
    "name": "friends-of-mulmoclaude",
    "indexUrl": "https://example.org/coll/index.json",
    "rawBaseUrl": "https://example.org/coll-raw"
  }
]
```

Reload the browser tab and open the **Discover** tab on `/collections` (it is a
tab, not a route of its own); the cards from those registries appear
mixed in with the official ones, each with its own `name` as a badge.

### What each field means

| Field | Purpose |
|---|---|
| `name` | Short label used as the routing key and shown on the Discover badge. `[A-Za-z0-9][A-Za-z0-9_-]{0,31}`. Must be unique. `"official"` is reserved. |
| `indexUrl` | HTTPS URL of the registry's `index.json` (the catalog metadata MulmoClaude lists). |
| `rawBaseUrl` | HTTPS base URL where the per-collection files live. A collection at index path `collections/<author>/<slug>` is fetched from `<rawBaseUrl>/collections/<author>/<slug>/<file>`. |

### Rules and constraints

- **HTTPS only.** `http://`, `ftp://`, `file://`, `javascript:` etc. are
  rejected. URLs with embedded credentials (`https://user:pass@host/...`) are
  also rejected so secrets can't leak via logs.
- **The official registry is always loaded** alongside whatever you configure;
  there's no way to "replace" it. (If you don't want it surfaced, file an
  issue describing the use case.)
- **Bad entries are dropped, not fatal.** A malformed entry is logged at
  `[collections-registry] registry config entry rejected`; the rest of the
  file still loads. Missing file is treated as an empty config (only the
  official registry shows).
- **Per-registry isolation.** Each registry has its own fetch cache and
  stale-on-failure backoff. If `myorg` is down, official still serves fresh
  data — and vice versa.
- **No live reload yet.** The server caches each registry's catalog for five
  minutes (`CACHE_TTL_MS` in `registry/server/client.ts`), and a long-running
  browser tab may still show what it loaded; reload the tab to pick up newly
  added registries.

### Authoring your own registry

The official registry's repo is the canonical example:

- Repo: <https://github.com/receptron/mulmoclaude-collections>
- Index: <https://receptron.github.io/mulmoclaude-collections/index.json>

Copy its layout to bootstrap your own:

```
<your-registry-repo>/
  collections/<author>/<slug>/
    SKILL.md
    schema.json
    meta.json
    manifest.json              (generated by build-index; committed)
    screenshot.png             (optional catalog preview)
    views/*.html               (optional custom views)
    templates/*.md             (optional action templates)
    seed/items/*.json          (optional sample records)
  schema/
    index.schema.json
    meta.schema.json
  scripts/
    build-index.mjs            (regenerates manifest.json files and index.json from collections/*)
    validate.mjs               (validates every meta.json against meta.schema.json)
  .github/workflows/
    build-index.yml            (builds index.json and publishes it via GitHub Pages on push)
    pr-validate.yml            (validates bundles on every PR)
```

The host trusts neither your registry repo nor the official one as a security
boundary — every imported schema is re-validated against the host's own gates
before it lands in `data/skills/`. `index.json` is gitignored: CI builds it and
publishes it to GitHub Pages, so it is never committed.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| New registry doesn't show up in Discover | Hard-reload the browser tab. The server caches each catalog for five minutes. |
| All cards from one registry vanished | That registry's `indexUrl` returned a non-200, malformed JSON, or an unsupported `schemaVersion`. Check the server log for `[collections-registry] index invalid` / `index fetch failed`. |
| Import says "registry … is no longer configured" | The card was rendered from a cached index but the registry's config entry was removed in between. Refresh and import again. |
| `author/slug` shows twice | Two registries publish the same identifier. Both are listed deliberately — pick the one whose badge matches your intent. |

## Related

- [`config/helps/collection-skills.md`](../packages/core/assets/helps/collection-skills.md) — authoring a collection schema (the source side of Contribute).
- Plan record: [`plans/done/refactor-shared-core.md`](../plans/done/refactor-shared-core.md) — the `@mulmoclaude/collection-plugin` extraction that made registries possible.
