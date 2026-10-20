# fix: `document.columns` squeezes cards in a narrow host (#3551)

## Problem

`columns` (#3533) set `grid-cols-N` whatever the width. In MulmoTerminal's Canvas at its default
width, `columns: 2` left each card about 200px: the title truncated to nothing under the PNG / SVG /
CSV buttons and axis labels ran together. Found in a real agent run of MulmoTerminal's data-analysis
skill.

## Approach

`columns` becomes the most cards in a row. Each grid track is `minmax(min(100%, max(20rem, 1/N of
the row after the gaps)), 1fr)` under `repeat(auto-fill, …)`: a wide host gets N, a narrower one
fewer, one at the least, and never wider than the row. Only the class strings in `layout.ts` change;
the View is untouched.

## Verified

The plugin's View mounted in Chromium at several widths, cards per row measured: with the built
change, 460px at 2 or 4 columns gives 1 per row, 800px at 4 gives 2, 1100px at 4 gives 3, 1700px at
4 gives 4, never overflowing. The published 4.4.0 at 460px / 2 and 800px / 4 put 2 and 4 per row
with the title down to a few pixels.
