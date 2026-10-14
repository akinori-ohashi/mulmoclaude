import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { MulmoBeat, MulmoMovieParams } from "mulmocast";
import { beatImageNeedsFfmpeg, type BeatFfmpegContext } from "../src/server/beatNeedsFfmpeg";

const beat = (fields: Record<string, unknown>): MulmoBeat => fields as unknown as MulmoBeat;
const plain: BeatFfmpegContext = { isPluginVideo: false, styleMovieParams: undefined, suppressSpeech: false };
const withStyle = (movieParams: Record<string, unknown>): BeatFfmpegContext => ({
  ...plain,
  styleMovieParams: movieParams as unknown as MulmoMovieParams,
});

describe("beatImageNeedsFfmpeg — still beats render without ffmpeg", () => {
  const stills: [string, MulmoBeat, BeatFfmpegContext][] = [
    ["textSlide", beat({ text: "", image: { type: "textSlide", slide: { title: "t" } } }), plain],
    ["markdown", beat({ text: "", image: { type: "markdown", markdown: ["# t"] } }), plain],
    ["static html_tailwind", beat({ text: "", image: { type: "html_tailwind", html: ["<div/>"] } }), plain],
    ["chart", beat({ text: "", image: { type: "chart", title: "c", chartData: {} } }), plain],
    ["image", beat({ text: "", image: { type: "image", source: { kind: "url", url: "https://h/a.png" } } }), plain],
    ["imagePrompt only", beat({ text: "", imagePrompt: "a cat" }), plain],
    ["empty movie fields", beat({ text: "", moviePrompt: "", enableLipSync: false }), plain],
    ["a sound effect without a movie (mulmocast drops it)", beat({ text: "", soundEffectPrompt: "rain" }), plain],
    ["lip sync without suppressSpeech", beat({ text: "", enableLipSync: true }), plain],
    ["suppressSpeech without lip sync", beat({ text: "" }), { ...plain, suppressSpeech: true }],
    ["a $beatImage frame sentinel on a still beat", beat({ text: "", movieParams: { firstFrameImageName: "$beatImage" } }), plain],
    ["a style-level $beatImage sentinel", beat({ text: "" }), withStyle({ lastFrameImageName: "$beatImage" })],
    ["empty frame names", beat({ text: "", movieParams: { firstFrameImageName: "" } }), withStyle({})],
  ];
  stills.forEach(([name, value, context]) => {
    it(name, () => assert.equal(beatImageNeedsFfmpeg(value, context), false));
  });

  it("a beat index the script does not have", () => assert.equal(beatImageNeedsFfmpeg(undefined, { ...plain, isPluginVideo: true }), false));
});

describe("beatImageNeedsFfmpeg — beats that reach ffmpeg in generateBeatImage", () => {
  const needs: [string, MulmoBeat, BeatFfmpegContext][] = [
    [
      "plugin video (animated html_tailwind / remotion)",
      beat({ text: "", image: { type: "html_tailwind", html: ["<div/>"] } }),
      { ...plain, isPluginVideo: true },
    ],
    ["movie image", beat({ text: "", image: { type: "movie", source: { kind: "path", path: "a.mp4" } } }), plain],
    ["moviePrompt", beat({ text: "", moviePrompt: "waves" }), plain],
    ["moviePrompt with a sound effect", beat({ text: "", moviePrompt: "waves", soundEffectPrompt: "rain" }), plain],
    ["lip sync with suppressSpeech (BGM trim)", beat({ text: "", enableLipSync: true }), { ...plain, suppressSpeech: true }],
    ["a named first frame on the beat", beat({ text: "", movieParams: { firstFrameImageName: "logo" } }), plain],
    ["a named last frame on the beat", beat({ text: "", movieParams: { lastFrameImageName: "logo" } }), plain],
    ["a named frame from the presentation style", beat({ text: "" }), withStyle({ firstFrameImageName: "logo" })],
    [
      "a beat frame name overriding a style sentinel",
      beat({ text: "", movieParams: { firstFrameImageName: "logo" } }),
      withStyle({ firstFrameImageName: "$beatImage" }),
    ],
  ];
  needs.forEach(([name, value, context]) => {
    it(name, () => assert.equal(beatImageNeedsFfmpeg(value, context), true));
  });

  it("a beat sentinel overrides a named style frame", () => {
    const value = beat({ text: "", movieParams: { firstFrameImageName: "$beatImage" } });
    assert.equal(beatImageNeedsFfmpeg(value, withStyle({ firstFrameImageName: "logo" })), false);
  });
});
