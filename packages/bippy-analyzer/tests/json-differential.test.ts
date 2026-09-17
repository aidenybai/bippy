import { it } from "vite-plus/test";
import {
  checkDifferentialCases,
  checkKnownDifferentialWitnesses,
  createSeededRandom,
  differentialSeeds,
  type DifferentialCase,
} from "./helpers/differential-evaluator.js";

it.each(differentialSeeds)(
  "matches native JSON round trips and independent parsed copies, seed %i",
  async (seed) => {
    const getRandom = createSeededRandom(seed);
    const texts = ["", 'quote"slash\\', "line\nnext", "😀", "\ud800", "e\u0301"];
    const cases: DifferentialCase[] = [];
    for (let index = 0; index < 60; index++) {
      const rows = Array.from(
        { length: 1 + getRandom(5) },
        () => `{ value: ${getRandom(100) - 50}, enabled: ${getRandom(2) === 0} }`,
      );
      cases.push({
        name: `seed=${seed}/case=${index}`,
        body: `
      const source = { title: ${JSON.stringify(texts[index % texts.length])}, rows: [${rows.join(",")}], omitted: undefined, edges: [NaN, -0, undefined, Infinity, -Infinity], nested: { value: null } };
      const encoded = JSON.stringify(source);
      const parsed = JSON.parse(encoded);
      parsed.rows[0].value += ${getRandom(20)};
      return encoded + '#' + JSON.stringify(parsed) + '#' + source.rows[0].value + '#' + (parsed.rows === source.rows);
    `,
      });
    }
    await checkDifferentialCases(cases);
  },
);

it.each([
  {
    name: "undefined root serializes to undefined",
    body: `return JSON.stringify(undefined);`,
  },
  {
    name: "function object properties are omitted",
    body: `return JSON.stringify({ value: 1, method: () => 2 });`,
  },
  {
    name: "function and symbol array items become null",
    body: `return JSON.stringify([() => 1, Symbol('value')]);`,
  },
  {
    name: "bigint serialization throws TypeError",
    body: `try { JSON.stringify({ value: 1n }); return 'accepted'; } catch (error) { return error.name; }`,
  },
])("matches native JSON: $name", (testCase) => checkDifferentialCases([testCase]));

it.each([
  {
    name: "serialization invokes getters in property order",
    expected: "first|second|after",
    actual: JSON.stringify("after"),
    body: `const trace = []; JSON.stringify({ get first() { trace.push('first'); return 1; }, get second() { trace.push('second'); return 2; } }); trace.push('after'); return trace.join('|');`,
  },
  {
    name: "throwing serialization getter stops subsequent getters",
    expected: "first|caught:stop",
    actual: JSON.stringify("after"),
    body: `const trace = []; try { JSON.stringify({ get first() { trace.push('first'); throw 'stop'; }, get second() { trace.push('second'); return 2; } }); trace.push('after'); } catch (error) { trace.push('caught:' + error); } return trace.join('|');`,
  },
  {
    name: "toJSON receives its property key",
    expected: "nested|after",
    actual: JSON.stringify("after"),
    body: `const trace = []; JSON.stringify({ nested: { toJSON(key) { trace.push(key); return 7; } } }); trace.push('after'); return trace.join('|');`,
  },
  {
    name: "replacer visits root before its descendants",
    expected: "key:|key:value",
    actual: JSON.stringify(""),
    body: `const trace = []; JSON.stringify({ value: 1 }, (key, value) => { trace.push('key:' + key); return value; }); return trace.join('|');`,
  },
  {
    name: "reviver visits descendants before root",
    expected: "key:value|key:",
    actual: "<string: join of a list with an unknown length>",
    body: `const trace = []; JSON.parse('{"value":1}', (key, value) => { trace.push('key:' + key); return value; }); return trace.join('|');`,
  },
  {
    name: "reviver exceptions propagate",
    expected: "reviver",
    actual: JSON.stringify("accepted"),
    body: `try { JSON.parse('{"value":1}', () => { throw 'reviver'; }); return 'accepted'; } catch (error) { return error; }`,
  },
])("known divergence: $name", (testCase) => checkKnownDifferentialWitnesses([testCase]));

it.each([
  {
    name: "invalid JSON raises a modeled SyntaxError",
    body: `try { JSON.parse('{'); return 'accepted'; } catch (error) { return error.name; }`,
  },
  {
    name: "duplicate JSON keys keep their last value",
    body: `return JSON.parse('{"value":1,"value":2}').value;`,
  },
])("preserves $name", (testCase) => checkDifferentialCases([testCase]));
