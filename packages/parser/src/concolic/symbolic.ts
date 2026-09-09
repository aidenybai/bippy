import type { DecisionLog } from "./decisions.js";

export type SymbolicType = "unknown" | "string" | "number" | "boolean" | "array" | "object";

export type SymbolicSourceKind =
  | "fetch"
  | "xhr"
  | "environment"
  | "media-query"
  | "storage"
  | "random"
  | "clock"
  | "cookie"
  | "loader"
  | "server-action"
  | "native";

export interface SymbolicSource {
  kind: SymbolicSourceKind;
  description: string;
}

/**
 * One vertex of the expression DAG: a symbolic source, a property of another
 * symbolic, or the result of an operation with at least one symbolic operand.
 * Nodes are interned by `key` so structurally equal expressions share a variable.
 */
export interface SymbolicNode {
  id: number;
  key: string;
  type: SymbolicType;
  source: SymbolicSource;
  operation: string;
  operands: SymbolicNode[];
  /** Concrete values written through the proxy, read back before the symbolic child. */
  writes: Map<PropertyKey, unknown>;
  children: Map<string, unknown>;
}

export type LeakKind =
  | "concretized"
  | "native-call"
  | "uninstrumented-call"
  | "iterated"
  | "own-keys"
  | "object-spread"
  | "jsx-key"
  | "jsx-type";

/** A symbolic that reached code the runtime could not keep symbolic, and what it turned into. */
export interface SymbolicLeak {
  kind: LeakKind;
  symbolic: string;
  detail: string;
  site: string | null;
}

export interface SymbolicSummary {
  id: number;
  key: string;
  type: SymbolicType;
  source: SymbolicSource;
}

/** The longest an uninstrumented consumer may pull a symbolic iterator before it ends. */
export const MAX_NATIVE_ITERATION = 8;

const CONCRETE_BY_TYPE: Record<SymbolicType, unknown> = {
  unknown: undefined,
  string: "",
  number: 0,
  boolean: false,
  array: undefined,
  object: undefined,
};

const STRING_METHOD_TYPES = new Map<string, SymbolicType>([
  ["toUpperCase", "string"],
  ["toLowerCase", "string"],
  ["trim", "string"],
  ["trimStart", "string"],
  ["trimEnd", "string"],
  ["slice", "unknown"],
  ["substring", "string"],
  ["substr", "string"],
  ["replace", "string"],
  ["replaceAll", "string"],
  ["padStart", "string"],
  ["padEnd", "string"],
  ["concat", "unknown"],
  ["toString", "string"],
  ["toLocaleString", "string"],
  ["toFixed", "string"],
  ["toISOString", "string"],
  ["toLocaleDateString", "string"],
  ["toLocaleTimeString", "string"],
  ["toLocaleUpperCase", "string"],
  ["toLocaleLowerCase", "string"],
  ["normalize", "string"],
  ["repeat", "string"],
  ["charAt", "string"],
  ["join", "string"],
  ["indexOf", "number"],
  ["lastIndexOf", "number"],
  ["charCodeAt", "number"],
  ["codePointAt", "number"],
  ["localeCompare", "number"],
  ["search", "number"],
  ["getTime", "number"],
  ["valueOf", "unknown"],
  ["includes", "boolean"],
  ["startsWith", "boolean"],
  ["endsWith", "boolean"],
  ["test", "boolean"],
  ["has", "boolean"],
  ["split", "array"],
  ["match", "unknown"],
  ["json", "object"],
  ["text", "string"],
]);

const PROPERTY_TYPES = new Map<string, SymbolicType>([
  ["length", "number"],
  ["size", "number"],
  ["status", "number"],
  ["ok", "boolean"],
  ["matches", "boolean"],
]);

const describeConcreteKey = (value: unknown): string => {
  switch (typeof value) {
    case "string":
    case "number":
    case "boolean":
    case "undefined":
      return JSON.stringify(value) ?? "undefined";
    case "bigint":
      return `${value}n`;
    case "symbol":
      return value.toString();
    case "function":
      return `#fn(${value.name})`;
    case "object":
      return value === null ? "null" : Array.isArray(value) ? "#array" : "#object";
  }
};

const inspectSymbol = Symbol.for("nodejs.util.inspect.custom");

export class SymbolicSpace {
  private readonly nodesByProxy = new WeakMap<object, SymbolicNode>();
  private readonly proxiesByKey = new Map<string, object>();
  private readonly nodesByKey = new Map<string, SymbolicNode>();
  readonly leaks: SymbolicLeak[] = [];
  private nextId = 1;

  constructor(readonly decisions: DecisionLog) {}

  isSymbolic(value: unknown): boolean {
    return typeof value === "object" && value !== null && this.nodesByProxy.has(value);
  }

  getNode(value: unknown): SymbolicNode | null {
    if (typeof value !== "object" || value === null) return null;
    return this.nodesByProxy.get(value) ?? null;
  }

  describe(value: unknown): string {
    return this.getNode(value)?.key ?? describeConcreteKey(value);
  }

  get nodes(): SymbolicSummary[] {
    return [...this.nodesByKey.values()].map(({ id, key, type, source }) => ({
      id,
      key,
      type,
      source,
    }));
  }

  /** A fresh variable for an input the program cannot know at analysis time. */
  source(kind: SymbolicSourceKind, description: string, type: SymbolicType = "unknown"): unknown {
    return this.intern({
      key: `${kind}(${description})`,
      type,
      source: { kind, description },
      operation: "source",
      operands: [],
    });
  }

