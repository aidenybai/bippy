import { getHookKind } from "../../react-compiler/HIR/HIR";
import type {
  DeclarationId,
  HIRFunction,
  Place,
  SourceLocation,
} from "../../react-compiler/HIR/HIR";
import { getPlaceOrSpread } from "./get-place-or-spread";
import { getHookTraits } from "../hook-traits";

export const ALL_PROPS = "*";

const CONTEXT_PREFIX = "#context:";

const NO_DEPENDENCIES: ReadonlySet<DeclarationId> = new Set();

interface PropForward {
  tagLoc: SourceLocation;
  attribute: string;
  name: string;
}

interface PropHolds {
  held: ReadonlySet<string>;
  forwards: PropForward[];
  contextLocs: ReadonlyMap<string, SourceLocation>;
}

const holdsByFunction = new WeakMap<HIRFunction, PropHolds>();

const scanFunction = (hirFunction: HIRFunction): PropHolds => {
  const [props] = hirFunction.params;
  const contextLocs = new Map<string, SourceLocation>();
  const namesByDeclaration = new Map<DeclarationId, string>(
    props ? [[getPlaceOrSpread(props).identifier.declarationId, ALL_PROPS]] : [],
  );
  const loadedDeclarations = new Map<DeclarationId, DeclarationId>();
  const functionsByDeclaration = new Map<DeclarationId, HIRFunction>();
  const elementsByDeclaration = new Map<DeclarationId, Set<DeclarationId>>();
  const memoDependencies = new Map<number, Set<DeclarationId>>();
  const held = new Set<string>();
  const forwards: PropForward[] = [];
  const getName = (place: Place): string | undefined =>
    namesByDeclaration.get(place.identifier.declarationId);
  const getSource = (place: Place): DeclarationId =>
    loadedDeclarations.get(place.identifier.declarationId) ?? place.identifier.declarationId;
  const getCaptured = (place: Place | undefined): Place[] =>
    place ? (functionsByDeclaration.get(place.identifier.declarationId)?.context ?? []) : [];
  const hold = (places: Place[], dependencies: ReadonlySet<DeclarationId>): void => {
    for (const place of places) {
      const name = getName(place);
      if (name !== undefined && !dependencies.has(place.identifier.declarationId)) held.add(name);
    }
  };
  const setName = (target: Place, name: string | undefined): void => {
    if (name !== undefined) namesByDeclaration.set(target.identifier.declarationId, name);
  };
  const derive = (target: Place, source: Place): void => {
    setName(target, getName(source));
    const loaded = functionsByDeclaration.get(source.identifier.declarationId);
    if (loaded) functionsByDeclaration.set(target.identifier.declarationId, loaded);
    loadedDeclarations.set(target.identifier.declarationId, getSource(source));
  };
  for (const block of hirFunction.body.blocks.values())
    for (const { lvalue, value } of block.instructions) {
      for (const dependencies of memoDependencies.values())
        hold(
          value.kind === "LoadLocal"
            ? [value.place]
            : value.kind === "FunctionExpression"
              ? value.loweredFunc.func.context
              : [],
          dependencies,
        );
      if (value.kind === "StartMemoize" && value.deps)
        memoDependencies.set(
          value.manualMemoId,
          new Set(
            value.deps.flatMap((dependency) =>
              dependency.root.kind === "NamedLocal"
                ? [dependency.root.value.identifier.declarationId]
                : [],
            ),
          ),
        );
      if (value.kind === "FinishMemoize") memoDependencies.delete(value.manualMemoId);
      if (value.kind === "LoadLocal") derive(lvalue, value.place);
      if (value.kind === "StoreLocal") {
        derive(value.lvalue.place, value.value);
        derive(lvalue, value.value);
      }
      if (value.kind === "PropertyLoad")
        setName(
          lvalue,
          getName(value.object) === ALL_PROPS ? String(value.property) : getName(value.object),
        );
      if (value.kind === "Destructure" && getName(value.value) !== undefined) {
        const name = getName(value.value);
        const pattern = value.lvalue.pattern;
        const parts: Array<[Place, string | undefined]> =
          pattern.kind === "ObjectPattern"
            ? pattern.properties.map((property) => [
                property.place,
                property.kind === "ObjectProperty" &&
                property.key.kind !== "computed" &&
                name === ALL_PROPS
                  ? String(property.key.name)
                  : name,
              ])
            : pattern.items.flatMap((item): Array<[Place, string | undefined]> =>
                item.kind === "Hole" ? [] : [[getPlaceOrSpread(item), name]],
              );
        for (const [place, partName] of parts) setName(place, partName);
      }
      if (value.kind === "FunctionExpression")
        functionsByDeclaration.set(lvalue.identifier.declarationId, value.loweredFunc.func);
      if (value.kind === "ArrayExpression")
        elementsByDeclaration.set(
          lvalue.identifier.declarationId,
          new Set(
            value.elements.flatMap((element) =>
              element.kind === "Identifier" ? [getSource(element)] : [],
            ),
          ),
        );
      if (value.kind === "JsxExpression" && value.tag.kind === "Identifier")
        for (const attribute of value.props) {
          const place = attribute.kind === "JsxAttribute" ? attribute.place : attribute.argument;
          for (const readPlace of [place, ...getCaptured(place)]) {
            const name = getName(readPlace);
            if (name !== undefined)
              forwards.push({
                tagLoc: value.tag.loc,
                attribute: attribute.kind === "JsxAttribute" ? attribute.name : ALL_PROPS,
                name,
              });
          }
        }
      if (value.kind !== "CallExpression" && value.kind !== "MethodCall") continue;
      const callee = value.kind === "CallExpression" ? value.callee : value.property;
      const hookKind = getHookKind(hirFunction.env, callee.identifier);
      const places = value.args.map(getPlaceOrSpread);
      if (hookKind === "useContext" && places[0]) {
        const contextName = `${CONTEXT_PREFIX}${contextLocs.size}`;
        contextLocs.set(contextName, places[0].loc);
        setName(lvalue, contextName);
      }
      const handleDependencies = hookKind === "useImperativeHandle" ? places[2] : undefined;
      if (handleDependencies)
        hold(
          getCaptured(places[1]),
          elementsByDeclaration.get(handleDependencies.identifier.declarationId) ?? NO_DEPENDENCIES,
        );
      for (const index of hookKind ? getHookTraits(hookKind).heldArgumentIndices : [])
        for (const place of places[index] ? [places[index]] : [])
          hold([place, ...getCaptured(place)], NO_DEPENDENCIES);
    }
  return { held, forwards, contextLocs };
};

export const getPropHolds = (hirFunction: HIRFunction): PropHolds => {
  const cached = holdsByFunction.get(hirFunction);
  if (cached) return cached;
  const holds = scanFunction(hirFunction);
  holdsByFunction.set(hirFunction, holds);
  return holds;
};
