import type { SourceLocation, StaticValue } from "../types.js";
import { listValue, unknownPrimitiveValue, unknownValue } from "./values.js";

const CRYPTO_NAME = /^(?:(?:window|globalThis|self)\.)?crypto$/;

export const isCryptoName = (globalName: string): boolean => CRYPTO_NAME.test(globalName);

const UUID_LENGTH = 36;

/** `crypto.getRandomValues` fills the typed array in place with entropy: same length, every element dynamic. */
export const callCryptoMethod = (
  name: string,
  args: StaticValue[],
  location: SourceLocation | null,
): StaticValue | null => {
  const [target] = args;
  switch (name) {
    case "getRandomValues":
      if (target?.kind !== "list") return unknownValue(`crypto.${name}()`, location);
      return listValue(target.items.map(() => unknownPrimitiveValue("number", `crypto.${name}`)));
    case "randomUUID":
      return {
        ...unknownPrimitiveValue("string", `crypto.${name}`),
        stringShape: { prefix: "", length: UUID_LENGTH },
      };
    default:
      return null;
  }
};
