// The `$…$` rules as they meet REAL articles, rather than as isolated
// rules. `test_mathExtension.ts` covers each rule on its own; this file
// covers what a finance / maths / IT blog post actually contains — code
// listings, diagrams, emphasis, tables, prices — and the combinations
// where two features meet.
//
// The whole recent history of this module is one rule being narrowed
// four times (f2af349 → 4e4ce72 → 2bed5a5 → 0410b55), each time because
// a real article came out wrong: `$10000$` sitting in the prose, then
// `$1,5$` broken for European authors, then `$1.000,50$` typeset as
// maths, then `$0.100$` refused for fuel prices. Every row of the money
// matrix below names which reading it encodes, so the next narrowing
// starts from the decisions rather than from the regexes.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Marked } from "marked";
import { mathExtension, isPlausibleInlineMath, findMathBlockStart } from "../src/markdown/mathExtension.js";
import { mermaidExtension } from "../src/markdown/mermaidExtension.js";

// A private instance: `marked.use()` mutates a global singleton the host
// and the mermaid tests share.
const mathMd = new Marked();
mathMd.use(mathExtension);

/** Every formula the document typeset, in order, as `i:<tex>` for inline
 *  and `D:<tex>` for display. Comparing whole arrays is what makes a
 *  combination case readable: it says which formulas were found AND that
 *  nothing else was swallowed. */
function typeset(source: string, instance: Marked = mathMd): string[] {
  const html = instance.parse(source) as string;
  const pattern = /data-math-pending="1" data-math-display="(\d)"[^>]*>([^<]*)</g;
  const found: string[] = [];
  let match = pattern.exec(html);
  while (match !== null) {
    found.push(`${match[1] === "1" ? "D" : "i"}:${match[2] ?? ""}`);
    match = pattern.exec(html);
  }
  return found;
}

/** 数式にならなかったことに加えて、その本文が**散文として残っている**ことまで
 *  見る。「プレースホルダが出ていない」だけでは、`$1,000$` をトークナイザが
 *  丸ごと飲み込んで何も出力しない回帰を通してしまう —— 価格が数式になるのと
 *  同じくらい悪いのに、テストは緑のままになる（coderabbit, #2993）。
 *
 *  `survives` は出力に残るべき文字列。markdown のエスケープを経る形（`\$5`
 *  → `$5`）があるので、ソースそのままではなく期待する出力を渡す。
 *
 *  **断片ではなく散文の全体を渡すこと。** 一部だけを見ていると、残りを
 *  飲み込む回帰がプレースホルダを出さないまま通る —— `$a\nb$ です` に
 *  対して `$a` だけを見ていたのがまさにそれで、改行後を失う回帰を
 *  素通りさせていた（codex, #2993）。 */
function assertProse(source: string, survives: string): void {
  const html = mathMd.parse(source) as string;
  assert.doesNotMatch(html, /data-math-pending/, `数式として組まれた: ${source}`);
  assert.ok(html.includes(survives), `散文が出力から消えた: ${survives} — ${html}`);
}

