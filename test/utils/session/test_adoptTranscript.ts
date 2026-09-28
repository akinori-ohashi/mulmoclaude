// #3292. Adopting the server transcript must carry the selection and every
// card's timestamp across, even though text cards come back with new uuids.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { ToolResultComplete } from "gui-chat-protocol/vue";
import { adoptServerTranscript, alignServerToClient, type TranscriptView } from "../../../src/utils/session/adoptTranscript.js";
import { makeErrorResult, makeSkillResult, makeTextResult } from "../../../src/utils/tools/result.js";

const NOW_MS = 9_000;

function toolCard(uuid: string): ToolResultComplete {
  return { uuid, toolName: "presentChart", message: "chart", title: "Chart", data: {} };
}

/** The same text card as the server re-parses it: identical content, new uuid. */
function reparsed(card: ToolResultComplete): ToolResultComplete {
  return { ...card, uuid: `${card.uuid}-server` };
}

function clientView(toolResults: ToolResultComplete[], selectedResultUuid: string | null): TranscriptView {
  const resultTimestamps = new Map(toolResults.map((card, index) => [card.uuid, (index + 1) * 100]));
  return { toolResults, selectedResultUuid, resultTimestamps };
}

describe("adoptServerTranscript — the reported case", () => {
  it("keeps timestamps of cards the client had, stamps the recovered one, and follows the tail", () => {
    const user = makeTextResult("hi", "user");
    const truncated = makeTextResult("half a re", "assistant");
    const client = clientView([user, truncated], truncated.uuid);
    const recoveredError = makeErrorResult("claude exited with code 2");
    const server = [reparsed(user), { ...reparsed(truncated), message: "half a reply" }, recoveredError];

    const adopted = adoptServerTranscript(client, server, NOW_MS);

    assert.equal(adopted.toolResults, server);
    assert.equal(adopted.selectedResultUuid, recoveredError.uuid);
    assert.deepEqual(
      [...adopted.resultTimestamps],
      [
        [server[0]?.uuid, 100],
        [server[1]?.uuid, 200],
        [recoveredError.uuid, NOW_MS],
      ],
    );
  });
});

describe("adoptServerTranscript — selection", () => {
  it("keeps a deliberate selection of an earlier text card, on its new uuid", () => {
    const user = makeTextResult("hi", "user");
    const reply = makeTextResult("hello", "assistant");
    const client = clientView([user, reply], user.uuid);
    const server = [reparsed(user), reparsed(reply), makeErrorResult("x")];
    assert.equal(adoptServerTranscript(client, server, NOW_MS).selectedResultUuid, `${user.uuid}-server`);
  });

  it("keeps a selected tool card, whose uuid survives the round trip", () => {
    const user = makeTextResult("hi", "user");
    const chart = toolCard("chart-1");
    const reply = makeTextResult("done", "assistant");
    const client = clientView([user, chart, reply], chart.uuid);
    const server = [reparsed(user), chart, reparsed(reply), makeErrorResult("x")];
    assert.equal(adoptServerTranscript(client, server, NOW_MS).selectedResultUuid, chart.uuid);
  });

  it("falls back to the last card when nothing was selected", () => {
    const user = makeTextResult("hi", "user");
    const server = [reparsed(user), makeErrorResult("x")];
    assert.equal(adoptServerTranscript(clientView([user], null), server, NOW_MS).selectedResultUuid, server[1]?.uuid);
  });

  it("falls back to the last card when the selected card is not in the server copy", () => {
    const user = makeTextResult("hi", "user");
    const clientOnly = makeErrorResult("attach failed");
    const reply = makeTextResult("hello", "assistant");
    const client = clientView([user, clientOnly, reply], clientOnly.uuid);
    const server = [reparsed(user), reparsed(reply), makeErrorResult("x")];
    assert.equal(adoptServerTranscript(client, server, NOW_MS).selectedResultUuid, server[2]?.uuid);
  });

  it("selects nothing when the server copy is empty", () => {
    const adopted = adoptServerTranscript(clientView([], null), [], NOW_MS);
    assert.equal(adopted.selectedResultUuid, null);
    assert.equal(adopted.resultTimestamps.size, 0);
  });
});

