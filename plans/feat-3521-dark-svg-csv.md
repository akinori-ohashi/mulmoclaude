# feat: dark appearance, SVG and CSV exports (#3521)

## Problem

Cards were white and ECharts had no theme, so a dark host showed bright cards; only a PNG on white
could be exported — no SVG for reports, no CSV of the data drawn.

## Approach

- Appearance: the host signals it with `data-appearance` on `<html>` (MulmoTerminal's themes;
  MulmoClaude has no dark mode and never sets it). `src/vue/appearance.ts` reads it and follows it
  with a MutationObserver. Only `"dark"` is dark; the OS preference is not followed, so a light host
  does not get dark charts. Card classes per appearance are constants; ECharts gets its built-in
  `dark` theme with a transparent background (unless the option sets one), and a switch redraws.
- SVG: the card draws on a canvas, so the export draws the same option again off screen with the
  SVG renderer at the card's size and the card's colour as background.
- CSV (`src/core/exportData.ts`, pure): the first dataset whose source is a table (a sheet's rows
  included), else the category axis against each series' plain values; no button when neither
  applies. RFC 4180 with CRLF, a UTF-8 BOM for spreadsheets, and a leading quote on text that a
  spreadsheet would run as a formula.
- The file-name slug moved to `fileSlug` (no regex on the trailing dashes, compared with the old
  loop over generated titles).