describe("the shape of a number decides maths vs money", () => {
  // The rule reads the SHAPE, never a particular separator: a comma
  // groups thousands in English and marks the decimal across most of
  // Europe, and a dot does the opposite, so naming either one breaks
  // half the world's authors (codex, #2985). Two separators, or one
  // followed by exactly three digits, is money.
  const MONEY: [string, string][] = [
    ["1,000.50", "英語の千区切り＋小数 — 区切り2つ"],
    ["1.000,50", "欧州の千区切り＋小数 — 同上、逆のロケール"],
    ["12,345,678", "区切り3つ"],
    ["1 000 000", "空白区切りが複数"],
    ["1.2.3", "区切り3つ — 数として計算する形ではない"],
    ["2024.01.15", "同上"],
    ["1,000,000.00", "千区切り2つ＋小数"],
  ];
  MONEY.forEach(([body, why]) => {
    it(`\`$${body}$\` は金額として散文に残す — ${why}`, () => {
      assertProse(`価格は $${body}$ です`, `$${body}$`);
    });
  });

  const MATHS: [string, string][] = [
    ["1", "答えは 1 — 数学記事の普通の書き方（f2af349）"],
    ["10000", "1秒を 10000 個に割る — 区切りを打たない数"],
    ["1,5", "欧州の 1.5 — カンマ決め打ちで壊していた（4e4ce72）"],
    ["1.5", "英語の 1.5"],
    ["3.14159", "小数5桁"],
    ["3.141", "π の3桁近似 — 「区切り1つ＋3桁は金額」で潰していた（#2991）"],
    ["1.414", "√2"],
    ["2.718", "e"],
    ["1.618", "黄金比"],
    ["0.577", "オイラー・マスケローニ定数"],
    ["6.022", "アボガドロ数の仮数"],
    ["9.807", "重力加速度"],
    ["0.001", "ミリ"],
    ["1.000", "有効数字3桁の 1"],
    ["999.999", "3桁＋3桁"],
    ["0.1", "測定値"],
    ["0.10", "区切り後が2桁"],
    ["0.100", "燃料の単価にも見えるが、区切り1つは数として読む（#2991）"],
    ["1,000", "千区切りに見えるが、両端に `$` を書いたのは数式の書き方（#2991）"],
    ["1,500", "同上"],
    ["1 000", "同上、空白区切り"],
    ["12,345", "同上"],
    ["-100", "符号付きは数字だけの形ではない"],
    ["1.5e10", "指数表記"],
    ["12:30", "コロンは数の区切りではない"],
    ["1,0000", "区切り後が4桁"],
    ["1,00", "区切り後が2桁"],
  ];
  MATHS.forEach(([body, why]) => {
    it(`\`$${body}$\` は数式として組む — ${why}`, () => {
      assert.deepEqual(typeset(`値は $${body}$ です`), [`i:${body}`]);
    });
  });

  // Bodies that are digits-and-separators but do not parse as a written
  // number at all: a run comes out empty, so the money test declines and
  // the body typesets. Pinned because it is the boundary of
  // `isMoneyShaped`, and a future rewrite that "simplifies" the split
  // would move it silently.
  const MALFORMED = ["1  000", "1,,000", "1000.", ".5"];
  MALFORMED.forEach((body) => {
    it(`\`$${body}$\` は数として壊れているので金額判定にかからない`, () => {
      assert.deepEqual(typeset(`$${body}$ です`), [`i:${body}`]);
    });
  });
});

describe("組むものが無い本文", () => {
  // 区切り記号だけの本文は数式ではない。表の空欄に `$-$` と書く、
  // 箇条書きに `$...$` と置く、といった書き方が金融記事にはある。
  ["+", "-", "...", ":", "%", " . , ".trim()].forEach((body) => {
    it(`\`$${body}$\` は組むものが無いので散文のまま`, () => {
      assertProse(`区切り $${body}$ です`, `$${body}$`);
      assert.equal(isPlausibleInlineMath(body, ""), false);
    });
  });
});

describe("トークナイザ単体の境界 — 拡張経由では届かないもの", () => {
  // `isPlausibleInlineMath` は公開関数で、`INLINE_PLAIN` が `\n` を
  // 弾くために拡張経由では改行入りの本文が渡らない。関数の契約として
  // 独立に固定する（この2件はどちらのテストファイルも見ていなかった）。
  it("改行を含む本文を拒む", () => {
    assert.equal(isPlausibleInlineMath("a\nb", ""), false);
    assert.equal(isPlausibleInlineMath("E =\nmc^2", ""), false);
  });

  it("閉じ `$` がエスケープされていた本文を拒む", () => {
    // 本文が `\` で終わるのは、閉じたと思った `$` が実は `\$` だった形。
    assert.equal(isPlausibleInlineMath("x\\", ""), false);
    assertProse("$x\\$ です", "$x$");
  });

  it("`$$` ブロックは3スペースまでのインデントを許し、4スペースは許さない", () => {
    // 4スペースはインデントコード。ブロック用の正規表現と `findMathBlockStart`
    // の両方が同じ境界を持っていることを確かめる。
    assert.deepEqual(typeset("   $$\n   x^2\n   $$"), ["D:x^2"]);
    assertProse("    $$\n    x^2\n    $$", "$$\nx^2\n$$");
    assert.equal(findMathBlockStart("   $$\nx"), 3);
    assert.equal(findMathBlockStart("    $$\nx"), undefined);
  });
});

