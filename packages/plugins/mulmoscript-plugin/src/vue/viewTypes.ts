// Loose UI-facing script shapes shared between the View orchestrator and its
// composables. `MulmoScript` is intentionally a structural superset (every
// field optional + index signature) so the empty-beat fallbacks and the
// beat-editor boundary re-typing stay cast-light. Kept out of View.vue so the
// extracted composables can import the same shapes without importing the SFC.

import type { SlideLayout, SlideTheme } from "@mulmocast/beat-editor";
import type { Beat } from "./helpers";

export interface ImageEntry {
  type: string;
  prompt?: string;
  [key: string]: unknown;
}

/** Open-lightbox state. `index` is the beat index for a beat image and `-1`
 *  for a character image, which `isCharacter` marks so the beat-strip and
 *  prev/next arrows stay hidden for characters. */
export interface LightboxState {
  src: string;
  text?: string | undefined;
  index: number;
  isCharacter?: boolean | undefined;
}

export interface MulmoScript {
  title?: string;
  description?: string;
  lang?: string;
  beats?: Beat[];
  imageParams?: {
    images?: Record<string, ImageEntry>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

// `BeatListEditor` takes a beat ARRAY, and its beats are a structural superset of
// ours (every key optional + index signature) built on `SlideLayout` / `SlideTheme`.
// Our strict `MulmoScript` doesn't unify with that shape by name, so the editor
// boundary re-types through these.
export interface DeckBeatShape {
  image?: {
    type?: string;
    slide?: SlideLayout;
    theme?: SlideTheme;
    [k: string]: unknown;
  };
  [k: string]: unknown;
}

export interface DeckScriptShape {
  beats?: DeckBeatShape[];
  presentationStyle?: { slideParams?: { theme?: SlideTheme } };
  slideParams?: { theme?: SlideTheme };
  [k: string]: unknown;
}
