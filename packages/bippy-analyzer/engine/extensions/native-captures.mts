export interface CapturedBinding {
  name: string;
  get: () => unknown;
  set?: (value: unknown) => void;
}

export interface CaptureManifest {
  bindings: readonly CapturedBinding[];
  ambientNames: readonly string[];
}

class ClosureTarget {
  constructor(closure: object) {
    // HACK: A derived private field attaches metadata without changing function identity, prototypes, or own keys.
    return closure;
  }
}

class NativeClosure extends ClosureTarget {
  #captures: () => CaptureManifest;
  #sourceModule: string | undefined;

  constructor(closure: object, captures: () => CaptureManifest, sourceModule?: string) {
    super(closure);
    this.#captures = captures;
    this.#sourceModule = sourceModule;
  }

  static register = (
    closure: object,
    captures: () => CaptureManifest,
    sourceModule?: string,
  ): void => {
    if (typeof closure !== "function") throw new TypeError("Expected a native closure");
    if (#captures in closure) {
      closure.#captures = captures;
      closure.#sourceModule = sourceModule;
    } else new NativeClosure(closure, captures, sourceModule);
  };

  static getSourceModule = (closure: object): string | undefined =>
    #sourceModule in closure ? closure.#sourceModule : undefined;

  static get = (closure: object): CaptureManifest | undefined =>
    #captures in closure ? closure.#captures() : undefined;
}

export const registerNativeClosure = <Closure extends object>(
  closure: Closure,
  captures: () => CaptureManifest,
): Closure => {
  NativeClosure.register(closure, captures);
  return closure;
};

export const registerEngineClosure = <Closure extends object>(
  closure: Closure,
  captures: () => CaptureManifest,
  sourceModule: string,
): Closure => {
  NativeClosure.register(closure, captures, sourceModule);
  return closure;
};

export const getNativeSourceModule = (closure: unknown): string | undefined => {
  if (typeof closure !== "function") return undefined;
  return NativeClosure.getSourceModule(closure);
};

export const getNativeCaptures = (closure: unknown): CaptureManifest | undefined => {
  if (typeof closure !== "function") return undefined;
  return NativeClosure.get(closure);
};
