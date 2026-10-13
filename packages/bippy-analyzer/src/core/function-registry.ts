import type { HIRFunction, Place } from "../react-compiler/HIR/HIR";
import type { DomainResolver } from "./infer-domains";
import type { FunctionValue, SymbolicValue } from "./types";

export interface ModuleFunctionLoader {
  (functionName: string): HIRFunction | null;
}

export type CapturedValue = [Place, SymbolicValue];

export class FunctionRegistry {
  readonly #functions: HIRFunction[] = [];
  readonly #idsByFunction = new Map<HIRFunction, number>();
  readonly #resolversByFunction = new WeakMap<HIRFunction, DomainResolver>();
  readonly #loadersByModule = new Map<DomainResolver, ModuleFunctionLoader>();
  readonly #capturedValuesById = new Map<number, CapturedValue[]>();

  get(functionId: number): HIRFunction | null {
    return this.#functions[functionId] ?? null;
  }

  register(hirFunction: HIRFunction, resolver: DomainResolver, isSnapshot = false): FunctionValue {
    if (!this.#resolversByFunction.has(hirFunction))
      this.#resolversByFunction.set(hirFunction, resolver);
    const existingId = isSnapshot ? undefined : this.#idsByFunction.get(hirFunction);
    if (existingId !== undefined)
      return { kind: "Function", functionId: existingId, loc: hirFunction.loc };
    this.#functions.push(hirFunction);
    const functionId = this.#functions.length - 1;
    if (!isSnapshot) this.#idsByFunction.set(hirFunction, functionId);
    return { kind: "Function", functionId, loc: hirFunction.loc };
  }

  getResolver(hirFunction: HIRFunction): DomainResolver | undefined {
    return this.#resolversByFunction.get(hirFunction);
  }

  addModule(
    resolver: DomainResolver,
    loadModuleFunction: ModuleFunctionLoader,
    hirFunction: HIRFunction | null = null,
  ): void {
    if (hirFunction) this.#resolversByFunction.set(hirFunction, resolver);
    this.#loadersByModule.set(resolver, loadModuleFunction);
  }

  loadModuleFunction(resolver: DomainResolver, functionName: string): HIRFunction | null {
    return this.#loadersByModule.get(resolver)?.(functionName) ?? null;
  }

  setCapturedValues(functionId: number, capturedValues: CapturedValue[]): void {
    this.#capturedValuesById.set(functionId, capturedValues);
  }

  getCapturedValues(functionId: number | null): CapturedValue[] {
    return functionId === null ? [] : (this.#capturedValuesById.get(functionId) ?? []);
  }
}
