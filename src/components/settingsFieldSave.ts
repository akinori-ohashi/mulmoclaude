// Save sequencing for a Settings select that auto-saves on `@change`.
// Pure so the ordering rules below are testable without a component harness —
// they are the part that was wrong, not the wiring around them.

/** Whether a `@change` should start a PUT.
 *
 *  A save already in flight blocks a new one, which is what makes the
 *  `resend` rule below load-bearing: the change that was blocked here is
 *  the one nobody else will send. */
export const shouldStartSave = (saving: boolean, draft: string, stored: string): boolean => !saving && draft !== stored;

export interface SaveResolution {
  /** Adopt the requested value as the saved one. */
  store: boolean;
  /** Send again, because the draft moved past what this request carried. */
  resend: boolean;
}

/** What must happen once a PUT resolves.
 *
 *  `resend` is deliberately independent of `ok`. A draft that moved while the
 *  request was in flight was never sent — `shouldStartSave` turned that change
 *  away — and re-picking the same option fires no further change event. Tying
 *  the resend to the success path leaves the select showing a value the server
 *  never received, with no way for the user to retry it. */
export const resolveSave = (ok: boolean, draft: string, requested: string): SaveResolution => ({
  store: ok,
  resend: draft !== requested,
});
