import { it } from "vite-plus/test";
import {
  checkDifferentialCases,
  checkKnownDifferentialWitnesses,
} from "./helpers/differential-evaluator.js";

interface DescriptorFlags {
  writable: boolean;
  configurable: boolean;
  enumerable: boolean;
}

const flags: DescriptorFlags[] = Array.from({ length: 8 }, (_value, index) => ({
  writable: (index & 1) !== 0,
  configurable: (index & 2) !== 0,
  enumerable: (index & 4) !== 0,
}));

const cases = flags.flatMap((initial, initialIndex) =>
  flags.flatMap((replacement, replacementIndex) =>
    [false, true].map((changesValue) => {
      const isAllowed =
        initial.configurable ||
        (!replacement.configurable &&
          initial.enumerable === replacement.enumerable &&
          (initial.writable || (!replacement.writable && !changesValue)));
      const value = changesValue ? 2 : 1;
      const name = `flags ${initialIndex}/${replacementIndex}/${changesValue ? 1 : 0}`;
      return {
        name,
        label: `${isAllowed ? "" : "known divergence: "}${name}`,
        isAllowed,
        body: `
      const target = {};
      Object.defineProperty(target, 'value', ${JSON.stringify({ value: 1, ...initial })});
      let outcome = 'accepted';
      try { Object.defineProperty(target, 'value', ${JSON.stringify({ value, ...replacement })}); }
      catch (error) { outcome = error.name; }
      return outcome + '|' + target.value + '|' + Object.keys(target).join(',');
    `,
        expected: isAllowed
          ? `accepted|${value}|${replacement.enumerable ? "value" : ""}`
          : `TypeError|1|${initial.enumerable ? "value" : ""}`,
        actual: JSON.stringify(`accepted|${value}|${replacement.enumerable ? "value" : ""}`),
      };
    }),
  ),
);

it.each(cases)("$label", ({ name, body, isAllowed, expected, actual }) =>
  isAllowed
    ? checkDifferentialCases([{ name, body }])
    : checkKnownDifferentialWitnesses([{ name, body, expected, actual }]),
);