describe("alignServerToClient", () => {
  it("skips a card the client missed in the middle and keeps aligning after it", () => {
    const user = makeTextResult("hi", "user");
    const chart = toolCard("chart-1");
    const later = makeTextResult("after the chart", "assistant");
    const missed = makeTextResult("before the chart", "assistant");
    const server = [reparsed(user), missed, chart, reparsed(later)];
    assert.deepEqual(
      [...alignServerToClient([user, chart, later], server)],
      [
        [`${user.uuid}-server`, user.uuid],
        [chart.uuid, chart.uuid],
        [`${later.uuid}-server`, later.uuid],
      ],
    );
  });

  it("skips a client-only card instead of stalling on it", () => {
    const user = makeTextResult("hi", "user");
    const localError = makeErrorResult("attach failed");
    const chart = toolCard("chart-1");
    const reply = makeTextResult("done", "assistant");
    const recovered = makeErrorResult("boom");
    const server = [reparsed(user), chart, reparsed(reply), recovered];
    const client = clientView([user, localError, chart, reply], chart.uuid);
    const adopted = adoptServerTranscript(client, server, NOW_MS);
    assert.equal(adopted.selectedResultUuid, chart.uuid);
    assert.equal(adopted.resultTimestamps.get(chart.uuid), 300);
    assert.equal(adopted.resultTimestamps.get(`${reply.uuid}-server`), 400);
    assert.equal(adopted.resultTimestamps.get(recovered.uuid), NOW_MS);
  });

  it("prefers the exact card over a recovered one it is a prefix of", () => {
    const ok = makeTextResult("ok", "assistant");
    const recoveredOkay = makeTextResult("okay", "assistant");
    const server = [recoveredOkay, reparsed(ok)];
    assert.deepEqual([...alignServerToClient([ok], server)], [[`${ok.uuid}-server`, ok.uuid]]);
  });

  it("lets only the client's last card match a longer server body", () => {
    const earlier = makeTextResult("par", "assistant");
    const tail = makeTextResult("the end", "assistant");
    const server = [makeTextResult("partial answer", "assistant"), reparsed(tail)];
    assert.deepEqual([...alignServerToClient([earlier, tail], server)], [[`${tail.uuid}-server`, tail.uuid]]);
  });

  it("matches a truncated tail to its single continuation", () => {
    const tail = makeTextResult("half a re", "assistant");
    const server = [{ ...reparsed(tail), message: "half a reply" }];
    assert.equal(alignServerToClient([tail], server).get(`${tail.uuid}-server`), tail.uuid);
  });

  it("leaves a truncated tail unmatched when two server cards could continue it", () => {
    const tail = makeTextResult("", "assistant");
    const server = [makeTextResult("first", "assistant"), makeTextResult("second", "assistant")];
    assert.equal(alignServerToClient([tail], server).size, 0);
  });

  it("pairs repeated identical cards in order", () => {
    const first = makeTextResult("ok", "assistant");
    const second = makeTextResult("ok", "assistant");
    const server = [reparsed(first), reparsed(second)];
    assert.deepEqual(
      [...alignServerToClient([first, second], server)],
      [
        [`${first.uuid}-server`, first.uuid],
        [`${second.uuid}-server`, second.uuid],
      ],
    );
  });

  it("tells skill cards apart by body, not by their shared description", () => {
    const skill = (body: string): ToolResultComplete =>
      makeSkillResult({ skillName: "wiki", skillScope: "project", skillPath: null, skillDescription: "Wiki", message: body });
    const clientSkill = skill("body one");
    const server = [skill("body two"), reparsed(clientSkill)];
    assert.deepEqual([...alignServerToClient([clientSkill, makeTextResult("tail", "assistant")], server)], [[`${clientSkill.uuid}-server`, clientSkill.uuid]]);
  });

  it("does not pair a user card with an assistant card of the same text", () => {
    assert.equal(alignServerToClient([makeTextResult("same words", "user")], [makeTextResult("same words", "assistant")]).size, 0);
  });

  it("past the size cap, keeps the shared prefix and leaves the rest unaligned instead of building a huge table", () => {
    const CARDS_PAST_CAP = 2_100;
    const shared = toolCard("shared");
    const clientTail = Array.from({ length: CARDS_PAST_CAP }, (_unused, index) => toolCard(`client-${index}`));
    const serverTail = Array.from({ length: CARDS_PAST_CAP }, (_unused, index) => toolCard(`server-${index}`));
    const aligned = alignServerToClient([shared, makeErrorResult("local"), ...clientTail], [shared, ...serverTail, clientTail[0] ?? shared]);
    assert.deepEqual([...aligned], [[shared.uuid, shared.uuid]]);
  });

  it("does not pair two different tool cards by kind alone", () => {
    assert.equal(alignServerToClient([toolCard("a")], [toolCard("b")]).size, 0);
  });
});

