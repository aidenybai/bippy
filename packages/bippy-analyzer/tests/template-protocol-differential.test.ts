import { it } from "vite-plus/test";
import {
  checkDifferentialCases,
  checkKnownDifferentialWitnesses,
  createSeededRandom,
  differentialSeeds,
  type DifferentialCase,
} from "./helpers/differential-evaluator.js";

it.each(differentialSeeds)(
  "matches native tag argument evaluation and cooked interpolation, seed %i",
  async (seed) => {
    const getRandom = createSeededRandom(seed);
    const cases: DifferentialCase[] = [];
    for (let index = 0; index < 40; index++) {
      cases.push({
        name: `seed=${seed}/case=${index}`,
        body: `
      const trace = [];
      const read = (name, value) => { trace.push(name); return value; };
      const tag = (strings, ...values) => { trace.push('tag'); return strings.map((text, index) => text + (index < values.length ? String(values[index]) : '')).join(''); };
      const result = tag\`head\${read('first', ${getRandom(20)})}:\${read('second', ${getRandom(20)})}tail\`;
      return result + '#' + trace.join('|');
    `,
      });
    }
    await checkDifferentialCases(cases);
  },
);

it.each([
  {
    name: "same template site has stable identity",
    expected: "false:true",
    actual: JSON.stringify("false:false"),
    body: "const seen = new WeakSet(); const tag = (strings) => { const repeated = seen.has(strings); seen.add(strings); return repeated; }; const run = () => tag`same`; return run() + ':' + run();",
  },
  {
    name: "separate closures share their template site",
    expected: true,
    actual: "false",
    body: "const tag = (strings) => strings; const create = () => () => tag`same`; return create()() === create()();",
  },
  {
    name: "template arrays reject indexed writes",
    expected: "TypeError",
    actual: JSON.stringify("accepted"),
    body: "const tag = (strings) => { try { strings[0] = 'changed'; return 'accepted'; } catch (error) { return error.name; } }; return tag`same`;",
  },
  {
    name: "invalid tagged escapes have undefined cooked values",
    expected: undefined,
    actual: JSON.stringify("\\u{xyz}"),
    body: "const tag = (strings) => strings[0]; return tag`\\u{xyz}`;",
  },
  {
    name: "member tags retain their receiver",
    expected: true,
    actual: "<boolean: === on dynamic values>",
    body: "const receiver = { tag() { return this === receiver; } }; return receiver.tag`same`;",
  },
])("known divergence: $name", (testCase) => checkKnownDifferentialWitnesses([testCase]));

it.each([
  {
    name: "untagged symbol conversion throws before a later interpolation",
    body: "const trace = []; const later = () => { trace.push('later'); return 2; }; try { const value = `${Symbol('value')}-${later()}`; trace.push('after'); } catch (error) { trace.push(error.name); } return trace.join('|');",
  },
  {
    name: "throwing tag lookup prevents interpolation",
    body: "const trace = []; const receiver = { get tag() { trace.push('lookup'); throw 'tag'; } }; const read = () => { trace.push('argument'); return 1; }; try { receiver.tag`${read()}`; trace.push('after'); } catch (error) { trace.push('caught:' + error); } return trace.join('|');",
  },
  {
    name: "throwing interpolation prevents later interpolation and invocation",
    body: "const trace = []; const fail = () => { trace.push('first'); throw 'stop'; }; const later = () => { trace.push('later'); return 2; }; const tag = () => { trace.push('tag'); return 3; }; try { tag`${fail()}-${later()}`; trace.push('after'); } catch (error) { trace.push('caught:' + error); } return trace.join('|');",
  },
  {
    name: "untagged templates stop after a throwing interpolation",
    body: "const trace = []; const fail = () => { trace.push('first'); throw 'stop'; }; const later = () => { trace.push('later'); return 2; }; try { const value = `${fail()}-${later()}`; trace.push('after'); } catch (error) { trace.push('caught:' + error); } return trace.join('|');",
  },
  {
    name: "identical text at distinct sites has distinct identity",
    body: "const tag = (strings) => strings; return tag`same` === tag`same`;",
  },
  {
    name: "tagged object interpolation does not coerce",
    body: "const value = { toString() { throw 'coercion'; } }; const tag = (strings, argument) => argument === value; return tag`${value}`;",
  },
  {
    name: "tagged symbol interpolation does not coerce",
    body: "const value = Symbol('value'); const tag = (strings, argument) => argument === value; return tag`${value}`;",
  },
  {
    name: "template arrays are frozen",
    body: "const tag = (strings) => Object.isFrozen(strings); return tag`same`;",
  },
  {
    name: "raw strings are exposed as an array",
    body: "const tag = (strings) => Array.isArray(strings.raw); return tag`same`;",
  },
  {
    name: "interpolation cannot replace the captured tag",
    body: "let tag = (strings, value) => 'old:' + value; const read = () => { tag = () => 'new'; return 1; }; return tag`${read()}`;",
  },
])("preserves $name", (testCase) => checkDifferentialCases([testCase]));
