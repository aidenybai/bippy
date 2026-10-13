import type { HIRFunction, Place } from "../react-compiler/HIR/HIR";
import type { DomainResolver } from "./infer-domains";
import type { FunctionValue, SymbolicValue } from "./types";

export type ModuleFunctionLoader = (name: string) => HIRFunction | null;

/** Functions values refer to by id, with the file each came from and what each closure captured. */
export class FunctionRegistry {
  readonly #functions: HIRFunction[] = [];
  readonly #functionIds = new Map<HIRFunction, number>();
  readonly #resolvers = new WeakMap<HIRFunction, DomainResolver>();
  readonly #moduleFunctionLoaders = new Map<DomainResolver, ModuleFunctionLoader>();
  readonly #captures = new Map<number, Array<[Place, SymbolicValue]>>();

  get(functionId: number): HIRFunction | null {
    return this.#functions[functionId] ?? null;
  }

  register(fn: HIRFunction, resolver: DomainResolver, isSnapshot = false): FunctionValue {
    if (!this.#resolvers.has(fn)) this.#resolvers.set(fn, resolver);
    const existingId = isSnapshot ? undefined : this.#functionIds.get(fn);
    if (existingId !== undefined) return { kind: "Function", functionId: existingId, loc: fn.loc };
    this.#functions.push(fn);
    const functionId = this.#functions.length - 1;
    if (!isSnapshot) this.#functionIds.set(fn, functionId);
    return { kind: "Function", functionId, loc: fn.loc };
  }

  getResolver(fn: HIRFunction): DomainResolver | undefined {
    return this.#resolvers.get(fn);
  }

  addModule(
    resolver: DomainResolver,
    loadModuleFunction: ModuleFunctionLoader,
    fn: HIRFunction | null = null,
  ): void {
    if (fn) this.#resolvers.set(fn, resolver);
    this.#moduleFunctionLoaders.set(resolver, loadModuleFunction);
  }

  loadModuleFunction(resolver: DomainResolver, name: string): HIRFunction | null {
    return this.#moduleFunctionLoaders.get(resolver)?.(name) ?? null;
  }

  setCaptures(functionId: number, captures: Array<[Place, SymbolicValue]>): void {
    this.#captures.set(functionId, captures);
  }

  getCaptures(functionId: number | null): Array<[Place, SymbolicValue]> {
    return functionId === null ? [] : (this.#captures.get(functionId) ?? []);
  }
}
