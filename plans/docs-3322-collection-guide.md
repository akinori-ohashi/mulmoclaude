# docs: beginner guide for Collections, hosted on GitHub Pages (#3322)

## Problem

Collections are the feature we most want new users to try, but `docs/` only has developer-facing
material (`collection-registries.md`, `collections-data-operations.md`,
`papers/collections-architecture.md`). No end-user guide, no docs site.

## Scope

**In**

- A Jekyll + just-the-docs site under `docs/`, same shape as mulmoterminal's `docs/guide/`
  (`docs/_config.yml`, `docs/Gemfile`, `docs/index.md`).
- `.github/workflows/pages.yml` — build with Jekyll 4, deploy with `actions/deploy-pages`;
  top-level `permissions: contents: read`, the Pages write scopes only on the jobs that need them.
- Guide pages in Japanese (`docs/guide/ja/`) and English (`docs/guide/en/`), same structure:
  1. `index.md` — what the guide covers, reading order
  2. `getting-started.md` — install and launch MulmoClaude
  3. `what-is-a-collection.md` — the idea, where the files live
  4. `create.md` — "+ Collection" (guided / free-form / starters), creating by chat, changing it later
  5. `use.md` — table / calendar / kanban, records, filters, chat, custom views, pin and dashboard
  6. `schema.md` — `schema.json` basics for the curious (field types, actions, views)
  7. `share.md` — Discover, Contribute, using it from a phone, letting others enter records,
     handing over the files
  8. `faq.md` — when a collection does not appear, etc.
- A link from `docs/README.md`'s End Users table.

**Out**

- Screenshots and videos (can be added later under `docs/guide/images/`).
- Fixing the developer docs that disagree with the code (`collection-registries.md` paths,
  `/collections/discover`, the empty-state wording). Recorded below for a follow-up.

## Key decisions

- **The code is the source of truth, not the existing docs.** Every UI label is taken from
  `packages/plugins/collection-plugin/src/vue/lang/{en,ja}.ts` and `src/lang/{en,ja}.ts`.
- **"Let other people enter records" does not exist in MulmoClaude today.** Firestore-backed shared
  collections are refused on purpose (`server/index.ts`, `discovery.ts`); public forms under
  `mulmoserver.web.app/a/:slug` are published by MulmoTerminal. The guide says so plainly and points
  to the alternatives (messaging bridges, MulmoTerminal's shared apps) rather than implying a feature.
- **Phone:** view, edit through a phone view that allows it, and ask the agent by chat. There is no
  direct "create record" on the phone; the guide says so.
- **Existing developer `docs/*.md` have no front matter**, so Jekyll copies them as static files and
  they do not appear in the guide's navigation. Heavy folders (`papers/`) are excluded from the build.

## Doc/code mismatches found (follow-up, not in this PR)

1. `docs/collection-registries.md` says imports land in `data/<slug>/items/` and `.claude/skills/<slug>/`;
   the code writes `data/skills/<slug>/` (mirrored) and `data/collections/<slug>/items`.
2. The same doc's Contribute steps differ from the real prompt (`gh repo fork`, `CONTRIBUTING.md`,
   `npm run validate`).
3. It refers to `/collections/discover`; Discover is a tab, not a route.
4. The Installed empty state tells users to star a skill; the list does not filter by star.
5. `error-recovery.md` names `SANDBOX_FORWARD_SSH_AGENT`; the code reads `SANDBOX_SSH_AGENT_FORWARD`.

## One-time setup after merge

Repository Settings → Pages → Source: **GitHub Actions**.
