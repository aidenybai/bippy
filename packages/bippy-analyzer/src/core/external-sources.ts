import type { HookKind } from "../react-compiler/HIR/ObjectShape";
import { assertExhaustive } from "../react-compiler/Utils/utils";
import type { DomainResolver } from "./infer-domains";
import type {
  Binding,
  BindingKind,
  ContextModels,
  HookResultValue,
  Sample,
  StoreAssignment,
  StoreModel,
  SymbolicValue,
} from "./types";
import { UNDEFINED_VALUE, createUnknown } from "./symbolic-values";

const isDefinedSample = (sample: Sample): boolean =>
  sample.kind !== "Undefined" && !(sample.kind === "Value" && sample.value === null);

export const getHookBindingKind = (hookKind: HookKind): BindingKind =>
  hookKind === "useRef" ? "ref" : hookKind === "useContext" ? "context" : "hook";

export const getStoreFieldValue = (
  binding: Binding,
  { field, value }: StoreAssignment,
  args: SymbolicValue[],
): SymbolicValue => {
  switch (value.kind) {
    case "Argument":
      return args[value.index] ?? UNDEFINED_VALUE;
    case "Literal":
      return { kind: "Primitive", value: value.value };
    case "Toggle":
      return {
        kind: "UnaryExpression",
        operator: "!",
        value: { kind: "Binding", binding, path: [field] },
      };
    case "Unknown":
      return createUnknown("store", binding.loc);
    default:
      return assertExhaustive(value, "Unhandled store field value");
  }
};

/** Hooks, contexts and stores: values that change from outside the component. */
export class ExternalSources {
  readonly #contextModels: ContextModels;
  readonly #storeModels: Map<string, StoreModel>;
  readonly #contextKeys = new WeakMap<HookResultValue, string>();
  readonly #hookResolvers = new WeakMap<HookResultValue, DomainResolver>();
  readonly #contextSetters = new Map<number, Map<string, string>>();
  readonly #hookModules = new Map<number, string>();
  readonly #storeBindings = new Map<string, Binding>();
  readonly #storeActions = new Map<number, StoreModel>();
  readonly contextSamples = new Map<string, Sample>();
  readonly untypedContexts = new Map<string, number>();

  constructor(contextModels: ContextModels, storeModels: Map<string, StoreModel>) {
    this.#contextModels = contextModels;
    this.#storeModels = storeModels;
  }

  addHookResult(hook: HookResultValue, resolver: DomainResolver, contextKey: string | null): void {
    if (contextKey) this.#contextKeys.set(hook, contextKey);
    this.#hookResolvers.set(hook, resolver);
  }

  getHookResolver(hook: HookResultValue): DomainResolver | undefined {
    return this.#hookResolvers.get(hook);
  }

  link(binding: Binding, hook: HookResultValue, resolver: DomainResolver): void {
    if (hook.module !== null) this.#hookModules.set(binding.id, hook.module);
    const contextKey = this.#contextKeys.get(hook);
    if (!contextKey) return;
    const setters = this.#contextModels.get(contextKey);
    if (setters) this.#contextSetters.set(binding.id, setters);
    if (binding.domain.kind === "Unknown") {
      if (!this.untypedContexts.has(contextKey)) this.untypedContexts.set(contextKey, binding.id);
      return;
    }
    const sample = (this.#hookResolvers.get(hook) ?? resolver)
      .getSamples(binding.loc)
      .find(isDefinedSample);
    if (sample && !this.contextSamples.has(contextKey)) this.contextSamples.set(contextKey, sample);
  }

  isFromSameModule(binding: Binding, other: Binding): boolean {
    const module = this.#hookModules.get(binding.id);
    return module !== undefined && this.#hookModules.get(other.id) === module;
  }

  getContextField(binding: Binding, member: string): string | undefined {
    return this.#contextSetters.get(binding.id)?.get(member);
  }

  getStoreModel(storeKey: string): StoreModel | undefined {
    return this.#storeModels.get(storeKey);
  }

  // Every read of one store shares one binding, so an action through any read sets its fields.
  bindStore(storeKey: string, model: StoreModel, createBinding: () => Binding): Binding {
    const binding = this.#storeBindings.get(storeKey) ?? createBinding();
    this.#storeBindings.set(storeKey, binding);
    this.#storeActions.set(binding.id, model);
    return binding;
  }

  getStoreAssignments(binding: Binding, member: string): StoreAssignment[] | undefined {
    return this.#storeActions.get(binding.id)?.get(member);
  }
}
