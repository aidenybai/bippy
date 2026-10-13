import assert from "node:assert/strict";

export interface SampleStatistics {
  median: number;
  min: number;
  max: number;
}

export const getSampleStatistics = (samples: number[]): SampleStatistics => {
  assert.ok(
    samples.length > 0 && samples.every((sample) => Number.isFinite(sample) && sample >= 0),
  );
  const ordered = samples.toSorted((first, second) => first - second);
  const middleIndex = Math.floor(ordered.length / 2);
  return {
    median:
      ordered.length % 2
        ? ordered[middleIndex]
        : (ordered[middleIndex - 1] + ordered[middleIndex]) / 2,
    min: ordered[0],
    max: ordered[ordered.length - 1],
  };
};
