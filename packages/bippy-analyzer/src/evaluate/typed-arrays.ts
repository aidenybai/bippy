import type { SourceLocation } from "../parse/source-types.js";
import type {
  StaticListValue,
  StaticPrimitiveValue,
  StaticSymbolValue,
  StaticValue,
} from "../types.js";
import { createErrorValue } from "./errors.js";
import { getThrowCertainty } from "./thrown.js";
import {
  UNDEFINED_VALUE,
  describeValue,
  distributeBinary,
  getSymbolPropertyKey,
  isKnownList,
  listValue,
  mapFiniteListItems,
  mapValue,
  primitiveValue,
  thrownValue,
  unknownPrimitiveValue,
  unknownValue,
} from "./values.js";

/**
 * Binary data as lists of element values: a typed array is a list tagged with
 * its constructor, an `ArrayBuffer` a list of its bytes. A view copies the
 * buffer it is created over rather than aliasing it, so a write through one
 * view is not seen through another; such writes are rare in rendering code.
 */
const TYPED_ARRAY_CONSTRUCTORS = {
  Int8Array,
  Uint8Array,
  Uint8ClampedArray,
  Int16Array,
  Uint16Array,
  Int32Array,
  Uint32Array,
  Float32Array,
  Float64Array,
};

export const isTypedArrayName = (name: string): name is keyof typeof TYPED_ARRAY_CONSTRUCTORS =>
  Object.hasOwn(TYPED_ARRAY_CONSTRUCTORS, name);

type BinaryKind = keyof typeof TYPED_ARRAY_CONSTRUCTORS | "ArrayBuffer";

const binaryKinds = new WeakMap<StaticListValue, BinaryKind>();

const BYTES_PER_ELEMENT: Record<BinaryKind, number> = {
  Int8Array: 1,
  Uint8Array: 1,
  Uint8ClampedArray: 1,
  Int16Array: 2,
  Uint16Array: 2,
  Int32Array: 4,
  Uint32Array: 4,
  Float32Array: 4,
  Float64Array: 8,
  ArrayBuffer: 1,
};

export const getBinaryKind = (value: StaticValue): BinaryKind | null =>
  value.kind === "list" ? (binaryKinds.get(value) ?? null) : null;

export const getBinaryByteLength = (value: StaticValue | undefined): number | null => {
  const kind = value === undefined ? null : getBinaryKind(value);
  return kind === null || value?.kind !== "list"
    ? null
    : value.items.length * BYTES_PER_ELEMENT[kind];
};

export const binaryValue = (kind: BinaryKind, items: StaticValue[]): StaticListValue => {
  const list = listValue(items);
  binaryKinds.set(list, kind);
  return list;
};

export const getBinaryWitness = (value: StaticListValue): object | null => {
  const kind = binaryKinds.get(value);
  if (kind === undefined) return null;
  return kind === "ArrayBuffer" ? new ArrayBuffer(0) : new TYPED_ARRAY_CONSTRUCTORS[kind]();
};

const MAX_BINARY_LENGTH = 65_536;

const unknownElements = (kind: BinaryKind, length: number, reason: string): StaticValue[] =>
  Array.from({ length }, () => unknownPrimitiveValue("number", `${kind} element ${reason}`));

/** The bytes of a list of known numbers, or null when any element is uncertain. */
export const getKnownBytes = (value: StaticValue): Uint8Array | null => {
  if (!isKnownList(value)) return null;
  const kind = binaryKinds.get(value);
  if (kind === undefined) return null;
  const numbers: number[] = [];
  for (const item of value.items) {
    if (item.kind !== "primitive" || typeof item.value !== "number") return null;
    numbers.push(item.value);
  }
  if (kind === "ArrayBuffer" || kind === "Uint8Array") return Uint8Array.from(numbers);
  const typed = TYPED_ARRAY_CONSTRUCTORS[kind].from(numbers);
  return new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength);
};

/** The `ArrayBuffer` or typed array a binary list stands for; null for other lists or uncertain elements. */
export const toNativeBinary = (value: StaticListValue): ArrayBuffer | ArrayBufferView | null => {
  const kind = binaryKinds.get(value);
  const bytes = kind === undefined ? null : getKnownBytes(value);
  if (kind === undefined || bytes === null) return null;
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return kind === "ArrayBuffer" ? buffer : new TYPED_ARRAY_CONSTRUCTORS[kind](buffer);
};

/** The elements of `kind` over `bytes`, as a view over their buffer reads them. */
export const bytesValue = (kind: BinaryKind, bytes: Uint8Array): StaticListValue => {
  const elements =
    kind === "ArrayBuffer"
      ? Array.from(bytes)
      : Array.from(new TYPED_ARRAY_CONSTRUCTORS[kind](bytes.slice().buffer));
  return binaryValue(
    kind,
    elements.map((element) => primitiveValue(element)),
  );
};

