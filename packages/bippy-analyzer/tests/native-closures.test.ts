import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { inspectClosure } from "../src/evaluate/closure-inspection.js";
import { liftNativeClosure } from "../src/evaluate/native-closures.js";
import { fromNativeValue } from "../src/evaluate/native-values.js";
import { lookupScope } from "../src/evaluate/scope.js";
import { formatPattern, getRenderPattern } from "../src/harness/index.js";
import { createStaticRenderer, objectFromRecord } from "../src/index.js";
import type { StaticClassValue, StaticFunctionValue } from "../src/types.js";
import {
  getFunctionPrototype,
  getObjectProperty,
  listValue,
  objectValue,
  unknownPrimitiveValue,
} from "../src/evaluate/values.js";

const createCounter = (step: number, label: string) => {
  let count = 0;
  const unused = { label };
  return () => {
    count += step;
    return `${label}:${count}${unused.label.length > 0 ? "" : "!"}`;
  };
};

const createShadowed = (name: string) => {
  const describeOuter = () => name;
  {
    const name = "inner";
    return () => `${name}:${describeOuter()}`;
  }
};

/** Stands for the interpreter's class definition: the thunk itself, marked as the class it would define. */
const defineClassFromThunk = (thunk: StaticFunctionValue): StaticClassValue => {
  const classNode = thunk.node.body;
  if (classNode?.type !== "ClassExpression") throw new Error(`thunk returns ${classNode?.type}`);
  return {
    kind: "class",
    node: classNode,
    body: { members: [], superValue: null },
    scope: thunk.scope,
    module: thunk.module,
    name: classNode.id?.name ?? null,
    properties: objectValue(),
  };
};

const lift = (callee: Function) =>
  liftNativeClosure(
    callee,
    callee.name || "closure",
    (value, name) => fromNativeValue(value, name, null),
    defineClassFromThunk,
  );

const liftFunction = (callee: Function): StaticFunctionValue => {
  const value = lift(callee);
  if (value?.kind !== "function") throw new Error(`lifted ${value?.kind ?? "nothing"}`);
  return value;
};

describe("closure inspection", () => {
  it("reads the variables a function closed over through the engine's [[Scopes]]", () => {
    const captured = inspectClosure(createCounter(2, "hits"));
    const byName = new Map(captured?.map((binding) => [binding.name, binding.value]));
    expect(byName.get("count")).toBe(0);
    expect(byName.get("step")).toBe(2);
    expect(byName.get("label")).toBe("hits");
    expect(byName.get("unused")).toEqual({ label: "hits" });
  });

  it("lists a shadowed name once, with the innermost scope's value", () => {
    const captured = inspectClosure(createShadowed("outer"));
    const names = captured?.map((binding) => binding.name);
    expect(names?.filter((name) => name === "name")).toEqual(["name"]);
    expect(names?.indexOf("name")).toBeLessThan(names?.indexOf("describeOuter") ?? -1);
    expect(captured?.find((binding) => binding.name === "name")?.value).toBe("inner");
  });

  it("reports a function that captured nothing as an empty closure", () => {
    expect(inspectClosure(Math.max)).toEqual([]);
  });
});

describe("lifting native closures", () => {
  it("evaluates a closure's source over the captured variables it references", () => {
    const lifted = liftFunction(createCounter(3, "runs"));
    expect(lifted.node.type).toBe("ArrowFunctionExpression");
    expect(lookupScope(lifted.scope, "count")).toEqual({ kind: "primitive", value: 0 });
    expect(lookupScope(lifted.scope, "step")).toEqual({ kind: "primitive", value: 3 });
    expect(lookupScope(lifted.scope, "label")).toEqual({ kind: "primitive", value: "runs" });
    expect(lookupScope(lifted.scope, "unused")?.kind).toBe("object");
    expect(lookupScope(lifted.scope, "createCounter")).toBeUndefined();
  });

  it("lifts each function once, so its captured objects keep one identity", () => {
    const counter = createCounter(1, "once");
    expect(lift(counter)).toBe(lift(counter));
  });

  it("leaves functions without readable source alone", () => {
    expect(lift(Math.max)).toBeNull();
    expect(lift(Math.max.bind(null, 1))).toBeNull();
    expect(lift(Function("return 1"))).not.toBeNull();
  });

  it("lifts a class through a thunk the interpreter defines it from, over its captured variables", () => {
    const registry = new Map<string, number>();
    class Widget {
      static count = 0;
      constructor(public name: string) {
        registry.set(name, ++Widget.count);
      }
    }
    const lifted = lift(Widget);
    expect(lifted?.kind).toBe("class");
    expect(lifted?.name).toBe("Widget");
    expect(lookupScope(lifted!.scope, "registry")?.kind).toBe("native-object");
    expect(lift(Widget)).toBe(lifted);
  });

  it("lifts a bound function as its target over the receiver and arguments bind fixed", () => {
    const greet = function (this: { prefix: string }, word: string, mark: string) {
      return `${this.prefix} ${word}${mark}`;
    };
    const lifted = liftFunction(greet.bind({ prefix: "hi" }, "there"));
    expect(lifted.node.type).toBe("FunctionExpression");
    expect(lifted.boundThis?.kind).toBe("object");
    expect(lifted.boundArgs).toEqual([{ kind: "primitive", value: "there" }]);
  });

  it("lifts a constructor's prototype so its instances find their methods", () => {
    function Counter(this: { count: number }, start: number) {
      this.count = start;
    }
    Counter.prototype.next = function (this: { count: number }) {
      return ++this.count;
    };
    const lifted = liftFunction(Counter);
    const prototype = getFunctionPrototype(lifted);
    if (prototype.kind !== "object") throw new Error(`prototype is ${prototype.kind}`);
    expect(getObjectProperty(prototype, "next").kind).toBe("native-function");
    expect(getObjectProperty(prototype, "constructor")).toBe(lifted);
  });

  it("keeps a method's source parseable and a captured intrinsic canonical", () => {
    const toString = Object.prototype.toString;
    const holder = {
      tag(value: unknown) {
        return toString.call(value);
      },
    };
    const lifted = liftFunction(holder.tag);
    expect(lifted.node.type).toBe("FunctionExpression");
    expect(lookupScope(lifted.scope, "toString")).toEqual({
      kind: "global",
      name: "Object.prototype.toString",
    });
  });
});

