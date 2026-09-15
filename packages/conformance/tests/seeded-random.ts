export const createSeededRandom = (seed: number): ((limit: number) => number) => {
  let state = seed >>> 0;
  return (limit) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return Math.floor((state / 0x100000000) * limit);
  };
};

export const fuzzSeeds = [0, 1, 42, 0xdeadbeef, 0xffffffff];