describe("金融記事 — 価格は散文、数式だけ組む", () => {
  it("一文に価格が2つあっても間の日本語を飲み込まない", () => {
    assertProse("コーヒーが $100 でパンが $200 です", "コーヒーが $100 でパンが $200 です");
  });

  it("価格と数式が同じ文にあるとき、数式だけを組む", () => {
    // ブログで一番多い形。閉じ `$` の直前が空白（ルール3）で価格側が落ち、
    // 続く `$r$` だけが数式になる。
    assert.deepEqual(typeset("価格 $100 に対し比率 $r$ を掛ける"), ["i:r"]);
  });

  it("通貨接頭辞と価格レンジを散文のまま残す", () => {
    assertProse("US$5 と CAD$10", "US$5 と CAD$10");
    assertProse("$5-$10 の範囲", "$5-$10 の範囲");
    assertProse("定価は \\$5 です", "定価は $5 です");
  });

  it("ルール1だけが効いている形でも散文のまま", () => {
    // 上の3例はルール3か4でも落ちるため、ルール1を外しても通ってしまう。
    // 本文が単独の識別子で、閉じ `$` の後ろが日本語 —— つまりルール1が
    // 唯一の防御になる形を別に置く。
    assertProse("記号 US$x$ です", "記号 US$x$ です");
    assertProse("エスケープ \\$x$ です", "エスケープ $x$ です");
  });

  it("価格表の各セルを数式にしない", () => {
    assertProse("| 商品 | 価格 |\n|---|---|\n| A | $100 |\n| B | $200 |", "<td>$100</td>");
    assertProse("| 商品 | 価格 |\n|---|---|\n| A | $100 |\n| B | $200 |", "<td>$200</td>");
  });

  it("表のセル内の数式は組む", () => {
    assert.deepEqual(typeset("| 記号 | 意味 |\n|---|---|\n| $\\sigma$ | 標準偏差 |"), ["i:\\sigma"]);
  });

  it("利回りやパーセントの式を組む", () => {
    assert.deepEqual(typeset("利回りは $r = 5\\%$ でした"), ["i:r = 5\\%"]);
    assert.deepEqual(typeset("複利は $A = P(1+r)^n$ で計算する"), ["i:A = P(1+r)^n"]);
  });

  it("本文に `$` を書きたいときは TeX 側でエスケープできる", () => {
    // 閉じ `$` を `\$` と取り違えて途中で切らないこと（INLINE_PLAIN の
    // エスケープ分岐）。
    assert.deepEqual(typeset("$\\text{Cost: \\$5}$ です"), ["i:\\text{Cost: \\$5}"]);
  });
});

