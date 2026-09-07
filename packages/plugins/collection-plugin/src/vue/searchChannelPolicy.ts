// What the host does when a sandboxed custom view claims the search channel
// (`mc-view-ready`). Pure so the rule is testable without a browser: the DOM
// side of it — port lifetimes, an async iframe rebuild — cannot be observed
// deterministically from a Playwright assertion, but the decision can.
//
// The host cannot identify the document occupying the frame. Anything injected
// into a view can be forwarded by that view to the page it navigates to, so no
// secret proves who is asking. The rule sidesteps identification entirely:
//
//   - The bootstrap runs before any of the view's own scripts, so the FIRST
//     claim on a freshly built frame is always the view the host installed.
//   - A LATER claim means the document changed underneath the host — a view
//     that reloaded itself, or a page it navigated to. Rather than choosing
//     whether to trust it, the host reinstalls the view it controls. Both
//     cases end with the real view in the frame.
//   - Each reinstall mints a token, so a view that reloads in a loop would
//     spend tokens forever. Past the budget the host stops reconnecting; the
//     view keeps rendering and reading data, only the search channel is gone.

/** Frame rebuilds granted between one user-initiated view change and the next. */
export const MAX_FRAME_RECLAIMS = 3;

/** Where the host's end of the search channel stands.
 *
 *  The two non-obvious states are both there because a single "no port held"
 *  flag kept conflating situations that must be answered differently:
 *
 *  - `exhausted` is terminal, not merely disconnected. Refusing a claim closes
 *    the host's port, so if refusal read as "no port" the very next claim from
 *    that same document looked like a fresh frame and was handed the channel.
 *  - `rebuilding` covers the window while `load()` is in flight. Rebuilding is
 *    asynchronous — a token mint and two fetches — and the OLD document sits in
 *    the frame for all of it. Treating that as connectable let a claimant ask
 *    again mid-rebuild and be seeded with the search text. */
export type SearchChannelState =
  /** A frame the host built and installed, waiting for its view to claim. */
  | "idle"
  /** Holding a port for the document currently in the frame. */
  | "connected"
  /** A rebuild is in flight; whatever is in the frame is not the host's yet. */
  | "rebuilding"
  /** Rebuild budget spent. Refuse every claim until the user changes view. */
  | "exhausted";

export type SearchChannelAction =
  /** Hand this claim the channel — it is the view the host just installed. */
  | "connect"
  /** Drop the channel and rebuild the frame, replacing whoever is in it. */
  | "reinstall"
  /** Refuse and change nothing — a rebuild already under way will settle it. */
  | "ignore"
  /** Refuse, and stay refusing: the frame keeps whatever document is in it. */
  | "giveUp";

/** Decide what a `mc-view-ready` claim earns.
 *
 *  `reclaims` is how many rebuilds the host has already granted since the user
 *  last switched view or collection. */
export function decideSearchChannelClaim(state: SearchChannelState, reclaims: number, max: number = MAX_FRAME_RECLAIMS): SearchChannelAction {
  if (state === "exhausted") return "giveUp";
  // Never spend a second rebuild on a frame already being rebuilt: a claimant
  // asking in a loop would otherwise burn the whole budget in one window.
  if (state === "rebuilding") return "ignore";
  if (state === "idle") return "connect";
  return reclaims < max ? "reinstall" : "giveUp";
}
