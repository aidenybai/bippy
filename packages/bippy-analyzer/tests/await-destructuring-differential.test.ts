import { describe, it } from "vite-plus/test";
import {
  checkDifferentialCases,
  checkKnownDifferentialWitnesses,
  type DifferentialCase,
} from "./helpers/differential-evaluator.js";

const createDestructuringCase = (
  name: string,
  source: string,
  hasValue: boolean,
): DifferentialCase => ({
  name,
  body: `
    const trace = [];
    const initial = ${hasValue ? "7" : "undefined"};
    const items = [initial, 2];
    const source = { get value() { trace.push('get:value'); return initial; }, get later() { trace.push('get:later'); return 2; } };
    let settle;
    const pending = new Promise((resolve) => { settle = resolve; });
    const start = () => { trace.push('default'); return pending; };
    const run = async () => { ${source} trace.push('after'); };
    run().then(() => trace.push('done'), (error) => trace.push('error:' + error));
    trace.push('sync');
    queueMicrotask(() => { trace.push('settle'); settle(7); });
    return () => trace.join('|');
  `,
});

describe.each([
  {
    name: "object binding",
    source: "const { value = await start(), later } = source;",
    isArray: false,
  },
  {
    name: "object assignment",
    source: "let value, later; ({ value = await start(), later } = source);",
    isArray: false,
  },
  { name: "array binding", source: "const [value = await start(), later] = items;", isArray: true },
  {
    name: "array assignment",
    source: "let value, later; [value = await start(), later] = items;",
    isArray: true,
  },
  {
    name: "nested object binding",
    source: "const { nested: { value = await start(), later } } = { nested: source };",
    isArray: false,
  },
])("awaited destructuring: $name", ({ name, source, isArray }) => {
  it("known divergence: waits before reading later properties and completing", () =>
    checkKnownDifferentialWitnesses(
      [
        {
          ...createDestructuringCase(name, source, false),
          expected: isArray
            ? "default|sync|settle|after|done"
            : "get:value|default|sync|settle|get:later|after|done",
          actual: JSON.stringify(
            isArray
              ? "default|after|sync|done|settle"
              : "get:value|default|get:later|after|sync|done|settle",
          ),
        },
      ],
      true,
    ));
  it("does not evaluate or await the default when a value is present", () =>
    checkDifferentialCases([createDestructuringCase(name, source, true)], true));
});

it.each(["resolve", "reject"])(
  "known divergence: closes a partially consumed iterator after an awaited default that %s",
  (settlement) =>
    checkKnownDifferentialWitnesses(
      [
        {
          name: `iterator default/${settlement}`,
          expected:
            settlement === "resolve"
              ? "next|sync|settle|close|after|done"
              : "next|sync|settle|close|error:reason",
          actual: JSON.stringify("next|next|after|sync|done|settle"),
          body: `
    const trace = [];
    let position = 0, settle;
    const pending = new Promise((resolve, reject) => { settle = ${settlement}; });
    const iterable = { [Symbol.iterator]: () => ({ next: () => { trace.push('next'); return { done: position++ > 0, value: undefined }; }, return: () => { trace.push('close'); return {}; } }) };
    const run = async () => { const [value = await pending] = iterable; trace.push('after'); };
    run().then(() => trace.push('done'), (error) => trace.push('error:' + error));
    trace.push('sync');
    queueMicrotask(() => { trace.push('settle'); settle('reason'); });
    return () => trace.join('|');
  `,
        },
      ],
      true,
    ),
);
