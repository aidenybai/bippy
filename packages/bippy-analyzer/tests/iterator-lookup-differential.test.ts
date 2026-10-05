import { it } from "vite-plus/test";
import {
  checkDifferentialCases,
  checkKnownDifferentialWitnesses,
  createSeededRandom,
  differentialSeeds,
  type DifferentialCase,
} from "./helpers/differential-evaluator.js";

it.each(differentialSeeds)(
  "matches cached iterator next lookups and terminal result inspection, seed %i",
  async (seed) => {
    const getRandom = createSeededRandom(seed);
    const cases: DifferentialCase[] = [];
    for (let index = 0; index < 30; index++) {
      const values = Array.from({ length: index % 7 }, () => getRandom(20));
      cases.push({
        name: `seed=${seed}/case=${index}`,
        body: `
      const trace = [];
      const values = [${values.join(",")}];
      let position = 0;
      const iterator = {
        get next() {
          trace.push('next-lookup');
          return () => {
            const current = position++;
            trace.push('next:' + current);
            Object.defineProperty(iterator, 'next', { value: () => { throw 'replacement'; }, configurable: true });
            return { get done() { trace.push('done:' + current); return current >= values.length; }, get value() { trace.push('value:' + current); if (current >= values.length) throw 'terminal-value'; return values[current]; } };
          };
        }
      };
      const iterable = { get [Symbol.iterator]() { trace.push('iterator-lookup'); return () => { trace.push('iterator-call'); return iterator; }; } };
      const result = ${index % 2 === 0 ? "[...iterable]" : "Array.from(iterable)"};
      return result.join(',') + '#' + trace.join('|');
    `,
      });
    }
    await checkDifferentialCases(cases);
  },
);

it.each([
  {
    name: "close looks up return after the body changes it",
    expected: "new",
    actual: '""',
    body: `const trace = []; let position = 0; const iterator = { next() { return { value: 1, done: position++ > 1 }; }, return() { trace.push('old'); return {}; } }; const iterable = { [Symbol.iterator]() { return iterator; } }; for (const value of iterable) { iterator.return = () => { trace.push('new'); return {}; }; break; } return trace.join('|');`,
  },
  {
    name: "throwing return lookup does not replace a body throw",
    expected: "return-lookup|caught:body",
    actual: '"caught:body"',
    body: `const trace = []; let position = 0; const iterator = { next() { return { value: 1, done: position++ > 1 }; }, get return() { trace.push('return-lookup'); throw 'lookup'; } }; try { for (const value of { [Symbol.iterator]: () => iterator }) throw 'body'; } catch (error) { trace.push('caught:' + error); } return trace.join('|');`,
  },
  {
    name: "throwing return lookup replaces a break completion",
    expected: "return-lookup|caught:lookup",
    actual: '"after"',
    body: `const trace = []; let position = 0; const iterator = { next() { return { value: 1, done: position++ > 1 }; }, get return() { trace.push('return-lookup'); throw 'lookup'; } }; try { for (const value of { [Symbol.iterator]: () => iterator }) break; trace.push('after'); } catch (error) { trace.push('caught:' + error); } return trace.join('|');`,
  },
  {
    name: "noncallable return raises TypeError on early exit",
    expected: "TypeError",
    actual: '"accepted"',
    body: `let position = 0; const iterator = { next() { return { value: 1, done: position++ > 1 }; }, return: 7 }; try { for (const value of { [Symbol.iterator]: () => iterator }) break; return 'accepted'; } catch (error) { return error.name; }`,
  },
  {
    name: "throwing next lookup prevents any iterator step",
    expected: "iterator|next-lookup|caught:lookup",
    actual: '"iterator|next-lookup|after"',
    body: `const trace = []; const iterable = { [Symbol.iterator]() { trace.push('iterator'); return { get next() { trace.push('next-lookup'); throw 'lookup'; } }; } }; try { [...iterable]; trace.push('after'); } catch (error) { trace.push('caught:' + error); } return trace.join('|');`,
  },
  {
    name: "primitive iterator results raise TypeError",
    expected: "TypeError",
    actual: '"accepted"',
    body: `const iterable = { [Symbol.iterator]() { return { next: () => 7 }; } }; try { [...iterable]; return 'accepted'; } catch (error) { return error.name; }`,
  },
  {
    name: "primitive iterator objects raise TypeError",
    expected: "TypeError",
    actual: '"accepted"',
    body: `const iterable = { [Symbol.iterator]: () => 7 }; try { [...iterable]; return 'accepted'; } catch (error) { return error.name; }`,
  },
])("known divergence: $name", (testCase) => checkKnownDifferentialWitnesses([testCase]));

it.each([
  {
    name: "null return is treated as absent",
    body: `let position = 0; const iterator = { next() { return { value: 1, done: position++ > 1 }; }, return: null }; for (const value of { [Symbol.iterator]: () => iterator }) break; return 'accepted';`,
  },
  {
    name: "natural exhaustion never reads return",
    body: `const trace = []; const iterable = { [Symbol.iterator]() { return { next: () => ({ done: true }), get return() { trace.push('return'); throw 'unused'; } }; } }; Array.from(iterable); return trace.join('|');`,
  },
])("preserves $name", (testCase) => checkDifferentialCases([testCase]));
