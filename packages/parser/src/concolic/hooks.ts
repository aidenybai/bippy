import { TextMarker, UnknownMarker } from "../materialize/markers.js";
import type { SymbolicNode, SymbolicSourceKind, SymbolicSpace, SymbolicType } from "./symbolic.js";

/** Intrinsics of the analyzed realm whose calls stay symbolic when an argument is symbolic. */
export interface RealmIntrinsics {
  JSON: typeof JSON;
  Math: typeof Math;
  Object: typeof Object;
  Array: typeof Array;
  String: typeof String;
  Number: typeof Number;
  Boolean: typeof Boolean;
  Date: typeof Date;
  parseInt: typeof parseInt;
  parseFloat: typeof parseFloat;
  isNaN: typeof isNaN;
  isFinite: typeof isFinite;
  encodeURIComponent: typeof encodeURIComponent;
  decodeURIComponent: typeof decodeURIComponent;
  encodeURI: typeof encodeURI;
  decodeURI: typeof decodeURI;
  Function: typeof Function;
}

export interface JsxFactory {
  (type: unknown, props: Record<string, unknown>, key?: unknown): unknown;
}

export interface CreateElementFactory {
  (
    type: unknown,
    props: Record<string, unknown> | null | undefined,
    ...children: unknown[]
  ): unknown;
}

/** The Jalangi-style hook object instrumented modules call as the free name `J$`. */
export interface ConcolicHooks {
  /** Scratch slot short-circuit rewrites store the left operand in: `(J$.C(J$.k = a, s) ? b : J$.k)`. */
  k: unknown;
  C: (condition: unknown, site: number) => boolean;
  /** A loop test: symbolic iterations are numbered so a flipped decision cannot spin forever. */
  CL: (condition: unknown, site: number) => boolean;
  Q: (value: unknown, site: number) => boolean;
  add: (left: unknown, right: unknown) => unknown;
  sub: (left: unknown, right: unknown) => unknown;
  mul: (left: unknown, right: unknown) => unknown;
  div: (left: unknown, right: unknown) => unknown;
  mod: (left: unknown, right: unknown) => unknown;
  exp: (left: unknown, right: unknown) => unknown;
  shl: (left: unknown, right: unknown) => unknown;
  shr: (left: unknown, right: unknown) => unknown;
  ushr: (left: unknown, right: unknown) => unknown;
  band: (left: unknown, right: unknown) => unknown;
  bor: (left: unknown, right: unknown) => unknown;
  bxor: (left: unknown, right: unknown) => unknown;
  eq: (left: unknown, right: unknown) => unknown;
  ne: (left: unknown, right: unknown) => unknown;
  seq: (left: unknown, right: unknown) => unknown;
  sne: (left: unknown, right: unknown) => unknown;
  lt: (left: unknown, right: unknown) => unknown;
  le: (left: unknown, right: unknown) => unknown;
  gt: (left: unknown, right: unknown) => unknown;
  ge: (left: unknown, right: unknown) => unknown;
  in: (left: unknown, right: unknown) => unknown;
  instanceof: (left: unknown, right: unknown) => unknown;
  not: (value: unknown) => unknown;
  neg: (value: unknown) => unknown;
  pos: (value: unknown) => unknown;
  bnot: (value: unknown) => unknown;
  typeof: (value: unknown) => unknown;
  G: (target: unknown, key: unknown) => unknown;
  F0: (callee: unknown, site: number) => unknown;
  F1: (callee: unknown, first: unknown, site: number) => unknown;
  F2: (callee: unknown, first: unknown, second: unknown, site: number) => unknown;
  F3: (callee: unknown, first: unknown, second: unknown, third: unknown, site: number) => unknown;
  Fn: (callee: unknown, args: unknown[], site: number) => unknown;
  M0: (target: unknown, key: unknown, site: number) => unknown;
  M1: (target: unknown, key: unknown, first: unknown, site: number) => unknown;
  M2: (target: unknown, key: unknown, first: unknown, second: unknown, site: number) => unknown;
  M3: (
    target: unknown,
    key: unknown,
    first: unknown,
    second: unknown,
    third: unknown,
    site: number,
  ) => unknown;
  Mn: (target: unknown, key: unknown, args: unknown[], site: number) => unknown;
  /** Calls inside an optional chain: a nullish callee or receiver yields `undefined`. */
  FO: (callee: unknown, args: unknown[], site: number) => unknown;
  MO: (target: unknown, key: unknown, args: unknown[], site: number) => unknown;
  NEW: (callee: unknown, args: unknown[], site: number) => unknown;
  T: (...parts: unknown[]) => unknown;
  S: (iterable: unknown, site: number) => unknown;
  SO: (source: unknown, site: number) => unknown;
  K: (target: unknown, site: number) => unknown;
  SW: (discriminant: unknown, site: number, caseCount: number) => unknown;
  SK: (index: number, test: unknown, site: number) => unknown;
  wrapJsx: (jsx: JsxFactory) => JsxFactory;
  wrapCreateElement: (createElement: CreateElementFactory) => CreateElementFactory;
}