const fromLength = (
  kind: BinaryKind,
  length: StaticPrimitiveValue | StaticSymbolValue,
  location: SourceLocation | null,
): StaticValue => {
  const nativeLength = length.kind === "symbol" ? Symbol() : length.value;
  const count =
    typeof nativeLength === "bigint" || typeof nativeLength === "symbol"
      ? null
      : Math.trunc(Number(nativeLength)) || 0;
  if (count === null || count < 0 || count > Number.MAX_SAFE_INTEGER) {
    try {
      Reflect.construct(kind === "ArrayBuffer" ? ArrayBuffer : TYPED_ARRAY_CONSTRUCTORS[kind], [
        nativeLength,
      ]);
    } catch (error) {
      if (error instanceof TypeError || error instanceof RangeError)
        return thrownValue(
          `new ${kind}() with an invalid length`,
          createErrorValue(
            error instanceof TypeError ? "TypeError" : "RangeError",
            [primitiveValue(error.message)],
            location,
          ),
          location,
        );
    }
    return unknownValue(`new ${kind}() with an unsupported length`, location);
  }
  if (count > MAX_BINARY_LENGTH)
    return unknownValue(`new ${kind}() longer than the analysis follows`, location);
  return binaryValue(
    kind,
    Array.from({ length: count }, () => primitiveValue(0)),
  );
};

const toKnownInteger = (value: StaticValue | undefined): number | null | undefined => {
  if (value === undefined || (value.kind === "primitive" && value.value === undefined))
    return undefined;
  return value.kind === "primitive" &&
    typeof value.value === "number" &&
    Number.isInteger(value.value)
    ? value.value
    : null;
};

/** `new Uint8Array(buffer, byteOffset?, length?)` over a buffer or another view: the viewed byte span. */
const viewBuffer = (
  kind: BinaryKind,
  source: StaticListValue,
  sourceKind: BinaryKind,
  byteOffset: StaticValue | undefined,
  length: StaticValue | undefined,
  location: SourceLocation | null,
): StaticValue => {
  const elementBytes = BYTES_PER_ELEMENT[kind];
  const sourceByteLength = source.items.length * BYTES_PER_ELEMENT[sourceKind];
  const offset = toKnownInteger(byteOffset) ?? 0;
  const count = toKnownInteger(length);
  if (offset === null || count === null)
    return unknownValue(`new ${kind}() over a dynamic span of a buffer`, location);
  const byteLength = count === undefined ? sourceByteLength - offset : count * elementBytes;
  const rangeError = (message: string): StaticValue =>
    thrownValue(
      `new ${kind}() over an invalid span of a buffer`,
      createErrorValue("RangeError", [primitiveValue(message)], location),
      location,
    );
  if (offset % elementBytes !== 0)
    return rangeError(`start offset of ${kind} should be a multiple of ${elementBytes}`);
  if (byteLength < 0 || offset + byteLength > sourceByteLength)
    return rangeError(`Invalid typed array length: ${byteLength / elementBytes}`);
  if (byteLength % elementBytes !== 0)
    return rangeError(`byte length of ${kind} should be a multiple of ${elementBytes}`);
  const bytes = getKnownBytes(source);
  if (bytes) return bytesValue(kind, bytes.subarray(offset, offset + byteLength));
  return binaryValue(
    kind,
    unknownElements(kind, byteLength / elementBytes, "viewed over a buffer"),
  );
};

export const createTypedElementConverter = (
  kind: keyof typeof TYPED_ARRAY_CONSTRUCTORS,
  location: SourceLocation | null,
  operation: string,
): ((value: StaticValue) => StaticValue) => {
  const element = new TYPED_ARRAY_CONSTRUCTORS[kind](1);
  return (value) =>
    mapValue(value, (alternative) => {
      if (alternative.kind === "unknown" && alternative.thrown) return alternative;
      const primitiveType =
        alternative.kind === "symbol"
          ? "Symbol"
          : alternative.kind === "primitive" && typeof alternative.value === "bigint"
            ? "BigInt"
            : null;
      if (primitiveType !== null)
        return thrownValue(
          `${operation} element conversion`,
          createErrorValue(
            "TypeError",
            [primitiveValue(`Cannot convert a ${primitiveType} value to a number`)],
            location,
          ),
          location,
        );
      if (alternative.kind !== "primitive")
        return unknownValue(`${operation} with unsupported element conversion`, location);
      element[0] = Number(alternative.value);
      return primitiveValue(element[0]);
    });
};

