import { it } from "vite-plus/test";
import {
  checkSymbolicCases,
  createSeededRandom,
  differentialSeeds,
  type DifferentialCase,
} from "./helpers/differential-evaluator.js";

it.each(differentialSeeds)(
  "preserves shared-object identity through forked replacement and writes, seed %i",
  async (seed) => {
    const getRandom = createSeededRandom(seed);
    const cases: DifferentialCase[] = [];
    for (let index = 0; index < 20; index++) {
      const initial = getRandom(7);
      const updated = 10 + getRandom(7);
      const replaced = 20 + getRandom(7);
      cases.push({
        name: `seed=${seed}/case=${index}`,
        body: `
        const shared = { value: ${initial} };
        const holder = { left: shared, right: shared };
        if (first) holder.left.value = ${updated};
        if (second) holder.left = { value: ${replaced} };
        return holder.left.value + ':' + holder.right.value + ':' + (holder.left === holder.right);
      `,
      });
    }
    await checkSymbolicCases(cases);
  },
);

it.each([
  {
    name: "replacing a parent property does not redirect an earlier child alias",
    body: `const old = { value: 'old' }; const parent = { child: old }; const alias = parent.child; if (first) parent.child = { value: 'new' }; if (second) alias.value = 'changed'; return parent.child.value + ':' + alias.value;`,
  },
  {
    name: "a caught branch retains earlier writes but not unreachable writes",
    body: `const state = { value: 'old' }; const alias = state; let result = ''; try { if (first) { alias.value = 'before'; throw 'stop'; } state.value = second ? 'left' : 'right'; result = 'returned'; } catch (error) { result = 'caught'; } return result + ':' + state.value;`,
  },
  {
    name: "two property paths into a cycle remain the same allocation",
    body: `const state = { value: 'old', self: null }; state.self = state; const alias = state.self; if (first) alias.value = 'first'; if (second) state.self.value = 'second'; return state.value + ':' + alias.value + ':' + (state.self === state);`,
  },
  {
    name: "closures observe branch-local reassignment rather than capture-time values",
    body: `let selected = { value: 'old' }; const original = selected; const read = () => selected.value; if (first) selected = { value: 'new' }; if (second) original.value = 'changed'; return read() + ':' + original.value;`,
  },
  {
    name: "a retained array alias agrees with length after conditional pushes and pops",
    body: `const list = ['x']; const alias = list; if (first) list.push('a'); else list.push('b'); if (second) alias.pop(); return list.join('|') + ':' + alias.length;`,
  },
  {
    name: "caught branches with repeated alias reads stay concrete",
    body: `const state = { value: 'old' }; const alias = state; let result = ''; try { if (first) { alias.value = 'before'; throw 'stop'; } state.value = second ? 'left' : 'right'; result = 'returned'; } catch (error) { result = 'caught'; } return result + ':' + state.value + ':' + alias.value;`,
  },
])("$name", (testCase) => checkSymbolicCases([testCase]));
