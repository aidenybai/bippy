import type { DeclarationKeyParts } from "./declaration-key-parts";

const SEPARATOR = "#";

export const createDeclarationKey = (path: string, name: string): string =>
  `${path}${SEPARATOR}${name}`;

export const parseDeclarationKey = (declarationKey: string): DeclarationKeyParts => {
  const separatorIndex = declarationKey.lastIndexOf(SEPARATOR);
  return {
    path: declarationKey.slice(0, separatorIndex),
    name: declarationKey.slice(separatorIndex + SEPARATOR.length),
  };
};
