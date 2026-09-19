import { it } from "vite-plus/test";
import {
  checkDifferentialCases,
  checkKnownDifferentialWitnesses,
  createSeededRandom,
  differentialSeeds,
  type DifferentialCase,
} from "./helpers/differential-evaluator.js";

it.each(differentialSeeds)(
  "matches replacement tokens and callback arguments for bounded patterns, seed %i",
  async (seed) => {
    const getRandom = createSeededRandom(seed);
    const patterns = ["/a/g", "/(a)(b)?/g", "/(?:)/gu", "/(a)?b/g", "'a'", "''"];
    const fragments = ["a", "b", "😀", "\n", "$"];
    const replacements = ["$$", "$&", "$1-$2", "$`", "$'", "$01/$10", "<$&>", "$<missing>"];
    const cases: DifferentialCase[] = [];
    for (let index = 0; index < 40; index++) {
      const text = Array.from(
        { length: getRandom(9) },
        () => fragments[getRandom(fragments.length)],
      ).join("");
      cases.push({
        name: `seed=${seed}/case=${index}`,
        body: `
      const text = ${JSON.stringify(text)};
      const pattern = ${patterns[index % patterns.length]};
      const trace = [];
      const tokenResult = text.replaceAll(pattern, ${JSON.stringify(replacements[index % replacements.length])});
      const callbackResult = text.replaceAll(pattern, (...values) => {
        trace.push(values.map((value) => typeof value + ':' + String(value)).join('/'));
        return '[' + trace.length + ']';
      });
      return tokenResult + '#' + callbackResult + '#' + trace.join('|');
    `,
      });
    }
    await checkDifferentialCases(cases);
  },
);

it.each([
  {
    name: "throwing replacer stops later callbacks",
    expected: "0|caught:stop",
    actual: JSON.stringify("0|1|2|after"),
    body: `const trace = []; try { 'aaa'.replace(/a/g, (match, offset) => { trace.push(offset); throw 'stop'; }); trace.push('after'); } catch (error) { trace.push('caught:' + error); } return trace.join('|');`,
  },
  {
    name: "throwing second replacer retains only earlier callback effects",
    expected: "0|1|caught:stop",
    actual: JSON.stringify("0|1|2|after"),
    body: `const trace = []; try { 'aaa'.replaceAll(/a/g, (match, offset) => { trace.push(offset); if (offset === 1) throw 'stop'; return 'x'; }); trace.push('after'); } catch (error) { trace.push('caught:' + error); } return trace.join('|');`,
  },
  {
    name: "replacer object results are converted before the next callback",
    expected: "callback:0|string:0|callback:1|string:1",
    actual: JSON.stringify("callback:0|callback:1"),
    body: `const trace = []; 'aa'.replace(/a/g, (match, offset) => { trace.push('callback:' + offset); return { toString() { trace.push('string:' + offset); return 'x'; } }; }); return trace.join('|');`,
  },
  {
    name: "symbol replacer results throw TypeError",
    expected: "TypeError",
    actual: JSON.stringify("accepted"),
    body: `try { 'a'.replace(/a/g, () => Symbol('result')); return 'accepted'; } catch (error) { return error.name; }`,
  },
  {
    name: "custom exec supplies the matched result",
    expected: "a",
    actual: JSON.stringify("x"),
    body: `const pattern = /a/; pattern.exec = () => null; return 'a'.replace(pattern, 'x');`,
  },
  {
    name: "custom exec exceptions propagate before replacement",
    expected: "exec|caught:stop",
    actual: JSON.stringify("callback|callback|after"),
    body: `const trace = []; const pattern = /a/g; pattern.exec = () => { trace.push('exec'); throw 'stop'; }; try { 'aa'.replace(pattern, () => { trace.push('callback'); return 'x'; }); trace.push('after'); } catch (error) { trace.push('caught:' + error); } return trace.join('|');`,
  },
])("known divergence: $name", (testCase) => checkKnownDifferentialWitnesses([testCase]));

it.each([
  {
    name: "global collection finishes before callbacks change exec",
    body: `const trace = []; const pattern = /a/g; const result = 'aa'.replace(pattern, (match, offset) => { trace.push(offset); pattern.exec = () => { throw 'changed'; }; return 'x'; }); return result + ':' + trace.join(',');`,
  },
  {
    name: "unmatched input never calls the replacer",
    body: `let calls = 0; const result = 'bbb'.replace(/a/g, () => { calls++; throw 'unused'; }); return result + ':' + calls;`,
  },
])("preserves $name", (testCase) => checkDifferentialCases([testCase]));
