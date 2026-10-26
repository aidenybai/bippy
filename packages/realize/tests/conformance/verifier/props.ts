import type { ComponentAnalysis, PropWitness, Sample, StateReport } from "../../../src/core/types";

const MAX_PROP_COMBINATIONS = 12;
const MAX_WITNESS_PROPS = 48;

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
    getPropSamples(analysis).map(({ name, samples }) => [
      name,
      samples[0] ?? { kind: "Undefined" },
    ]),
  ),
});

export const getPropCombinations = (analysis: ComponentAnalysis): Record<string, Sample>[] => {
  const propSamples = getPropSamples(analysis);
  const defaultProps = getDefaultProps(analysis);
  const combinationCount = propSamples.reduce((total, { samples }) => total * samples.length, 1);
  if (combinationCount <= MAX_PROP_COMBINATIONS) {
    return propSamples.reduce<Record<string, Sample>[]>(
      (combinations, { name, samples }) =>
        combinations.flatMap((combination) =>
          samples.map((sample) => ({ ...combination, [name]: sample })),
        ),
      [getWholeProps(analysis)],
    );
  }
  const variations = propSamples.flatMap(({ name, samples }) =>
    samples.slice(1).map((sample) => ({ ...defaultProps, [name]: sample })),
  );
  return [defaultProps, ...variations].slice(0, MAX_PROP_COMBINATIONS);
};

export const getWitnessProps = (
  analysis: ComponentAnalysis,
  report: StateReport,
  combinations: Record<string, Sample>[],
): PropWitness[] => {
  const defaultProps = getDefaultProps(analysis);
  const seenKeys = new Set(combinations.map((props) => JSON.stringify(props)));
  return report.propWitnesses
    .map((witness) => ({ ...witness, props: { ...defaultProps, ...witness.props } }))
    .filter((witness) => {
      const key = JSON.stringify(witness.props);
      if (seenKeys.has(key)) return false;
      seenKeys.add(key);
      return true;
    })
    .slice(0, MAX_WITNESS_PROPS);
};
