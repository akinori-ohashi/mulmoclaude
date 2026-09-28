// The sidebar card's one line, driven with each payload `manageSpotify`
// actually answers with. The component that renders it cannot be loaded by
// `tsx --test` (it is an SFC), which is exactly why #3226 — the card throwing
// on every call — survived a green suite; keeping the decision in a pure module
// is what puts it back under test.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { summarisePreview, type PreviewLabels } from "../../../packages/plugins/spotify-plugin/src/previewSummary.js";

/** Labels through as their own key, so an assertion names the branch rather
 *  than a translation that can be reworded. */
const labels: PreviewLabels = {
  previewSummary: "previewSummary",
  notConnected: "notConnected",
  notConfigured: "notConfigured",
  connected: "connected",
  empty: "empty",
  emptyNowPlaying: "emptyNowPlaying",
  tabPlaylists: "Playlists",
  tabRecent: "Recent",
  tracksCount: "tracks",
  devices: "Devices",
  searchEmpty: "searchEmpty",
  searchTracks: "Tracks",
  searchArtists: "Artists",
  searchAlbums: "Albums",
  searchPlaylists: "Playlists",
};

const summarise = (data: unknown): string => summarisePreview(data, labels);

const track = (name: string) => ({ id: name, name, artists: ["A"], album: "Alb", durationMs: 1 });

describe("summarisePreview — the shapes manageSpotify actually returns", () => {
  it("liked / playlistTracks: an array of tracks counts as tracks", () => {
    assert.equal(summarise([track("one"), track("two")]), "2 tracks");
  });

  it("playlists: counted as playlists, not tracks", () => {
    assert.equal(summarise([{ id: "p", name: "Mix", description: "", trackCount: 12 }]), "1 Playlists");
  });

  it("recent: counted as recently played, not tracks", () => {
    assert.equal(summarise([{ track: track("one"), playedAt: "2026-01-01T00:00:00Z" }]), "1 Recent");
  });

  it("getDevices: counted as devices — the shape that used to read as tracks", () => {
    assert.equal(summarise([{ id: "d1", name: "Laptop", type: "Computer", isActive: true }]), "1 Devices");
  });

  it("nowPlaying with a track: names it", () => {
    assert.equal(summarise(track("Ghost Town")), "Ghost Town");
  });

  it("nowPlaying with nothing playing: null is a result, not an absence", () => {
    assert.equal(summarise(null), "emptyNowPlaying");
  });

  it("status: connected", () => {
    assert.equal(summarise({ connected: true, clientIdConfigured: true }), "connected");
  });

  it("status: configured but not connected", () => {
    assert.equal(summarise({ connected: false, clientIdConfigured: true }), "notConnected");
  });

  it("status: not even configured", () => {
    assert.equal(summarise({ connected: false, clientIdConfigured: false }), "notConfigured");
  });

  it("diagnose: reports tokensPresent, not connected — so it does not claim a connection state", () => {
    // `diagnose`'s payload has no `connected` key. Matching it against the
    // status branch would answer "notConfigured" for a perfectly connected
    // account, because `clientIdConfigured` alone decides that branch.
    assert.equal(summarise({ clientIdConfigured: true, tokensPresent: true, scopes: [] }), "previewSummary");
  });

  it("search: tallies each category it found", () => {
    assert.equal(summarise({ tracks: [track("a"), track("b")], artists: [{ id: "x", name: "X" }] }), "2 Tracks · 1 Artists");
  });

  it("search: a query that matched nothing still says so", () => {
    assert.equal(summarise({ tracks: [], artists: [], albums: [], playlists: [] }), "searchEmpty");
  });

  it("connect: the authorize-url payload has no summary of its own", () => {
    assert.equal(summarise({ authorizeUrl: "https://accounts.spotify.com/authorize?x=1" }), "previewSummary");
  });
});

describe("summarisePreview — abnormal input", () => {
  it("undefined falls back rather than throwing", () => {
    assert.equal(summarise(undefined), "previewSummary");
  });

  it("an empty array says so instead of counting zero of something", () => {
    assert.equal(summarise([]), "empty");
  });

  it("an array of unrecognised elements counts them as tracks rather than throwing", () => {
    assert.equal(summarise([{ nothing: true }]), "1 tracks");
  });

  it("primitives fall back", () => {
    assert.equal(summarise("a string"), "previewSummary");
    assert.equal(summarise(42), "previewSummary");
    assert.equal(summarise(true), "previewSummary");
  });

  it("a record with a non-string name is not treated as a track", () => {
    assert.equal(summarise({ name: 42 }), "previewSummary");
  });

  it("a payload whose only category is not an array is not a search result at all", () => {
    // `"nope".length` is 4, so a key-presence check reported four track hits.
    assert.equal(summarise({ tracks: "nope" }), "previewSummary");
  });

  it("one real category alongside a malformed one counts only the real one", () => {
    // This is the case that reaches the per-category count: the payload IS a
    // search result (tracks is an array), and `artists` still must not be read
    // for a `.length` it happens to have.
    assert.equal(summarise({ tracks: [track("a")], artists: "nope" }), "1 Tracks");
  });
});