describe("IT記事 — `$` はシェル変数であってデリミタではない", () => {
  const SHELL: [string, string, string][] = [
    ["環境変数 $PATH と $HOME を設定", "環境変数 $PATH と $HOME を設定", "閉じ側の直前が空白"],
    ["引数 $1 と $2 を渡す", "引数 $1 と $2 を渡す", "同上 — 位置引数"],
    ["結果は $(date) です", "結果は $(date) です", "閉じる `$` がない"],
    ["`export PATH=$PATH:/bin`", "<code>export PATH=$PATH:/bin</code>", "インラインコードは触らない"],
  ];
  SHELL.forEach(([source, survives, why]) => {
    it(`散文の \`${source.slice(0, 18)}…\` を数式にしない — ${why}`, () => {
      assertProse(source, survives);
    });
  });

  it("コードは4つの書き方すべてで数式から守られる", () => {
    assertProse("`$x$` はコード", "<code>$x$</code>");
    assertProse("```\n$y$\n```", "<code>$y$\n</code>");
    assertProse("~~~\n$z$\n~~~", "<code>$z$\n</code>");
    assertProse("    $w$\n", "<code>$w$\n</code>");
    assertProse("```\n$$x$$\n```", "<code>$$x$$\n</code>");
  });

  it("コード紹介と数式と図が同居する記事で、それぞれが独立に動く", () => {
    // ブログ記事の実物の形。mermaid 拡張と同じ Marked インスタンスに
    // 載せても互いのプレースホルダを壊さない。
    const blog = new Marked();
    blog.use(mathExtension);
    blog.use(mermaidExtension);
    const article = ["# 記事", "", "```mermaid", "graph TD", "  A-->B", "```", "", "式は $E=mc^2$ です。", "", "```js", "const price = $100;", "```", ""].join(
      "\n",
    );
    assert.deepEqual(typeset(article, blog), ["i:E=mc^2"], "コード内の $100 を拾わないこと");
    assert.match(blog.parse(article) as string, /data-mermaid-pending/, "図のプレースホルダも残ること");
  });
});

describe("markdown の構造と数式の組み合わせ", () => {
  const STRUCTURE: [string, string, string[]][] = [
    ["斜体の中", "*$x$* は変数", ["i:x"]],
    ["太字の中", "**$E=mc^2$** は有名", ["i:E=mc^2"]],
    ["取り消し線の中", "~~$x$~~ は削除", ["i:x"]],
    ["強調が数式をまたぐ", "*係数 $a$ と定数*", ["i:a"]],
    ["強調と隣接（空白なし）", "$x$**太字**です", ["i:x"]],
    ["見出し", "## $E=mc^2$ について", ["i:E=mc^2"]],
    ["引用", "> $x^2$ を考える", ["i:x^2"]],
    ["リスト", "- 項目 $a_1$\n- 項目 $b_2$", ["i:a_1", "i:b_2"]],
    ["ネストしたリスト", "- 外\n  - 内 $y$", ["i:y"]],
    ["リンクのテキスト内", "[式 $x$](https://example.com) を参照", ["i:x"]],
    ["リンクの直後", "[a](u)$x$ です", ["i:x"]],
    ["表の複数セル", "| a | b |\n|---|---|\n| $x$ | $y$ |", ["i:x", "i:y"]],
    ["脚注の中", "本文[^1]\n\n[^1]: 注 $x$ です", ["i:x"]],
    ["HTMLブロックの隣", "<div>a</div>\n\n$x$ です", ["i:x"]],
    ["文末", "最後は $x^2$", ["i:x^2"]],
    ["1行に複数", "$a$ と $b$ と $c$", ["i:a", "i:b", "i:c"]],
    ["デリミタが隣接", "$a$$b$", ["i:a", "i:b"]],
  ];
  STRUCTURE.forEach(([label, source, expected]) => {
    it(`${label}で数式が生き残る`, () => {
      assert.deepEqual(typeset(source), expected);
    });
  });

  it("強調記号が数式の本文を食べない", () => {
    // marked のインライン拡張は組み込みの強調より先に走るので、`*` も
    // `_` も TeX のまま渡る。ここが崩れると `a*b*c` が `a<em>b</em>c`
    // になり、MathJax に壊れた TeX が渡る。
    assert.deepEqual(typeset("$a*b*c$ の積"), ["i:a*b*c"]);
    assert.deepEqual(typeset("$a_1_2$ の添字"), ["i:a_1_2"]);
  });

  it("強調の中の価格は価格のまま", () => {
    assertProse("**価格は $100 です**", "価格は $100 です");
  });
});

