import { defaultModuleTypeProvider } from "../../react-compiler/HIR/DefaultModuleTypeProvider";
import type { TypeConfig } from "../../react-compiler/HIR/TypeSchema";

export const getModuleType = (moduleName: string): TypeConfig | null => {
  const moduleType = defaultModuleTypeProvider(moduleName);
  if (!moduleType) return null;
  const compatibleType: TypeConfig = JSON.parse(JSON.stringify(moduleType), (key, value) =>
    key === "knownIncompatible" ? undefined : value,
  );
  return compatibleType;
};
