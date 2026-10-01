import { it } from "vite-plus/test";
import { checkGuardedCases, checkSymbolicCases } from "./helpers/differential-evaluator.js";

it.each([
  {
    name: "heap: labeled break out of nested blocks resumes after the label",
    body: `let trace = ""; const run = () => { label0: { { { if (Infinity) break label0; } } } return (trace += "e", 0); }; return run() + trace;`,
  },
  {
    name: "heap: labeled block keeps a guarded return apart from falling through",
    body: `let trace = ""; const run = () => { label0: { { if (first) return 0; } } trace += "e"; }; return String(run()) + trace;`,
  },
  {
    name: "heap: join renders a possibly undefined item as empty text",
    body: `const value = first ? 0 : undefined; return [value, "e"].join("|");`,
  },
  {
    name: "heap: loop break to an enclosing label skips the rest of the label",
    body: `let trace = ""; const run = () => { label1: { let index = 3; while (index-- > 0) { if ("1") break label1; } trace += 0; } }; run(); return trace + "!";`,
  },
  {
    name: "heap: loose equality calls valueOf on an object operand",
    body: `const events = []; const coerce = { valueOf() { events.push("valueOf"); return 0; } }; { { (coerce == 0); } } return events.join("|");`,
  },
  {
    name: "scalar: deoptimized loop keeps the path that breaks past a guarded return",
    body: `let total = 0; { let index0 = 0; do { if (first) return "early"; if (-2n) break; } while (++index0 < 0); } try { 0 ** 1n; } catch (caught) { total = caught; } total *= 0; return typeof total;`,
  },
  ...[
    `do { if (first) return "early"; break; } while (false);`,
    `while (true) { if (first) return "early"; break; }`,
    `for (const item of [1]) { if (first) return "early"; break; }`,
    `outer: { while (true) { if (first) return "early"; if (second) break outer; break; } return "inner"; }`,
  ].map((loop) => ({
    name: `scalar: ${loop} return "end"`,
    body: `const force = () => 0; ${loop} return "end";`,
  })),
  {
    name: "heap: loose equality coerces an object against each alternative of a branch",
    body: `const events = []; const coerce = { valueOf() { events.push("valueOf"); return 0; } }; const value = first ? 1 : 0; const result = value == coerce; return result + ":" + events.join("|");`,
  },
  {
    name: "scalar: BigInt plus a decremented unknown boolean throws",
    body: `let flag = first, trace = 1n; (--flag); try { trace += flag; return typeof trace; } catch (error) { return error.name; }`,
  },
  {
    name: "heap: a computed key converts an object with toString before valueOf",
    body: `const events = []; const list = [1, 2]; const coerce = { valueOf() { events.push("valueOf"); return 0; }, toString() { events.push("toString"); return "text"; } }; return String(list[coerce]) + events.join("|");`,
  },
  {
    name: "heap: the in operator converts an object key with toString",
    body: `const box = { count: 1 }; const coerce = { valueOf() { return 0; }, toString() { return "count"; } }; return String(coerce in box);`,
  },
  {
    name: "heap: a template literal calls Symbol.toPrimitive with the string hint",
    body: `const events = []; const primitive = { [Symbol.toPrimitive](hint) { events.push(hint); return "p"; } };     return \`t\${primitive}\` + events.join("|");`,
  },
  {
    name: "scalar: concatenating a caught TypeError uses Error.prototype.toString",
    body: `let trace = ""; try { (-2n) - 0; } catch (caught) { trace += caught; } return trace;`,
  },
  {
    name: "corpus: Array() rejects a length past 2 ** 32 - 1",
    body: `const names = []; for (const length of [3, 2 ** 32, 1e21]) { try { names.push(Array(length).length); } catch (error) { names.push(error.name); } } return names.join("|");`,
  },
  {
    name: "scalar: a modeled error reads back its reassigned name and message",
    body: `const error = new RangeError("r"); error.name = "Custom"; return "" + error + \`|\${new Error("")}|\${new TypeError("t")}\`;`,
  },
  {
    name: "corpus: class methods and getters are not enumerable own keys",
    body: `class Box { constructor() { this.count = 1; } increment() {} get size() { return 1; } } const box = new Box(); const keys = []; for (const key in box) keys.push(key); return Object.keys(box).join("|") + ":" + Object.keys({ ...box }).join("|") + ":" + keys.join("|");`,
  },
  {
    name: "corpus: spreading a non-iterable into a call throws a TypeError",
    body: `try { return String(Math.max(...(first ? [1] : 0))); } catch (error) { return error.name; }`,
  },
  {
    name: "corpus: forEach, map, and filter stop at a callback that throws",
    body: `const seen = []; for (const method of ["forEach", "map", "filter"]) { try { [1, 2][method]((item) => { seen.push(item); return item.name.length; }); } catch (error) { seen.push(error.name); } } return seen.join("|");`,
  },
  {
    name: "corpus: a plain call leaves this undefined in strict code",
    body: `function Make() { this.count = 0; } try { Make(); return "returned"; } catch (error) { return error.name; }`,
  },
  {
    name: "corpus: a tagged template's strings carry their raw text",
    body: `const tag = (strings) => [...strings.raw].join("|") + ":" + Object.keys(strings).join("|") + ":" + Object.isFrozen(strings.raw); return tag\`a\\\\n\${1}b\`;`,
  },
  {
    name: "corpus: spreading or destructuring a non-iterable value throws a TypeError",
    body: `const names = []; try { names.push([...(second ? [] : 1)].length); } catch (error) { names.push(error.name); } try { const [head] = true; names.push(head); } catch (error) { names.push(error.name); } try { names.push(Math.max(...{ id: 0 })); } catch (error) { names.push(error.name); } return names.join("|");`,
  },
])("preserves fuzz-minimized $name", (testCase) => checkSymbolicCases([testCase]));

