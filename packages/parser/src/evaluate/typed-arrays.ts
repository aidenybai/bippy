import type { SourceLocation, StaticListValue, StaticValue } from "../types.js";
import { createErrorValue } from "./errors.js";
import {
  UNDEFINED_VALUE,
  describeValue,
  isKnownList,
  listValue,
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
export const TYPED_ARRAY_CONSTRUCTORS = {
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
  length: StaticValue,
  location: SourceLocation | null,
): StaticValue => {
  if (length.kind !== "primitive" || typeof length.value !== "number")
    return unknownValue(`new ${kind}() with a dynamic length`, location);
  if (!Number.isInteger(length.value) || length.value < 0)
    return thrownValue(
      `new ${kind}() with an invalid length`,
      createErrorValue("RangeError", [primitiveValue(`Invalid ${kind} length`)], location),
      location,
    );
  if (length.value > MAX_BINARY_LENGTH)
    return unknownValue(`new ${kind}() longer than the analysis follows`, location);
  return binaryValue(
    kind,
    Array.from({ length: length.value }, () => primitiveValue(0)),
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
  if (source.kind === "list") {
    const sourceKind = binaryKinds.get(source);
    if (sourceKind === "ArrayBuffer" || (sourceKind !== undefined && kind === "ArrayBuffer")) {
      return viewBuffer(kind, source, sourceKind, byteOffset, length, location);
    }
    return binaryValue(kind, [...source.items]);
  }
  if (source.kind === "primitive") return fromLength(kind, source, location);
  return unknownValue(`new ${name}() from ${describeValue(source)}`, location);
};

/** `Uint8Array.from(items)` / `Uint8Array.of(...items)` over already-mapped elements. */
export const binaryFromItems = (name: string, items: StaticValue[]): StaticValue | null =>
  isTypedArrayName(name) ? binaryValue(name, items) : null;

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
  list.items.splice(0, list.items.length, ...unknownElements(kind, list.items.length, reason));
};

/** A known numeric index argument, `fallback` when omitted or `undefined`, null when dynamic. */
export const toIndex = (value: StaticValue | undefined, fallback: number): number | null => {
  if (value === undefined || (value.kind === "primitive" && value.value === undefined))
    return fallback;
  return value.kind === "primitive" && typeof value.value === "number" ? value.value : null;
};

/** `subarray`/`slice` of a typed array, and `set` writing a source into it; null for other methods. */
export const callBinaryMethod = (
  list: StaticListValue,
  name: string,
  args: StaticValue[],
  recordMutation: () => void,
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
    case "set": {
      if (kind === "ArrayBuffer" || first === undefined) return null;
      const offset = toIndex(second, 0);
      recordMutation();
      if (
        offset === null ||
        !isKnownList(first) ||
        offset + first.items.length > list.items.length
      ) {
        fillBinaryUnknown(list, `after ${kind}.set() the analysis cannot follow`);
        return UNDEFINED_VALUE;
      }
      first.items.forEach((item, index) => {
        list.items[offset + index] = item;
      });
      return UNDEFINED_VALUE;
    }
    default:
      return null;
  }
};
