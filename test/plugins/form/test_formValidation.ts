// What `presentForm` accepts, and what it refuses (#3287).
//
// The definition arrives from the model, so every rule here is the only thing
// between a bad field and a form the user cannot complete. This copy of the
// plugin had lost the whole `defaultValue` family and the unknown-type check
// that its upstream (`@mulmochat-plugin/form`) still had: a default outside the
// choices, of the wrong type, or outside the range the same field declares was
// accepted and rendered.
//
// Both directions, because a validator that refuses everything passes a
// one-directional test: each rule gets a case that must be REFUSED and the
// valid neighbour that must still be ACCEPTED. The object-shaped choice is the
// case upstream's own `choices.includes()` would get wrong — here a choice may
// be `{ label, value? }`, and the default matches the resolved VALUE.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { executeForm } from "../../../packages/plugins/form-plugin/src/core/plugin.ts";
import type { FormArgs, FormField } from "../../../packages/plugins/form-plugin/src/core/types.ts";

const context = {} as never;

/** The message when the form was built, or the refusal. `executeForm` reports a
 *  bad definition as a result rather than by throwing. */
const run = async (fields: unknown[]): Promise<string> => {
  const args = { title: "T", fields } as unknown as FormArgs;
  const result = await executeForm(context, args);
  return result.message;
};

/** True when the definition was accepted. Returned rather than asserted so the
 *  assertion sits in the case that cares about it. */
const accepts = async (fields: unknown[]): Promise<boolean> => !(await run(fields)).startsWith("Form error");

/** The refusal's reason, or the message it produced instead — so a case that
 *  expected a refusal and got a form reads as the form it got. */
const refusalFor = async (fields: unknown[]): Promise<string> => run(fields);

describe("presentForm — a definition with no defaults", () => {
  it("accepts one field of every type it can render", async () => {
    const fields: FormField[] = [
      { id: "a", type: "text", label: "A" },
      { id: "b", type: "textarea", label: "B" },
      { id: "c", type: "radio", label: "C", choices: ["x", "y"] },
      { id: "d", type: "dropdown", label: "D", choices: ["x"] },
      { id: "e", type: "checkbox", label: "E", choices: ["x", "y"] },
      { id: "f", type: "date", label: "F" },
      { id: "g", type: "time", label: "G" },
      { id: "h", type: "number", label: "H" },
    ];
    assert.ok(await accepts(fields), "refused a valid form");
  });

  it("refuses a type it cannot render", async () => {
    assert.match(await refusalFor([{ id: "a", type: "hologram", label: "A" }]), /unknown field type 'hologram'/);
  });

  it("still refuses a missing id, label or type, and a duplicate id", async () => {
    assert.match(await refusalFor([{ type: "text", label: "A" }]), /must have a valid 'id' property/);
    assert.match(await refusalFor([{ id: "a", type: "text" }]), /must have a valid 'label' property/);
    assert.match(await refusalFor([{ id: "a", label: "A" }]), /must have a valid 'type' property/);
    const duplicated = [
      { id: "a", type: "text", label: "A" },
      { id: "a", type: "text", label: "B" },
    ];
    assert.match(await refusalFor(duplicated), /Duplicate field ID: 'a'/);
  });
});

describe("presentForm — defaultValue on a text field", () => {
  it("accepts a default inside the declared length range", async () => {
    assert.ok(await accepts([{ id: "a", type: "text", label: "A", minLength: 2, maxLength: 6, defaultValue: "abcd" }]), "refused a valid form");
  });

  it("refuses a default that is not a string", async () => {
    assert.match(await refusalFor([{ id: "a", type: "text", label: "A", defaultValue: 42 }]), /defaultValue must be a string/);
  });

  it("refuses a default shorter than minLength or longer than maxLength", async () => {
    assert.match(await refusalFor([{ id: "a", type: "text", label: "A", minLength: 4, defaultValue: "ab" }]), /length is less than minLength/);
    assert.match(await refusalFor([{ id: "a", type: "textarea", label: "A", maxLength: 3, defaultValue: "abcdefg" }]), /length exceeds maxLength/);
  });
});