  /** The result of `operation` over `operands`, at least one of which is symbolic. */
  derive(
    operation: string,
    operands: unknown[],
    type: SymbolicType = "unknown",
    keyOverride: string | null = null,
  ): unknown {
    const symbolicOperands = operands.flatMap((operand) => {
      const node = this.getNode(operand);
      return node ? [node] : [];
    });
    const key =
      keyOverride ??
      `${operation}(${operands.map((operand) => this.describe(operand)).join(", ")})`;
    return this.intern({
      key,
      type,
      source: symbolicOperands[0]?.source ?? { kind: "native", description: operation },
      operation,
      operands: symbolicOperands,
    });
  }

  member(target: unknown, property: PropertyKey): unknown {
    const node = this.getNode(target);
    if (!node) return Reflect.get(Object(target), property);
    return this.memberOfNode(node, property);
  }

  memberOfNode(node: SymbolicNode, property: PropertyKey): unknown {
    if (node.writes.has(property)) return node.writes.get(property);
    const name = typeof property === "symbol" ? property.toString() : String(property);
    const cached = node.children.get(name);
    if (cached !== undefined) return cached;
    const isIndex = typeof property !== "symbol" && /^\d+$/.test(name);
    const child = this.intern({
      key: isIndex ? `${node.key}[${name}]` : `${node.key}.${name}`,
      type: PROPERTY_TYPES.get(name) ?? "unknown",
      source: node.source,
      operation: "member",
      operands: [node],
    });
    node.children.set(name, child);
    return child;
  }

  /** Calling a symbolic function: the result is symbolic, typed by the method name when it has one. */
  call(node: SymbolicNode, args: unknown[]): unknown {
    const name = node.key.slice(node.key.lastIndexOf(".") + 1);
    return this.derive(
      "call",
      args,
      STRING_METHOD_TYPES.get(name) ?? "unknown",
      `${node.key}(${args.map((argument) => this.describe(argument)).join(", ")})`,
    );
  }

  construct(node: SymbolicNode, args: unknown[]): unknown {
    return this.derive(
      "construct",
      args,
      "object",
      `new ${node.key}(${args.map((argument) => this.describe(argument)).join(", ")})`,
    );
  }

  /** The concrete stand-in a native receives for a symbolic it cannot take; recorded as a leak. */
  concretize(node: SymbolicNode, detail: string, hint: string | null = null): unknown {
    this.leak("concretized", node, detail);
    if (hint === "number") return 0;
    if (hint === "string") return "";
    return CONCRETE_BY_TYPE[node.type];
  }

  leak(kind: LeakKind, node: SymbolicNode, detail: string): void {
    this.leaks.push({ kind, symbolic: node.key, detail, site: captureLeakSite() });
  }

  private intern(spec: Omit<SymbolicNode, "id" | "writes" | "children">): unknown {
    const existing = this.proxiesByKey.get(spec.key);
    if (existing) return existing;
    const node: SymbolicNode = {
      ...spec,
      id: this.nextId++,
      writes: new Map(),
      children: new Map(),
    };
    const proxy = this.createProxy(node);
    this.nodesByProxy.set(proxy, node);
    this.proxiesByKey.set(spec.key, proxy);
    this.nodesByKey.set(spec.key, node);
    return proxy;
  }

  private createProxy(node: SymbolicNode): object {
    const handler: ProxyHandler<object> = {
      get: (_target, property) => {
        if (typeof property === "symbol") return this.getWellKnown(node, property);
        switch (property) {
          case "then":
          case "$$typeof":
          case "__esModule":
            return undefined;
          case "toJSON":
            return () => this.concretize(node, "JSON.stringify", "string");
          case "valueOf":
            return () => this.concretize(node, "valueOf");
          case "toString":
            return () => this.concretize(node, "toString", "string");
          default:
            return this.memberOfNode(node, property);
        }
      },
      set: (_target, property, value) => {
        node.writes.set(property, value);
        return true;
      },
      has: (_target, property) => {
        this.leak("concretized", node, `${String(property)} in symbolic`);
        return false;
      },
      deleteProperty: (_target, property) => {
        node.writes.set(property, undefined);
        return true;
      },
      defineProperty: (_target, property, descriptor) => {
        node.writes.set(property, descriptor.value);
        return true;
      },
      ownKeys: () => {
        this.leak("own-keys", node, "own keys enumerated by a native");
        return [];
      },
      getOwnPropertyDescriptor: () => {
        return undefined;
      },
    };
    return new Proxy({}, handler);
  }

  private getWellKnown(node: SymbolicNode, property: symbol): unknown {
    switch (property) {
      case Symbol.toPrimitive:
        return (hint: string) => this.concretize(node, `ToPrimitive(${hint})`, hint);
      case Symbol.iterator:
        return () => this.nativeIterator(node);
      case Symbol.asyncIterator:
        return undefined;
      case Symbol.toStringTag:
        return "Symbolic";
      case Symbol.hasInstance:
        return undefined;
      case inspectSymbol:
        return () => `Symbolic<${node.key}>`;
      default:
        return undefined;
    }
  }

  /** Destructuring pulls a fixed number of elements; anything pulling more is a native that gets a capped list. */
  private *nativeIterator(node: SymbolicNode): Generator<unknown> {
    for (let index = 0; index < MAX_NATIVE_ITERATION; index++) {
      yield this.memberOfNode(node, String(index));
    }
    this.leak("iterated", node, `iterated natively past ${MAX_NATIVE_ITERATION} elements`);
  }
}

const RUNTIME_FRAME = /[\\/]src[\\/]concolic[\\/]|node:internal|node_modules[\\/]happy-dom/;

const captureLeakSite = (): string | null => {
  const holder: { stack?: string } = {};
  Error.captureStackTrace(holder);
  const frames = (holder.stack ?? "").split("\n").slice(1);
  const frame = frames.find((line) => !RUNTIME_FRAME.test(line));
  return frame ? frame.trim().replace(/^at\s+/, "") : null;
};
