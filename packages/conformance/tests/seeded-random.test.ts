import { expect, it } from "vite-plus/test";
import { createSeededRandom, fuzzSeeds } from "./seeded-random.js";

interface SeedVector {
  seed: number;
  words: number[];
}

const vectors: SeedVector[] = [
  {
    seed: 0,
    words: [
      1013904223, 1196435762, 3519870697, 2868466484, 1649599747, 2670642822, 1476291629,
      2748932008,
    ],
  },
  {
    seed: 1,
    words: [
      1015568748, 1586005467, 2165703038, 3027450565, 217083232, 1587069247, 3327581586, 2388811721,
    ],
  },
  {
    seed: 42,
    words: [
      1083814273, 378494188, 2479403867, 955863294, 1613448261, 110225632, 1921058495, 508781842,
    ],
  },
  {
    seed: 0xdeadbeef,
    words: [
      1789648770, 4125694201, 160001540, 950215059, 1668495830, 3627689789, 939147128, 4230347895,
    ],
  },
  {
    seed: 0xffffffff,
    words: [
      1012239698, 806866057, 579071060, 2709482403, 3082116262, 3754216397, 3919968968, 3109052295,
    ],
  },
];

it("keeps the default seed corpus fixed and immutable", () => {
  expect(fuzzSeeds).toEqual(vectors.map((vector) => vector.seed));
  expect(Object.isFrozen(fuzzSeeds)).toBe(true);
});

it.each(vectors)(
  "pins seed $seed to a stable vector across independent async replays",
  async ({ seed, words }) => {
    const limits = [0, 1, 2, 3, 17, 100, 0x80000000, 0x100000000];
    const expectedBounded = words.map((word, index) =>
      Math.floor((word / 0x100000000) * limits[index]),
    );
    const getFirst = createSeededRandom(seed);
    const getSecond = createSeededRandom(seed);
    const first: number[] = [];
    const second: number[] = [];
    for (const limit of limits) {
      first.push(getFirst(limit));
      await Promise.resolve();
      const getIndependent = createSeededRandom(seed);
      expect(words.map(() => getIndependent(0x100000000))).toEqual(words);
      second.push(getSecond(limit));
    }
    expect(first).toEqual(expectedBounded);
    expect(second).toEqual(expectedBounded);
  },
);
