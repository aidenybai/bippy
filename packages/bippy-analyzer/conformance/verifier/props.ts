import type { ComponentAnalysis, Sample } from "../../src/core/types.js";

const MAX_PROP_COMBINATIONS = 12;

const getPropSamples = (analysis: ComponentAnalysis) =>
  analysis.bindings.flatMap((binding) =>
    binding.kind === "prop" && binding.propName && binding.samples.length > 0
      ? [{ name: binding.propName, samples: binding.samples }]
      : [],
  );

const getWholeProps = (analysis: ComponentAnalysis): Record<string, Sample> =>
  analysis.propsSample?.kind === "Object" ? analysis.propsSample.fields : {};

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
  const props = getPropSamples(analysis);
  const base = getDefaultProps(analysis);
  const fullCount = props.reduce((total, { samples }) => total * samples.length, 1);
  if (fullCount <= MAX_PROP_COMBINATIONS) {
    return props.reduce<Record<string, Sample>[]>(
      (combinations, { name, samples }) =>
        combinations.flatMap((combination) =>
          samples.map((sample) => ({ ...combination, [name]: sample })),
        ),
      [getWholeProps(analysis)],
    );
  }
  const variations = props.flatMap(({ name, samples }) =>
    samples.slice(1).map((sample) => ({ ...base, [name]: sample })),
  );
  return [base, ...variations].slice(0, MAX_PROP_COMBINATIONS);
};
