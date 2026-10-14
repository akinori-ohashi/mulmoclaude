import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { MulmoBeat } from "mulmocast";
import { beatImageNeedsFfmpeg } from "../src/server/beatNeedsFfmpeg";

const beat = (fields: Record<string, unknown>): MulmoBeat => fields as unknown as MulmoBeat;

describe("beatImageNeedsFfmpeg — still beats render without ffmpeg", () => {
  const stills: [string, MulmoBeat][] = [
    ["textSlide", beat({ text: "", image: { type: "textSlide", slide: { title: "t" } } })],
    ["markdown", beat({ text: "", image: { type: "markdown", markdown: ["# t"] } })],
    ["static html_tailwind", beat({ text: "", image: { type: "html_tailwind", html: ["<div/>"] } })],
    ["chart", beat({ text: "", image: { type: "chart", title: "c", chartData: {} } })],
    ["image", beat({ text: "", image: { type: "image", source: { kind: "url", url: "https://h/a.png" } } })],
    ["imagePrompt only", beat({ text: "", imagePrompt: "a cat" })],
    ["empty movie fields", beat({ text: "", moviePrompt: "", soundEffectPrompt: "", enableLipSync: false })],
  ];
  stills.forEach(([name, value]) => {
    it(name, () => assert.equal(beatImageNeedsFfmpeg(value, false), false));
  });

  it("a beat index the script does not have", () => assert.equal(beatImageNeedsFfmpeg(undefined, false), false));
});

describe("beatImageNeedsFfmpeg — beats that make or read a movie need ffmpeg", () => {
  const movies: [string, MulmoBeat, boolean][] = [
    ["plugin video (animated html_tailwind / remotion)", beat({ text: "", image: { type: "html_tailwind", html: ["<div/>"] } }), true],
    ["movie image", beat({ text: "", image: { type: "movie", source: { kind: "path", path: "a.mp4" } } }), false],
    ["moviePrompt", beat({ text: "", moviePrompt: "waves" }), false],
    ["moviePrompt with an imagePrompt", beat({ text: "", imagePrompt: "sea", moviePrompt: "waves" }), false],
    ["soundEffectPrompt", beat({ text: "", soundEffectPrompt: "rain" }), false],
    ["enableLipSync", beat({ text: "", enableLipSync: true }), false],
  ];
  movies.forEach(([name, value, isPluginVideo]) => {
    it(name, () => assert.equal(beatImageNeedsFfmpeg(value, isPluginVideo), true));
  });
});
