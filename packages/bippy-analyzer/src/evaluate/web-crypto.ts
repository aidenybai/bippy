import { createHash } from "node:crypto";
import type { SourceLocation, StaticListValue, StaticValue } from "../types.js";
import { resolvedPromiseValue } from "./promises.js";
import {
  binaryValue,
  bytesValue,
  fillBinaryUnknown,
  getBinaryByteLength,
  getBinaryKind,
  getKnownBytes,
} from "./typed-arrays.js";
import {
  getObjectProperty,
  listValue,
  objectFromRecord,
  primitiveValue,
  unknownPrimitiveValue,
  unknownValue,
} from "./values.js";

/**
 * Web Crypto as the page observes it: key material and ciphertext are random,
 * so their bytes are unknown while their lengths follow from the algorithm;
 * digests of known bytes are computed. Operations settle before the runtime
 * snapshot is taken, so their promises are resolved.
 */
const CRYPTO_NAME = /^(?:(?:window|globalThis|self)\.)?crypto$/;
const SUBTLE_NAME = /^(?:(?:window|globalThis|self)\.)?crypto\.subtle$/;

const CRYPTO_METHODS = new Set(["getRandomValues", "randomUUID"]);
const UUID_LENGTH = 36;
const SUBTLE_METHODS = new Set([
  "digest",
  "encrypt",
  "decrypt",
  "generateKey",
  "importKey",
  "exportKey",
  "sign",
  "verify",
  "deriveKey",
  "deriveBits",
  "wrapKey",
  "unwrapKey",
]);

export const isWebCryptoName = (globalName: string): boolean =>
  CRYPTO_NAME.test(globalName) || SUBTLE_NAME.test(globalName);

export const getWebCryptoMember = (globalName: string, key: string): StaticValue | null => {
  const isSubtle = SUBTLE_NAME.test(globalName);
  if (!isSubtle && key === "subtle") return { kind: "global", name: `${globalName}.subtle` };
  const methods = isSubtle ? SUBTLE_METHODS : CRYPTO_METHODS;
  return methods.has(key)
    ? { kind: "method", receiver: { kind: "global", name: globalName }, name: key }
    : null;
};

const DIGEST_LENGTHS: Record<string, { bytes: number; hash: string }> = {
  "SHA-1": { bytes: 20, hash: "sha1" },
  "SHA-256": { bytes: 32, hash: "sha256" },
  "SHA-384": { bytes: 48, hash: "sha384" },
  "SHA-512": { bytes: 64, hash: "sha512" },
};

const KEY_PAIR_ALGORITHMS = new Set([
  "RSASSA-PKCS1-V1_5",
  "RSA-PSS",
  "RSA-OAEP",
  "ECDSA",
  "ECDH",
  "ED25519",
  "X25519",
]);

/** The algorithm name of an `AlgorithmIdentifier` (a name or `{ name }`), normalized as the API does. */
const getAlgorithmName = (algorithm: StaticValue | undefined): string | null => {
  const name = algorithm?.kind === "object" ? getObjectProperty(algorithm, "name") : algorithm;
  return name?.kind === "primitive" && typeof name.value === "string"
    ? name.value.toUpperCase()
    : null;
};

const getAlgorithmNumber = (algorithm: StaticValue | undefined, key: string): number | null => {
  if (algorithm?.kind !== "object") return null;
  const value = getObjectProperty(algorithm, key);
  return value.kind === "primitive" && typeof value.value === "number" ? value.value : null;
};

const unknownBuffer = (length: number, reason: string): StaticListValue =>
  binaryValue(
    "ArrayBuffer",
    Array.from({ length }, () => unknownPrimitiveValue("number", reason)),
  );

const digest = (algorithm: StaticValue | undefined, data: StaticValue | undefined): StaticValue => {
  const name = getAlgorithmName(algorithm);
  const length = name === null ? undefined : DIGEST_LENGTHS[name];
  if (length === undefined)
    return unknownValue("crypto.subtle.digest() with a dynamic algorithm", null);
  const bytes = data === undefined ? null : getKnownBytes(data);
  if (bytes) return bytesValue("ArrayBuffer", createHash(length.hash).update(bytes).digest());
  return unknownBuffer(length.bytes, `${name} digest of dynamic bytes`);
};

interface Encryption {
  algorithm: StaticValue | undefined;
  key: StaticValue | undefined;
  plaintext: StaticListValue;
}

/** What each ciphertext buffer encrypts, so decrypting it with the same key and parameters yields the plaintext back. */
const encryptions = new WeakMap<StaticListValue, Encryption>();

const getCiphertextLength = (
  name: string,
  algorithm: StaticValue | undefined,
  plaintextLength: number,
): number | null => {
  switch (name) {
    case "AES-GCM":
      return plaintextLength + (getAlgorithmNumber(algorithm, "tagLength") ?? 128) / 8;
    case "AES-CBC":
      return (Math.floor(plaintextLength / 16) + 1) * 16;
    case "AES-CTR":
      return plaintextLength;
    default:
      return null;
  }
};

const encrypt = (
  algorithm: StaticValue | undefined,
  key: StaticValue | undefined,
  data: StaticValue | undefined,
): StaticValue => {
  const name = getAlgorithmName(algorithm);
  const plaintextLength = getBinaryByteLength(data);
  if (name === null || plaintextLength === null || data?.kind !== "list")
    return unknownValue("crypto.subtle.encrypt() over dynamic input", null);
  const ciphertextLength = getCiphertextLength(name, algorithm, plaintextLength);
  if (ciphertextLength === null) return unknownValue(`crypto.subtle.encrypt() with ${name}`, null);
  const ciphertext = unknownBuffer(ciphertextLength, `${name} ciphertext byte`);
  encryptions.set(ciphertext, { algorithm, key, plaintext: data });
  return ciphertext;
};

