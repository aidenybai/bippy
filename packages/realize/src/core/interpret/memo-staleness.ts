import type {
  DeclarationId,
  HIRFunction,
  IdentifierId,
  ManualMemoDependency,
  Place,
  SourceLocation,
} from "../../react-compiler/HIR/HIR";
import type { CapturedValue } from "../compile/function-registry";
import type { InstructionValueOfKind, Interpreter } from "./interpret";
import { createBindingValue, createUnknown } from "../values/symbolic-values";
import type { BindingPlace, FunctionValue, JsxProp, JsxSpreadProp, SymbolicValue } from "../types";
import { forEachSymbolicValue } from "../values/for-each-symbolic-value";
import { getBindingPlace } from "../values/get-binding-place";
import { getClosureMutatedLocals } from "./get-closure-mutated-locals";
import { getDeclarationLocation } from "./get-declaration-location";
import { getIdentifierName } from "./get-identifier-name";
import { ALL_PROPS } from "./get-prop-holds";
import { getStoredLocals } from "./get-stored-locals";
import { getValuePlace } from "../values/get-value-place";
import { isPlacePrefix } from "../values/is-place-prefix";
import { PlaceMap } from "../values/place-map";

const getNullishTestPlaces = (
  value: SymbolicValue,
  capturedPlaces: PlaceMap<true>,
): PlaceMap<true> => {
  const nullishTests = new PlaceMap<number>();
  const reads = new PlaceMap<number>();
  forEachSymbolicValue(value, (part) => {
    if (part.kind === "Binding")
      reads.set(getValuePlace(part), (reads.get(getValuePlace(part)) ?? 0) + 1);
    if (
      part.kind === "Conditional" &&
      part.testKind === "nullish" &&
      part.test.kind === "Binding"
    ) {
      const place = getValuePlace(part.test);
      nullishTests.set(place, (nullishTests.get(place) ?? 0) + 1);
    }
  });
  return new PlaceMap(
    nullishTests
      .places()
      .filter((place) => nullishTests.get(place) === reads.get(place) && !capturedPlaces.has(place))
      .map((place): [BindingPlace, true] => [place, true]),
  );
};

export class MemoStaleness {
  readonly #interpreter: Interpreter;
  readonly #memoDependencies = new Map<number, Array<ManualMemoDependency> | null>();
  readonly #closureMutatedLocals = new WeakMap<HIRFunction, Map<IdentifierId, Place>>();
  readonly #storedLocals = new WeakMap<HIRFunction, Map<IdentifierId, Place>>();
  isInMemo = false;

  constructor(interpreter: Interpreter) {
    this.#interpreter = interpreter;
  }

  startMemoize(start: InstructionValueOfKind<"StartMemoize">): void {
    this.#memoDependencies.set(start.manualMemoId, start.deps);
  }

