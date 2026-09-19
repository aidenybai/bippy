import { it } from "vite-plus/test";
import {
  checkDifferentialCases,
  checkKnownDifferentialWitnesses,
  createSeededRandom,
  differentialSeeds,
  type DifferentialCase,
} from "./helpers/differential-evaluator.js";

it.each(differentialSeeds)(
  "matches configurable data/accessor transitions and effects, seed %i",
  async (seed) => {
    const getRandom = createSeededRandom(seed);
    const cases: DifferentialCase[] = [];
    for (let index = 0; index < 30; index++) {
      const statements: string[] = [];
      for (let step = 0; step < 24; step++) {
        const value = getRandom(20);
        const enumerable = getRandom(2) === 0;
        const operations = [
          `Object.defineProperty(target, 'value', { value: ${value}, writable: true, configurable: true, enumerable: true });`,
          `Object.defineProperty(target, 'value', { get() { trace.push('get'); return stored; }, set(value) { trace.push('set'); stored = value; }, configurable: true, enumerable: ${enumerable} });`,
          `target.value = ${value};`,
          `delete target.value;`,
        ];
        statements.push(operations[step < operations.length ? step : getRandom(operations.length)]);
        statements.push(
          `trace.push(${step} + ':' + String(target.value) + ':' + stored + ':' + Object.keys(target).join(','));`,
        );
      }
      cases.push({
        name: `seed=${seed}/case=${index}`,
        body: `const trace = []; const target = {}; let stored = 0; ${statements.join("\n")} return trace.join('|');`,
      });
    }
    await checkDifferentialCases(cases);
  },
);

it.each([
  {
    name: "ordinary assignment preserves non-enumerability",
    expected: "",
    actual: JSON.stringify("value"),
    body: `const target = {}; Object.defineProperty(target, 'value', { value: 1, writable: true, configurable: true, enumerable: false }); target.value = 2; return Object.keys(target).join(',');`,
  },
  {
    name: "patching a value preserves omitted enumeration attributes",
    expected: "2:value",
    actual: JSON.stringify("2:"),
    body: `const target = {}; Object.defineProperty(target, 'value', { value: 1, writable: true, configurable: true, enumerable: true }); Object.defineProperty(target, 'value', { value: 2 }); return target.value + ':' + Object.keys(target).join(',');`,
  },
  {
    name: "patching an accessor retains its omitted setter",
    expected: "3:6",
    actual: JSON.stringify("TypeError:1"),
    body: `const target = {}; let stored = 1; Object.defineProperty(target, 'value', { get() { return stored; }, set(value) { stored = value; }, configurable: true }); Object.defineProperty(target, 'value', { get() { return stored * 2; } }); try { target.value = 3; return stored + ':' + target.value; } catch (error) { return error.name + ':' + stored; }`,
  },
  {
    name: "descriptor conversion completes before defining any property",
    expected: "TypeError:false:false",
    actual: JSON.stringify("accepted:true:true"),
    body: `const target = {}; let outcome = 'accepted'; try { Object.defineProperties(target, { first: { value: 1 }, second: { get: 7 } }); } catch (error) { outcome = error.name; } return outcome + ':' + Object.hasOwn(target, 'first') + ':' + Object.hasOwn(target, 'second');`,
  },
  {
    name: "definition failure preserves earlier commits but skips later ones",
    expected: "TypeError:true:0:false",
    actual: JSON.stringify("accepted:true:2:true"),
    body: `const target = {}; Object.defineProperty(target, 'locked', { value: 0 }); let outcome = 'accepted'; try { Object.defineProperties(target, { first: { value: 1 }, locked: { value: 2 }, last: { value: 3 } }); } catch (error) { outcome = error.name; } return outcome + ':' + Object.hasOwn(target, 'first') + ':' + target.locked + ':' + Object.hasOwn(target, 'last');`,
  },
  {
    name: "descriptor fields are read in specification order",
    expected: "enumerable|configurable|value|writable",
    actual: JSON.stringify(""),
    body: `const trace = []; const descriptor = { get enumerable() { trace.push('enumerable'); return true; }, get configurable() { trace.push('configurable'); return true; }, get value() { trace.push('value'); return 1; }, get writable() { trace.push('writable'); return true; } }; Object.defineProperty({}, 'item', descriptor); return trace.join('|');`,
  },
  {
    name: "defineProperties reads descriptor getters before committing",
    expected: "first:false|second:false:1:2",
    actual: JSON.stringify(":undefined:undefined"),
    body: `const trace = []; const target = {}; const descriptors = { get first() { trace.push('first:' + Object.hasOwn(target, 'first')); return { value: 1 }; }, get second() { trace.push('second:' + Object.hasOwn(target, 'first')); return { value: 2 }; } }; Object.defineProperties(target, descriptors); return trace.join('|') + ':' + target.first + ':' + target.second;`,
  },
  {
    name: "SameValue rejects replacing frozen positive zero with negative zero",
    expected: "TypeError",
    actual: JSON.stringify("accepted"),
    body: `const target = {}; Object.defineProperty(target, 'value', { value: 0 }); try { Object.defineProperty(target, 'value', { value: -0 }); return 'accepted'; } catch (error) { return error.name; }`,
  },
])("known divergence: $name", (testCase) => checkKnownDifferentialWitnesses([testCase]));

it.each([
  {
    name: "SameValue permits redefining frozen NaN with NaN",
    body: `const target = {}; Object.defineProperty(target, 'value', { value: NaN }); Object.defineProperty(target, 'value', { value: NaN }); return Number.isNaN(target.value);`,
  },
])("preserves $name", (testCase) => checkDifferentialCases([testCase]));
