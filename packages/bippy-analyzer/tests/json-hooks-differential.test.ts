import { it } from "vite-plus/test";
import {
  checkDifferentialCases,
  checkKnownDifferentialWitnesses,
} from "./helpers/differential-evaluator.js";

it.each([
  {
    name: "replacer list deduplicates keys and controls traversal order",
    expected: '{"second":2,"first":1}',
    actual: "<string: JSON.stringify>",
    body: `return JSON.stringify({ first: 1, second: 2, third: 3 }, ['second', 'first', 'second']);`,
  },
  {
    name: "replacer list applies recursively but not to array indices",
    expected: '{"items":[{"keep":3}],"keep":{"keep":1}}',
    actual: "<string: JSON.stringify>",
    body: `return JSON.stringify({ keep: { keep: 1, omit: 2 }, items: [{ keep: 3, omit: 4 }] }, ['items', 'keep']);`,
  },
  {
    name: "numeric indentation is capped at ten spaces",
    expected: '{\n          "value": [\n                    1\n          ]\n}',
    actual: "<string: JSON.stringify>",
    body: `return JSON.stringify({ value: [1] }, null, 20);`,
  },
  {
    name: "string indentation is truncated to ten code units",
    expected: '{\nabcdefghij"value": 1\n}',
    actual: "<string: JSON.stringify>",
    body: `return JSON.stringify({ value: 1 }, null, 'abcdefghijklm');`,
  },
  {
    name: "replacer holder mutation changes a later existing property",
    expected: '{"first":1,"second":7}',
    actual: "<string: JSON.stringify>",
    body: `const source = { first: 1, second: 2 }; const holder = { replace(key, value) { if (key === 'first') this.second = 7; return value; } }; return JSON.stringify(source, holder.replace);`,
  },
  {
    name: "replacer key snapshot ignores newly added properties",
    expected: '{"first":1}',
    actual: "<string: JSON.stringify>",
    body: `const source = { first: 1 }; const holder = { replace(key, value) { if (key === 'first') this.added = 7; return value; } }; return JSON.stringify(source, holder.replace);`,
  },
  {
    name: "reviver deletion leaves an array hole rather than shrinking length",
    expected: "2:false:2",
    actual: "<string: + on dynamic values>",
    body: `const result = JSON.parse('[1,2]', (key, value) => key === '0' ? undefined : value); return result.length + ':' + Object.hasOwn(result, '0') + ':' + result[1];`,
  },
  {
    name: "reviver visits a deleted sibling with undefined",
    expected: "first:number|second:undefined|:object",
    actual: "<string: join of a list with an unknown length>",
    body: `const trace = []; const holder = { revive(key, value) { trace.push(key + ':' + typeof value); if (key === 'first') delete this.second; return value; } }; JSON.parse('{"first":1,"second":2}', holder.revive); return trace.join('|');`,
  },
  {
    name: "reviver can replace the root with undefined",
    expected: undefined,
    actual: "unknown(JSON.parse)",
    body: `return JSON.parse('1', () => undefined);`,
  },
  {
    name: "reviver root replacement may reuse an existing object",
    expected: true,
    actual: "<boolean: === on dynamic values>",
    body: `const replacement = {}; return JSON.parse('1', () => replacement) === replacement;`,
  },
  {
    name: "toJSON precedes the replacer for a nested property",
    expected: "replace::object|json:nested|replace:nested:number",
    actual: JSON.stringify(""),
    body: `const trace = []; const nested = { toJSON(key) { trace.push('json:' + key); return 7; } }; JSON.stringify({ nested }, (key, value) => { trace.push('replace:' + key + ':' + typeof value); return value; }); return trace.join('|');`,
  },
  {
    name: "throwing toJSON skips replacer invocation for that property",
    expected: "replace:|json|caught:stop",
    actual: JSON.stringify("after"),
    body: `const trace = []; try { JSON.stringify({ nested: { toJSON() { trace.push('json'); throw 'stop'; } } }, (key, value) => { trace.push('replace:' + key); return value; }); trace.push('after'); } catch (error) { trace.push('caught:' + error); } return trace.join('|');`,
  },
  {
    name: "null parse reviver is ignored",
    expected: 7,
    actual: "unknown(JSON.parse)",
    body: `return JSON.parse('7', null);`,
  },
  {
    name: "invalid JSON throws before a reviver can run",
    expected: "SyntaxError:0",
    actual: 'branch("accepted:0" | <string>)',
    body: `let calls = 0; let outcome = 'accepted'; try { JSON.parse('{', () => { calls++; return 7; }); } catch (error) { outcome = error.name; } return outcome + ':' + calls;`,
  },
])("known divergence: $name", (testCase) => checkKnownDifferentialWitnesses([testCase]));

it("omitted parse reviver matches explicit undefined", () =>
  checkDifferentialCases([
    {
      name: "omitted parse reviver matches explicit undefined",
      body: `return JSON.parse('7', undefined);`,
    },
  ]));
