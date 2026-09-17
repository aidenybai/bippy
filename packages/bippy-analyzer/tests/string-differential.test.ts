import { it } from "vite-plus/test";
import {
  checkDifferentialCases,
  checkKnownDifferentialWitnesses,
  type DifferentialCase,
} from "./helpers/differential-evaluator.js";

const texts = ["", "abc", "😀a😀", "\ud800x\udc00", "e\u0301", " \tline\n", "Straße"];
const bounds = ["undefined", "null", "NaN", "-Infinity", "Infinity", "-2.7", "-0", "1.8", "9"];

it.each(texts.map((text) => ({ text, label: JSON.stringify(text) })))(
  "matches exhaustive string boundaries for $label",
  async ({ text, label }) => {
    const cases: DifferentialCase[] = bounds.flatMap((start) =>
      bounds.map((end) => ({
        name: `${label}/${start}/${end}`,
        body: `
      const text = ${JSON.stringify(text)};
      const values = [text.slice(${start}, ${end}), text.substring(${start}, ${end}), text.substr(${start}, ${end}), text.at(${start}), text.charAt(${start}), text.charCodeAt(${start}), text.codePointAt(${start}), text.indexOf('a', ${start}), text.lastIndexOf('a', ${start}), text.startsWith('a', ${start}), text.endsWith('a', ${end}), text.includes('a', ${start}), text.trim(), text.normalize('NFC'), text.toUpperCase(), text.toLowerCase()];
      return values.map((value) => typeof value + ':' + String(value).length + ':' + String(value)).join('|');
    `,
      })),
    );
    await checkDifferentialCases(cases);
  },
);

it.each([
  {
    name: "padStart converts an explicit null filler",
    expected: "nula",
    actual: JSON.stringify("   a"),
    body: `return 'a'.padStart(4, null);`,
  },
  {
    name: "padEnd converts an explicit null filler",
    expected: "anul",
    actual: JSON.stringify("a   "),
    body: `return 'a'.padEnd(4, null);`,
  },
  {
    name: "invalid normalization form throws RangeError",
    expected: "RangeError",
    actual: JSON.stringify("accepted"),
    body: `try { 'a'.normalize('invalid'); return 'accepted'; } catch (error) { return error.name; }`,
  },
  {
    name: "includes rejects a regexp search argument",
    expected: "TypeError",
    actual: JSON.stringify("accepted"),
    body: `try { 'abc'.includes(/a/); return 'accepted'; } catch (error) { return error.name; }`,
  },
])("known divergence: $name", (testCase) => checkKnownDifferentialWitnesses([testCase]));

it.each([
  {
    name: "undefined filler uses a space",
    body: `return 'a'.padStart(4, undefined) + ':' + 'a'.padEnd(4, undefined);`,
  },
  {
    name: "empty filler leaves text unchanged",
    body: `return 'a'.padStart(4, '') + ':' + 'a'.padEnd(4, '');`,
  },
])("preserves $name", (testCase) => checkDifferentialCases([testCase]));
