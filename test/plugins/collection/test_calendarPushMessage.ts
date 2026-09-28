// The push note's key and params, rendered (#3260).
//
// `test_calendarPushCounts.ts` covers the arithmetic. This covers the boundary
// the bug actually lived at: the counts were already right, and the sentence was
// built from four of them, so a helper-level test stayed green while the user
// read the wrong thing.
//
// The behaviour-preservation half is a DIFFERENTIAL, not an assertion about a
// string someone typed here: the expression the old code used is reproduced
// verbatim below and rendered beside the new one, over the REAL dictionaries,
// for generated inputs. "Unchanged for a collection that never opted in" is a
// claim about eight locales' output, and reading the template cannot check it.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { pushMessage } from "../../../packages/plugins/collection-plugin/src/vue/calendarPushResult";
import type { CollectionPushResult } from "../../../packages/plugins/collection-plugin/src/vue/uiContext";
import deMessages from "../../../packages/plugins/collection-plugin/src/vue/lang/de";
import enMessages from "../../../packages/plugins/collection-plugin/src/vue/lang/en";
import esMessages from "../../../packages/plugins/collection-plugin/src/vue/lang/es";
import frMessages from "../../../packages/plugins/collection-plugin/src/vue/lang/fr";
import jaMessages from "../../../packages/plugins/collection-plugin/src/vue/lang/ja";
import koMessages from "../../../packages/plugins/collection-plugin/src/vue/lang/ko";
import ptBRMessages from "../../../packages/plugins/collection-plugin/src/vue/lang/ptBR";
import zhMessages from "../../../packages/plugins/collection-plugin/src/vue/lang/zh";

const LOCALES = {
  de: deMessages,
  en: enMessages,
  es: esMessages,
  fr: frMessages,
  ja: jaMessages,
  ko: koMessages,
  ptBR: ptBRMessages,
  zh: zhMessages,
};

/** vue-i18n named interpolation, which is all these two templates use. An
 *  unmatched slot is left in place so a missing param shows up as `{name}` in
 *  the assertion rather than as a silent "undefined". */
const render = (template: string, params: Record<string, number>): string =>
  template.replace(/\{(\w+)\}/g, (whole, name: string) => (name in params ? String(params[name]) : whole));

const templateFor = (locale: keyof typeof LOCALES, key: string): string => {
  const leaf = key.replace("collectionsView.", "");
  const dict: Record<string, unknown> = LOCALES[locale].collectionsView;
  const template = dict[leaf];
  // Thrown rather than asserted: `assert.equal` does not narrow, and a missing
  // key must fail as a missing key rather than as `undefined` reaching render.
  if (typeof template !== "string") throw new Error(`${locale} is missing ${key}`);
  return template;
};

const result = (overrides: Partial<CollectionPushResult> = {}): CollectionPushResult => ({
  pushed: true,
  created: 0,
  updated: 0,
  conflicts: 0,
  localDeletes: 0,
  skipped: [],
  errors: [],
  ...overrides,
});

/** What the code did BEFORE this change, copied verbatim so the two can be run
 *  side by side. It is deleted when this test is, and that is the point: the
 *  property it proves outlives it, the expression does not. */
const renderedByOldCode = (locale: keyof typeof LOCALES, pushResult: CollectionPushResult): string => {
  const { created, updated, conflicts, localDeletes } = pushResult;
  return render(templateFor(locale, "collectionsView.pushDone"), { created, updated, conflicts, localDeletes });
};

const renderedByNewCode = (locale: keyof typeof LOCALES, pushResult: CollectionPushResult): string => {
  const { key, params } = pushMessage(pushResult);
  return render(templateFor(locale, key), params);
};

// Listed rather than derived from `Object.keys`, which types as `string[]`.
// The list going stale is caught by `LOCALES` itself: a locale added there and
// missed here simply is not exercised, and `templateFor` throws for one removed.
const locales: (keyof typeof LOCALES)[] = ["de", "en", "es", "fr", "ja", "ko", "ptBR", "zh"];