const isSameParameter = (left: StaticValue | undefined, right: StaticValue | undefined): boolean =>
  left === right ||
  (left !== undefined &&
    right !== undefined &&
    left.kind === "primitive" &&
    right.kind === "primitive" &&
    left.value === right.value);

const isSameAlgorithm = (
  left: StaticValue | undefined,
  right: StaticValue | undefined,
): boolean => {
  if (left === right) return true;
  if (left?.kind !== "object" || right?.kind !== "object") return false;
  return ["name", "iv", "counter", "tagLength", "additionalData"].every((key) =>
    isSameParameter(getObjectProperty(left, key), getObjectProperty(right, key)),
  );
};

const decrypt = (
  algorithm: StaticValue | undefined,
  key: StaticValue | undefined,
  data: StaticValue | undefined,
  location: SourceLocation | null,
): StaticValue => {
  const encryption = data?.kind === "list" ? encryptions.get(data) : undefined;
  if (!encryption || encryption.key !== key || !isSameAlgorithm(encryption.algorithm, algorithm))
    return unknownValue("crypto.subtle.decrypt() plaintext", location);
  const bytes = getKnownBytes(encryption.plaintext);
  if (bytes) return bytesValue("ArrayBuffer", bytes);
  return getBinaryKind(encryption.plaintext) === "Uint8Array"
    ? binaryValue("ArrayBuffer", [...encryption.plaintext.items])
    : unknownBuffer(
        getBinaryByteLength(encryption.plaintext) ?? 0,
        "decrypted byte of dynamic plaintext",
      );
};

const cryptoKey = (
  type: string,
  algorithm: StaticValue | undefined,
  extractable: StaticValue | undefined,
  usages: StaticValue | undefined,
): StaticValue =>
  objectFromRecord({
    type: primitiveValue(type),
    extractable: extractable ?? primitiveValue(false),
    algorithm: algorithm ?? unknownValue("CryptoKey.algorithm", null),
    usages: usages ?? listValue([]),
  });

const generateKey = (
  algorithm: StaticValue | undefined,
  extractable: StaticValue | undefined,
  usages: StaticValue | undefined,
): StaticValue => {
  const name = getAlgorithmName(algorithm);
  if (name === null)
    return unknownValue("crypto.subtle.generateKey() with a dynamic algorithm", null);
  if (!KEY_PAIR_ALGORITHMS.has(name)) return cryptoKey("secret", algorithm, extractable, usages);
  return objectFromRecord({
    publicKey: cryptoKey("public", algorithm, primitiveValue(true), usages),
    privateKey: cryptoKey("private", algorithm, extractable, usages),
  });
};

const IMPORT_FORMAT_TYPES: Record<string, string> = { spki: "public", pkcs8: "private" };

const importKey = (
  format: StaticValue | undefined,
  algorithm: StaticValue | undefined,
  extractable: StaticValue | undefined,
  usages: StaticValue | undefined,
): StaticValue => {
  if (format?.kind !== "primitive" || typeof format.value !== "string")
    return unknownValue("crypto.subtle.importKey() with a dynamic format", null);
  return cryptoKey(IMPORT_FORMAT_TYPES[format.value] ?? "secret", algorithm, extractable, usages);
};

/** `crypto.getRandomValues(array)` fills the array in place; `crypto.subtle.*` resolve to their results. */
export const callWebCryptoMethod = (
  globalName: string,
  name: string,
  args: StaticValue[],
  recordMutation: (list: StaticListValue) => void,
  location: SourceLocation | null,
): StaticValue | null => {
  const [first, second, third, fourth, fifth] = args;
  if (!SUBTLE_NAME.test(globalName)) {
    switch (name) {
      case "randomUUID":
        return {
          ...unknownPrimitiveValue("string", "crypto.randomUUID()"),
          stringShape: { prefix: "", minLength: UUID_LENGTH, length: UUID_LENGTH },
        };
      case "getRandomValues":
        if (first?.kind !== "list" || getBinaryKind(first) === null)
          return unknownValue("crypto.getRandomValues() of a dynamic array", location);
        recordMutation(first);
        fillBinaryUnknown(first, "from crypto.getRandomValues()");
        return first;
      default:
        return null;
    }
  }
  const unknownResult = (detail: string): StaticValue =>
    unknownValue(`crypto.subtle.${name}() ${detail}`, location);
  switch (name) {
    case "digest":
      return resolvedPromiseValue(digest(first, second));
    case "encrypt":
      return resolvedPromiseValue(encrypt(first, second, third));
    case "decrypt":
      return resolvedPromiseValue(decrypt(first, second, third, location));
    case "generateKey":
      return resolvedPromiseValue(generateKey(first, second, third));
    case "importKey":
      return resolvedPromiseValue(importKey(first, third, fourth, fifth));
    case "deriveKey":
      return resolvedPromiseValue(cryptoKey("secret", third, fourth, fifth));
    case "unwrapKey":
      return resolvedPromiseValue(cryptoKey("secret", fifth, args[6], args[7]));
    case "verify":
      return resolvedPromiseValue(unknownPrimitiveValue("boolean", "crypto.subtle.verify()"));
    case "exportKey":
    case "sign":
    case "deriveBits":
    case "wrapKey":
      return resolvedPromiseValue(unknownResult("output"));
    default:
      return null;
  }
};
