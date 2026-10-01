import { expect, it } from "vite-plus/test";
import {
  checkDifferentialCases,
  createSeededRandom,
  differentialSeeds,
} from "./helpers/differential-evaluator.js";

it("keeps the campaign seed inventory fixed", () => {
  expect(differentialSeeds).toEqual([0, 1, 42, 0xdeadbeef, 0xffffffff]);
});

it.each([
  { seed: 0, expected: [236067, 278566, 819533, 667866, 384077, 621807, 343725, 640035] },
  { seed: 1, expected: [236455, 369270, 504242, 704883, 50543, 369518, 774762, 556188] },
  { seed: 42, expected: [252345, 88125, 577281, 222554, 375660, 25663, 447281, 118460] },
  { seed: 0xdeadbeef, expected: [416685, 960588, 37253, 221239, 388476, 844637, 218662, 984954] },
  { seed: 0xffffffff, expected: [235680, 187863, 134825, 630850, 717611, 874096, 912688, 723882] },
])("preserves the recorded random sequence for seed $seed", ({ seed, expected }) => {
  const getRandom = createSeededRandom(seed);
  expect(Array.from({ length: expected.length }, () => getRandom(1_000_000))).toEqual(expected);
});

it.each(differentialSeeds)("keeps generators independent under interleaving, seed %i", (seed) => {
  const getExpected = createSeededRandom(seed);
  const getActual = createSeededRandom(seed);
  const getUnrelated = createSeededRandom(seed + 1);
  for (let index = 0; index < 100; index++) {
    getUnrelated(1000);
    getUnrelated(7);
    expect(getActual(1 + index)).toBe(getExpected(1 + index));
  }
});

it("repeats stateful native comparisons identically in reversed campaign order", async () => {
  const cases = [
    {
      name: "fresh regexp literals",
      body: `const create = () => /a/g; const first = create(); const second = create(); first.test('aba'); return second.lastIndex + ':' + first.lastIndex;`,
    },
    {
      name: "independent JSON parses",
      body: `const first = JSON.parse('{"value":1}'); const second = JSON.parse('{"value":1}'); first.value = 7; return second.value;`,
    },
    {
      name: "fresh array copies",
      body: `const original = [1, 2]; const copy = original.slice(); copy[0] = 7; return original.join(',') + ':' + copy.join(',');`,
    },
  ];
  await checkDifferentialCases(cases);
  await checkDifferentialCases([...cases].reverse());
  await checkDifferentialCases(cases);
});
