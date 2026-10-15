import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { MulmoBeat, MulmoMovieParams } from "mulmocast";
import { beatRendersWithoutFfmpeg, type BeatFfmpegContext } from "../src/server/beatRendersWithoutFfmpeg";

const beat = (fields: Record<string, unknown>): MulmoBeat => fields as unknown as MulmoBeat;
const plain: BeatFfmpegContext = { isPluginVideo: false, styleMovieParams: undefined, suppressSpeech: false };
const withStyle = (movieParams: Record<string, unknown>): BeatFfmpegContext => ({
  ...plain,
  styleMovieParams: movieParams as unknown as MulmoMovieParams,
});
const imageFrom = (source: Record<string, unknown>) => beat({ text: "", image: { type: "image", source } });

describe("beatRendersWithoutFfmpeg — still beats render without ffmpeg", () => {
  const stills: [string, MulmoBeat, BeatFfmpegContext][] = [
    ["textSlide", beat({ text: "", image: { type: "textSlide", slide: { title: "t" } } }), plain],
    ["markdown", beat({ text: "", image: { type: "markdown", markdown: ["# t"] } }), plain],
    ["static html_tailwind", beat({ text: "", image: { type: "html_tailwind", html: ["<div/>"] } }), plain],
    ["chart", beat({ text: "", image: { type: "chart", title: "c", chartData: {} } }), plain],
    ["mermaid", beat({ text: "", image: { type: "mermaid", title: "m", code: { kind: "text", text: "graph LR; A-->B" } } }), plain],
    ["slide", beat({ text: "", image: { type: "slide", slide: { layout: "title", title: "t" } } }), plain],
    ["vision", beat({ text: "", image: { type: "vision", style: "x", data: {} } }), plain],
    ["beat reference", beat({ text: "", image: { type: "beat", id: "b1" } }), plain],
    ["voice_over", beat({ text: "", image: { type: "voice_over" } }), plain],
    ["image from a url", imageFrom({ kind: "url", url: "https://h/a.mp4" }), plain],
    ["image from base64", imageFrom({ kind: "base64", data: "AAAA" }), plain],
    ["image from a still path", imageFrom({ kind: "path", path: "assets/a.PNG" }), plain],
    ["image from a jpeg path", imageFrom({ kind: "path", path: "a.jpeg" }), plain],
    ["imagePrompt only", beat({ text: "", imagePrompt: "a cat" }), plain],
    ["no image at all", beat({ text: "" }), plain],
    ["empty movie fields", beat({ text: "", moviePrompt: "", enableLipSync: false }), plain],
    ["a sound effect without a movie (mulmocast drops it)", beat({ text: "", soundEffectPrompt: "rain" }), plain],
    ["lip sync without suppressSpeech", beat({ text: "", enableLipSync: true }), plain],
    ["suppressSpeech without lip sync", beat({ text: "" }), { ...plain, suppressSpeech: true }],
    ["a $beatImage frame sentinel on a still beat", beat({ text: "", movieParams: { firstFrameImageName: "$beatImage" } }), plain],
    ["a style-level $beatImage sentinel", beat({ text: "" }), withStyle({ lastFrameImageName: "$beatImage" })],
    ["empty frame names", beat({ text: "", movieParams: { firstFrameImageName: "" } }), withStyle({})],
    [
      "a beat sentinel overriding a named style frame",
      beat({ text: "", movieParams: { firstFrameImageName: "$beatImage" } }),
      withStyle({ firstFrameImageName: "logo" }),
    ],
    [
      "htmlPrompt with a named frame (returns before frames)",
      beat({ text: "", htmlPrompt: { prompt: "x" }, movieParams: { firstFrameImageName: "logo" } }),
      plain,
    ],
    [
      "htmlPrompt with a moviePrompt and lip sync",
      beat({ text: "", htmlPrompt: { prompt: "x" }, moviePrompt: "m", enableLipSync: true }),
      { ...plain, suppressSpeech: true },
    ],
  ];
  stills.forEach(([name, value, context]) => {
    it(name, () => assert.equal(beatRendersWithoutFfmpeg(value, context), true));
  });

  it("a beat index the script does not have", () => assert.equal(beatRendersWithoutFfmpeg(undefined, { ...plain, isPluginVideo: true }), true));
});

describe("beatRendersWithoutFfmpeg — beats that reach ffmpeg in generateBeatImage", () => {
  const needs: [string, MulmoBeat, BeatFfmpegContext][] = [
    [
      "plugin video (animated html_tailwind / remotion)",
      beat({ text: "", image: { type: "html_tailwind", html: ["<div/>"] } }),
      { ...plain, isPluginVideo: true },
    ],
    ["movie image", beat({ text: "", image: { type: "movie", source: { kind: "path", path: "a.mp4" } } }), plain],
    ["remotion", beat({ text: "", image: { type: "remotion" } }), plain],
    ["an image type this does not know", beat({ text: "", image: { type: "hologram" } }), plain],
    ["image from a video path", imageFrom({ kind: "path", path: "assets/a.mp4" }), plain],
    ["image from an extensionless path", imageFrom({ kind: "path", path: "assets/a" }), plain],
    ["image from a path that only contains .png", imageFrom({ kind: "path", path: "a.png.mov" }), plain],
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
    it(name, () => assert.equal(beatRendersWithoutFfmpeg(value, context), false));
  });
});
