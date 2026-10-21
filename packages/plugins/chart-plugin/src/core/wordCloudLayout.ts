// Where each word of a word cloud goes. Largest first, each word is tried at points along a spiral
// from the centre and put at the first one where it fits inside the box without touching a word
// already placed; a word that fits nowhere is left out. Taken space is kept as a grid of cells, so
// one check costs the cells a word covers rather than the words placed so far.
//
// Widths come from a measuring function: the browser's own text metrics where there is a canvas,
// else an estimate from the characters that errs wide (the server's trial draw has no fonts).

import { seededRandom } from "./random";

export interface CloudWord {
  name: string;
  value: number;
}

export interface CloudStyle {
  /** Font sizes in px for the smallest and the largest value. */
  sizeRange: readonly [number, number];
  /** Degrees; each word takes one angle from this range, `rotationStep` apart. */
  rotationRange: readonly [number, number];
  rotationStep: number;
  /** Cell size in px of the grid that marks taken space; larger leaves more room between words. */
  gridSize: number;
}

/** Width in px of `text` at `fontSize`. */
export type MeasureText = (text: string, fontSize: number) => number;

export interface CloudBox {
  width: number;
  height: number;
}

export interface PlacedWord {
  /** Index into the words given to `layoutWords`. */
  index: number;
  x: number;
  y: number;
  fontSize: number;
  rotationDeg: number;
}

const LAYOUT_SEED = 0x2545f491;
// Measured in Chromium's sans-serif: full-width characters (CJK, kana, hangul) 1em, W and M up
// to 0.94em, capitals about 0.7em, lowercase under 0.6em; a line box about 1.15em tall.
const FULL_WIDTH_EM = 1;
const BROAD_LETTER_EM = 1;
const CAPITAL_EM = 0.75;
const OTHER_CHARACTER_EM = 0.62;
const FIRST_FULL_WIDTH_CODE_POINT = 0x1100;
const BROAD_LETTERS = new Set(["M", "W", "m", "w", "@", "%"]);
const LINE_HEIGHT_EM = 1.2;
const FULL_TURN_RAD = 2 * Math.PI;
/** Candidate positions one layout may try in all, so a cloud of words that do not fit cannot stall
 *  a redraw; words still unplaced when it runs out are left out. */
export const LAYOUT_CHECK_BUDGET = 5_000_000;
const DEGREES_TO_RAD = Math.PI / 180;

const isFullWidth = (character: string): boolean => (character.codePointAt(0) ?? 0) >= FIRST_FULL_WIDTH_CODE_POINT;

function characterEm(character: string): number {
  if (isFullWidth(character)) return FULL_WIDTH_EM;
  if (BROAD_LETTERS.has(character)) return BROAD_LETTER_EM;
  return character >= "A" && character <= "Z" ? CAPITAL_EM : OTHER_CHARACTER_EM;
}

/** Width of `text` in em, estimated from its characters so that it errs wide. */
export const textWidthEm = (text: string): number => [...text].reduce((width, character) => width + characterEm(character), 0);

/** The measure where no font can be measured. */
export const estimateTextWidth: MeasureText = (text, fontSize) => textWidthEm(text) * fontSize;

/** Font size for `value`, linear between `sizeRange` over the values' range. */
export function fontSizeFor(value: number, [lowest, highest]: readonly [number, number], [smallest, largest]: readonly [number, number]): number {
  if (highest === lowest) return (smallest + largest) / 2;
  return smallest + ((value - lowest) / (highest - lowest)) * (largest - smallest);
}

/** Every angle in `range`, `step` apart; just the range's start when the step cannot move. */
export function rotationChoices([from, to]: readonly [number, number], step: number): number[] {
  if (!(step > 0) || to <= from) return [from];
  return Array.from({ length: Math.floor((to - from) / step) + 1 }, (_, index) => from + index * step);
}

interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Half the width and height of the axis-aligned box around `name` at `fontSize`, turned by `rotationDeg`. */
function halfExtent(name: string, fontSize: number, rotationDeg: number, measure: MeasureText): { halfWidth: number; halfHeight: number } {
  const width = measure(name, fontSize);
  const height = LINE_HEIGHT_EM * fontSize;
  const angle = rotationDeg * DEGREES_TO_RAD;
  return {
    halfWidth: (Math.abs(width * Math.cos(angle)) + Math.abs(height * Math.sin(angle))) / 2,
    halfHeight: (Math.abs(width * Math.sin(angle)) + Math.abs(height * Math.cos(angle))) / 2,
  };
}

const rectAt = ({ halfWidth, halfHeight }: { halfWidth: number; halfHeight: number }, x: number, y: number): Rect => ({
  left: x - halfWidth,
  top: y - halfHeight,
  right: x + halfWidth,
  bottom: y + halfHeight,
});

interface Grid {
  cellPx: number;
  columns: number;
  taken: Uint8Array;
}

const newGrid = (box: CloudBox, cellPx: number): Grid => {
  const columns = Math.ceil(box.width / cellPx);
  return { cellPx, columns, taken: new Uint8Array(columns * Math.ceil(box.height / cellPx)) };
};