describe("pushMessage — a collection that never opted in renders exactly as it did", () => {
  // Generated rather than one example: the claim is about every shape the four
  // counts can take, and the interesting ones are the boundaries (0, 1, many)
  // and a result from an older host that carries no `deletedInGoogle` key.
  const withoutOptIn: CollectionPushResult[] = [];
  for (const created of [0, 1, 7]) {
    for (const localDeletes of [0, 1, 5]) {
      withoutOptIn.push(result({ created, updated: 2, conflicts: 3, localDeletes, deletedInGoogle: 0 }));
      withoutOptIn.push(result({ created, updated: 2, conflicts: 3, localDeletes })); // older host: key absent
    }
  }

  for (const locale of locales) {
    it(`${locale}: every generated result renders byte-identically`, () => {
      for (const pushResult of withoutOptIn) {
        assert.equal(renderedByNewCode(locale, pushResult), renderedByOldCode(locale, pushResult), `${locale} changed for ${JSON.stringify(pushResult)}`);
      }
    });
  }

  it("covers both the explicit zero and the absent key", () => {
    assert.equal(withoutOptIn.length, 18);
  });
});

describe("pushMessage — a collection that opted in says what reached Google", () => {
  it("switches to the key that names the deletions", () => {
    assert.equal(pushMessage(result({ localDeletes: 3, deletedInGoogle: 3 })).key, "collectionsView.pushDoneWithDeletes");
  });

  it("stays on the original key when nothing carried", () => {
    assert.equal(pushMessage(result({ localDeletes: 3, deletedInGoogle: 0 })).key, "collectionsView.pushDone");
  });

  // The regression in one line: the slot the template calls "not applied" must
  // hold the remainder, never the raw count.
  it("puts the REMAINDER in the slot the sentence calls 'not applied'", () => {
    const { params } = pushMessage(result({ localDeletes: 3, deletedInGoogle: 2 }));
    assert.equal(params.localDeletes, 1);
    assert.equal(params.deletedInGoogle, 2);
  });

  it("says nothing is outstanding when every deletion carried", () => {
    const { params } = pushMessage(result({ localDeletes: 3, deletedInGoogle: 3 }));
    assert.equal(params.localDeletes, 0);
  });

  for (const locale of locales) {
    it(`${locale}: renders both numbers, and no slot is left unfilled`, () => {
      const rendered = renderedByNewCode(locale, result({ created: 1, updated: 0, conflicts: 0, localDeletes: 3, deletedInGoogle: 2 }));
      assert.doesNotMatch(rendered, /\{\w+\}/, `${locale} left a slot unfilled: ${rendered}`);
      assert.match(rendered, /2/);
      assert.match(rendered, /1/);
    });
  }
});

// The two mutations Codex named on #3261: each must turn something here red.
// Written as assertions about what the CURRENT code does, so that making either
// mutation contradicts them.
describe("pushMessage — the mutations that reintroduce the bug", () => {
  it("always returning pushDone would contradict the key assertion above", () => {
    assert.notEqual(pushMessage(result({ localDeletes: 2, deletedInGoogle: 2 })).key, "collectionsView.pushDone");
  });

  it("passing the raw localDeletes would contradict the remainder assertion above", () => {
    const pushResult = result({ localDeletes: 4, deletedInGoogle: 3 });
    assert.notEqual(pushMessage(pushResult).params.localDeletes, pushResult.localDeletes);
  });
});

/** The slot names a template asks to be filled. */
const slotsOf = (template: string): string[] => [...template.matchAll(/\{(\w+)\}/g)].map((match) => match[1] ?? "").sort();

// The sentence a refused deletion rides (#3272). Its reason is the only thing
// saying an event is still standing in Google, so a locale spelling the slot
// differently would show the user a raw `{reasons}`. Typecheck pins that the key
// EXISTS in all eight; nothing pins what it asks for.
describe("pushKeptDeletes — every locale asks for the same one slot", () => {
  for (const locale of locales) {
    it(`asks only for the reasons in ${locale}`, () => {
      assert.deepEqual(slotsOf(templateFor(locale, "pushKeptDeletes")), ["reasons"]);
    });
  }
});
