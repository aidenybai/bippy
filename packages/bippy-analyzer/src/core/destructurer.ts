import type { ArrayPattern, ObjectPattern, Place, SourceLocation } from "../react-compiler/HIR/HIR";
import type { HookKind } from "../react-compiler/HIR/ObjectShape";
import { getHookBindingKind } from "./external-sources";
import type { InstructionValueOfKind, Interpreter } from "./interpret";
import {
  START_TRANSITION_VALUE,
  UNDEFINED_VALUE,
  createBindingValue,
  createUnknown,
} from "./symbolic-values";
import type { BindingValue, Domain, HookResultValue, Sample, SymbolicValue } from "./types";
import { getDeclarationLocation } from "./utils/get-declaration-location";
import { getIdentifierName } from "./utils/get-identifier-name";
import { getPlaceOrSpread } from "./utils/get-place-or-spread";

const STATE_HOOKS = new Set<HookKind>(["useState", "useOptimistic"]);

const REDUCER_HOOKS = new Set<HookKind>(["useReducer", "useActionState"]);

const ASSERTED_DOMAIN: Domain = { kind: "Unknown", reason: "cast" };

interface StateSlot {
  name: string;
  loc: SourceLocation;
  domain: Domain | null;
}

const getHoleStateName = (setterPlace: Place | null): string => {
  const setterName = setterPlace && getIdentifierName(setterPlace);
  const named = setterName && /^set([A-Z].*)$/.exec(setterName);
  return named ? named[1].charAt(0).toLowerCase() + named[1].slice(1) : "state";
};

export class Destructurer {
  readonly #interpreter: Interpreter;
  #restPropsSample: Sample | null = null;

  constructor(interpreter: Interpreter) {
    this.#interpreter = interpreter;
  }

  get restPropsSample(): Sample | null {
    return this.#restPropsSample;
  }

