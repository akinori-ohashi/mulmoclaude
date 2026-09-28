// Whether a custom view's `__MC_VIEW.startChat` RUNS the prompt or leaves it as
// an editable draft (#3062). Pure + its own module so the one reading of the
// declaration is shared by every surface that renders a view, and is pinned by
// unit tests rather than by driving an iframe.

import type { CollectionCustomView } from "./schema";

/** True when this view's `startChat` should send. Default-deny: a view that does
 *  not declare `allowSendChat` drafts, so upgrading the host can never turn an
 *  already-shipped view's buttons into unreviewed agent turns.
 *
 *  Read from the SCHEMA — never from the message the iframe posts up. The view's
 *  code composes the prompt text; letting it also decide whether that text runs
 *  would put both halves of the decision inside the sandbox.
 *
 *  EVERY surface honours this declaration, the phone included. The phone once
 *  always sent, on the grounds that it has no Enter key to press — but that made
 *  the same view behave differently depending on where it was opened, and it
 *  silently overrode default-deny on a device the author never tested.
 *
 *  The phone does not call THIS function: it reads `allowSendChat` out of the
 *  collection schema it already receives (`toDetail` sends the schema whole) and
 *  applies the same `=== true` rule in its own copy. Two reasons for that copy
 *  have been written down and both were wrong, so this states none — if you are
 *  touching it, check whether the phone can import this subpath and delete the
 *  copy if it can. Until then, keep the two in step.
 *
 *  It must also ask about the view whose document is RENDERED, not the selected
 *  one — during a view switch those differ, and the selected view's flag would
 *  decide for the previous view's still-running sandbox. */
export function customViewSendsChat(view: Pick<CollectionCustomView, "allowSendChat">): boolean {
  return view.allowSendChat === true;
}