it.each(
  ["", "const force = () => 0; "].flatMap((prefix) =>
    [
      {
        name: "heap: a shadowing let reads itself in its initializer",
        body: `let alpha = 0, trace = ""; const run = () => { { let alpha = (alpha |= 0); } trace += 0; }; try { run(); return "returned"; } catch (error) { return error.name + trace + alpha; }`,
      },
      {
        name: "heap: let beta = beta throws before a later statement runs",
        body: `let beta = 0, trace = ""; const run = () => { { let beta = beta; } trace += "after"; }; try { run(); } catch (error) { trace += error.message; } return trace;`,
      },
      {
        name: "heap: a compound assignment inside the dead zone throws",
        body: `let alpha = 1; const run = () => { { alpha += ""; let alpha = 2; } return alpha; }; try { return run(); } catch (error) { return error.name + alpha; }`,
      },
      {
        name: "temporal dead zone: a hoisted function reads a let before its declaration",
        body: `let trace = ""; const run = () => { const read = () => later; try { read(); } catch (error) { trace += error.name; } let later = 1; return trace + read(); }; return run();`,
      },
      {
        name: "temporal dead zone: typeof throws before the declaration",
        body: `const run = () => { let trace = ""; try { trace += typeof later; } catch (error) { trace += error.name; } let later; return trace + typeof later; }; return run();`,
      },
      {
        name: "temporal dead zone: constructing a class before its declaration",
        body: `const run = () => { try { new Box(); } catch (error) { return error.message; } class Box {} }; return run();`,
      },
      {
        name: "heap: a throwing right operand stops the left operand's valueOf",
        body: `const events = []; const coerce = { valueOf() { events.push("valueOf"); return 0; } }; const run = () => { { let beta = (coerce & beta); } }; try { run(); } catch (error) { events.push(error.name); } return events.join("|");`,
      },
    ].map((testCase) => ({
      ...testCase,
      name: `${prefix}${testCase.name}`,
      body: prefix + testCase.body,
    })),
  ),
)("preserves fuzz-minimized $name", (testCase) => checkSymbolicCases([testCase]));