describe("display 数式", () => {
  it("独立した `$$` ブロックを組む", () => {
    assert.deepEqual(typeset("式:\n\n$$\nE = mc^2\n$$\n\n終わり"), ["D:E = mc^2"]);
  });

  it("1つの文書に複数のブロックを置ける", () => {
    assert.deepEqual(typeset("$$\na\n$$\n\n$$\nb\n$$"), ["D:a", "D:b"]);
  });

  it("文中の `$$…$$` は display モードだが inline 要素として出す", () => {
    // `<p>` の中に `<div>` を入れるとブラウザが黙って組み替えるため。
    const html = mathMd.parse("途中に $$x^2$$ がある") as string;
    assert.deepEqual(typeset("途中に $$x^2$$ がある"), ["D:x^2"]);
    assert.match(html, /<span class="math-inline"/);
    assert.doesNotMatch(html, /<div class="math-block"/);
  });

  it("リストと引用の中でもブロックとして組む", () => {
    assert.deepEqual(typeset("- 項目\n\n  $$\n  x^2\n  $$\n"), ["D:x^2"]);
    assert.deepEqual(typeset("> $$\n> x^2\n> $$"), ["D:x^2"]);
  });

  it("`$$` は通貨の判定を受けない — 曖昧さがないので", () => {
    // インライン `$…$` のルール1-5は `$$…$$` には掛からない。
    assert.deepEqual(typeset("$$\n1,000\n$$"), ["D:1,000"]);
    assert.deepEqual(typeset("$$1.000,50$$"), ["D:1.000,50"]);
  });

  it("中身が空なら組まない", () => {
    assertProse("$$\n   \n$$", "<p>$$</p>");
    assertProse("$$ です", "$$ です");
  });
});

describe("TeX 本文の受け渡し", () => {
  it("HTML の特殊文字をエスケープして placeholder に載せる", () => {
    // 本文はテキストノードとして運ぶ。DOMPurify はテキストを素通しする
    // ので、DOM から読み戻すときに実体参照が自然に解ける。
    const html = mathMd.parse('$a<b$ と $x = "s"$') as string;
    assert.match(html, />a&lt;b</);
    assert.match(html, />x = &quot;s&quot;</);
    assert.doesNotMatch(html, /<b\$/, "生の `<` がタグとして出ないこと");
  });

  it("入れ子の波括弧やマクロをそのまま渡す", () => {
    assert.deepEqual(typeset("$\\frac{\\frac{a}{b}}{c}$"), ["i:\\frac{\\frac{a}{b}}{c}"]);
    assert.deepEqual(typeset("系列 $a_1, a_2, \\ldots, a_n$ を考える"), ["i:a_1, a_2, \\ldots, a_n"]);
    assert.deepEqual(typeset("$a \\texttt{b} c$"), ["i:a \\texttt{b} c"]);
  });

  it("`\\href` の判定はここではせず、そのまま下流に渡す", () => {
    // 危険な URL を止めるのは `mathRender.ts` のサニタイズであって
    // トークナイザではない（6545bb3）。ここで落とすと二重防御の在り処が
    // ぼやけるので、通ることを固定しておく。
    assert.deepEqual(typeset("$\\href{https://a.example}{x}$"), ["i:\\href{https://a.example}{x}"]);
  });
});

describe("改行コードと空白の変種", () => {
  it("CRLF の文書でも inline / display とも組む", () => {
    // Windows で書かれた記事や、貼り付けで CRLF になった記事。
    assert.deepEqual(typeset("文中 $x^2$ です\r\n次の行"), ["i:x^2"]);
    assert.deepEqual(typeset("式:\r\n\r\n$$\r\nE = mc^2\r\n$$\r\n\r\n終"), ["D:E = mc^2"]);
  });

  it("インライン数式は行をまたがない", () => {
    assertProse("$a\nb$ です", "$a\nb$ です");
  });

  it("treats an ideographic space and a tab as number separators", () => {
    // JS `\s` covers U+3000 and TAB, so both split the digit runs. One
    // separator is a number, so these typeset; it takes two to read as money.
    assert.deepEqual(typeset("$1\u3000000$ です"), ["i:1\u3000000"]);
    assert.deepEqual(typeset("$1\t000$ です"), ["i:1\t000"]);
    assertProse("$1\u3000000\u3000000$ です", "$1\u3000000\u3000000$ です");
  });

  it("デリミタに空白が接していたら数式にしない", () => {
    assertProse("$ x$ と $x $", "$ x$ と $x $");
  });
});
