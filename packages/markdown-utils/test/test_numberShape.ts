// Exhaustive cover of the ONE rule that decides whether `$…$` around a bare
// number is a formula or a price left in the prose — rule 5's `isMoneyShaped`.
//
// It gets its own file because it is the rule this module has rewritten five
// times (f2af349 → 4e4ce72 → 2bed5a5 → 0410b55 → #2991), every time because a
// real article came out wrong, and every time by moving the SAME boundary.
// `test_mathExtension.ts` covers the five delimiter rules; `test_mathInDocuments.ts`
// covers whole articles; this covers the boundary itself, edge by edge.
//
// The rule, after #2991: a body of digits-and-separators is money when it
// carries TWO separators or more. One separator is a number, whatever follows
// it — the reading that costs nothing, because every realistic way of writing
// a price dies at rules 1-4 before this rule is consulted at all (the
// "currency prose never reaches rule 5" suite below is what pins that).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Marked } from "marked";
import { mathExtension, isPlausibleInlineMath } from "../src/markdown/mathExtension.js";

const mathMd = new Marked();
mathMd.use(mathExtension);
const PENDING = /data-math-pending="1"/;

/** The rule under test, reached the way production reaches it. `after` is the
 *  character following the closing delimiter; a space keeps rules 1-4 quiet so
 *  only rule 5 can decide. */
const isMaths = (body: string): boolean => isPlausibleInlineMath(body, " ");

/** Same question asked through the whole extension, so the unit answers above
 *  cannot drift from what a document actually renders. */
const rendersMaths = (body: string): boolean => PENDING.test(mathMd.parse(`値は $${body}$ です`) as string);

function expectMaths(bodies: readonly string[], why: string): void {
  for (const body of bodies) {
    assert.equal(isMaths(body), true, `${JSON.stringify(body)} should typeset — ${why}`);
    assert.equal(rendersMaths(body), true, `${JSON.stringify(body)} should typeset in a document — ${why}`);
  }
}

function expectProse(bodies: readonly string[], why: string): void {
  for (const body of bodies) {
    assert.equal(isMaths(body), false, `${JSON.stringify(body)} should stay prose — ${why}`);
    assert.equal(rendersMaths(body), false, `${JSON.stringify(body)} should stay prose in a document — ${why}`);
  }
}

describe("separator count is the whole test", () => {
  it("zero separators — a bare integer is a number", () => {
    expectMaths(["0", "1", "42", "10000", "999999999999999999999"], "no separator to read");
  });

  it("one separator — a number, whatever follows it", () => {
    expectMaths(["1.5", "1,5", "0.1", "1.000", "1,000", "1 000", "12,345", "1.23456789"], "one separator");
  });

  it("two separators or more — a formatted amount", () => {
    expectProse(["1,000.50", "1.000,50", "1 000,50", "12,345,678", "1 000 000", "1.2.3", "1,000,000.00"], "grouping AND a decimal mark");
  });

  it("many separators", () => {
    expectProse(["1.2.3.4.5", "1,2,3,4,5,6,7,8,9", "1 2 3 4"], "far past two");
  });
});

describe("every tail length after a single separator", () => {
  // The old rule singled out THREE and nothing else, which is what made
  // `$3.141$` behave differently from `$3.14$` and `$3.1415$`. Walk the whole
  // range so a future narrowing has to face the discontinuity it creates.
  const TAILS = ["1.1", "1.12", "1.123", "1.1234", "1.12345", "1.123456"];
  it("typesets at 1, 2, 3, 4, 5 and 6 digits alike", () => {
    expectMaths(TAILS, "tail length is not a signal on its own");
  });

  it("has no discontinuity at three — the shape the old rule cut on", () => {
    const decisions = TAILS.map((body) => isMaths(body));
    assert.deepEqual(new Set(decisions), new Set([true]), "one rule for every tail length");
  });
});

describe("leading run length and leading zeros", () => {
  it("typesets whatever precedes the separator", () => {
    expectMaths([".5", "0.5", "00.5", "1.5", "12.5", "123.5", "1234.5", "1234567.5"], "the leading run is not a signal");
  });

  it("treats a leading zero like any other digit", () => {
    // 0410b55 removed a leading-zero exception because fuel is priced at
    // `$0.100` a litre. #2991 makes the point moot: one separator is a number
    // either way, so `$0.100$` and `$1.500$` are read the same — as maths.
    expectMaths(["0.100", "0.000", "0.001", "1.500"], "no leading-zero special case");
  });
});

describe("the maths constants the old rule swallowed (#2991)", () => {
  // Every one of these came out as a literal `$…$` sitting in the prose. They
  // are the reason the rule moved; each is here by name so a future narrowing
  // has to say which of them it is willing to break again.
  const CONSTANTS: [string, string][] = [
    ["3.141", "π"],
    ["1.414", "√2"],
    ["1.732", "√3"],
    ["2.718", "e"],
    ["1.618", "φ, the golden ratio"],
    ["0.577", "γ, Euler–Mascheroni"],
    ["6.022", "Avogadro's mantissa"],
    ["9.807", "g"],
    ["2.998", "c's mantissa"],
    ["1.381", "Boltzmann's mantissa"],
    ["0.693", "ln 2"],
    ["2.303", "ln 10"],
  ];
  CONSTANTS.forEach(([body, name]) => {
    it(`typesets ${body} (${name})`, () => {
      expectMaths([body], name);
    });
  });
});

