import type { Instruction, Place, SourceLocation } from "../react-compiler/HIR/HIR";
import type { AliasingEffect } from "../react-compiler/Inference/AliasingEffects";
import { formatPlace } from "./format";
import type { InstructionValueOfKind, Interpreter } from "./interpret";
import { createUnknown } from "./symbolic-values";
import type {
  ArrayExpressionValue,
  Binding,
  BindingValue,
  GlobalValue,
  ObjectExpressionValue,
  SymbolicValue,
} from "./types";
import { getConditionallyMutatedPlace } from "./utils/get-conditionally-mutated-place";
import { getMutatedPlace } from "./utils/get-mutated-place";
import { isFunctionCreation } from "./utils/is-function-creation";
import { isStateBinding } from "./utils/is-state-binding";
import type { WalkState } from "./walk-state";

interface CreationPath {
  guards: SymbolicValue[];
  loopDepth: number;
}

const MAX_ALIAS_CHAIN_LENGTH = 32;

const isReassignedPlace = (instruction: Instruction, place: Place): boolean =>
  instruction.value.kind === "StoreContext" &&
  instruction.value.lvalue.place.identifier.id === place.identifier.id;

const isOwnedValue = (value: SymbolicValue): value is BindingValue =>
  value.kind === "Binding" && (value.binding.kind === "prop" || isStateBinding(value.binding));

const REF_TYPE_PATTERN = /\b(?:Mutable)?RefObject\b|\bForwardedRef\b|\bRef</;

const REF_CURRENT = "current";

const isRefWrite = (ownedValue: BindingValue, storedProperty: string | null): boolean => {
  const { domain } = ownedValue.binding;
  const writesCurrent = ownedValue.path[0] === REF_CURRENT || storedProperty === REF_CURRENT;
  return writesCurrent && domain.kind === "Opaque" && REF_TYPE_PATTERN.test(domain.typeText);
};

const getOwnedValues = (value: SymbolicValue): BindingValue[] => {
  if (value.kind === "Conditional")
    return [...getOwnedValues(value.consequent), ...getOwnedValues(value.alternate)];
  return isOwnedValue(value) ? [value] : [];
};

const getCopiedOwnedValue = (array: ArrayExpressionValue): BindingValue | null => {
  const [copiedValue] = array.spreads;
  return array.elements.length === 0 &&
    array.spreads.length === 1 &&
    copiedValue &&
    isOwnedValue(copiedValue)
    ? copiedValue
    : null;
};

export class MutationTracker {
  readonly #interpreter: Interpreter;
  readonly #creationPaths = new WeakMap<SymbolicValue, CreationPath>();

  constructor(interpreter: Interpreter) {
    this.#interpreter = interpreter;
  }