// Generated inputs, in the shapes a catch-up really produces: the server copy
// is the client copy re-parsed (new text uuids) with missed cards inserted
// anywhere, the client may hold local-only cards the server never saw, and the
// client's last text card may be a truncated prefix. For every shape, each
// surviving card keeps its timestamp, recovered cards get the adoption time,
// and the selection always names a server card.
describe("adoptServerTranscript — generated transcripts", () => {
  const SEED = 3292;
  const CASES = 600;

  function nextRandom(state: { value: number }): number {
    state.value = (state.value * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state.value / 2_147_483_648;
  }

  function randomCard(state: { value: number }, label: string): ToolResultComplete {
    const kind = Math.floor(nextRandom(state) * 4);
    if (kind === 0) return makeTextResult(`user ${label}`, "user");
    if (kind === 1) return makeTextResult(`reply ${label}`, "assistant");
    if (kind === 2) return makeTextResult("ok", "assistant");
    return toolCard(`tool-${label}`);
  }

  interface GeneratedCase {
    clientCards: ToolResultComplete[];
    serverCards: ToolResultComplete[];
    survivingClientUuids: Set<string>;
  }

  function generateCase(state: { value: number }, caseIndex: number): GeneratedCase {
    const clientCards = Array.from({ length: Math.floor(nextRandom(state) * 7) }, (_unused, index) => randomCard(state, `${caseIndex}-${index}`));
    const serverCards: ToolResultComplete[] = [];
    const survivingClientUuids = new Set<string>();
    clientCards.forEach((card, index) => {
      if (nextRandom(state) < 0.25) serverCards.push(makeErrorResult(`missed ${caseIndex}-${index}`));
      if (nextRandom(state) < 0.15) return; // client-only: the server never saw it
      survivingClientUuids.add(card.uuid);
      const isTail = index === clientCards.length - 1;
      if (card.toolName !== "text-response") serverCards.push(card);
      // Extend only a uniquely worded tail: an "ok" tail has several possible
      // continuations, and that ambiguous case is deliberately left unmatched.
      else if (isTail && card.message !== "ok" && nextRandom(state) < 0.5) serverCards.push({ ...reparsed(card), message: `${card.message ?? ""} continued` });
      else serverCards.push(reparsed(card));
    });
    serverCards.push(makeErrorResult(`missed tail ${caseIndex}`));
    return { clientCards, serverCards, survivingClientUuids };
  }

  it(`holds for ${CASES} seeded cases (seed ${SEED})`, () => {
    const state = { value: SEED };
    Array.from({ length: CASES }, (_unused, caseIndex) => caseIndex).forEach((caseIndex) => {
      const { clientCards, serverCards, survivingClientUuids } = generateCase(state, caseIndex);
      const selectionIndex = Math.floor(nextRandom(state) * (clientCards.length + 1));
      const client = clientView(clientCards, clientCards[selectionIndex]?.uuid ?? null);
      const adopted = adoptServerTranscript(client, serverCards, NOW_MS);
      const context = `seed ${SEED}, case ${caseIndex}`;

      assert.ok(
        serverCards.some((card) => card.uuid === adopted.selectedResultUuid),
        `selection must name a server card (${context})`,
      );
      const clientByStamp = new Map(clientCards.map((card) => [client.resultTimestamps.get(card.uuid), card]));
      const carriedPairs = serverCards.flatMap((serverCard) => {
        const clientCard = clientByStamp.get(adopted.resultTimestamps.get(serverCard.uuid));
        return clientCard === undefined ? [] : [{ serverCard, clientCard }];
      });
      // Identical cards may trade identities, so assert what must hold: as many
      // cards carried as survived, each from a card that says the same thing.
      assert.equal(carriedPairs.length, survivingClientUuids.size, `every surviving card is carried (${context})`);
      carriedPairs.forEach(({ serverCard, clientCard }) => {
        const sameContent = serverCard.title === clientCard.title && (serverCard.message ?? "").startsWith(clientCard.message ?? "");
        assert.ok(serverCard.uuid === clientCard.uuid || sameContent, `a timestamp only moves between matching cards (${context})`);
      });
      serverCards
        .filter((card) => card.title === "Error")
        .forEach((card) => assert.equal(adopted.resultTimestamps.get(card.uuid), NOW_MS, `recovered card gets adoption time (${context})`));
    });
  });
});