it.each([
  ...["", "const force = () => 0; "].flatMap((prefix) => [
    {
      name: `scalar: ${prefix}an unknown boolean plus a number stays a Number, so adding a BigInt throws`,
      body: `${prefix}let alpha = second; alpha += 0; alpha += (-2n); return alpha;`,
    },
    {
      name: `heap: ${prefix}a postfix increment of an unknown boolean returns a Number`,
      body: `${prefix}let beta = second; return typeof (beta++);`,
    },
    {
      name: `scalar: ${prefix}loose equality converts a string literal against an unknown boolean`,
      body: `${prefix}return ("0e16" == second) + ":" + (second != "1") + ":" + (0 == second) + ":" + ("x" == second);`,
    },
    {
      name: `heap: ${prefix}a logical assignment keeps the input it did not replace`,
      body: `${prefix}let alpha = second; alpha &&= first; return String(alpha);`,
    },
    {
      name: `heap: ${prefix}a conditional reassignment keeps the input it did not replace`,
      body: `${prefix}let alpha = second; if (second) alpha = first; return String(alpha);`,
    },
    {
      name: `scalar: ${prefix}a discarded BigInt division by an unknown string throws`,
      body: `${prefix}let trace = ""; trace += second; (1n / trace); return "returned";`,
    },
    {
      name: `scalar: ${prefix}statements after an assignment that throws on every path do not run`,
      body: `${prefix}let trace = "" + second; trace *= 1n; switch (0) { case 0: trace += 0; } return trace;`,
    },
  ]),
  {
    name: "heap: a binary operator converts an object alternative with Symbol.toPrimitive",
    body: `const events = []; const primitive = { [Symbol.toPrimitive](hint) { events.push(hint); return 1; } }; 0 >> (first ? primitive : false); 0 + (second && primitive); return events.join("|");`,
  },
  {
    name: "heap: an unknown boolean key reads only the true or false property",
    body: `const box = { count: 1, add() {} }; return box[first];`,
  },
  {
    name: "heap: statements after a switch skip the paths that returned inside it",
    body: `let trace = ""; const run = () => { switch (0) { default: if (first) return "early"; } trace += "late"; }; return String(run()) + trace;`,
  },
  {
    name: "heap: a second switch skips the paths that returned inside the first",
    body: `let trace = ""; const run = () => { switch (0) { default: if (first) return "early"; } switch (0) { default: trace += "late"; } }; return String(run()) + trace;`,
  },
  {
    name: "heap: an unknown boolean key reads no list index",
    body: `let total = 0; const list = [1, 2]; total += list[first]; return total;`,
  },
  {
    name: "heap: a break after a throwing case completes only the paths that reach it",
    body: `let trace = ""; const run = (alpha, beta = alpha) => { switch (0) { default: alpha += 0; case "1": break; } return beta; }; try { trace += run(first ? -2n : 0); } catch (error) { trace += error.name; } return trace;`,
  },
  {
    name: "corpus: calling a primitive, object, or list throws a TypeError",
    body: `const names = []; for (const callee of [0, "text", first, { id: 0 }, []]) { try { names.push(String(callee(0) > 0)); } catch (error) { names.push(error.name); } try { names.push([1, 2].filter(callee).length); } catch (error) { names.push(error.name); } try { names.push([].reduce(callee, 0)); } catch (error) { names.push(error.name); } } for (const receiver of [0, first, { id: 0 }, [1]]) { try { names.push(receiver.filterBy(Boolean)); } catch (error) { names.push(error.name); } } names.push(String((0).filter?.(Boolean)), "text".at(0), (1.5).toFixed(0)); return names.join("|");`,
  },
  {
    name: "corpus: writing a property of a primitive throws in strict code",
    body: `const names = []; for (const target of [0, "text", first]) { try { target[0] = 1; names.push("wrote"); } catch (error) { names.push(error.name); } } return names.join("|");`,
  },
])("preserves fuzz-minimized $name", (testCase) => checkGuardedCases([testCase]));
