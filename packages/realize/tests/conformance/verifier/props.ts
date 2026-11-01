import type { ComponentAnalysis, Sample } from "../../../src/core/types";

const MAX_PROP_COMBINATIONS = 12;

interface PropSamples {
  name: string;
  samples: Sample[];
}

const getPropSamples = (analysis: ComponentAnalysis): PropSamples[] =>
  analysis.bindings.flatMap((binding) =>
    binding.kind === "prop" && binding.propName && binding.samples.length > 0
      ? [{ name: binding.propName, samples: binding.samples }]
      : [],
  );

const getWholeProps = (analysis: ComponentAnalysis): Record<string, Sample> =>
  analysis.wholePropsSample?.kind === "Object" ? analysis.wholePropsSample.fields : {};

export const getDefaultProps = (analysis: ComponentAnalysis): Record<string, Sample> => ({
  ...getWholeProps(analysis),
  ...Object.fromEntries(
    getPropSamples(analysis).map((propSample) => [
      propSample.name,
      propSample.samples[0] ?? { kind: "Undefined" },
    ]),
  ),
});

export const getPropCombinations = (analysis: ComponentAnalysis): Record<string, Sample>[] => {
  const propSamples = getPropSamples(analysis);
  const defaultProps = getDefaultProps(analysis);
  const combinationCount = propSamples.reduce(
    (total, propSample) => total * propSample.samples.length,
    1,
  );
  if (combinationCount <= MAX_PROP_COMBINATIONS) {
    return propSamples.reduce<Record<string, Sample>[]>(
      (combinations, propSample) =>
        combinations.flatMap((combination) =>
          propSample.samples.map((sample) => ({ ...combination, [propSample.name]: sample })),
        ),
      [getWholeProps(analysis)],
    );
  }
  const variations = propSamples.flatMap((propSample) =>
    propSample.samples.slice(1).map((sample) => ({ ...defaultProps, [propSample.name]: sample })),
  );
  return [defaultProps, ...variations].slice(0, MAX_PROP_COMBINATIONS);
};
