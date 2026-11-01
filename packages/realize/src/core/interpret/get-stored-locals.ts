import type { HIRFunction, IdentifierId, Place } from "../../react-compiler/HIR/HIR";

export const getStoredLocals = (hirFunction: HIRFunction): Map<IdentifierId, Place> => {
  const localsByValue = new Map<IdentifierId, Place>();
  for (const block of hirFunction.body.blocks.values())
    for (const instruction of block.instructions)
      if (instruction.value.kind === "StoreLocal")
        localsByValue.set(instruction.value.value.identifier.id, instruction.value.lvalue.place);
  return localsByValue;
};
