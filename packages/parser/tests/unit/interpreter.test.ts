import { describe, expect, it } from "vite-plus/test";
import { createStaticRenderer, describeValue, type StaticValue } from "@bippy/parser";

/** Evaluates the `value` export of a module written around `source`. */
const evaluate = (source: string, files: Record<string, string> = {}): StaticValue => {
  const renderer = createStaticRenderer({
    rootDirectory: "/virtual",
    files: { "src/main.tsx": source, ...files },
  });
  return renderer.getExportValue("src/main.tsx", "value");
};

const describe_ = (source: string, files?: Record<string, string>): string =>
  describeValue(evaluate(source, files));

/** Runs `body` inside a function so statements execute in order, and exports its return value. */
const run = (body: string): string =>
  describe_(`declare const show: boolean;
    declare const kind: string;
    declare const rows: number[];
    const run = () => { ${body} };
    export const value = run();`);

describe("interpreter: literals and operators", () => {
  it("folds arithmetic, comparisons and string concatenation", () => {
    expect(describe_(`export const value = 1 + 2 * 3;`)).toBe("7");
    expect(describe_(`export const value = "a" + 1 + true;`)).toBe('"a1true"');
    expect(describe_(`export const value = 3 > 2 && "yes";`)).toBe('"yes"');
    expect(describe_(`export const value = null ?? undefined ?? 0;`)).toBe("0");
    expect(describe_(`export const value = typeof [] === "object";`)).toBe("true");
  });

  it("folds template literals with known parts and keeps unknown ones as text", () => {
    expect(describe_(`const n = 2; export const value = \`n=\${n}\`;`)).toBe('"n=2"');
    expect(describe_(`export const value = \`id-\${Math.random()}\`;`)).toMatch(/^text\(/);
  });

  it("evaluates ternaries and logical expressions with undecidable tests", () => {
    expect(describe_(`declare const flag: boolean; export const value = flag ? 1 : 2;`)).toBe(
      "(flag ? 1 : 2)",
    );
    expect(describe_(`export const value = Math.random() > 0.5 || "fallback";`)).toBe(
      '(Math.random() > 0.5 ? unknown(Math.random() > 0.5) : "fallback")',
    );
    expect(
      describe_(`declare const flag: boolean; export const value = flag ? (flag ? 1 : 2) : 3;`),
    ).toBe("(flag ? 1 : 3)");
    expect(
      describe_(`declare const flag: boolean; export const value = flag ? "same" : "same";`),
    ).toBe('"same"');
  });
});

describe("interpreter: strings and regular expressions", () => {
  it("runs pure string methods when every operand is known", () => {
    expect(describe_(`export const value = "a-b-c".split("-");`)).toBe('["a", "b", "c"]');
    expect(describe_(`export const value = "Hello".toUpperCase().padEnd(7, "!");`)).toBe(
      '"HELLO!!"',
    );
    expect(describe_(`export const value = "x <a>b</a> y".split(/(<\\w+>[^<]*<\\/\\w+>)/);`)).toBe(
      '["x ", "<a>b</a>", " y"]',
    );
  });

  it("routes replace callbacks through the interpreter", () => {
    expect(
      describe_(
        `const values = { name: "Ada" };
         export const value = "Hi {name}!".replace(/\\{(\\w+)\\}/g, (_m, key) => values[key]);`,
      ),
    ).toBe('"Hi Ada!"');
    expect(
      describe_(`export const value = "Hi {name}".replace(/\\{(\\w+)\\}/g, () => Math.random());`),
    ).toMatch(/^text\(/);
  });

  it("evaluates regexp test and exec statelessly", () => {
    expect(describe_(`export const value = /^a/g.test("abc");`)).toBe("true");
    expect(describe_(`const re = /^<(\\w+)>$/; export const value = re.exec("<b>");`)).toBe(
      '["<b>", "b"]',
    );
    expect(describe_(`export const value = /x/.exec("y");`)).toBe("null");
    expect(describe_(`export const value = /x/gi.flags;`)).toBe('"gi"');
  });

  it("calls methods on each arm of a conditional receiver", () => {
    expect(
      describe_(
        `declare const flag: boolean;
         const label = flag ? "yes" : "no";
         export const value = label.toUpperCase();`,
      ),
    ).toBe('(flag ? "YES" : "NO")');
    expect(
      describe_(
        `declare const flag: boolean;
         declare const fallback: string;
         export const value = (flag ? "a-b" : fallback).replace("-", "+");`,
      ),
    ).toBe('(flag ? "a+b" : text((flag ? "a-b" : fallback).replace()))');
  });

  it("degrades to text for unknown receivers", () => {
    expect(describe_(`declare const s: string; export const value = s.trim();`)).toMatch(/^text\(/);
    expect(describe_(`declare const s: string; export const value = s.split(",");`)).toMatch(
      /^list\(/,
    );
    expect(describe_(`declare const s: string; export const value = s.startsWith("a");`)).toMatch(
      /^unknown\(/,
    );
  });
});

describe("interpreter: arrays and objects", () => {
  it("maps, filters and reduces known arrays item by item", () => {
    expect(describe_(`export const value = [1, 2, 3].map((n) => n * 2);`)).toBe("[2, 4, 6]");
    expect(describe_(`export const value = [1, 2, 3].filter((n) => n > 1);`)).toBe("[2, 3]");
    expect(describe_(`export const value = [1, 2, 3].reduce((sum, n) => sum + n, 0);`)).toBe("6");
    expect(
      describe_(`export const value = ["a", "b"].reduceRight((acc, item) => acc + item, "");`),
    ).toBe('"ba"');
    expect(describe_(`export const value = [[1], [2, 3]].flat();`)).toBe("[1, 2, 3]");
    expect(describe_(`export const value = [3, 1].concat([2], 4);`)).toBe("[3, 1, 2, 4]");
  });

  it("keeps unknown arrays as lists of the mapped shape", () => {
    expect(
      describe_(`declare const rows: number[]; export const value = rows.map((r) => r);`),
    ).toBe("list(rows)");
    expect(describe_(`export const value = Array.from({ length: 3 }, (_, i) => i);`)).toBe(
      "list(Array.from())",
    );
  });

  it("supports Object.keys/values/entries/fromEntries on known objects", () => {
    expect(describe_(`export const value = Object.keys({ a: 1, b: 2 });`)).toBe('["a", "b"]');
    expect(describe_(`export const value = Object.values({ a: 1, b: 2 });`)).toBe("[1, 2]");
    expect(describe_(`export const value = Object.fromEntries([["a", 1]]);`)).toBe("{a}");
    expect(describe_(`export const value = { ...{ a: 1 }, b: 2 };`)).toBe("{a, b}");
    expect(describe_(`declare const rest: object; export const value = { a: 1, ...rest };`)).toBe(
      "{a, ...}",
    );
  });

  it("tracks pushes and property writes, conditional when the control flow is undecided", () => {
    expect(run(`const items = [1]; if (show) items.push(2); return items;`)).toBe(
      "[1, list(items.push() under show)]",
    );
    expect(
      run(`const theme = { mode: "light" }; if (show) theme.mode = "dark"; return theme.mode;`),
    ).toBe('(show ? "dark" : "light")');
    expect(run(`const items = [1, 2]; if (items.length > 1) items.push(3); return items;`)).toBe(
      "[1, 2, 3]",
    );
  });

  it("forgets array contents after untrackable mutations", () => {
    expect(run(`const items = [1, 2]; if (show) items.pop(); return items;`)).toBe("[list(items)]");
  });

  it("keeps items whose filter verdict is undecided as optional items", () => {
    const filtered = `const kept = [1, 2, 3].filter((n) => n === 2 || (show && n === 3));`;
    expect(run(`${filtered} return kept;`)).toBe(
      "[2, ([1, 2, 3].filter() keeps [2] ? 3 : absent)]",
    );
    expect(run(`${filtered} return kept.map((n) => n * 10);`)).toBe(
      "[20, ([1, 2, 3].filter() keeps [2] ? 30 : absent)]",
    );
    expect(run(`${filtered} return kept.length;`)).toBe("unknown(array.length)");
    expect(run(`${filtered} return kept[0];`)).toBe("2");
    expect(run(`${filtered} return kept[1];`)).toBe(
      "([1, 2, 3].filter() keeps [2] ? 3 : undefined)",
    );
    expect(run(`const kept = [1, 2].filter((n) => n === 2 || show); return kept[0];`)).toBe(
      "([1, 2].filter() keeps [0] ? 1 : 2)",
    );
    expect(run(`const kept = [1, 2].filter((n) => n === 2 || show); return kept.at(-1);`)).toBe(
      "unknown(kept.at())",
    );
  });

  it("models find as a fall-through over undecided matches", () => {
    expect(run(`return [1, 2, 3].find((n) => n > 1);`)).toBe("2");
    expect(run(`return [1, 2, 3].find((n) => n > 5);`)).toBe("undefined");
    expect(run(`return [1, 2, 3].find((n) => n === 2 || show);`)).toBe(
      "([1, 2, 3].find() matches [0] ? 1 : 2)",
    );
    expect(run(`return [1, 2, 3].findLast((n) => n === 2 || show);`)).toBe(
      "([1, 2, 3].findLast() matches [2] ? 3 : 2)",
    );
    expect(
      run(`const kept = [1, 2].filter((n) => n === 2 || show); return kept.find((n) => n > 0);`),
    ).toBe("([1, 2].filter() keeps [0] ? 1 : 2)");
  });

  it("decides some, every and includes from known items", () => {
    expect(run(`return [1, 2, 3].some((n) => n > 2);`)).toBe("true");
    expect(run(`return [1, 2, 3].every((n) => n > 2);`)).toBe("false");
    expect(run(`return [1, 2, 3].every((n) => n > 0);`)).toBe("true");
    expect(run(`return [1, 2, 3].some((n) => show);`)).toBe("unknown(some())");
    expect(run(`return ["a", "b"].includes("b");`)).toBe("true");
    expect(run(`return ["a", "b"].includes(kind);`)).toBe("unknown(some())");
  });

  it("narrows a branching variable by the tests a path has passed", () => {
    const preset = `const preset = [{ v: "a", label: "A" }, { v: "b", label: "B" }].find((p) => p.v === kind);`;
    expect(run(`${preset} if (preset) return preset.label; return "none";`)).toBe(
      '(preset ? ([{ v: "a", label: "A" }, { v: "b", label: "B" }].find() matches [0] ? "A" : "B") : "none")',
    );
    expect(run(`${preset} if (!preset) return "none"; return preset.label;`)).toBe(
      '(!preset ? "none" : ([{ v: "a", label: "A" }, { v: "b", label: "B" }].find() matches [0] ? "A" : "B"))',
    );
    expect(run(`${preset} return preset ? preset.label : "none";`)).toBe(
      '(preset ? ([{ v: "a", label: "A" }, { v: "b", label: "B" }].find() matches [0] ? "A" : "B") : "none")',
    );
    expect(run(`${preset} return preset && preset.label;`)).toBe(
      '(preset ? ([{ v: "a", label: "A" }, { v: "b", label: "B" }].find() matches [0] ? "A" : "B") : undefined)',
    );
    expect(run(`${preset} if (preset == null) throw new Error(); return preset.label;`)).toBe(
      '([{ v: "a", label: "A" }, { v: "b", label: "B" }].find() matches [0] ? "A" : "B")',
    );
    expect(run(`${preset} return preset?.label && preset.label.length;`)).toBe(
      "(preset?.label ? 1 : undefined)",
    );
  });

  it("narrows property paths through objects, keeping short-circuited optional reads", () => {
    const state = `const state = { item: show ? { label: "x" } : undefined };`;
    expect(run(`${state} return state.item ? state.item.label : "none";`)).toBe(
      '(state.item ? "x" : "none")',
    );
    expect(run(`${state} if (!state.item) return "none"; return state.item.label;`)).toBe(
      '(!state.item ? "none" : "x")',
    );
    const maybe = `const maybe = show ? { item: { label: "x" } } : undefined;`;
    expect(run(`${maybe} return maybe?.item.label === "x" ? maybe.item.label : "none";`)).toBe(
      '(maybe?.item.label === "x" ? "x" : "none")',
    );
    expect(run(`${maybe} return maybe?.item.label !== "x" ? String(maybe) : "same";`)).toBe(
      '(maybe?.item.label !== "x" ? "undefined" : "same")',
    );
  });

  it("narrows by equality with a primitive, including switch cases", () => {
    const mode = `const mode = show ? "a" : kind === "x" ? "b" : "c";`;
    expect(run(`${mode} if (mode === "a") return 1; return mode;`)).toBe(
      '(mode === "a" ? 1 : (kind === "x" ? "b" : "c"))',
    );
    expect(run(`${mode} if (mode !== "a") return mode; return mode;`)).toBe(
      '(mode !== "a" ? (kind === "x" ? "b" : "c") : "a")',
    );
    expect(
      run(`${mode} switch (mode) { case "a": case "b": return mode; default: return mode; }`),
    ).toBe('(mode === "a" || mode === "b" ? (show ? "a" : "b") : "c")');
    expect(run(`let x = show ? 1 : 0; if (x) { x = 2; return x; } return x;`)).toBe("(x ? 2 : 0)");
  });

  it("short-circuits optional chains on nullish values", () => {
    expect(run(`const user = undefined; return user?.profile.name;`)).toBe("undefined");
    expect(run(`const user = { profile: null }; return user.profile?.name ?? "anon";`)).toBe(
      '"anon"',
    );
    expect(run(`const user = show ? { name: "a" } : null; return user?.name ?? "anon";`)).toBe(
      '(user?.name != null ? "a" : "anon")',
    );
    expect(run(`const onSelect = undefined; return onSelect?.(1);`)).toBe("undefined");
    expect(run(`const api = show ? { get: () => 1 } : undefined; return api?.get();`)).toBe(
      "(show ? 1 : undefined)",
    );
    expect(run(`const user = undefined; return user.name;`)).toBe("unknown(undefined.name)");
  });
});

describe("interpreter: control flow", () => {
  it("unrolls loops with static trip counts", () => {
    expect(run(`const out = []; for (let i = 0; i < 3; i++) out.push(i * i); return out;`)).toBe(
      "[0, 1, 4]",
    );
    expect(
      run(`const out = []; for (const key in { a: 1, b: 2 }) out.push(key); return out;`),
    ).toBe('["a", "b"]');
    expect(
      run(
        `let total = 0; for (const n of [1, 2, 3]) { if (n === 2) continue; total += n; } return total;`,
      ),
    ).toBe("4");
    expect(
      run(
        `const out = []; for (const n of [1, 2]) { switch (n) { case 1: break; } out.push(n); } return out;`,
      ),
    ).toBe("[1, 2]");
  });

  it("does not unroll loops that break, since a break may depend on runtime state", () => {
    expect(
      run(
        `const out = []; for (const n of [1, 2, 3]) { if (show) break; out.push(n); } return out;`,
      ),
    ).toMatch(/^\[list\(/);
    expect(
      run(
        `const out = []; for (const n of [1, 2, 3]) { if (n === 2) break; out.push(n); } return out;`,
      ),
    ).toMatch(/^\[list\(/);
  });

  it("falls back to a single undecided pass for unbounded loops", () => {
    expect(run(`const out = []; for (const row of rows) out.push(row); return out;`)).toMatch(
      /^\[list\(/,
    );
  });

  it("merges assignments across branches and early returns", () => {
    expect(
      run(`let label = "none";
           switch (kind) {
             case "a": label = "A"; break;
             case "b": return "early";
             default: label = "other";
           }
           return label;`),
    ).toBe('(kind === "a" ? "A" : (kind === "b" ? "early" : "other"))');
    expect(
      describe_(
        `const pick = (n: number) => {
           if (n > 1) return "big";
           return "small";
         };
         export const value = [pick(2), pick(0)];`,
      ),
    ).toBe('["big", "small"]');
  });

  it("evaluates try/catch as a branch and destructuring with defaults", () => {
    expect(
      describe_(
        `const { a = 1, b: [c] = [2], ...rest } = { b: [3], d: 4 } as { a?: number; b?: number[]; d: number };
         export const value = [a, c, Object.keys(rest)];`,
      ),
    ).toBe('[1, 3, ["d"]]');
    expect(
      describe_(
        `const parse = () => { try { return JSON.parse("1"); } catch { return null; } };
         export const value = parse();`,
      ),
    ).toMatch(/^\(try/);
  });

  it("drops paths that throw, since React renders an error boundary there instead", () => {
    expect(
      run(`if (!show) throw new Error("must be inside provider");
           return "content";`),
    ).toBe('"content"');
    expect(
      run(`if (show) return "a";
           else if (kind === "b") return "b";
           else throw new Error("unreachable");`),
    ).toBe('(show ? "a" : "b")');
    expect(run(`try { throw new Error("boom"); } catch { return "recovered"; }`)).toBe(
      '"recovered"',
    );
    expect(
      describe_(`const fail = () => { throw new Error("always"); }; export const value = fail();`),
    ).toBe("unknown(thrown error)");
  });
});

describe("interpreter: recursion", () => {
  it("follows recursion on fully known arguments to its result", () => {
    expect(
      describe_(
        `const sum = (items: number[]): number =>
           items.length === 0 ? 0 : items[0] + sum(items.slice(1));
         export const value = sum([1, 2, 3]);`,
      ),
    ).toBe("6");
  });

  it("cuts recursion as soon as an argument is unknown, instead of exploring every branch", () => {
    const startedAt = performance.now();
    expect(
      describe_(
        `declare const flag: boolean;
         const midpoint = (a: string, b: string): string => {
           if (flag) return midpoint(a.slice(1), b) + "x";
           if (a.length > b.length) return midpoint(a, b.slice(1));
           return midpoint(a.slice(1), b.slice(1));
         };
         export const value = midpoint("abc", "de");`,
      ),
    ).toMatch(/^(\(flag|unknown\(|text\()/);
    expect(performance.now() - startedAt).toBeLessThan(2_000);
  });
});

describe("interpreter: functions and modules", () => {
  it("binds rest and default parameters and reads closures", () => {
    expect(
      describe_(
        `const join = (separator = ",", ...parts: string[]) => parts.join(separator);
         export const value = join("-", "a", "b");`,
      ),
    ).toMatch(/^text\(/);
    expect(
      describe_(
        `const make = (base: number) => (n: number) => base + n;
         export const value = make(10)(5);`,
      ),
    ).toBe("15");
  });

  it("resolves values across modules, barrels and namespace imports", () => {
    expect(
      describe_(
        `import { SIZE } from "./ui"; import * as ns from "./ui"; export const value = [SIZE, ns.double(SIZE)];`,
        {
          "src/ui/index.ts": `export * from "./size";`,
          "src/ui/size.ts": `export const SIZE = 21; export const double = (n: number) => n * 2;`,
        },
      ),
    ).toBe("[21, 42]");
  });

  it("reads compound-component statics however they were attached", () => {
    const files = {
      "src/parts.tsx": `export const Header = () => <h1 />; export const Body = () => <p />;`,
    };
    expect(
      describe_(
        `import { Header, Body } from "./parts";
         const Card = () => <section />;
         Card.Header = Header;
         Object.assign(Card, { Body });
         export const value = [Card.Header, Card.Body];`,
        files,
      ),
    ).toBe("[fn(Header), fn(Body)]");
    expect(
      describe_(
        `import { forwardRef } from "react";
         import { Header } from "./parts";
         const Panel = Object.assign(forwardRef<HTMLElement>((props, ref) => <aside ref={ref} />), { Header });
         Panel.displayName = "Panel";
         export const value = [Panel, Panel.Header];`,
        files,
      ),
    ).toBe("[component(Panel), fn(Header)]");
  });

  it("imports JSON modules as their data", () => {
    expect(
      describe_(
        `import en from "./locales/en.json";
         export const value = [en.buttons.save, en.title, Object.keys(en)];`,
        { "src/locales/en.json": `{ "title": "Hello", "buttons": { "save": "Save" } }` },
      ),
    ).toBe('["Save", "Hello", ["title", "buttons"]]');
  });

  it("compiles enums to objects with counted members and reverse mappings", () => {
    expect(
      describe_(
        `export enum Step { Password, Code = 5, Done, Label = "done" }
         enum Direction { Up = 1, Down = Up * 2 }
         const local = () => { const enum Size { S = "s" } return Size.S; };
         export const value = [Step.Password, Step.Done, Step[5], Step.Label, Direction.Down, local()];`,
      ),
    ).toBe('[0, 6, "Code", "done", 2, "s"]');
  });

  it("names closures after their bindings and honours displayName", () => {
    expect(
      describe_(
        `const Header = () => null;
         const Footer = () => null;
         Footer.displayName = "SiteFooter";
         export const value = [Header, Footer];`,
      ),
    ).toBe("[fn(Header), fn(SiteFooter)]");
  });

  it("models class components with inherited members and defaultProps", () => {
    expect(
      describe_(
        `import { Component } from "react";
         class Base extends Component<{ n?: number }> { static defaultProps = { n: 1 }; }
         class Child extends Base { render() { return null; } }
         export const value = Child;`,
      ),
    ).toBe("component(Child)");
  });

  it("exposes React's $$typeof brands and registered symbols, as react-is style checks read them", () => {
    expect(
      describe_(
        `import { forwardRef, memo } from "react";
         const Plain = () => null;
         const Ref = forwardRef(() => null);
         const isForwardRef = (type: unknown) => type.$$typeof === Symbol.for("react.forward_ref");
         const render = isForwardRef(Ref) ? Ref.render : Ref;
         export const value = [isForwardRef(Plain), isForwardRef(Ref), memo(Plain).type === Plain, render];`,
      ),
    ).toBe("[false, true, true, fn(anonymous)]");
  });

  it("forgets what a closure assigns once it is handed to a call that cannot be followed", () => {
    expect(
      run(`let result = 0;
           let untouched = 1;
           declare const reaction: { track: (fn: () => void) => void };
           reaction.track(() => { result = 2; });
           return [result, untouched];`),
    ).toBe("[unknown(result after reaction.track()), 1]");
    expect(
      run(`let result = 0;
           [1].forEach(() => { result = 2; });
           return result;`),
    ).toBe("2");
  });
});
