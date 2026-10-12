import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { beatMovieCandidates } from "../src/server/beatMovieCandidates";

const paths = {
  lipSyncFile: "b_lipsync.mov",
  soundEffectFile: "b_sound.mov",
  movieFile: "b.mov",
  animatedVideoFile: "b_animated.mp4",
};

describe("beatMovieCandidates", () => {
  it("prefers the most processed clip, ending with the plugin's own _animated.mp4 for a plugin-video beat", () => {
    assert.deepEqual(beatMovieCandidates(paths, true), ["b_lipsync.mov", "b_sound.mov", "b_animated.mp4"]);
  });

  it("ends with the moviePrompt .mov for any other beat", () => {
    assert.deepEqual(beatMovieCandidates(paths, false), ["b_lipsync.mov", "b_sound.mov", "b.mov"]);
  });

  it("never offers a clip left over from the beat's other kind", () => {
    assert.equal(beatMovieCandidates(paths, true).includes("b.mov"), false);
    assert.equal(beatMovieCandidates(paths, false).includes("b_animated.mp4"), false);
  });
});
