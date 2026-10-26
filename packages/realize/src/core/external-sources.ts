import type { HookKind } from "../react-compiler/HIR/ObjectShape";
import { assertExhaustive } from "../react-compiler/Utils/utils";
import type { SourceFileResolver } from "./source-file-resolver";
import type {
  Binding,
  BindingKind,
  ContextSetterFields,
  HookResultValue,
  Sample,
  StoreAssignment,
  StoreActions,
  StoreModel,
  SymbolicValue,
} from "./types";
import { UNDEFINED_VALUE, createUnknown } from "./symbolic-values";

const isDefinedSample = (sample: Sample): boolean =>
  sample.kind !== "Undefined" && !(sample.kind === "Value" && sample.value === null);

export const getHookBindingKind = (hookKind: HookKind): BindingKind =>
  hookKind === "useRef" ? "ref" : hookKind === "useContext" ? "context" : "hook";

export const getStoreFieldValue = (
  storeBinding: Binding,
  assignment: StoreAssignment,
  actionArguments: SymbolicValue[],
  readField: (field: string) => SymbolicValue,
): SymbolicValue => {
  const { field, value } = assignment;
  switch (value.kind) {
    case "Argument":
      return actionArguments[value.index] ?? UNDEFINED_VALUE;
    case "Literal":
      return { kind: "Primitive", value: value.value };
    case "Toggle":
      return { kind: "UnaryExpression", operator: "!", value: readField(field) };
    case "Unknown":
      return createUnknown("store", storeBinding.loc);
    default:
      return assertExhaustive(value, "Unhandled store field value");
  }
};

const EXTERNAL_STORE_HOOKS = new Map<string, string[]>([
  ["react", ["useSyncExternalStore"]],
  ["use-sync-external-store/shim", ["useSyncExternalStore"]],
  ["use-sync-external-store/shim/with-selector", ["useSyncExternalStoreWithSelector"]],
  ["use-sync-external-store/with-selector", ["useSyncExternalStoreWithSelector"]],
]);
export class ExternalSources {
  readonly #contextSetterFields: ContextSetterFields;
  readonly #modelsByStore: Map<string, StoreModel>;
  readonly #contextKeysByHook = new WeakMap<HookResultValue, string>();
  readonly #resolversByHook = new WeakMap<HookResultValue, SourceFileResolver>();
  readonly #setterFieldsByBinding = new Map<number, Map<string, string>>();
  readonly #modulesByBinding = new Map<number, string>();
  readonly #externalStoreIds = new Set<number>();
  readonly #bindingsByStore = new Map<string, Binding>();
  readonly #actionsByStoreBinding = new Map<number, StoreActions>();
  readonly contextSamples = new Map<string, Sample>();
  readonly untypedContextBindingIds = new Map<string, number>();
  readonly readContextKeys = new Set<string>();

  constructor(contextSetterFields: ContextSetterFields, modelsByStore: Map<string, StoreModel>) {
    this.#contextSetterFields = contextSetterFields;
    this.#modelsByStore = modelsByStore;
  }

  addHookResult(
    hook: HookResultValue,
    resolver: SourceFileResolver,
    contextKey: string | null,
  ): void {
    if (contextKey) this.#contextKeysByHook.set(hook, contextKey);
    this.#resolversByHook.set(hook, resolver);
  }

  getHookResolver(hook: HookResultValue): SourceFileResolver | undefined {
    return this.#resolversByHook.get(hook);
  }

  bindHookResult(binding: Binding, hook: HookResultValue, resolver: SourceFileResolver): void {
    if (hook.module !== null) this.#modulesByBinding.set(binding.id, hook.module);
    const isExternalStore =
      resolver.getReactExportName(hook.loc) === "useSyncExternalStore" ||
      (EXTERNAL_STORE_HOOKS.get(hook.module ?? "")?.includes(hook.name) ?? false);
    if (isExternalStore) this.#externalStoreIds.add(binding.id);
    const contextKey = this.#contextKeysByHook.get(hook);
    if (!contextKey) return;
    this.readContextKeys.add(contextKey);
    const setterFields = this.#contextSetterFields.get(contextKey);
    if (setterFields) this.#setterFieldsByBinding.set(binding.id, setterFields);
    if (binding.domain.kind === "Unknown") {
      if (!this.untypedContextBindingIds.has(contextKey))
        this.untypedContextBindingIds.set(contextKey, binding.id);
      return;
    }
    const contextSample = (this.#resolversByHook.get(hook) ?? resolver)
      .getSamples(binding.loc)
      .find(isDefinedSample);
    if (contextSample && !this.contextSamples.has(contextKey))
      this.contextSamples.set(contextKey, contextSample);
  }

  isExternalStore(binding: Binding): boolean {
    return this.#externalStoreIds.has(binding.id);
  }

  isFromSameModule(binding: Binding, otherBinding: Binding): boolean {
    const hookModule = this.#modulesByBinding.get(binding.id);
    return hookModule !== undefined && this.#modulesByBinding.get(otherBinding.id) === hookModule;
  }

  getSetterField(contextBinding: Binding, setterName: string): string | undefined {
    return this.#setterFieldsByBinding.get(contextBinding.id)?.get(setterName);
  }

  getStoreModel(storeKey: string): StoreModel | undefined {
    return this.#modelsByStore.get(storeKey);
  }

  getStoreBinding(storeKey: string, model: StoreModel, createBinding: () => Binding): Binding {
    const storeBinding = this.#bindingsByStore.get(storeKey) ?? createBinding();
    this.#bindingsByStore.set(storeKey, storeBinding);
    this.#actionsByStoreBinding.set(storeBinding.id, model.actions);
    return storeBinding;
  }

  isStoreBinding(binding: Binding): boolean {
    return this.#actionsByStoreBinding.has(binding.id);
  }

  getActionAssignments(storeBinding: Binding, actionName: string): StoreAssignment[] | undefined {
    return this.#actionsByStoreBinding.get(storeBinding.id)?.get(actionName);
  }
}