describe("presentForm — defaultValue on a radio or dropdown", () => {
  it("accepts a default that is one of the choices", async () => {
    assert.ok(await accepts([{ id: "a", type: "radio", label: "A", choices: ["x", "y"], defaultValue: "y" }]), "refused a valid form");
  });

  // A choice may be an object here, and the submitted value is its `value` (or
  // its `label` when there is none). Matching on the object itself would refuse
  // a correct default.
  it("accepts a default that matches an object choice's value", async () => {
    assert.ok(
      await accepts([{ id: "a", type: "dropdown", label: "A", choices: [{ label: "Extra large", value: "xl" }], defaultValue: "xl" }]),
      "refused a valid form",
    );
  });

  it("accepts a default that matches an object choice with no value, by its label", async () => {
    assert.ok(await accepts([{ id: "a", type: "dropdown", label: "A", choices: [{ label: "Blue" }], defaultValue: "Blue" }]), "refused a valid form");
  });

  it("refuses a default that is not among the choices", async () => {
    assert.match(await refusalFor([{ id: "a", type: "radio", label: "A", choices: ["x", "y"], defaultValue: "z" }]), /defaultValue 'z' is not in choices/);
  });

  it("refuses a non-string default", async () => {
    assert.match(await refusalFor([{ id: "a", type: "dropdown", label: "A", choices: ["x"], defaultValue: ["x"] }]), /defaultValue must be a string/);
  });
});

describe("presentForm — defaultValue on a checkbox", () => {
  it("accepts an array of choices within the selection range", async () => {
    assert.ok(
      await accepts([{ id: "a", type: "checkbox", label: "A", choices: ["x", "y", "z"], minSelections: 1, maxSelections: 2, defaultValue: ["x", "z"] }]),
      "refused a valid form",
    );
  });

  it("refuses a default that is not an array", async () => {
    assert.match(await refusalFor([{ id: "a", type: "checkbox", label: "A", choices: ["x"], defaultValue: "x" }]), /defaultValue must be an array/);
  });

  it("refuses a default holding something that is not a choice", async () => {
    assert.match(
      await refusalFor([{ id: "a", type: "checkbox", label: "A", choices: ["x"], defaultValue: ["x", "q"] }]),
      /contains 'q' which is not in choices/,
    );
  });

  // CodeRabbit on #3298: the view ticks by index, so a repeat is one tick, two
  // against the count rules, and two entries in what is submitted.
  it("refuses a default that repeats a selection", async () => {
    assert.match(await refusalFor([{ id: "a", type: "checkbox", label: "A", choices: ["x", "y"], defaultValue: ["x", "x"] }]), /must not repeat a selection/);
  });

  it("refuses a default outside the selection counts", async () => {
    assert.match(
      await refusalFor([{ id: "a", type: "checkbox", label: "A", choices: ["x", "y"], minSelections: 2, defaultValue: ["x"] }]),
      /fewer selections than minSelections/,
    );
    assert.match(
      await refusalFor([{ id: "a", type: "checkbox", label: "A", choices: ["x", "y"], maxSelections: 1, defaultValue: ["x", "y"] }]),
      /more selections than maxSelections/,
    );
  });

  // This one is ours rather than upstream's: a form whose minSelections exceeds
  // the choices renders and can never be submitted.
  it("refuses selection counts the choices cannot satisfy", async () => {
    assert.match(
      await refusalFor([{ id: "a", type: "checkbox", label: "A", choices: ["x"], minSelections: 2 }]),
      /minSelections cannot exceed number of choices/,
    );
    assert.match(
      await refusalFor([{ id: "a", type: "checkbox", label: "A", choices: ["x"], maxSelections: 2 }]),
      /maxSelections cannot exceed number of choices/,
    );
  });
});

describe("presentForm — defaultValue on a number, date or time", () => {
  it("accepts a number inside its range and a date inside its window", async () => {
    assert.ok(await accepts([{ id: "a", type: "number", label: "A", min: 1, max: 10, defaultValue: 5 }]), "refused a valid form");
    assert.ok(
      await accepts([{ id: "b", type: "date", label: "B", minDate: "2026-01-01", maxDate: "2026-12-31", defaultValue: "2026-06-06" }]),
      "refused a valid form",
    );
    assert.ok(await accepts([{ id: "c", type: "time", label: "C", defaultValue: "09:30" }]), "refused a valid form");
  });

  it("refuses a number default of the wrong type or outside the range", async () => {
    assert.match(await refusalFor([{ id: "a", type: "number", label: "A", defaultValue: "5" }]), /defaultValue must be a number/);
    assert.match(await refusalFor([{ id: "a", type: "number", label: "A", min: 3, defaultValue: 1 }]), /defaultValue is less than min/);
    assert.match(await refusalFor([{ id: "a", type: "number", label: "A", max: 3, defaultValue: 9 }]), /defaultValue is greater than max/);
  });

  it("refuses a date default of the wrong type or outside the window", async () => {
    assert.match(await refusalFor([{ id: "a", type: "date", label: "A", defaultValue: 20260606 }]), /ISO date format/);
    assert.match(await refusalFor([{ id: "a", type: "date", label: "A", minDate: "2026-02-01", defaultValue: "2026-01-01" }]), /is before minDate/);
    assert.match(await refusalFor([{ id: "a", type: "date", label: "A", maxDate: "2026-02-01", defaultValue: "2026-03-01" }]), /is after maxDate/);
  });

  it("refuses a time default that is not a string", async () => {
    assert.match(await refusalFor([{ id: "a", type: "time", label: "A", defaultValue: 930 }]), /defaultValue must be a string/);
  });
});

