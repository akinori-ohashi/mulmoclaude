// A seeded generator, so a layout or a clustering drawn from it is the same on every redraw and host.

/** mulberry32: a small generator; the same seed gives the same sequence everywhere. */
export function seededRandom(seed: number): () => number {
  const state = { value: seed >>> 0 };
  return () => {
    state.value = (state.value + 0x6d2b79f5) >>> 0;
    const mixed = Math.imul(state.value ^ (state.value >>> 15), 1 | state.value);
    const scrambled = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((scrambled ^ (scrambled >>> 14)) >>> 0) / 4294967296;
  };
}
