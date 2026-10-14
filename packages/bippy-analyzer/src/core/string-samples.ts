import type { Sample } from "./types";

interface NamedStringSample {
  namePattern: RegExp;
  value: string;
}

export const SAMPLE_DATE = "2024-01-01T00:00:00.000Z";
export const TEXT_SAMPLE: Sample = { kind: "Value", value: "text" };
const EMPTY_TEXT_SAMPLE: Sample = { kind: "Value", value: "" };

// HACK: a string a component parses has no type to say so, so its name picks a valid sample.
const NAMED_STRING_SAMPLES: NamedStringSample[] = [
  { namePattern: /(?:^date|^time|Date|Time|At|_at)$/, value: SAMPLE_DATE },
  { namePattern: /(?:^currency|Currency)(?:Code)?$/, value: "USD" },
  { namePattern: /^(?:locale|lang|language)$|Locale$/, value: "en" },
  { namePattern: /^(?:color|background)$|(?:Color|Background)$/, value: "#808080" },
];

export const getStringSamples = (name: string | null): Sample[] => {
  const namedSample =
    name === null
      ? undefined
      : NAMED_STRING_SAMPLES.find((sample) => sample.namePattern.test(name));
  return namedSample
    ? [{ kind: "Value", value: namedSample.value }, EMPTY_TEXT_SAMPLE]
    : [TEXT_SAMPLE, EMPTY_TEXT_SAMPLE];
};
