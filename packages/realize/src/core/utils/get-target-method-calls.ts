import type { HIRFunction, IdentifierId } from "../../react-compiler/HIR/HIR";

interface TargetMethodCall {
  methodName: string;
  isForm: boolean;
}

const TARGET_PROPERTIES = new Set(["currentTarget", "target"]);

export const getTargetMethodCalls = (hirFunction: HIRFunction): TargetMethodCall[] => {
  const targetIds = new Set<IdentifierId>();
  const formIds = new Set<IdentifierId>();
  const methodNames = new Map<IdentifierId, string>();
  const calls: TargetMethodCall[] = [];
  for (const block of hirFunction.body.blocks.values())
    for (const { lvalue, value } of block.instructions) {
      if (value.kind === "PropertyLoad" && TARGET_PROPERTIES.has(String(value.property)))
        targetIds.add(lvalue.identifier.id);
      if (
        value.kind === "PropertyLoad" &&
        value.property === "form" &&
        targetIds.has(value.object.identifier.id)
      )
        formIds.add(lvalue.identifier.id);
      if (value.kind === "PropertyLoad")
        methodNames.set(lvalue.identifier.id, String(value.property));
      if (value.kind !== "MethodCall") continue;
      const methodName = methodNames.get(value.property.identifier.id);
      const receiverId = value.receiver.identifier.id;
      if (methodName && (targetIds.has(receiverId) || formIds.has(receiverId)))
        calls.push({ methodName, isForm: formIds.has(receiverId) });
    }
  return calls;
};