export const HOOK_GLOBAL_NAME = "J$";

/** What instrumentation stamps into every function body so the runtime can tell instrumented callees apart. */
export const INSTRUMENTED_FUNCTION_MARK = "/*! J$ */";

const NATIVE_CODE = "[native code]";

const ARRAY_ITERATION_METHODS = new Set([
  "map",
  "forEach",
  "filter",
  "flatMap",
  "flat",
  "reduce",
  "reduceRight",
  "some",
  "every",
  "find",
  "findIndex",
  "findLast",
  "findLastIndex",
  "sort",
  "toSorted",
  "toReversed",
  "reverse",
  "entries",
  "keys",
  "values",
]);

const NUMERIC_OPERATORS = new Set(["-", "*", "/", "%", "**", "<<", ">>", ">>>", "&", "|", "^"]);

/** Iterations a loop whose test is symbolic may take on one path before the test is forced false. */
export const MAX_SYMBOLIC_LOOP_ITERATIONS = 2;

/** Largest element count a symbolic list is materialized with; counts 0..MAX are the alternatives of its `count` decision. */
export const MAX_SYMBOLIC_LIST_COUNT = 2;

const isNullish = (value: unknown): boolean => value === null || value === undefined;

/** Natives whose result the program cannot know at analysis time; each call from instrumented code yields a fresh variable. */
export interface UnknownNativeSource {
  native: unknown;
  kind: SymbolicSourceKind;
  name: string;
  type: SymbolicType;
}

