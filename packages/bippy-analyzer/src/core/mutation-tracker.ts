import { ValueKind } from "../react-compiler/HIR/HIR";
import type { Instruction, Place, SourceLocation } from "../react-compiler/HIR/HIR";
import type { AliasingEffect } from "../react-compiler/Inference/AliasingEffects";
import { formatPlace } from "./format";
import type { InstructionValueOfKind, Interpreter } from "./interpret";
import { createUnknown } from "./symbolic-values";
import type {
  AbstractValue,
  ArrayExpressionValue,
  Binding,
  BindingValue,
  CollectionValue,
  Domain,
  GlobalValue,
  ObjectExpressionValue,
  SymbolicValue,
} from "./types";
import { getConditionallyMutatedPlace } from "./utils/get-conditionally-mutated-place";
import { getMutatedPlace } from "./utils/get-mutated-place";
import { isFunctionCreation } from "./utils/is-function-creation";
import { isStateBinding } from "./utils/is-state-binding";
import { isCollectionWrite } from "./utils/literal-receivers";
import type { WalkState } from "./walk-state";

interface CreationPath {
  guards: SymbolicValue[];
  loopDepth: number;
  isInHandler: boolean;
}

const MAX_ALIAS_CHAIN_LENGTH = 32;

const ELEMENT_METHODS = new Set(["find", "findLast", "at"]);

const COPYING_METHODS = new Set([
  "filter",
  "slice",
  "toSorted",
  "toReversed",
  "toSpliced",
  "concat",
  "with",
  "reverse",
  "sort",
  "flat",
]);

const COPYING_STATICS = new Set(["Array.from", "Object.values", "Object.entries"]);

const isReassignedPlace = (instruction: Instruction, place: Place): boolean =>
  instruction.value.kind === "StoreContext" &&
  instruction.value.lvalue.place.identifier.id === place.identifier.id;

const isOwnedValue = (value: SymbolicValue): value is BindingValue =>
  value.kind === "Binding" &&
  (value.binding.kind === "prop" ||
    value.binding.kind === "context" ||
    isStateBinding(value.binding));

const REF_TYPE_PATTERN = /\b(?:Mutable)?RefObject\b|\bForwardedRef\b|\bRef</;

const REF_CURRENT = "current";

const isRefCase = (value: AbstractValue): boolean =>
  value.kind === "Literal"
    ? value.value === null || value.value === undefined
    : REF_TYPE_PATTERN.test(value.text) || value.text.includes("=>");

const isRefDomain = (domain: Domain): boolean => {
  if (domain.kind === "Opaque") return REF_TYPE_PATTERN.test(domain.typeText);
  return (
    domain.kind === "Cases" &&
    domain.cases.some((value) => value.kind === "Type" && REF_TYPE_PATTERN.test(value.text)) &&
    domain.cases.every(isRefCase)
  );
};