  recordCreation(value: SymbolicValue, walkState: WalkState): void {
    this.#creationPaths.set(value, {
      guards: walkState.guards,
      loopDepth: this.#interpreter.walker.loopDepth,
    });
  }

  track(instruction: Instruction, walkState: WalkState): void {
    if (isFunctionCreation(instruction.value)) return;
    const mutatedLiterals = new Set<SymbolicValue>();
    for (const effect of instruction.effects ?? []) {
      const mutatedPlace = getMutatedPlace(effect);
      if (mutatedPlace && isReassignedPlace(instruction, mutatedPlace)) continue;
      if (!mutatedPlace) {
        this.#trackPossibleMutation(effect);
        continue;
      }
      const mutatedValue = this.#interpreter.read(mutatedPlace);
      if (
        (mutatedValue.kind === "ArrayExpression" || mutatedValue.kind === "ObjectExpression") &&
        !mutatedLiterals.has(mutatedValue)
      ) {
        mutatedLiterals.add(
          this.#mutateLiteral(instruction, mutatedPlace, mutatedValue, walkState),
        );
        continue;
      }
      if (mutatedValue.kind === "Global") this.#trackGlobalMutation(mutatedValue, mutatedPlace.loc);
      const storedProperty =
        instruction.value.kind === "PropertyStore" ? String(instruction.value.property) : null;
      this.#trackOwnedValues(mutatedPlace, mutatedValue, mutatedPlace.loc, storedProperty);
    }
  }

  trackArgument(place: Place, loc: SourceLocation): void {
    this.#trackOwnedValues(place, this.#interpreter.read(place), loc, null);
  }

  #trackOwnedValues(
    place: Place,
    value: SymbolicValue,
    loc: SourceLocation,
    storedProperty: string | null,
  ): void {
    const ownedValues = getOwnedValues(value);
    const aliasedValue = ownedValues.length > 0 ? null : this.#findAliasedOwnedValue(place);
    for (const ownedValue of aliasedValue ? [aliasedValue] : ownedValues)
      this.#trackOwnedMutation(ownedValue, loc, storedProperty);
  }

  #trackOwnedMutation(
    ownedValue: BindingValue,
    loc: SourceLocation,
    storedProperty: string | null,
  ): void {
    const { binding } = ownedValue;
    if (binding.kind === "prop") {
      if (isRefWrite(ownedValue, storedProperty)) return;
      this.#interpreter.warn(
        "prop-mutation",
        `mutates prop ${formatPlace(binding, ownedValue.path)}`,
        loc,
        binding.propName,
      );
      return;
    }
    if (this.#interpreter.handlerEffects) {
      this.#interpreter.handlerEffects.addMutation(binding, loc);
      return;
    }
    this.#interpreter.warn("render-mutation", `mutates ${binding.name} during render`, loc);
  }

  recordAliasSources(instruction: Instruction): void {
    const { aliasSources } = this.#interpreter.getCompilationTables();
    for (const effect of instruction.effects ?? [])
      if (effect.kind === "Assign" || effect.kind === "Alias" || effect.kind === "CreateFrom")
        aliasSources.set(effect.into.identifier.id, effect.from);
  }

  #findAliasedOwnedValue(place: Place): BindingValue | null {
    const { aliasSources } = this.#interpreter.getCompilationTables();
    let source = aliasSources.get(place.identifier.id);
    for (let chainLength = 0; source && chainLength < MAX_ALIAS_CHAIN_LENGTH; chainLength++) {
      const sourceValue = this.#interpreter.read(source);
      if (isOwnedValue(sourceValue)) return sourceValue;
      if (sourceValue.kind === "ArrayExpression") return getCopiedOwnedValue(sourceValue);
      source = aliasSources.get(source.identifier.id);
    }
    return null;
  }

  #trackGlobalMutation(mutatedGlobal: GlobalValue, loc: SourceLocation): void {
    if (!this.#interpreter.handlerEffects) return;
    for (const binding of this.#interpreter.bindingTable.bindings)
      if (isStateBinding(binding) && this.#isInitializedFrom(binding, mutatedGlobal))
        this.#interpreter.handlerEffects.addMutation(binding, loc);
  }

  #isInitializedFrom(binding: Binding, mutatedGlobal: GlobalValue): boolean {
    const { initial } = binding;
    return (
      initial?.kind === "Global" &&
      initial.module === mutatedGlobal.module &&
      (mutatedGlobal.name === initial.name || mutatedGlobal.name.startsWith(`${initial.name}.`)) &&
      this.#interpreter.bindingTable.isDeclaredIn(binding, this.#interpreter.resolver.fileName)
    );
  }

  #trackPossibleMutation(effect: AliasingEffect): void {
    const possiblyMutatedPlace = getConditionallyMutatedPlace(effect);
    if (!possiblyMutatedPlace || possiblyMutatedPlace.identifier.type.kind === "Primitive") return;
    const possiblyMutatedValue = this.#interpreter.read(possiblyMutatedPlace);
    if (possiblyMutatedValue.kind === "Binding" && isStateBinding(possiblyMutatedValue.binding))
      this.#interpreter.handlerEffects?.addPossibleMutation(possiblyMutatedValue.binding);
  }

  #mutateLiteral(
    instruction: Instruction,
    mutatedPlace: Place,
    literal: ArrayExpressionValue | ObjectExpressionValue,
    walkState: WalkState,
  ): SymbolicValue {
    const creationPath = this.#creationPaths.get(literal);
    const isOnCreationPath =
      creationPath !== undefined &&
      creationPath.guards === walkState.guards &&
      creationPath.loopDepth === this.#interpreter.walker.loopDepth;
    const mutatedLiteral = this.#getMutatedLiteral(
      instruction,
      mutatedPlace,
      literal,
      isOnCreationPath,
    );
    if (isOnCreationPath) this.#creationPaths.set(mutatedLiteral, creationPath);
    const { values } = this.#interpreter.getCompilationTables();
    for (const [identifierId, value] of values)
      if (value === literal) values.set(identifierId, mutatedLiteral);
    return mutatedLiteral;
  }

  #getMutatedLiteral(
    instruction: Instruction,
    mutatedPlace: Place,
    literal: ArrayExpressionValue | ObjectExpressionValue,
    isOnCreationPath: boolean,
  ): SymbolicValue {
    const { value, loc } = instruction;
    const isPushIntoLiteral =
      literal.kind === "ArrayExpression" &&
      value.kind === "MethodCall" &&
      value.receiver.identifier.id === mutatedPlace.identifier.id &&
      this.#interpreter.getCompilationTables().propertyNames.get(value.property.identifier.id) ===
        "push";
    if (isPushIntoLiteral) return this.#pushIntoArray(literal, value, isOnCreationPath, loc);
    const isStoreIntoLiteral =
      literal.kind === "ObjectExpression" &&
      value.kind === "PropertyStore" &&
      value.object.identifier.id === mutatedPlace.identifier.id;
    if (isStoreIntoLiteral) return this.#storeIntoObject(literal, value, isOnCreationPath, loc);
    return createUnknown("mutation", loc);
  }

  #pushIntoArray(
    array: ArrayExpressionValue,
    push: InstructionValueOfKind<"MethodCall">,
    isOnCreationPath: boolean,
    loc: SourceLocation,
  ): ArrayExpressionValue {
    const pushedItems = push.args.flatMap((argument) =>
      argument.kind === "Identifier" ? [this.#interpreter.read(argument)] : [],
    );
    const pushedSpreads = push.args.flatMap((argument) =>
      argument.kind === "Spread" ? [this.#interpreter.read(argument.place)] : [],
    );
    if (isOnCreationPath)
      return {
        ...array,
        elements: [...array.elements, ...pushedItems],
        spreads: [...array.spreads, ...pushedSpreads],
      };
    const maybePushedItems = pushedItems.map((item): SymbolicValue => ({
      kind: "ArrayMap",
      array: createUnknown("mutation", loc),
      item,
      loc,
    }));
    return { ...array, spreads: [...array.spreads, ...pushedSpreads, ...maybePushedItems] };
  }

  #storeIntoObject(
    object: ObjectExpressionValue,
    store: InstructionValueOfKind<"PropertyStore">,
    isOnCreationPath: boolean,
    loc: SourceLocation,
  ): ObjectExpressionValue {
    const storedProperty = {
      key: String(store.property),
      value: isOnCreationPath
        ? this.#interpreter.read(store.value)
        : createUnknown("mutation", loc),
    };
    return { ...object, properties: [...object.properties, storedProperty] };
  }
}