  bindMutatedMemo(finish: InstructionValueOfKind<"FinishMemoize">): void {
    const memoized = this.#interpreter.read(finish.decl);
    if (memoized.kind !== "ObjectExpression" && memoized.kind !== "ArrayExpression") return;
    const local = this.#getClosureMutatedLocals().get(finish.decl.identifier.id);
    if (!local) return;
    const binding = this.#interpreter.createBinding(
      getIdentifierName(local) ?? "memo",
      "memo",
      getDeclarationLocation(local),
      { hookKind: "useMemo", initial: memoized },
    );
    this.#interpreter.addStoredFunctions(createBindingValue(binding), memoized);
    this.#interpreter.write(finish.decl, createBindingValue(binding));
  }

  #getClosureMutatedLocals(): Map<IdentifierId, Place> {
    const hirFunction = this.#interpreter.getCurrentFunction();
    const cached = this.#closureMutatedLocals.get(hirFunction);
    if (cached) return cached;
    const locals = getClosureMutatedLocals(hirFunction);
    this.#closureMutatedLocals.set(hirFunction, locals);
    return locals;
  }

  finishMemoize(finish: InstructionValueOfKind<"FinishMemoize">): void {
    const dependencies = this.#memoDependencies.get(finish.manualMemoId);
    if (!dependencies) return;
    const memoized = this.#interpreter.read(finish.decl);
    const dependencyPlaces = new PlaceMap<true>();
    const dependencyDeclarations = new Set<DeclarationId>();
    for (const dependency of dependencies) {
      if (dependency.root.kind !== "NamedLocal") continue;
      dependencyDeclarations.add(dependency.root.value.identifier.declarationId);
      const root = this.#interpreter.read(dependency.root.value);
      if (root.kind !== "Binding") continue;
      const path = [...root.path, ...dependency.path.map((entry) => String(entry.property))];
      dependencyPlaces.set(getBindingPlace(root.binding, path), true);
    }
    if (memoized.kind === "Function") {
      this.#captureStaleReads(memoized, dependencyPlaces, dependencyDeclarations, finish.loc);
      return;
    }
    if (!this.#isStaleMemo(memoized, dependencyPlaces)) return;
    forEachSymbolicValue(memoized, (part) => {
      if (part.kind === "Function")
        this.#captureStaleReads(part, dependencyPlaces, dependencyDeclarations, finish.loc);
    });
    this.#interpreter.write(finish.decl, this.#createStaleMemo(memoized, finish.decl));
  }

  #createStaleMemo(memoized: SymbolicValue, decl: Place): SymbolicValue {
    const hirFunction = this.#interpreter.getCurrentFunction();
    const storedLocals = this.#storedLocals.get(hirFunction) ?? getStoredLocals(hirFunction);
    this.#storedLocals.set(hirFunction, storedLocals);
    const local = storedLocals.get(decl.identifier.id) ?? decl;
    const inputPlaces = new PlaceMap<true>();
    this.#interpreter.collectInputPlaces(memoized, inputPlaces);
    const memo = createBindingValue(
      this.#interpreter.createBinding(
        getIdentifierName(local) ?? "memo",
        "call",
        getDeclarationLocation(local),
        {
          hookKind: "useMemo",
          initial: memoized,
          inputPlaces: inputPlaces.places(),
        },
      ),
    );
    this.#interpreter.addStoredFunctions(memo, memoized);
    return memo;
  }

  #captureStaleReads(
    callback: FunctionValue,
    dependencyPlaces: PlaceMap<true>,
    dependencyDeclarations: Set<DeclarationId>,
    loc: SourceLocation,
    visitedFunctionIds = new Set<number>(),
  ): void {
    if (visitedFunctionIds.has(callback.functionId)) return;
    visitedFunctionIds.add(callback.functionId);
    const context = this.#interpreter.functions.get(callback.functionId)?.context ?? [];
    const capturedValues = new Map(
      this.#interpreter.functions
        .getCapturedValues(callback.functionId)
        .map(([place, value]) => [place.identifier.id, value]),
    );
    const staleValues = context.flatMap((place): CapturedValue[] => {
      const value = capturedValues.get(place.identifier.id) ?? this.#interpreter.read(place);
      if (dependencyDeclarations.has(place.identifier.declarationId)) return [];
      if (value.kind === "Function") {
        this.#captureStaleReads(
          value,
          dependencyPlaces,
          dependencyDeclarations,
          loc,
          visitedFunctionIds,
        );
        return [];
      }
      if (value.kind !== "Unknown" && !this.#isStaleMemo(value, dependencyPlaces)) return [];
      return [[place, createUnknown("memo", loc)]];
    });
    if (staleValues.length === 0) return;
    const staleIds = new Set(staleValues.map(([place]) => place.identifier.id));
    const keptValues = this.#interpreter.functions
      .getCapturedValues(callback.functionId)
      .filter(([place]) => !staleIds.has(place.identifier.id));
    this.#interpreter.functions.setCapturedValues(callback.functionId, [
      ...keptValues,
      ...staleValues,
    ]);
  }

  captureHeldProps(props: Array<JsxProp | JsxSpreadProp>, heldProps: ReadonlySet<string>): void {
    for (const prop of props)
      if (
        heldProps.has(ALL_PROPS) ||
        (prop.kind === "JsxAttribute" ? heldProps.has(prop.name) : heldProps.size > 0)
      )
        forEachSymbolicValue(prop.value, (part) => {
          if (part.kind === "Function")
            this.#captureStaleReads(part, new PlaceMap(), new Set(), prop.loc);
        });
  }

  #isStaleMemo(memoized: SymbolicValue, dependencyPlaces: PlaceMap<true>): boolean {
    const readPlaces = new PlaceMap<true>();
    this.#interpreter.collectInputPlaces(memoized, readPlaces);
    const bindingsById = new Map(
      this.#interpreter.bindingTable.bindings.map((binding) => [binding.id, binding]),
    );
    const capturedPlaces = new PlaceMap<true>();
    forEachSymbolicValue(memoized, (part) => {
      if (part.kind !== "Function") return;
      for (const capturedPlace of this.#interpreter.functions.get(part.functionId)?.context ?? [])
        this.#interpreter.collectInputPlaces(this.#interpreter.read(capturedPlace), capturedPlaces);
    });
    const nullishTestPlaces = getNullishTestPlaces(memoized, capturedPlaces);
    const isCovered = (place: BindingPlace, visited = new Set<number>()): boolean => {
      if (dependencyPlaces.places().some((dependency) => isPlacePrefix(dependency, place)))
        return true;
      const isOptionalChainBase =
        nullishTestPlaces.has(place) &&
        dependencyPlaces.places().some((dependency) => isPlacePrefix(place, dependency));
      if (isOptionalChainBase) return true;
      const binding = bindingsById.get(place.bindingId);
      if (!binding || binding.kind === "ref" || visited.has(binding.id))
        return binding?.kind === "ref";
      visited.add(binding.id);
      const inputPlaces =
        binding.kind === "item"
          ? (this.#interpreter.getItemSources(binding)?.places() ?? [])
          : binding.kind === "call" || binding.kind === "loop"
            ? binding.inputPlaces
            : [];
      return (
        inputPlaces.length > 0 && inputPlaces.every((inputPlace) => isCovered(inputPlace, visited))
      );
    };
    return readPlaces.places().some((place) => !isCovered(place));
  }
}
