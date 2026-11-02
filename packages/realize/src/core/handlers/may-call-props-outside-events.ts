import { getHookKind } from "../../react-compiler/HIR/HIR";
import type { HIRFunction, IdentifierId } from "../../react-compiler/HIR/HIR";
import { isFunctionCreation } from "../interpret/is-function-creation";
import { getHookTraits } from "../interpret/hook-traits";

const scanFunction = (hirFunction: HIRFunction): boolean => {
  const functionIds = new Set<IdentifierId>();
  for (const block of hirFunction.body.blocks.values())
    for (const instruction of block.instructions) {
      const value = instruction.value;
      if (isFunctionCreation(value)) {
        if (mayCallPropsOutsideEvents(value.loweredFunc.func)) return true;
        functionIds.add(instruction.lvalue.identifier.id);
      }
      if (value.kind === "StoreLocal" && functionIds.has(value.value.identifier.id))
        functionIds.add(value.lvalue.place.identifier.id);
      if (value.kind === "LoadLocal" && functionIds.has(value.place.identifier.id))
        functionIds.add(instruction.lvalue.identifier.id);
      const callee =
        value.kind === "CallExpression"
          ? value.callee
          : value.kind === "MethodCall"
            ? value.property
            : null;
      const hookKind = callee ? getHookKind(hirFunction.env, callee.identifier) : null;
      if (hookKind !== null && !getHookTraits(hookKind).callsPropsOnlyInEvents) return true;
      if (value.kind !== "JsxExpression") continue;
      if (value.tag.kind !== "BuiltinTag") return true;
      const hasRefCallback = value.props.some(
        (prop) =>
          prop.kind === "JsxAttribute" &&
          prop.name === "ref" &&
          functionIds.has(prop.place.identifier.id),
      );
      if (hasRefCallback) return true;
    }
  return false;
};

export const mayCallPropsOutsideEvents = (hirFunction: HIRFunction): boolean =>
  scanFunction(hirFunction);
