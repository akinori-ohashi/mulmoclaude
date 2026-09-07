# Changelog

Newest first. Each entry corresponds to a tagged release. Written in English.

## @mulmoclaude/markdown-utils@2.2.0 — 2026-08-30

All of this release is about one rule: deciding whether the body of an inline `$…$` is **math** or **a price**.

- **A number with a single separator is now typeset as math** (#2991, PR #3002). `円周率は $3.141$ です` used to survive as literal prose while `$3.14159$` rendered, so from an author's point of view the behaviour changed with the number of digits. Rule 5 read "one separator followed by exactly three digits" as money, which caught `3.141` along with `1.500`.

  The money branch was removed only after measuring what it bought. Every realistic currency phrasing is already rejected by rules 1–4 before rule 5 is reached: `価格は $1,000 です` has no closing `$`, `$1,000 と $2,000` and `合計 $1,000から$500` fail rule 3, `$1,000-$2,000` fails rule 4, `US$1,000` fails rule 1, and table cells are tokenized per cell. What remained was `$1,000$` — the doubled-delimiter form, which the module already reads as math for `$5$`.

- **Price detection keys on the shape of the number rather than the separator character.** Hard-coding the comma broke European `$1,5$` (= 1.5); keying on the separator alone typeset dot-locale `$1.000,50$` as math; and the "nobody writes 0.100 as a price" assumption was wrong, because fuel is priced to three decimals.

- **83 document-level combination tests** (#2990, PR #2993), taking the package from 39 to 122 tests with no source change. The five commits preceding them were the same rule narrowed four times, and each regression surfaced as "correct as a standalone rule, but real documents read it another way". `test_mathExtension.ts` stays the per-rule unit suite; the new `test_mathInDocuments.ts` covers rule-vs-rule and rule-vs-markdown combinations across finance, mathematics and IT prose — locale number forms, `$PATH` / `$(date)`, code spans and fences, price tables, `US$5`, `$5-$10`, `\$5`.

`2.0.0` and `2.1.0` were published to npm without git tags, so those tags were created retroactively on the commits that bumped `version` to each value. The exact boundary of what shipped in `2.1.0` is therefore best-effort, and this entry covers everything since that version bump. Tests are not part of the published tarball (`files: ["dist", "README.md"]`).

📦 **npm**: [`@mulmoclaude/markdown-utils@2.2.0`](https://www.npmjs.com/package/@mulmoclaude/markdown-utils/v/2.2.0)
