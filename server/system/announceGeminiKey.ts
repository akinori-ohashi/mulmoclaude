// Boot-time warning when GEMINI_API_KEY is absent (#2081). A missing key
// otherwise surfaces only as an opaque per-operation crash (movie beats)
// or a buried image-fill warning; announcing it once at startup makes the
// misconfiguration visible and points at the `.env` this launch actually
// reads — which is not the same file on every route, and used to be
// described wrongly for an icon launch (#2626). Kept as its own module
// (like announceOptionalDeps) so the generic boot sequence stays free of
// provider specifics. Never throws.

import { isGeminiAvailable } from "./env.js";
import { currentLaunchRouteFacts, geminiKeyMissingMessage } from "./geminiKeyGuidance.js";
import { log } from "./logger/index.js";

export function announceGeminiKey(): void {
  if (isGeminiAvailable()) return;
  log.warn("gemini", geminiKeyMissingMessage(currentLaunchRouteFacts()));
}