export const convertTypedElements = (
  kind: keyof typeof TYPED_ARRAY_CONSTRUCTORS,
  items: StaticValue[],
  location: SourceLocation | null,
  operation = `new ${kind}()`,
): StaticValue => {
  const convert = createTypedElementConverter(kind, location, operation);
  const appendElement = (prefix: StaticValue, element: StaticValue): StaticValue => {
    if (prefix.kind === "branch" || element.kind === "branch")
      return (
        distributeBinary(prefix, element, appendElement) ??
        unknownValue(`${operation} exceeds supported element alternatives`, location)
      );
    if (prefix.kind !== "list") return prefix;
    return element.kind === "primitive" ? binaryValue(kind, [...prefix.items, element]) : element;
  };
  const result = mapFiniteListItems(items, (elements) => {
    let converted: StaticValue = binaryValue(kind, []);
    for (const item of elements) {
      if (converted.kind === "unknown" || getThrowCertainty(converted) === "always") break;
      const element = convert(item);
      if (
        element.kind === "primitive" ||
        (element.kind === "branch" &&
          element.alternatives.every((alternative) => alternative.kind === "primitive"))
      ) {
        converted = mapValue(converted, (prefix) => {
          if (prefix.kind === "list") prefix.items.push(element);
          return prefix;
        });
      } else converted = appendElement(converted, element);
    }
    return converted;
  });
  return result ?? unknownValue(`${operation} with unsupported element conversion`, location);
};

/** `new Uint8Array(source, byteOffset?, length?)` / `new ArrayBuffer(length)`: zero-filled from a length, copied from a list, viewed over a buffer. */
export const constructBinary = (
  name: string,
  args: StaticValue[],
  location: SourceLocation | null,
): StaticValue => {
  const kind: BinaryKind | null = isTypedArrayName(name)
    ? name
    : name === "ArrayBuffer"
      ? "ArrayBuffer"
      : null;
  if (kind === null) return unknownValue(`new ${name}()`, location);
  const [source, byteOffset, length] = args;
  if (source === undefined) return binaryValue(kind, []);
  if (source.kind === "branch")
    return mapValue(source, (alternative) =>
      constructBinary(name, [alternative, ...args.slice(1)], location),
    );
  if (source.kind === "list") {
    const sourceKind = binaryKinds.get(source);
    if (sourceKind === "ArrayBuffer" || (sourceKind !== undefined && kind === "ArrayBuffer")) {
      return viewBuffer(kind, source, sourceKind, byteOffset, length, location);
    }
    return kind === "ArrayBuffer"
      ? binaryValue(kind, [...source.items])
      : convertTypedElements(kind, source.items, location);
  }
  if (source.kind === "primitive" || source.kind === "symbol")
    return fromLength(kind, source, location);
  return unknownValue(`new ${name}() from ${describeValue(source)}`, location);
};

/** `ArrayBuffer.isView(value)`. */
export const isBinaryView = (value: StaticValue | undefined): boolean | null => {
  if (value === undefined) return false;
  if (value.kind === "unknown" || value.kind === "branch") return null;
  const kind = getBinaryKind(value);
  return kind !== null && kind !== "ArrayBuffer";
};

/** Members typed arrays and buffers have beyond an array's. */
export const getBinaryMember = (list: StaticListValue, key: string): StaticValue | null => {
  const kind = binaryKinds.get(list);
  if (kind === undefined) return null;
  if (key === getSymbolPropertyKey({ kind: "symbol", key: "Symbol.toStringTag" }))
    return list.properties?.get(key) ?? primitiveValue(kind);
  switch (key) {
    case "byteLength":
      return primitiveValue(getBinaryByteLength(list) ?? 0);
    case "byteOffset":
      return primitiveValue(0);
    case "BYTES_PER_ELEMENT":
      return kind === "ArrayBuffer" ? UNDEFINED_VALUE : primitiveValue(BYTES_PER_ELEMENT[kind]);
    case "buffer":
      return kind === "ArrayBuffer"
        ? UNDEFINED_VALUE
        : constructBinary("ArrayBuffer", [list], null);
    default:
      return null;
  }
};

/** Overwrites every element with an unknown value, as a write the analysis cannot follow does. */
export const fillBinaryUnknown = (list: StaticListValue, reason: string): void => {
  const kind = binaryKinds.get(list) ?? "Uint8Array";
  for (let index = 0; index < list.items.length; index++) {
    const item = list.items[index];
    const value = unknownPrimitiveValue("number", `${kind} element ${reason}`);
    list.items[index] =
      item.kind === "optional"
        ? { ...item, value }
        : item.kind === "repeat"
          ? { ...item, item: value }
          : value;
  }
};

/** A known numeric index argument, `fallback` when omitted or `undefined`, null when dynamic. */
export const toIndex = (value: StaticValue | undefined, fallback: number): number | null => {
  if (value === undefined || (value.kind === "primitive" && value.value === undefined))
    return fallback;
  return value.kind === "primitive" && typeof value.value === "number" ? value.value : null;
};

/** `subarray`/`slice` of a typed array; null for other methods. */
export const callBinaryMethod = (
  list: StaticListValue,
  name: string,
  args: StaticValue[],
  location: SourceLocation | null,
): StaticValue | null => {
  const kind = binaryKinds.get(list);
  if (kind === undefined) return null;
  const [first, second] = args;
  switch (name) {
    case "subarray":
    case "slice": {
      const start = toIndex(first, 0);
      const end = toIndex(second, list.items.length);
      if (start === null || end === null)
        return unknownValue(`${kind}.${name}() with dynamic bounds`, location);
      return binaryValue(kind, list.items.slice(start, end));
    }
    default:
      return null;
  }
};
