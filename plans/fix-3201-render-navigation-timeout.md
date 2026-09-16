# fix(shapescript): the render page's navigation may not inherit Puppeteer's default (#3201)

## Symptom

`renderShapeScriptSheet` fails intermittently on a loaded CI runner:

```
TimeoutError: Navigation timeout of 30000 ms exceeded
 ❯ CdpPage.goto node_modules/puppeteer-core/src/api/Page.ts:1886:35
 ❯ A node_modules/@mulmoclaude/shapescript-plugin/dist/render.js:176:71
```

Measured downstream, where these renders are the only ones CI runs
(receptron/mulmoterminal#2095): five of the last twelve Windows daily runs, and at least one
required pull-request check. The count of failing cases differs per run, so it is per-render. A
render costs about a second on a developer machine.

## Cause

Every phase of a render had an explicit budget except the navigation:

```ts
timeout: LAUNCH_TIMEOUT_MS,                                        // launch, 30s
await page.goto(PAGE_URL, { waitUntil: "load" });                  // nothing — Puppeteer's 30s default
await page.waitForFunction("…", { timeout: RENDER_TIMEOUT_MS });   // rasterisation, 60s
```

`LAUNCH_TIMEOUT_MS`'s own comment states the rule the `goto` broke: *"Set explicitly rather than
left to Puppeteer's own 30 s default, so the total below is derived from numbers this file controls
instead of one it would silently inherit."*

**It is not a network wait.** `serveRenderAssets` answers every request from disk through
interception, so what the page load actually waits for is Chromium parsing and evaluating three.js
under software GL — fast on a developer machine, not always fast on a CI runner.

A host cannot work around it: `RenderShapeScriptOptions` carries no timeout, so MulmoTerminal's
only lever is retrying the whole render, which costs another Chromium.

## Change

- `NAVIGATION_TIMEOUT_MS`, and `page.goto` takes it.
- `RENDER_BUDGET_MS` becomes launch + navigation + render. A phase missing from that sum is a host
  transport sized to less than the work it waits for — the failure the constant already exists to
  prevent (CodeRabbit on #3056) — so this is part of the fix rather than bookkeeping.
- Exported from `./render` beside the other two, since it is now part of the same contract.

## Not doing

- **An injectable launcher so the renderer can be tested without a browser.** It would let a fake
  page assert the `goto` options directly, and it is a larger change to a published API than this
  fix warrants. What the tests pin instead is the arithmetic a host depends on.
- **Raising the other budgets.** Only the navigation was inheriting a number this file does not
  control.

## Verification

- `test/test_render_budget.ts`: the budget is the sum of every phase, each phase is a real duration,
  and the page load is given more than the default it used to inherit. No browser involved — the
  bug is arithmetic and an unset option, not rendering.
- Break-verified: putting `RENDER_BUDGET_MS` back to launch + render turns the first test red.
- The timeout itself cannot be reproduced here — it is a loaded-CI timing failure and a render
  takes about a second on this machine. The evidence is the downstream CI logs in #3201.