/** The span of grid cells `rect` touches. */
const cellSpan = (grid: Grid, rect: Rect): { firstColumn: number; lastColumn: number; firstRow: number; lastRow: number } => ({
  firstColumn: Math.floor(rect.left / grid.cellPx),
  lastColumn: Math.ceil(rect.right / grid.cellPx) - 1,
  firstRow: Math.floor(rect.top / grid.cellPx),
  lastRow: Math.ceil(rect.bottom / grid.cellPx) - 1,
});

// Loops rather than arrays of cells: this runs for every spiral point of every word, and stops at
// the first taken cell.
function isFree(grid: Grid, rect: Rect): boolean {
  const span = cellSpan(grid, rect);
  const at = { row: span.firstRow, column: span.firstColumn };
  while (at.row <= span.lastRow) {
    if (grid.taken[at.row * grid.columns + at.column] !== 0) return false;
    at.column += 1;
    if (at.column > span.lastColumn) {
      at.column = span.firstColumn;
      at.row += 1;
    }
  }
  return true;
}

function take(grid: Grid, rect: Rect): void {
  const span = cellSpan(grid, rect);
  const at = { row: span.firstRow };
  while (at.row <= span.lastRow) {
    grid.taken.fill(1, at.row * grid.columns + span.firstColumn, at.row * grid.columns + span.lastColumn + 1);
    at.row += 1;
  }
}

const inside = (rect: Rect, box: CloudBox): boolean => rect.left >= 0 && rect.top >= 0 && rect.right <= box.width && rect.bottom <= box.height;

/** Points on a spiral from the centre, stretched to the box's shape so its last turn passes
 *  through the corners, about one cell apart. */
function spiralPoints(box: CloudBox, cellPx: number): { x: number; y: number }[] {
  const longest = Math.max(box.width, box.height);
  const stretch = { x: box.width / longest, y: box.height / longest };
  const maxRadius = (longest / 2) * Math.SQRT2;
  const points: { x: number; y: number }[] = [];
  const at = { angle: 0, radius: 0 };
  while (at.radius <= maxRadius) {
    points.push({ x: box.width / 2 + at.radius * Math.cos(at.angle) * stretch.x, y: box.height / 2 + at.radius * Math.sin(at.angle) * stretch.y });
    at.angle += cellPx / Math.max(at.radius, cellPx);
    at.radius = (cellPx * at.angle) / FULL_TURN_RAD;
  }
  return points;
}

interface Placing {
  index: number;
  name: string;
  fontSize: number;
  rotationDeg: number;
}

interface Search {
  box: CloudBox;
  grid: Grid;
  spiral: { x: number; y: number }[];
  measure: MeasureText;
  /** Candidate positions still allowed in this layout. */
  checksLeft: number;
}

function place(word: Placing, search: Search): PlacedWord | null {
  const { box, grid } = search;
  const extent = halfExtent(word.name, word.fontSize, word.rotationDeg, search.measure);
  if (extent.halfWidth * 2 > box.width || extent.halfHeight * 2 > box.height) return null;
  const spot = search.spiral.find(({ x, y }) => {
    search.checksLeft -= 1;
    if (search.checksLeft < 0) return true;
    const rect = rectAt(extent, x, y);
    return inside(rect, box) && isFree(grid, rect);
  });
  if (!spot || search.checksLeft < 0) return null;
  take(grid, rectAt(extent, spot.x, spot.y));
  return { index: word.index, x: spot.x, y: spot.y, fontSize: word.fontSize, rotationDeg: word.rotationDeg };
}

/** A word with CJK, kana or hangul stays level: turned on its side its characters lie down, which
 *  is not how such text is read vertically. */
const uprightAngle = (name: string, angle: number): number => ([...name].some(isFullWidth) ? 0 : angle);

/** Largest value first, in their given order among equals, each with its size and angle. */
function placingOrder(words: CloudWord[], style: CloudStyle): Placing[] {
  const values = words.map(({ value }) => value);
  const valueRange: [number, number] = [Math.min(...values), Math.max(...values)];
  const angles = rotationChoices(style.rotationRange, style.rotationStep);
  const random = seededRandom(LAYOUT_SEED);
  return words
    .map((word, index) => ({ word, index }))
    .sort((a, b) => b.word.value - a.word.value || a.index - b.index)
    .map(({ word, index }) => ({
      index,
      name: word.name,
      fontSize: fontSizeFor(word.value, valueRange, style.sizeRange),
      rotationDeg: uprightAngle(word.name, angles[Math.floor(random() * angles.length)] ?? 0),
    }));
}

/** Where each word that fits goes in `box`. The same words, style and box give the same layout. */
export function layoutWords(
  words: CloudWord[],
  style: CloudStyle,
  box: CloudBox,
  measure: MeasureText = estimateTextWidth,
  checkBudget = LAYOUT_CHECK_BUDGET,
): PlacedWord[] {
  if (words.length === 0 || !(box.width > 0) || !(box.height > 0)) return [];
  const search: Search = { box, grid: newGrid(box, style.gridSize), spiral: spiralPoints(box, style.gridSize), measure, checksLeft: checkBudget };
  return placingOrder(words, style).flatMap((word) => place(word, search) ?? []);
}
