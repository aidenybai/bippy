import type { HIRFunction, IdentifierId } from "../../react-compiler/HIR/HIR";
import type { SymbolicValue } from "../types";
import { isFunctionCreation } from "../interpret/is-function-creation";

export type Load = "always" | "maybe" | null;

export interface EventLoads {
  stops: Load;
  prevents: Load;
}

export interface Dispatch extends EventLoads {
  callback: SymbolicValue;
}

export const NO_LOADS: EventLoads = { stops: null, prevents: null };

export const getBranchLoad = (consequent: Load, alternate: Load): Load => {
  if (consequent === "always" && alternate === "always") return "always";
  return consequent !== null || alternate !== null ? "maybe" : null;
};

export const getSequenceLoad = (loads: Load[]): Load => {
  if (loads.includes("always")) return "always";
  return loads.includes("maybe") ? "maybe" : null;
};

export const getPreventLoad = (dispatches: Dispatch[]): Load =>
  getSequenceLoad(dispatches.map((dispatch) => dispatch.prevents));

export const weaken = (load: Load): Load => (load === null ? null : "maybe");

export const gateByLoad = <Item>(
  load: Load,
  items: Item[],
  guard: (items: Item[]) => Item[],
): Item[] => {
  if (load === "always") return [];
  return load === "maybe" ? guard(items) : items;
};

export const getCallbacks = (dispatches: Dispatch[]): SymbolicValue[] =>
  dispatches.map((dispatch) => dispatch.callback);

export const loadsInHandlers = (
  hirFunction: HIRFunction,
  names: ReadonlySet<string>,
  property: string,
): boolean => {
  const functions = new Map<IdentifierId, HIRFunction>();
  for (const block of hirFunction.body.blocks.values())
    for (const instruction of block.instructions) {
      const value = instruction.value;
      if (isFunctionCreation(value)) {
        if (loadsInHandlers(value.loweredFunc.func, names, property)) return true;
        functions.set(instruction.lvalue.identifier.id, value.loweredFunc.func);
      }
      if (value.kind === "StoreLocal") {
        const stored = functions.get(value.value.identifier.id);
        if (stored) functions.set(value.lvalue.place.identifier.id, stored);
      }
      const source =
        value.kind === "LoadLocal"
          ? value.place
          : value.kind === "CallExpression"
            ? value.args.find(
                (argument) =>
                  argument.kind === "Identifier" && functions.has(argument.identifier.id),
              )
            : undefined;
      const sourceFunction =
        source?.kind === "Identifier" ? functions.get(source.identifier.id) : undefined;
      if (sourceFunction) functions.set(instruction.lvalue.identifier.id, sourceFunction);
      if (value.kind !== "JsxExpression") continue;
      const isLoaded = value.props.some((prop) => {
        if (prop.kind !== "JsxAttribute" || !names.has(prop.name)) return false;
        const handler = functions.get(prop.place.identifier.id);
        return handler !== undefined && loadsProperty(handler, property);
      });
      if (isLoaded) return true;
    }
  return false;
};

const loadsProperty = (hirFunction: HIRFunction, property: string): boolean => {
  for (const block of hirFunction.body.blocks.values())
    for (const instruction of block.instructions) {
      const value = instruction.value;
      if (value.kind === "PropertyLoad" && value.property === property) return true;
      if (isFunctionCreation(value) && loadsProperty(value.loweredFunc.func, property)) return true;
    }
  return false;
};

const getFunctionLoad = (hirFunction: HIRFunction, property: string): Load => {
  if (!loadsProperty(hirFunction, property)) return null;
  const entry = hirFunction.body.blocks.get(hirFunction.body.entry);
  const isAlways = entry?.instructions.some(
    (instruction) =>
      instruction.value.kind === "PropertyLoad" && instruction.value.property === property,
  );
  return isAlways ? "always" : "maybe";
};

export const getFunctionLoads = (hirFunction: HIRFunction): EventLoads => ({
  stops: getFunctionLoad(hirFunction, "stopPropagation"),
  prevents: getFunctionLoad(hirFunction, "preventDefault"),
});
