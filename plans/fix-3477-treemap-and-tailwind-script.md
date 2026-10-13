# fix: browser-drawn beats — treemap / sankey colours and the html_tailwind script field (#3477, part)

## Problem

Two gaps in the HTML beat preview from #3476 that MulmoClaude can close itself (the chart / mermaid look is being
fixed in mulmocast, receptron/mulmocast-cli#1634):

- The chart driver passed the JSON config straight to Chart.js. mulmocast's PNG template (`assets/html/chart.html`)
  first turns a treemap's `backgroundColor` array and a sankey's `colorFrom` / `colorTo` maps into the scriptable
  functions those chart types need; without that, their colours come out wrong.
- `beatToHtml` leaves out an `html_tailwind` beat's `script` field, so such beats were kept on the PNG path.

## Decision

- The chart driver (`CHART_DRIVER_JS`) ports the template's treemap and sankey conversions and its try/catch.
- `authorScriptTag` appends the `script` field after the beat's markup the way the PNG render does (a module script
  when the code uses ESM `import` / `export`). Such beats are drawn in the browser; only `elements` / `animation`
  stay on the PNG path. For a beat with an author script, the CSP allows `https:` script sources, as the PNG render
  does; the sandboxed iframe (no same-origin) is what isolates it from the host.

## Tests

- The driver run against a stand-in Chart: treemap colours cycle, sankey maps become lookups with a grey fallback,
  other chart types are untouched.
- `authorScriptTag`: classic vs module; the `html_tailwind` document carries the script and the wider CSP; other
  beats keep the narrow CSP.