export const createHooks = (
  space: SymbolicSpace,
  sites: string[],
  intrinsics: RealmIntrinsics,
  unknownNatives: UnknownNativeSource[] = [],
): ConcolicHooks => {
  const isSymbolic = (value: unknown): boolean => space.isSymbolic(value);
  const unknownNativeSources = new Map<unknown, UnknownNativeSource>(
    unknownNatives.map((source) => [source.native, source]),
  );
  const unknownNativeCalls = new Map<string, number>();
  const sourceOfNative = (callee: unknown): unknown => {
    const source = unknownNativeSources.get(callee);
    if (!source) return undefined;
    const ordinal = unknownNativeCalls.get(source.name) ?? 0;
    unknownNativeCalls.set(source.name, ordinal + 1);
    return space.source(source.kind, `${source.name}#${ordinal}`, source.type);
  };
  const siteOf = (site: number): string => sites[site] ?? `site#${site}`;
  const functionKinds = new WeakMap<object, "instrumented" | "native" | "uninstrumented">();
  const functionToString = intrinsics.Function.prototype.toString;
  const pendingSwitches = new Map<number, number | null>();
  const symbolicLoopIterations = new Map<number, number>();
  const SWITCH_MATCH = Symbol("concolic switch match");
  const SWITCH_MISS = Symbol("concolic switch miss");

  const classifyFunction = (callee: object): "instrumented" | "native" | "uninstrumented" => {
    const cached = functionKinds.get(callee);
    if (cached) return cached;
    const source: string = functionToString.call(callee);
    const kind = source.includes(INSTRUMENTED_FUNCTION_MARK)
      ? "instrumented"
      : source.includes(NATIVE_CODE)
        ? "native"
        : "uninstrumented";
    functionKinds.set(callee, kind);
    return kind;
  };

  const nodeOf = (value: unknown): SymbolicNode => {
    const node = space.getNode(value);
    if (!node) throw new TypeError("expected a symbolic value");
    return node;
  };

  const decideNullish = (node: SymbolicNode, site: number): boolean => {
    if (space.decisions.peek(`truthy ${node.key}`) === 1) return false;
    return space.decisions.decide(`nullish ${node.key}`, "nullish", siteOf(site), 2, 1) === 1;
  };

  const decideTruthy = (node: SymbolicNode, site: number): boolean => {
    switch (node.operation) {
      case "not":
        return !decideTruthy(node.operands[0], site);
      case "bool":
        return decideTruthy(node.operands[0], site);
      case "nullish-eq":
        return decideNullish(node.operands[0], site);
      case "nullish-ne":
        return !decideNullish(node.operands[0], site);
      default:
        if (space.decisions.peek(`nullish ${node.key}`) === 1) return false;
        return space.decisions.decide(`truthy ${node.key}`, "truthy", siteOf(site), 2, 0) === 1;
    }
  };

  const decideCount = (node: SymbolicNode, site: number): number =>
    space.decisions.decide(
      `count ${node.key}`,
      "count",
      siteOf(site),
      MAX_SYMBOLIC_LIST_COUNT + 1,
      0,
    );

  /** The concrete list a symbolic collection stands for on this path: `count` element symbolics. */
  const materializeList = (node: SymbolicNode, site: number): unknown[] => {
    const count = decideCount(node, site);
    const elements: unknown[] = [];
    for (let index = 0; index < count; index++) {
      elements.push(space.memberOfNode(node, String(index)));
    }
    return elements;
  };

  const typeOfOperand = (value: unknown): SymbolicType => {
    const node = space.getNode(value);
    if (node) return node.type;
    switch (typeof value) {
      case "string":
        return "string";
      case "number":
        return "number";
      case "boolean":
        return "boolean";
      default:
        return "unknown";
    }
  };

  const binary = (operator: string, left: unknown, right: unknown): unknown => {
    let type: SymbolicType = "unknown";
    if (operator === "+") {
      const leftType = typeOfOperand(left);
      const rightType = typeOfOperand(right);
      type =
        leftType === "string" || rightType === "string"
          ? "string"
          : leftType === "number" && rightType === "number"
            ? "number"
            : "unknown";
    } else if (NUMERIC_OPERATORS.has(operator)) {
      type = "number";
    } else {
      type = "boolean";
    }
    return space.derive(operator, [left, right], type);
  };

  const equality = (operator: string, left: unknown, right: unknown): unknown => {
    const isNegated = operator === "!=" || operator === "!==";
    if (isSymbolic(left) && isNullish(right)) {
      return space.derive(isNegated ? "nullish-ne" : "nullish-eq", [left], "boolean");
    }
    if (isSymbolic(right) && isNullish(left)) {
      return space.derive(isNegated ? "nullish-ne" : "nullish-eq", [right], "boolean");
    }
    return binary(operator, left, right);
  };

  const pureBuiltins = new Map<unknown, (args: unknown[]) => unknown>();
  const registerPure = (
    fn: unknown,
    name: string,
    type: SymbolicType,
    argumentsOnly = false,
  ): void => {
    pureBuiltins.set(fn, (args) =>
      space.derive(name, argumentsOnly ? args.slice(0, 1) : args, type),
    );
  };
  registerPure(intrinsics.JSON.stringify, "JSON.stringify", "string", true);
  registerPure(intrinsics.JSON.parse, "JSON.parse", "unknown", true);
  registerPure(intrinsics.String, "String", "string");
  registerPure(intrinsics.Number, "Number", "number");
  registerPure(intrinsics.parseInt, "parseInt", "number");
  registerPure(intrinsics.parseFloat, "parseFloat", "number");
  registerPure(intrinsics.isNaN, "isNaN", "boolean");
  registerPure(intrinsics.isFinite, "isFinite", "boolean");
  registerPure(intrinsics.Number.isNaN, "Number.isNaN", "boolean");
  registerPure(intrinsics.Number.isFinite, "Number.isFinite", "boolean");
  registerPure(intrinsics.Number.isInteger, "Number.isInteger", "boolean");
  registerPure(intrinsics.Number.parseInt, "parseInt", "number");
  registerPure(intrinsics.Number.parseFloat, "parseFloat", "number");
  registerPure(intrinsics.encodeURIComponent, "encodeURIComponent", "string");
  registerPure(intrinsics.decodeURIComponent, "decodeURIComponent", "string");
  registerPure(intrinsics.encodeURI, "encodeURI", "string");
  registerPure(intrinsics.decodeURI, "decodeURI", "string");
  registerPure(intrinsics.Object.keys, "Object.keys", "array");
  registerPure(intrinsics.Object.values, "Object.values", "array");
  registerPure(intrinsics.Object.entries, "Object.entries", "array");
  registerPure(intrinsics.Object.fromEntries, "Object.fromEntries", "object");
  registerPure(intrinsics.Object.prototype.hasOwnProperty, "hasOwnProperty", "boolean");
  registerPure(intrinsics.Array.isArray, "Array.isArray", "boolean");
  registerPure(intrinsics.Date.parse, "Date.parse", "number");
  registerPure(intrinsics.String.fromCharCode, "String.fromCharCode", "string");
  for (const name of Object.getOwnPropertyNames(intrinsics.Math)) {
    const member: unknown = Reflect.get(intrinsics.Math, name);
    if (typeof member === "function") registerPure(member, `Math.${name}`, "number");
  }
  pureBuiltins.set(intrinsics.Boolean, (args) => space.derive("bool", args.slice(0, 1), "boolean"));
  for (const passThrough of [
    intrinsics.Object.freeze,
    intrinsics.Object.seal,
    intrinsics.Object.preventExtensions,
  ]) {
    pureBuiltins.set(passThrough, (args) => args[0]);
  }

  const call = (callee: unknown, thisArgument: unknown, args: unknown[], site: number): unknown => {
    const calleeNode = space.getNode(callee);
    if (calleeNode) return space.call(calleeNode, args);
    if (typeof callee !== "function") return Reflect.apply(Object(callee), thisArgument, args);
    const kind = classifyFunction(callee);
    if (kind === "instrumented") return Reflect.apply(callee, thisArgument, args);
    if (kind === "native") {
      if (callee === intrinsics.Array.from && isSymbolic(args[0])) {
        return materializeList(nodeOf(args[0]), site);
      }
      if (callee === intrinsics.Function.prototype.call) {
        return call(thisArgument, args[0], args.slice(1), site);
      }
      if (callee === intrinsics.Function.prototype.apply) {
        const applied = args[1];
        return call(
          thisArgument,
          args[0],
          isSymbolic(applied)
            ? materializeList(nodeOf(applied), site)
            : Array.from(Object(applied)),
          site,
        );
      }
      const pure = pureBuiltins.get(callee);
      if (pure) return pure(args);
    }
    for (const argument of [thisArgument, ...args]) {
      const node = space.getNode(argument);
      if (node) {
        space.leak(
          kind === "native" ? "native-call" : "uninstrumented-call",
          node,
          `${callee.name || "anonymous"}() at ${siteOf(site)}`,
        );
      }
    }
    return Reflect.apply(callee, thisArgument, args);
  };

  const hasSymbolicArgument = (thisArgument: unknown, args: unknown[]): boolean => {
    if (isSymbolic(thisArgument)) return true;
    for (const argument of args) if (isSymbolic(argument)) return true;
    return false;
  };

  const methodCall = (target: unknown, key: unknown, args: unknown[], site: number): unknown => {
    const node = space.getNode(target);
    if (node) {
      if (
        typeof key === "string" &&
        ARRAY_ITERATION_METHODS.has(key) &&
        (node.type === "array" || node.type === "unknown")
      ) {
        const elements = materializeList(node, site);
        return Reflect.apply(Reflect.get(intrinsics.Array.prototype, key), elements, args);
      }
      const member = isSymbolic(key)
        ? space.derive("index", [target, key], "unknown", `${node.key}[${space.describe(key)}]`)
        : space.member(target, keyOf(key));
      return space.call(nodeOf(member), args);
    }
    const callee: unknown = isSymbolic(key)
      ? space.derive("index", [target, key], "unknown")
      : Reflect.get(Object(target), keyOf(key));
    return call(callee, target, args, site);
  };

  const keyOf = (key: unknown): PropertyKey =>
    typeof key === "symbol" ? key : typeof key === "number" ? key : String(key);

  const template = (parts: unknown[]): unknown => {
    for (let index = 1; index < parts.length; index += 2) {
      if (isSymbolic(parts[index])) return space.derive("template", parts, "string");
    }
    let text = "";
    for (let index = 0; index < parts.length; index++) {
      text += index % 2 === 0 ? parts[index] : intrinsics.String(parts[index]);
    }
    return text;
  };

  const childMarker = (jsx: JsxFactory, node: SymbolicNode): unknown => {
    if (space.decisions.peek(`truthy ${node.key}`) === 0) return null;
    if (node.type === "boolean") return null;
    if (node.type === "string" || node.type === "number") {
      return jsx(TextMarker, { reason: node.key });
    }
    return jsx(UnknownMarker, { reason: `${node.key} rendered as a child`, isTruncated: true });
  };

  const sanitizeChild = (jsx: JsxFactory, child: unknown): unknown => {
    const node = space.getNode(child);
    if (node) return childMarker(jsx, node);
    if (Array.isArray(child)) {
      let isChanged = false;
      const sanitized = child.map((element) => {
        const replacement = sanitizeChild(jsx, element);
        if (replacement !== element) isChanged = true;
        return replacement;
      });
      return isChanged ? sanitized : child;
    }
    return child;
  };

  const sanitizeElement = (
    jsx: JsxFactory,
    type: unknown,
    props: Record<string, unknown> | null | undefined,
    key: unknown,
  ): { type: unknown; props: Record<string, unknown> | null | undefined; key: unknown } => {
    const typeNode = space.getNode(type);
    if (typeNode) {
      space.leak("jsx-type", typeNode, "rendered as an element type");
      return {
        type: UnknownMarker,
        props: { reason: `${typeNode.key} as element type`, isTruncated: true },
        key,
      };
    }
    const keyNode = space.getNode(key);
    if (keyNode) space.leak("jsx-key", keyNode, "used as an element key");
    const sanitizedKey = keyNode ? undefined : key;
    if (props !== null && props !== undefined && "children" in props) {
      const children = sanitizeChild(jsx, props.children);
      if (children !== props.children) {
        return { type, props: { ...props, children }, key: sanitizedKey };
      }
    }
    return { type, props, key: sanitizedKey };
  };

  // HACK: the concrete fast paths apply the source's own operator to `unknown`
  // operands; `never` is the only cast TypeScript accepts for every operator.
  const hooks: ConcolicHooks = {
    k: undefined,
    C: (condition, site) => {
      const node = space.getNode(condition);
      return node ? decideTruthy(node, site) : !!condition;
    },
    CL: (condition, site) => {
      const node = space.getNode(condition);
      if (!node) return !!condition;
      const iteration = symbolicLoopIterations.get(site) ?? 0;
      symbolicLoopIterations.set(site, iteration + 1);
      if (iteration >= MAX_SYMBOLIC_LOOP_ITERATIONS) return false;
      return (
        space.decisions.decide(`truthy ${node.key}#${iteration}`, "truthy", siteOf(site), 2, 0) ===
        1
      );
    },
    Q: (value, site) => {
      const node = space.getNode(value);
      return node ? decideNullish(node, site) : isNullish(value);
    },
    add: (left, right) =>
      isSymbolic(left) || isSymbolic(right)
        ? binary("+", left, right)
        : (left as never) + (right as never),
    sub: (left, right) =>
      isSymbolic(left) || isSymbolic(right)
        ? binary("-", left, right)
        : (left as never) - (right as never),
    mul: (left, right) =>
      isSymbolic(left) || isSymbolic(right)
        ? binary("*", left, right)
        : (left as never) * (right as never),
    div: (left, right) =>
      isSymbolic(left) || isSymbolic(right)
        ? binary("/", left, right)
        : (left as never) / (right as never),
    mod: (left, right) =>
      isSymbolic(left) || isSymbolic(right)
        ? binary("%", left, right)
        : (left as never) % (right as never),
    exp: (left, right) =>
      isSymbolic(left) || isSymbolic(right)
        ? binary("**", left, right)
        : (left as never) ** (right as never),
    shl: (left, right) =>
      isSymbolic(left) || isSymbolic(right)
        ? binary("<<", left, right)
        : (left as never) << (right as never),
    shr: (left, right) =>
      isSymbolic(left) || isSymbolic(right)
        ? binary(">>", left, right)
        : (left as never) >> (right as never),
    ushr: (left, right) =>
      isSymbolic(left) || isSymbolic(right)
        ? binary(">>>", left, right)
        : (left as never) >>> (right as never),
    band: (left, right) =>
      isSymbolic(left) || isSymbolic(right)
        ? binary("&", left, right)
        : (left as never) & (right as never),
    bor: (left, right) =>
      isSymbolic(left) || isSymbolic(right)
        ? binary("|", left, right)
        : (left as never) | (right as never),
    bxor: (left, right) =>
      isSymbolic(left) || isSymbolic(right)
        ? binary("^", left, right)
        : (left as never) ^ (right as never),
    eq: (left, right) =>
      // eslint-disable-next-line eqeqeq
      isSymbolic(left) || isSymbolic(right) ? equality("==", left, right) : left == right,
    ne: (left, right) =>
      // eslint-disable-next-line eqeqeq
      isSymbolic(left) || isSymbolic(right) ? equality("!=", left, right) : left != right,
    seq: (left, right) =>
      isSymbolic(left) || isSymbolic(right) ? equality("===", left, right) : left === right,
    sne: (left, right) =>
      isSymbolic(left) || isSymbolic(right) ? equality("!==", left, right) : left !== right,
    lt: (left, right) =>
      isSymbolic(left) || isSymbolic(right)
        ? binary("<", left, right)
        : (left as never) < (right as never),
    le: (left, right) =>
      isSymbolic(left) || isSymbolic(right)
        ? binary("<=", left, right)
        : (left as never) <= (right as never),
    gt: (left, right) =>
      isSymbolic(left) || isSymbolic(right)
        ? binary(">", left, right)
        : (left as never) > (right as never),
    ge: (left, right) =>
      isSymbolic(left) || isSymbolic(right)
        ? binary(">=", left, right)
        : (left as never) >= (right as never),
    in: (left, right) =>
      isSymbolic(left) || isSymbolic(right)
        ? binary("in", left, right)
        : (left as never) in (right as never),
    instanceof: (left, right) =>
      isSymbolic(left) || isSymbolic(right)
        ? binary("instanceof", left, right)
        : (typeof left === "object" || typeof left === "function") &&
          left !== null &&
          left instanceof Object(right),
    not: (value) => (isSymbolic(value) ? space.derive("not", [value], "boolean") : !value),
    neg: (value) =>
      isSymbolic(value) ? space.derive("neg", [value], "number") : -(value as never),
    pos: (value) =>
      isSymbolic(value) ? space.derive("pos", [value], "number") : +(value as never),
    bnot: (value) =>
      isSymbolic(value) ? space.derive("bnot", [value], "number") : ~(value as never),
    typeof: (value) =>
      isSymbolic(value) ? space.derive("typeof", [value], "string") : typeof value,
    G: (target, key) => {
      if (isSymbolic(key)) return space.derive("index", [target, key], "unknown");
      return Reflect.get(Object(target), keyOf(key));
    },
    F0: (callee, site) => {
      if (unknownNativeSources.has(callee)) return sourceOfNative(callee);
      return typeof callee === "function" && !isSymbolic(callee)
        ? callee()
        : call(callee, undefined, [], site);
    },
    F1: (callee, first, site) =>
      typeof callee === "function" && !isSymbolic(callee) && !isSymbolic(first)
        ? callee(first)
        : call(callee, undefined, [first], site),
    F2: (callee, first, second, site) =>
      typeof callee === "function" &&
      !isSymbolic(callee) &&
      !isSymbolic(first) &&
      !isSymbolic(second)
        ? callee(first, second)
        : call(callee, undefined, [first, second], site),
    F3: (callee, first, second, third, site) =>
      typeof callee === "function" &&
      !isSymbolic(callee) &&
      !isSymbolic(first) &&
      !isSymbolic(second) &&
      !isSymbolic(third)
        ? callee(first, second, third)
        : call(callee, undefined, [first, second, third], site),
    Fn: (callee, args, site) =>
      typeof callee === "function" && !isSymbolic(callee) && !hasSymbolicArgument(undefined, args)
        ? Reflect.apply(callee, undefined, args)
        : call(callee, undefined, args, site),
    M0: (target, key, site) => {
      if (isSymbolic(target) || isSymbolic(key)) return methodCall(target, key, [], site);
      const callee: unknown = Reflect.get(Object(target), keyOf(key));
      if (unknownNativeSources.has(callee)) return sourceOfNative(callee);
      return typeof callee === "function" && !isSymbolic(callee)
        ? callee.call(target)
        : call(callee, target, [], site);
    },
    M1: (target, key, first, site) => {
      if (isSymbolic(target) || isSymbolic(key) || isSymbolic(first)) {
        return methodCall(target, key, [first], site);
      }
      const callee: unknown = Reflect.get(Object(target), keyOf(key));
      return typeof callee === "function" && !isSymbolic(callee)
        ? callee.call(target, first)
        : call(callee, target, [first], site);
    },
    M2: (target, key, first, second, site) => {
      if (isSymbolic(target) || isSymbolic(key) || isSymbolic(first) || isSymbolic(second)) {
        return methodCall(target, key, [first, second], site);
      }
      const callee: unknown = Reflect.get(Object(target), keyOf(key));
      return typeof callee === "function" && !isSymbolic(callee)
        ? callee.call(target, first, second)
        : call(callee, target, [first, second], site);
    },
    M3: (target, key, first, second, third, site) => {
      if (
        isSymbolic(target) ||
        isSymbolic(key) ||
        isSymbolic(first) ||
        isSymbolic(second) ||
        isSymbolic(third)
      ) {
        return methodCall(target, key, [first, second, third], site);
      }
      const callee: unknown = Reflect.get(Object(target), keyOf(key));
      return typeof callee === "function" && !isSymbolic(callee)
        ? callee.call(target, first, second, third)
        : call(callee, target, [first, second, third], site);
    },
    Mn: (target, key, args, site) => {
      if (isSymbolic(target) || isSymbolic(key) || hasSymbolicArgument(undefined, args)) {
        return methodCall(target, key, args, site);
      }
      const callee: unknown = Reflect.get(Object(target), keyOf(key));
      return typeof callee === "function" && !isSymbolic(callee)
        ? Reflect.apply(callee, target, args)
        : call(callee, target, args, site);
    },
    FO: (callee, args, site) =>
      isNullish(callee) ? undefined : call(callee, undefined, args, site),
    MO: (target, key, args, site) => {
      if (isNullish(target)) return undefined;
      if (isSymbolic(target) || isSymbolic(key) || hasSymbolicArgument(undefined, args)) {
        return methodCall(target, key, args, site);
      }
      const callee: unknown = Reflect.get(Object(target), keyOf(key));
      return isNullish(callee) ? undefined : call(callee, target, args, site);
    },
    NEW: (callee, args, site) => {
      const calleeNode = space.getNode(callee);
      if (calleeNode) return space.construct(calleeNode, args);
      if (args.length === 0 && unknownNativeSources.has(callee)) return sourceOfNative(callee);
      if (typeof callee !== "function" || !hasSymbolicArgument(undefined, args)) {
        return Reflect.construct(Object(callee), args);
      }
      const kind = classifyFunction(callee);
      if (kind === "native") {
        return space.derive(
          `new ${callee.name}`,
          args,
          "object",
          `new ${callee.name}(${args.map((argument) => space.describe(argument)).join(", ")})`,
        );
      }
      if (kind === "uninstrumented") {
        for (const argument of args) {
          const node = space.getNode(argument);
          if (node)
            space.leak("uninstrumented-call", node, `new ${callee.name}() at ${siteOf(site)}`);
        }
      }
      return Reflect.construct(callee, args);
    },
    T: (...parts) => template(parts),
    S: (iterable, site) => {
      const node = space.getNode(iterable);
      return node ? materializeList(node, site) : iterable;
    },
    SO: (source, site) => {
      const node = space.getNode(source);
      if (!node) return source;
      space.leak("object-spread", node, `spread into an object literal at ${siteOf(site)}`);
      return {};
    },
    K: (target, site) => {
      const node = space.getNode(target);
      if (!node) return target;
      const keys = space.derive("Object.keys", [target], "array");
      return materializeList(nodeOf(keys), site);
    },
    SW: (discriminant, site, caseCount) => {
      const node = space.getNode(discriminant);
      if (!node) {
        pendingSwitches.set(site, null);
        return discriminant;
      }
      pendingSwitches.set(
        site,
        space.decisions.decide(`case ${node.key}`, "case", siteOf(site), caseCount + 1, caseCount),
      );
      return SWITCH_MATCH;
    },
    SK: (index, test, site) => {
      const choice = pendingSwitches.get(site);
      if (choice === null || choice === undefined) return test;
      return choice === index ? SWITCH_MATCH : SWITCH_MISS;
    },
    wrapJsx: (jsx) => {
      const wrapped: JsxFactory = (type, props, key, ...rest) => {
        const element = sanitizeElement(jsx, type, props, key);
        return Reflect.apply(jsx, undefined, [element.type, element.props, element.key, ...rest]);
      };
      return wrapped;
    },
    wrapCreateElement: (createElement) => {
      const jsx: JsxFactory = (type, props) => createElement(type, props);
      const wrapped: CreateElementFactory = (type, props, ...children) => {
        const element = sanitizeElement(jsx, type, props, props?.key);
        const sanitizedChildren = children.map((child) => sanitizeChild(jsx, child));
        const sanitizedProps =
          element.key !== props?.key && element.props !== null
            ? { ...element.props, key: element.key }
            : element.props;
        return createElement(element.type, sanitizedProps, ...sanitizedChildren);
      };
      return wrapped;
    },
  };
  return hooks;
};
