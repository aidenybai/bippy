import type { HIRFunction, IdentifierId } from "../../react-compiler/HIR/HIR";
import { eachInstructionValueOperand } from "../../react-compiler/HIR/visitors";
import { getPlaceOrSpread } from "./get-place-or-spread";
import { isFunctionCreation } from "./is-function-creation";

export const isRefOnlyRead = (hirFunction: HIRFunction, refId: IdentifierId): boolean => {
  const aliases = new Set([refId]);
  const currentReads = new Set<IdentifierId>();
  for (const block of hirFunction.body.blocks.values())
    for (const { lvalue, value } of block.instructions) {
      const isAliasLoad =
        (value.kind === "LoadLocal" || value.kind === "LoadContext") &&
        aliases.has(value.place.identifier.id);
      if (isAliasLoad) {
        aliases.add(lvalue.identifier.id);
        continue;
      }
      const isCurrentRead =
        value.kind === "PropertyLoad" &&
        value.property === "current" &&
        aliases.has(value.object.identifier.id);
      if (isCurrentRead) {
        currentReads.add(lvalue.identifier.id);
        continue;
      }
      if (value.kind === "MethodCall" && aliases.has(value.receiver.identifier.id)) {
        if (!currentReads.has(value.property.identifier.id)) return false;
        if (value.args.some((arg) => aliases.has(getPlaceOrSpread(arg).identifier.id)))
          return false;
        continue;
      }
      if (isFunctionCreation(value)) {
        if (!isRefOnlyRead(value.loweredFunc.func, refId)) return false;
        continue;
      }
      for (const operand of eachInstructionValueOperand(value))
        if (aliases.has(operand.identifier.id)) return false;
    }
  return true;
};
