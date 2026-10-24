import type { HIRFunction, IdentifierId, Place } from "../../react-compiler/HIR/HIR";

export const getStoredLocals = (hirFunction: HIRFunction): Map<IdentifierId, Place> => {
  const localsByValue = new Map<IdentifierId, Place>();
  for (const block of hirFunction.body.blocks.values())
    for (const { value } of block.instructions)
      if (value.kind === "StoreLocal")
        localsByValue.set(value.value.identifier.id, value.lvalue.place);
  return localsByValue;
};
