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
    for (const instruction of block.instructions) {
      const value = instruction.value;
      const id = instruction.lvalue.identifier.id;
      if (value.kind === "PropertyLoad") {
        if (TARGET_PROPERTIES.has(String(value.property))) targetIds.add(id);
        if (value.property === "form" && targetIds.has(value.object.identifier.id)) formIds.add(id);
        methodNames.set(id, String(value.property));
      }
      if (value.kind !== "MethodCall") continue;
      const methodName = methodNames.get(value.property.identifier.id);
      const receiverId = value.receiver.identifier.id;
      if (methodName && (targetIds.has(receiverId) || formIds.has(receiverId)))
        calls.push({ methodName, isForm: formIds.has(receiverId) });
    }
  return calls;
};