const FILL_LOOP_SOURCE = `
interface LoopProps {
  items: string[];
}

const arrayMap = <T, R>(array: T[], iteratee: (item: T, index: number) => R): R[] => {
  let index = -1;
  const length = array == null ? 0 : array.length;
  const result = Array(length);
  while (++index < length) {
    result[index] = iteratee(array[index], index);
  }
  return result;
};

export const Loop = ({ items }: LoopProps) => (
  <ul>
    {arrayMap(items, (item) => (
      <li>{item}</li>
    ))}
  </ul>
);
`;

describe("index writes into lists of unknown length", () => {
  it("keeps the items a loop writes into Array(length) by index", async () => {
    const rootDirectory = mkdtempSync(join(tmpdir(), "bippy-analyzer-fill-loop-"));
    writeFileSync(join(rootDirectory, "loop.tsx"), FILL_LOOP_SOURCE);
    const renderer = await createStaticRenderer({ rootDirectory });
    const result = await renderer.renderComponent(join(rootDirectory, "loop.tsx"), {
      exportName: "Loop",
      props: objectFromRecord({
        items: listValue([
          { kind: "repeat", item: unknownPrimitiveValue("string", "item"), location: null },
        ]),
      }),
    });
    expect(result.stats.unknownCount).toBe(0);
    expect(formatPattern(getRenderPattern(result)).replaceAll(`${rootDirectory}/`, "")).toBe(
      [
        "<HostRoot>",
        "  <Loop>",
        "    <ul>",
        "      *repeat(0..) @ loop.tsx:10:3",
        "        ?branch(loop iterations are uncertain) @ loop.tsx:10:3",
        "          |0 (preferred)",
        "            <li>",
        "          |1",
      ].join("\n"),
    );
  });
});

const PRICE_SOURCE = `
interface PriceProps {
  text: string;
  Money: { parse(text: string): { describe(): string } };
}

export const Price = ({ text, Money }: PriceProps) => {
  const price = Money.parse(text);
  return (
    <p>
      {typeof price.describe}
      {price.describe()}
    </p>
  );
};
`;

const createMoneyClass = (): Function => {
  const currency = "USD";
  class Base {
    kind = "credit";
    describe() {
      return `${this.kind} in ${currency}`;
    }
  }
  return class Money extends Base {
    constructor(public amount: number) {
      super();
      if (amount < 0) this.kind = "debt";
    }
    static parse(text: string) {
      return new Money(Number(text));
    }
  };
};

describe("constructing lifted classes", () => {
  it("defines a native class through the interpreter, with the class it extends", async () => {
    const rootDirectory = mkdtempSync(join(tmpdir(), "bippy-analyzer-lifted-class-"));
    writeFileSync(join(rootDirectory, "price.tsx"), PRICE_SOURCE);
    const renderer = await createStaticRenderer({ rootDirectory });
    const result = await renderer.renderComponent(join(rootDirectory, "price.tsx"), {
      exportName: "Price",
      props: objectFromRecord({
        text: unknownPrimitiveValue("string", "text"),
        Money: fromNativeValue(createMoneyClass(), "Money", null),
      }),
    });
    const pattern = formatPattern(getRenderPattern(result));
    expect(result.stats.unknownCount).toBe(0);
    expect(pattern).toBe(
      [
        "<HostRoot>",
        "  <Price>",
        "    <p>",
        '      "function"',
        "      ?branch(if (<boolean: < on dynamic values>)) @ native-closure:Money.parse.Money:6:4",
        "        |0 (preferred)",
        '          "debt in USD"',
        "        |1",
        '          "credit in USD"',
      ].join("\n"),
    );
  });
});
