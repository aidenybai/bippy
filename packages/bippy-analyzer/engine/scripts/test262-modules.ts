import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import {
  FinishLoadingImportedModule,
  ManagedRealm,
  Realm,
  Construct,
  skipDebugger,
  surroundingAgent,
  Value,
  ThrowCompletion,
  type AbstractModuleRecord,
  type HostHooks,
  NormalCompletion,
} from "#engine";
import {
  test262ModuleLimit,
  test262ModuleByteLimit,
  type TestOutcome,
  type ModuleSource,
} from "./test262-input.js";

export class Test262ModuleError extends Error {
  constructor(
    readonly status: TestOutcome["status"],
    message: string,
  ) {
    super(message);
  }
}

const getResolutionError = (specifier: string): ThrowCompletion => {
  const completion = skipDebugger(
    Construct(surroundingAgent.intrinsic("%TypeError%"), [
      Value(`Cannot resolve module ${specifier}`),
    ]),
  );
  if (completion instanceof ThrowCompletion) return completion;
  return ThrowCompletion(completion instanceof NormalCompletion ? completion.Value : completion);
};

interface ModuleCache {
  records: Map<string, NormalCompletion<AbstractModuleRecord> | ThrowCompletion>;
}

export class Test262Modules {
  readonly entry: string;
  private readonly root: string;
  private readonly realms = new WeakMap<Realm, ModuleCache>();
  private loadedModules = 0;
  private readonly sources = new Map<string, string>();

  getSources = (): ModuleSource[] =>
    [...this.sources].map(([path, sourceHash]) => ({ path, sourceHash }));

  constructor(directory: string, path: string) {
    this.root = resolve(directory, "test");
    this.entry = resolve(this.root, path);
  }

  private isInside = (root: string, path: string): boolean => {
    const inside = relative(root, path);
    return (
      inside !== ".." &&
      !inside.startsWith("../") &&
      !inside.startsWith("..\\") &&
      !isAbsolute(inside)
    );
  };

  private getPath = (path: string): string | undefined => {
    const root = realpathSync(this.root);
    const normalized = this.isInside(this.root, path)
      ? resolve(root, relative(this.root, path))
      : path;
    if (!this.isInside(root, normalized))
      throw new Test262ModuleError(
        "unsupported",
        "Module dependency is outside the Test262 test tree",
      );
    try {
      const canonical = realpathSync(normalized);
      if (!this.isInside(root, canonical))
        throw new Test262ModuleError(
          "unsupported",
          "Module dependency is outside the Test262 test tree",
        );
      return canonical;
    } catch (error) {
      if (error instanceof Test262ModuleError) throw error;
      if (error && typeof error === "object" && Reflect.get(error, "code") === "ENOENT")
        return undefined;
      throw new Test262ModuleError(
        "harness-error",
        `Cannot read Test262 module ${path}: ${String(error)}`,
      );
    }
  };

  private getCache = (realm: Realm): ModuleCache => {
    let cache = this.realms.get(realm);
    if (!cache) {
      cache = { records: new Map() };
      this.realms.set(realm, cache);
    }
    return cache;
  };

  register = (completion: NormalCompletion<AbstractModuleRecord>): void => {
    const path = this.getPath(this.entry);
    if (!path) throw new Test262ModuleError("harness-error", "Test262 entry module is missing");
    this.getCache(completion.Value.Realm).records.set(path, completion);
  };

  load: NonNullable<HostHooks["HostLoadImportedModule"]> = (
    referrer,
    request,
    _hostDefined,
    payload,
  ) => {
    if (request.Phase !== "evaluation" || request.Attributes.length > 0)
      throw new Test262ModuleError(
        "unsupported",
        "Module source/defer phases and import attributes are not implemented",
      );
    const specifier = request.Specifier;
    if (!specifier.startsWith("./") && !specifier.startsWith("../")) {
      FinishLoadingImportedModule(referrer, request, payload, getResolutionError(specifier));
      return;
    }
    if (/[?#\\]/.test(specifier))
      throw new Test262ModuleError(
        "unsupported",
        "Only plain relative module specifiers are supported",
      );
    const realm = referrer instanceof Realm ? referrer : referrer.Realm;
    if (!(realm instanceof ManagedRealm))
      throw new Test262ModuleError("unsupported", "Module loading requires a managed realm");
    const base = referrer.HostDefined?.specifier ?? this.entry;
    const path = this.getPath(resolve(dirname(base), specifier));
    if (!path) {
      FinishLoadingImportedModule(referrer, request, payload, getResolutionError(specifier));
      return;
    }
    if (!/\.m?js$/.test(basename(path)))
      throw new Test262ModuleError("unsupported", "Only JavaScript module fixtures are supported");
    const cache = this.getCache(realm);
    let completion = cache.records.get(path);
    if (!completion) {
      if (++this.loadedModules > test262ModuleLimit)
        throw new Test262ModuleError("incomplete", "Test262 module budget exhausted");
      let source: string;
      try {
        const buffer = readFileSync(path);
        if (buffer.byteLength > test262ModuleByteLimit)
          throw new Test262ModuleError("incomplete", "Test262 module source budget exhausted");
        source = buffer.toString("utf8");
        const name = relative(realpathSync(this.root), path).replaceAll("\\", "/");
        const sourceHash = createHash("sha256").update(buffer).digest("hex");
        const previousHash = this.sources.get(name);
        if (previousHash && previousHash !== sourceHash)
          throw new Test262ModuleError("harness-error", "Module source changed during execution");
        this.sources.set(name, sourceHash);
      } catch (error) {
        if (error instanceof Test262ModuleError) throw error;
        throw new Test262ModuleError(
          "harness-error",
          `Cannot read Test262 module ${path}: ${String(error)}`,
        );
      }
      completion = realm.compileModule(source, { specifier: path });
      cache.records.set(path, completion);
    }
    FinishLoadingImportedModule(referrer, request, payload, completion);
  };
}