  bindHookResult(place: Place, hook: HookResultValue): BindingValue {
    const binding = this.#interpreter.createBinding(
      getIdentifierName(place) ?? hook.name,
      getHookBindingKind(hook.hookKind),
      getDeclarationLocation(place),
      { hookKind: hook.hookKind },
    );
    this.#interpreter.externalSources.bindHookResult(binding, hook, this.#interpreter.resolver);
    return createBindingValue(binding);
  }

  #getDestructuredValues(
    itemPlaces: Array<Place | null>,
    value: SymbolicValue,
    loc: SourceLocation,
  ): Array<SymbolicValue | null> {
    if (value.kind === "ArrayExpression" && value.spreads.length === 0)
      return itemPlaces.map((_itemPlace, index) => value.elements[index] ?? UNDEFINED_VALUE);
    if (value.kind !== "HookResult") return itemPlaces.map(() => null);
    if (value.hookKind === "useTransition")
      return itemPlaces.map((place, index) =>
        index === 1 ? START_TRANSITION_VALUE : place ? this.bindHookResult(place, value) : null,
      );
    const [statePlace, setterPlace] = itemPlaces;
    const slot: StateSlot | null = statePlace
      ? { name: getIdentifierName(statePlace) ?? "state", loc: statePlace.loc, domain: null }
      : setterPlace && {
          name: getHoleStateName(setterPlace),
          loc: value.loc,
          domain: this.#interpreter.resolver.getTupleElementDomain(value.loc, 0),
        };
    if (STATE_HOOKS.has(value.hookKind) && slot)
      return this.#destructureState(value, slot, setterPlace ?? null);
    if (REDUCER_HOOKS.has(value.hookKind) && slot)
      return this.#destructureReducer(value, slot, itemPlaces[2] ?? null, loc);
    return itemPlaces.map((place) => (place ? this.bindHookResult(place, value) : null));
  }

  #destructureState(
    hook: HookResultValue,
    slot: StateSlot,
    setterPlace: Place | null,
  ): SymbolicValue[] {
    const [initialArgument] = hook.argumentValues;
    if (!setterPlace && initialArgument?.kind === "Function") return [initialArgument];
    const initial = initialArgument && initialArgument.kind !== "Function" ? initialArgument : null;
    const isAsserted = initial?.kind === "Unknown" && initial.reason === "cast";
    const binding = this.#interpreter.createBinding(slot.name, "state", slot.loc, {
      hookKind: hook.hookKind,
      initial,
      ...(slot.domain && { domain: slot.domain }),
      ...(isAsserted && { domain: ASSERTED_DOMAIN }),
    });
    return [createBindingValue(binding), { kind: "Setter", binding }];
  }

  #destructureReducer(
    hook: HookResultValue,
    slot: StateSlot,
    pendingPlace: Place | null,
    loc: SourceLocation,
  ): Array<SymbolicValue | null> {
    const [reducerArgument, initialArgument] = hook.argumentValues;
    const binding = this.#interpreter.createBinding(slot.name, "reducer", slot.loc, {
      hookKind: hook.hookKind,
      initial: initialArgument ?? null,
      ...(slot.domain && { domain: slot.domain }),
    });
    const reducer = reducerArgument
      ? this.#interpreter.resolveModuleFunction(reducerArgument)
      : createUnknown("reducer", loc);
    const pending = pendingPlace
      ? this.#interpreter.createBinding(
          getIdentifierName(pendingPlace) ?? "isPending",
          "hook",
          pendingPlace.loc,
          {
            hookKind: hook.hookKind,
          },
        )
      : null;
    return [
      createBindingValue(binding),
      { kind: "Dispatch", binding, reducer, pending },
      pending ? createBindingValue(pending) : null,
    ];
  }

  destructure(instruction: InstructionValueOfKind<"Destructure">): void {
    const { pattern } = instruction.lvalue;
    const value = this.#interpreter.read(instruction.value);
    if (pattern.kind === "ObjectPattern") {
      this.#destructureObject(pattern, value);
      return;
    }
    this.#destructureArray(pattern, value, instruction.loc);
  }

  #destructureArray(pattern: ArrayPattern, value: SymbolicValue, loc: SourceLocation): void {
    const itemPlaces = pattern.items.map((item) => (item.kind === "Identifier" ? item : null));
    const destructuredValues = this.#getDestructuredValues(itemPlaces, value, loc);
    pattern.items.forEach((item, itemIndex) => {
      if (item.kind === "Hole") return;
      const itemPlace = getPlaceOrSpread(item);
      this.#interpreter.write(
        itemPlace,
        destructuredValues[itemIndex] ?? createUnknown("destructure", itemPlace.loc),
      );
    });
  }

  #destructureObject(pattern: ObjectPattern, value: SymbolicValue): void {
    for (const property of pattern.properties) {
      if (property.kind === "Spread") {
        if (value.kind === "Props")
          this.#restPropsSample ??= this.#interpreter.resolver.getRequiredSample(
            property.place.loc,
          );
        this.#interpreter.write(property.place, createUnknown("rest", property.place.loc));
        continue;
      }
      const key =
        property.key.kind === "string" || property.key.kind === "identifier"
          ? property.key.name
          : null;
      this.#interpreter.write(
        property.place,
        key === null
          ? createUnknown("computed-key", property.place.loc)
          : this.#getDestructuredField(value, key, property.place),
      );
    }
  }

  #getDestructuredField(value: SymbolicValue, key: string, fieldPlace: Place): SymbolicValue {
    if (value.kind === "Props") {
      const localName = getIdentifierName(fieldPlace) ?? key;
      return createBindingValue(this.#interpreter.getPropBinding(key, localName, fieldPlace.loc));
    }
    if (value.kind === "HookResult") {
      const hookCallBinding = this.#interpreter.createBinding(
        `${value.name}()`,
        getHookBindingKind(value.hookKind),
        value.loc,
        {
          hookKind: value.hookKind,
          resolver: this.#interpreter.externalSources.getHookResolver(value),
        },
      );
      this.#interpreter.externalSources.bindHookResult(
        hookCallBinding,
        value,
        this.#interpreter.resolver,
      );
      return this.#interpreter.readField(hookCallBinding, [key], fieldPlace.loc);
    }
    return this.#interpreter.evaluatePropertyLoad(value, key, fieldPlace.loc);
  }
}
