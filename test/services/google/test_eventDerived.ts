// Unit tests for the array→scalar folds a collection column needs (#3233).
//
// `attendees` and `conferenceData` are the only two event fields a schema could
// not map, because a collection field holds one value. These pin WHICH value
// each becomes, and — more importantly — what the absent case means: `""` here
// is "Google said nothing", never "no" or "declined", and a filter written the
// other way round hides most of a personal calendar.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { conferenceVideoUri, selfResponseStatus, toEventSummary } from "@mulmoclaude/core/google";

describe("selfResponseStatus", () => {
  const attendees = [
    { email: "other@example.com", responseStatus: "accepted" },
    { email: "me@example.com", self: true, responseStatus: "declined" },
    { email: "third@example.com", responseStatus: "tentative" },
  ];

  it("takes the status off the attendee Google marked as self", () => {
    assert.equal(selfResponseStatus(attendees), "declined");
  });

  it("reads each of Google's four values", () => {
    for (const status of ["needsAction", "declined", "tentative", "accepted"]) {
      assert.equal(selfResponseStatus([{ self: true, responseStatus: status }]), status);
    }
  });

  it("is empty when the user is not among the attendees", () => {
    assert.equal(selfResponseStatus([{ email: "other@example.com", responseStatus: "accepted" }]), "");
  });

  // The common case, not an edge one: an event with no attendees has nothing to
  // mark `self`, and that is most of a personal calendar.
  it("is empty when the event has no attendees at all", () => {
    assert.equal(selfResponseStatus([]), "");
    assert.equal(selfResponseStatus(undefined), "");
  });

  it("is empty when the self attendee carries no responseStatus", () => {
    assert.equal(selfResponseStatus([{ email: "me@example.com", self: true }]), "");
  });

  it("does not mistake a falsy or truthy-ish `self` for the real flag", () => {
    assert.equal(selfResponseStatus([{ self: "true", responseStatus: "accepted" }]), "");
    assert.equal(selfResponseStatus([{ self: 1, responseStatus: "accepted" }]), "");
    assert.equal(selfResponseStatus([{ self: false, responseStatus: "accepted" }]), "");
  });

  it("survives shapes Google would never send", () => {
    assert.equal(selfResponseStatus(null), "");
    assert.equal(selfResponseStatus("accepted"), "");
    assert.equal(selfResponseStatus({ self: true, responseStatus: "accepted" }), "");
    assert.equal(selfResponseStatus([null, "x", 7, { self: true, responseStatus: "accepted" }]), "accepted");
  });
});

describe("conferenceVideoUri", () => {
  const zoom = {
    entryPoints: [
      { entryPointType: "video", uri: "https://example.zoom.us/j/123", label: "example.zoom.us/j/123" },
      { entryPointType: "phone", uri: "tel:+1-000-000-0000" },
      { entryPointType: "more", uri: "https://example.zoom.us/u/abc" },
    ],
  };

  it("takes the video entry point's uri", () => {
    assert.equal(conferenceVideoUri(zoom), "https://example.zoom.us/j/123");
  });

  it("does not fall back to a phone or `more` entry point", () => {
    const phoneOnly = { entryPoints: [{ entryPointType: "phone", uri: "tel:+1-000-000-0000" }] };
    assert.equal(conferenceVideoUri(phoneOnly), "");
  });

  it("is empty when the event has no conference data", () => {
    assert.equal(conferenceVideoUri(undefined), "");
    assert.equal(conferenceVideoUri({}), "");
    assert.equal(conferenceVideoUri({ entryPoints: [] }), "");
  });

  it("is empty when the video entry point carries no uri", () => {
    assert.equal(conferenceVideoUri({ entryPoints: [{ entryPointType: "video" }] }), "");
  });

  it("survives shapes Google would never send", () => {
    assert.equal(conferenceVideoUri(null), "");
    assert.equal(conferenceVideoUri("https://example.com"), "");
    assert.equal(conferenceVideoUri({ entryPoints: "video" }), "");
    assert.equal(conferenceVideoUri({ entryPoints: [null, { entryPointType: "video", uri: "https://ok" }] }), "https://ok");
  });
});

// The two folds only matter if the projection actually runs them, and
// `toEventSummary` is the one place a raw Google event becomes the shape the
// map reads. Pinned here so a field added to the summary without its fold
// cannot pass unnoticed.
describe("toEventSummary — the derived scalars", () => {
  it("folds both out of a real event payload", () => {
    const summary = toEventSummary({
      id: "ev-1",
      summary: "Design review",
      start: { dateTime: "2026-07-17T09:00:00+09:00" },
      end: { dateTime: "2026-07-17T10:00:00+09:00" },
      attendees: [{ email: "me@example.com", self: true, responseStatus: "tentative" }],
      conferenceData: { entryPoints: [{ entryPointType: "video", uri: "https://example.zoom.us/j/9" }] },
    });
    assert.equal(summary.selfResponseStatus, "tentative");
    assert.equal(summary.conferenceVideoUri, "https://example.zoom.us/j/9");
  });

  it("gives both an empty string on an event that carries neither", () => {
    const summary = toEventSummary({ id: "ev-2", summary: "Focus" });
    assert.equal(summary.selfResponseStatus, "");
    assert.equal(summary.conferenceVideoUri, "");
  });

  // `hangoutLink` and `conferenceVideoUri` answer the same question for
  // different providers, and a Meet event fills both. Neither replaces the
  // other, so a schema can map whichever its calendar actually uses.
  it("leaves hangoutLink alone — a Meet event fills both", () => {
    const summary = toEventSummary({
      id: "ev-3",
      hangoutLink: "https://meet.google.com/abc-defg-hij",
      conferenceData: { entryPoints: [{ entryPointType: "video", uri: "https://meet.google.com/abc-defg-hij" }] },
    });
    assert.equal(summary.hangoutLink, "https://meet.google.com/abc-defg-hij");
    assert.equal(summary.conferenceVideoUri, "https://meet.google.com/abc-defg-hij");
  });
});