const isRefWrite = (ownedValue: BindingValue, storedProperty: string | null): boolean => {
  const passesWholeRef = ownedValue.path.length === 0 && storedProperty === null;
  const writesCurrent =
    ownedValue.path[0] === REF_CURRENT || storedProperty === REF_CURRENT || passesWholeRef;
  return writesCurrent && isRefDomain(ownedValue.binding.domain);
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

const isTransitiveMutation = (effect: AliasingEffect): boolean =>
  effect.kind === "MutateTransitive" || effect.kind === "MutateTransitiveConditionally";

type MutableLiteral = ArrayExpressionValue | ObjectExpressionValue | CollectionValue;

const isMutableLiteral = (value: SymbolicValue): value is MutableLiteral =>
  value.kind === "ArrayExpression" ||
  value.kind === "ObjectExpression" ||
  value.kind === "Collection";

const getNestedValues = (literal: MutableLiteral): SymbolicValue[] => {
  if (literal.kind === "ArrayExpression") return literal.elements;
  return literal.kind === "ObjectExpression"
    ? literal.properties.map((property) => property.value)
    : [];
};

export class MutationTracker {
  readonly #interpreter: Interpreter;
  readonly #creationPaths = new WeakMap<SymbolicValue, CreationPath>();
  readonly #frozenValues = new WeakSet<SymbolicValue>();

  constructor(interpreter: Interpreter) {
    this.#interpreter = interpreter;
  }

  recordCreation(value: SymbolicValue, walkState: WalkState): void {
    this.#creationPaths.set(value, {
      guards: walkState.guards,
      loopDepth: this.#interpreter.walker.loopDepth,
      isInHandler: this.#interpreter.handlerEffects !== null,
    });
  }

  track(instruction: Instruction, walkState: WalkState): void {
    if (isFunctionCreation(instruction.value)) return;
    const mutatedLiterals = new Set<SymbolicValue>();
    for (const effect of instruction.effects ?? []) {
      const mutatedPlace = getMutatedPlace(effect);
      if (!mutatedPlace || isReassignedPlace(instruction, mutatedPlace)) continue;
      const mutatedValue = this.#interpreter.read(mutatedPlace);
      if (isMutableLiteral(mutatedValue) && !mutatedLiterals.has(mutatedValue)) {
        mutatedLiterals.add(
          this.#mutateLiteral(instruction, mutatedPlace, mutatedValue, walkState),
        );
        if (isTransitiveMutation(effect)) this.#forgetNestedLiterals(mutatedValue, instruction.loc);
        continue;
      }
      if (mutatedValue.kind === "Global") this.#trackGlobalMutation(mutatedValue, mutatedPlace.loc);
      const storedProperty =
        instruction.value.kind === "PropertyStore" ? String(instruction.value.property) : null;
      this.#trackOwnedValues(
        mutatedPlace,
        mutatedValue,
        mutatedPlace.loc,
        storedProperty,
        effect.kind === "MutateFrozen",
      );
    }
  }

  trackPossibleMutations(instruction: Instruction, walkState: WalkState): void {
    if (isFunctionCreation(instruction.value)) return;
    for (const effect of instruction.effects ?? []) {
      if (effect.kind === "Freeze") this.#freeze(this.#interpreter.read(effect.value));
      if (effect.kind === "Create" && effect.value === ValueKind.Frozen)
        this.#freeze(this.#interpreter.read(effect.into));
      const possiblyMutatedPlace = getConditionallyMutatedPlace(effect);
      if (
        !possiblyMutatedPlace ||
        possiblyMutatedPlace.identifier.type.kind === "Primitive" ||
        isReassignedPlace(instruction, possiblyMutatedPlace)
      )
        continue;
      const possiblyMutatedValue = this.#interpreter.read(possiblyMutatedPlace);
      if (this.#frozenValues.has(possiblyMutatedValue)) continue;
      if (isMutableLiteral(possiblyMutatedValue)) {
        this.#mutateLiteral(instruction, possiblyMutatedPlace, possiblyMutatedValue, walkState);
        if (isTransitiveMutation(effect))
          this.#forgetNestedLiterals(possiblyMutatedValue, instruction.loc);
        continue;
      }
      if (possiblyMutatedValue.kind === "Binding" && isStateBinding(possiblyMutatedValue.binding))
        this.#interpreter.handlerEffects?.addPossibleMutation(possiblyMutatedValue.binding);
    }
  }

  #freeze(value: SymbolicValue): void {
    if (value.kind === "Conditional") {
      this.#freeze(value.consequent);
      this.#freeze(value.alternate);
      return;
    }
    if (!isMutableLiteral(value) || this.#frozenValues.has(value)) return;
    this.#frozenValues.add(value);
    for (const nestedValue of getNestedValues(value)) this.#freeze(nestedValue);
  }

  #forgetNestedLiterals(literal: MutableLiteral, loc: SourceLocation): void {
    const { values } = this.#interpreter.getCompilationTables();
    for (const nestedValue of getNestedValues(literal)) {
      if (!isMutableLiteral(nestedValue) || this.#frozenValues.has(nestedValue)) continue;
      this.#forgetNestedLiterals(nestedValue, loc);
      for (const [identifierId, value] of values)
        if (value === nestedValue) values.set(identifierId, createUnknown("mutation", loc));
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
    isFrozen = false,
  ): void {
    const ownedValues = getOwnedValues(value);
    const aliasedValue =
      ownedValues.length > 0 ? null : this.#findAliasedOwnedValue(place, isFrozen);
    for (const ownedValue of aliasedValue ? [aliasedValue] : ownedValues)
      this.#trackOwnedMutation(ownedValue, loc, storedProperty);
  }

  #trackOwnedMutation(
    ownedValue: BindingValue,
    loc: SourceLocation,
    storedProperty: string | null,
  ): void {
    const { binding } = ownedValue;
    if (binding.kind === "context") {
      this.#interpreter.warn(
        "context-mutation",
        `mutates context value ${formatPlace(binding, ownedValue.path)}`,
        loc,
      );
      return;
    }
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
    const { aliasSources, elementSources, frozenSources, itemSources, propertyNames } =
      this.#interpreter.getCompilationTables();
    const getElementSource = (place: Place): Place =>
      elementSources.get(place.identifier.id) ?? place;
    const resultId = instruction.lvalue.identifier.id;
    for (const effect of instruction.effects ?? []) {
      if (effect.kind === "Assign" || effect.kind === "Alias") {
        aliasSources.set(effect.into.identifier.id, effect.from);
        const fromElements = elementSources.get(effect.from.identifier.id);
        if (fromElements) elementSources.set(effect.into.identifier.id, fromElements);
      }
      if (effect.kind === "CreateFrom")
        aliasSources.set(effect.into.identifier.id, getElementSource(effect.from));
      if (effect.kind === "ImmutableCapture")
        frozenSources.set(effect.into.identifier.id, effect.from);
    }
    const { value } = instruction;
    if (value.kind === "ArrayExpression") {
      const [item] = value.elements;
      if (value.elements.length === 1 && item?.kind === "Spread")
        elementSources.set(resultId, getElementSource(item.place));
      if (value.elements.length === 1 && item?.kind === "Identifier")
        itemSources.set(resultId, item);
      return;
    }
    if (value.kind !== "MethodCall") return;
    const methodName = propertyNames.get(value.property.identifier.id) ?? "";
    if (ELEMENT_METHODS.has(methodName))
      aliasSources.set(resultId, getElementSource(value.receiver));
    const flattenedItem =
      methodName === "flat" ? itemSources.get(value.receiver.identifier.id) : null;
    if (COPYING_METHODS.has(methodName))
      elementSources.set(resultId, getElementSource(flattenedItem ?? value.receiver));
    const receiver = this.#interpreter.read(value.receiver);
    const [source] = value.args;
    const isCopyingStatic =
      receiver.kind === "Global" && COPYING_STATICS.has(`${receiver.name}.${methodName}`);
    if (isCopyingStatic && source?.kind === "Identifier")
      elementSources.set(resultId, getElementSource(source));
  }

  #findAliasedOwnedValue(place: Place, isFrozen: boolean): BindingValue | null {
    const { aliasSources, frozenSources } = this.#interpreter.getCompilationTables();
    const getSource = (from: Place): Place | undefined =>
      aliasSources.get(from.identifier.id) ??
      (isFrozen ? frozenSources.get(from.identifier.id) : undefined);
    let source = getSource(place);
    for (let chainLength = 0; source && chainLength < MAX_ALIAS_CHAIN_LENGTH; chainLength++) {
      const sourceValue = this.#interpreter.read(source);
      if (isOwnedValue(sourceValue)) return sourceValue;
      if (sourceValue.kind === "ArrayExpression")
        return getCopiedOwnedValue(sourceValue) ?? sourceValue.elements.find(isOwnedValue) ?? null;
      source = getSource(source);
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

  #mutateLiteral(
    instruction: Instruction,
    mutatedPlace: Place,
    literal: MutableLiteral,
    walkState: WalkState,
  ): SymbolicValue {
    const creationPath = this.#creationPaths.get(literal);
    const isOnCreationPath =
      creationPath !== undefined &&
      creationPath.guards === walkState.guards &&
      creationPath.loopDepth === this.#interpreter.walker.loopDepth &&
      creationPath.isInHandler === (this.#interpreter.handlerEffects !== null);
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
    literal: MutableLiteral,
    isOnCreationPath: boolean,
  ): SymbolicValue {
    const { value, loc } = instruction;
    const methodName =
      value.kind === "MethodCall" && value.receiver.identifier.id === mutatedPlace.identifier.id
        ? this.#interpreter.getCompilationTables().propertyNames.get(value.property.identifier.id)
        : undefined;
    if (literal.kind === "Collection")
      return isOnCreationPath &&
        value.kind === "MethodCall" &&
        methodName !== undefined &&
        isCollectionWrite(methodName)
        ? this.#writeIntoCollection(literal, value, methodName)
        : createUnknown("mutation", loc);
    if (literal.kind === "ArrayExpression" && value.kind === "MethodCall" && methodName === "push")
      return this.#pushIntoArray(literal, value, isOnCreationPath, loc);
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

  #writeIntoCollection(
    collection: CollectionValue,
    write: InstructionValueOfKind<"MethodCall">,
    methodName: string,
  ): SymbolicValue {
    if (write.args.some((argument) => argument.kind !== "Identifier"))
      return createUnknown("mutation", write.loc);
    const argumentValues = write.args.flatMap((argument) =>
      argument.kind === "Identifier" ? [this.#interpreter.read(argument)] : [],
    );
    return {
      ...collection,
      writes: [...collection.writes, { method: methodName, argumentValues }],
    };
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