describe("separator kinds are read the same, whichever one it is", () => {
  // A comma groups thousands in English and marks the decimal across most of
  // Europe; a dot does the opposite. Naming either one breaks half the world's
  // authors, so the rule counts separators instead of identifying them.
  it("dot, comma, space, tab and an ideographic space all separate", () => {
    expectMaths(["1.000", "1,000", "1 000", "1\t000", "1　000"], "one separator of any kind");
    expectProse(["1.000.000", "1,000,000", "1 000 000", "1\t000\t000", "1　000　000"], "two of any kind");
  });

  it("counts a mixed pair as two", () => {
    expectProse(["1.000,50", "1,000.50", "1 000,50", "1.000 50"], "mixed kinds still count");
  });

  it("does not treat a colon, slash or hyphen as a number separator", () => {
    // They are not in the separator set, so the body is not digits-and-separators
    // at all and lands on the maths side by the first check.
    expectMaths(["12:30", "1/2", "1-2", "1:2:3", "1/2/3"], "not a number separator");
  });
});

describe("bodies that are not written numbers at all", () => {
  it("typesets anything carrying a non-digit run", () => {
    expectMaths(["x", "x=1", "1+1", "1.5e10", "-100", "1a.000", "a.b.c"], "not digits-and-separators");
  });

  it("keeps a body of separators with no digits as prose", () => {
    // Nothing to typeset. This is the SEPARATORS_ONLY half of rule 5, which
    // #2991 does not touch — pinned here so the two halves stay distinguishable.
    expectProse(["+", "-", "...", ":", "%", ".", ",", " . , "], "no digits to draw");
  });
});

describe("malformed numbers — where a run comes out empty", () => {
  // `split` yields an empty run, which fails the digits test, so the body is
  // not a written number and typesets. Pinned because it is the exact boundary
  // of `isMoneyShaped`, and a rewrite that "simplifies" the split would move it.
  it("typesets doubled, leading and trailing separators", () => {
    expectMaths(["1,,000", "1..000", "1  000", "1000.", "1000,", ".5", ",5", "1,,,000"], "an empty run is not a digit run");
  });

  it("typesets a lone separator run even when there are several", () => {
    expectMaths(["1,,000,,000"], "empty runs keep it off the money path");
  });
});

describe("currency prose never reaches rule 5", () => {
  // This is the evidence the #2991 change rests on: every realistic way of
  // writing a price is already dead at rules 1-4, so rule 5 was paying for a
  // case it never had to catch. If one of these ever starts typesetting, the
  // reasoning behind the change is gone and it should be revisited.
  const PROSE: [string, string][] = [
    ["価格は $1,000 です", "no closing `$` at all"],
    ["$1,000 と $2,000 です", "rule 3 — whitespace before the close"],
    ["合計 $1,000から$500 引く", "rule 3"],
    ["$1,000-$2,000 の範囲", "rule 4 — a digit after the close"],
    ["$1,000〜$2,000 の範囲", "rule 3"],
    ["US$1,000 と CAD$2,000", "rule 1 — alphanumeric before the open"],
    ["定価は \\$1,000 です", "rule 1 — an escaped dollar"],
    ["| A | $1,000 |\n|---|---|\n| B | $2,000 |", "table cells are tokenised apart"],
    ["Prices: $1,000, $2,000, $3,000", "rule 3"],
    ["It costs $1,000.", "no closing `$`"],
    ["価格は $1,000$2,000 です", "rule 4"],
  ];
  PROSE.forEach(([source, why]) => {
    it(`leaves \`${source.slice(0, 22)}…\` as prose — ${why}`, () => {
      assert.doesNotMatch(mathMd.parse(source) as string, PENDING);
    });
  });

  it("leaves only the doubled-delimiter shape for rule 5 to see", () => {
    // `$1,000$` is what remains, and this file reads it as maths for the same
    // reason `$5$` is maths: a person quoting a price writes `$1,000`, and it
    // is the DOUBLED delimiter that makes it a formula (f2af349).
    assert.match(mathMd.parse("合計は $1,000$ でした") as string, PENDING);
    assert.match(mathMd.parse("答えは $5$ です") as string, PENDING);
  });
});

describe("display `$$…$$` is not subject to this rule", () => {
  it("typesets a money-shaped body when the delimiters are unambiguous", () => {
    assert.match(mathMd.parse("$$\n1.000,50\n$$") as string, PENDING);
    assert.match(mathMd.parse("$$12,345,678$$") as string, PENDING);
  });
});

describe("the unit answer and the rendered answer agree", () => {
  // `isPlausibleInlineMath` is exported and tested directly all over this
  // suite; this is the guard that it still describes what a document does.
  const SAMPLE = ["3.141", "1,000", "1.000,50", "12,345,678", "1", "x=1", "+", "1,,000"];
  it("gives the same verdict through the extension as through the function", () => {
    for (const body of SAMPLE) {
      assert.equal(isMaths(body), rendersMaths(body), `disagreement on ${JSON.stringify(body)}`);
    }
  });
});
