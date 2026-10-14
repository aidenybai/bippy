const SEPARATOR = "#";

export interface DeclarationKeyParts {
  path: string;
  name: string;
}

export const createDeclarationKey = (path: string, name: string): string =>
  `${path}${SEPARATOR}${name}`;

export const parseDeclarationKey = (declarationKey: string): DeclarationKeyParts => {
  const separatorIndex = declarationKey.lastIndexOf(SEPARATOR);
  return {
    path: declarationKey.slice(0, separatorIndex),
    name: declarationKey.slice(separatorIndex + SEPARATOR.length),
  };
};
