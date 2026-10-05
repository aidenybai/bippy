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

  constructor(closure: object, captures: () => CaptureManifest) {
    super(closure);
    this.#captures = captures;
  }

  static register = (closure: object, captures: () => CaptureManifest): void => {
    if (#captures in closure) closure.#captures = captures;
    else new NativeClosure(closure, captures);
  };

  static get = (closure: object): CaptureManifest | undefined =>
    #captures in closure ? closure.#captures() : undefined;
}

export const registerNativeClosure = <Closure extends object>(
  closure: Closure,
  captures: () => CaptureManifest,
): Closure => {
  if (typeof closure !== "function") throw new TypeError("Expected a native closure");
  NativeClosure.register(closure, captures);
  return closure;
};

export const getNativeCaptures = (closure: unknown): CaptureManifest | undefined => {
  if (typeof closure !== "function") return undefined;
  return NativeClosure.get(closure);
};