// CodeRabbit on #3298: the view matches a default against a choice's value OR its
// label and takes the FIRST hit, so a validator that only looks at values accepts
// a default the view answers with a different choice — the form opens on a
// selection the definition did not ask for.
describe("presentForm — a default the view would answer with something else", () => {
  it("accepts a default that matches a choice's label when that choice submits the same text", async () => {
    assert.ok(
      await accepts([{ id: "a", type: "dropdown", label: "A", choices: [{ label: "Blue" }, { label: "Red" }], defaultValue: "Blue" }]),
      "refused a valid form",
    );
  });

  it("refuses a default that matches one choice's label while another choice owns it as a value", async () => {
    const choices = [
      { label: "w", value: "x" },
      { label: "Other", value: "w" },
    ];
    assert.match(await refusalFor([{ id: "a", type: "radio", label: "A", choices, defaultValue: "w" }]), /matches the label of a choice that submits 'x'/);
  });

  it("refuses the same conflict inside a checkbox default", async () => {
    const choices = [
      { label: "w", value: "x" },
      { label: "Other", value: "w" },
    ];
    assert.match(await refusalFor([{ id: "a", type: "checkbox", label: "A", choices, defaultValue: ["w"] }]), /matches the label of a choice that submits 'x'/);
  });
});

// The browser blanks a value its input cannot parse, so a form with an
// unparseable default opens empty while the definition still claims one.
describe("presentForm — a date or time the input cannot hold", () => {
  it("accepts a real date and a well-formed time", async () => {
    assert.ok(await accepts([{ id: "a", type: "date", label: "A", defaultValue: "2026-02-28" }]), "refused a real date");
    assert.ok(await accepts([{ id: "b", type: "time", label: "B", defaultValue: "23:59" }]), "refused a valid time");
    assert.ok(await accepts([{ id: "c", type: "time", label: "C", defaultValue: "08:05:30" }]), "refused a valid time with seconds");
  });

  it("refuses a date that is not YYYY-MM-DD, and a day that does not exist", async () => {
    assert.match(await refusalFor([{ id: "a", type: "date", label: "A", defaultValue: "06/06/2026" }]), /must be a date in YYYY-MM-DD form/);
    assert.match(await refusalFor([{ id: "a", type: "date", label: "A", defaultValue: "2026-02-30" }]), /is not a real date/);
    assert.match(await refusalFor([{ id: "a", type: "date", label: "A", defaultValue: "2026-13-01" }]), /is not a real date/);
  });

  it("refuses a bound that is not a real date either", async () => {
    assert.match(await refusalFor([{ id: "a", type: "date", label: "A", minDate: "2026-02-30" }]), /minDate '2026-02-30' is not a real date/);
    assert.match(await refusalFor([{ id: "a", type: "date", label: "A", maxDate: "tomorrow" }]), /maxDate must be a date in YYYY-MM-DD form/);
  });

  it("refuses a time outside the clock", async () => {
    assert.match(await refusalFor([{ id: "a", type: "time", label: "A", defaultValue: "25:90" }]), /must be a time in HH:MM form/);
    assert.match(await refusalFor([{ id: "a", type: "time", label: "A", defaultValue: "9:30" }]), /must be a time in HH:MM form/);
  });
});

describe("presentForm — the result the model and the view receive", () => {
  it("carries the same payload as data and as jsonData", async () => {
    const result = await executeForm(context, { title: "T", fields: [{ id: "a", type: "text", label: "A" }] } as FormArgs);
    assert.deepEqual(result.data, result.jsonData);
    assert.equal(result.data?.fields.length, 1);
    assert.match(result.instructions ?? "", /wait for the user/i);
  });

  it("refuses a form with no fields at all", async () => {
    assert.match(await refusalFor([]), /At least one field is required/);
  });
});
