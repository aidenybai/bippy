const FLOAT16_FRACTION_BITS = 10;
const FLOAT16_EXPONENT_BITS = 5;
const FLOAT16_BIAS = 15;
const FLOAT16_CANONICAL_NAN_BITS = 0x7E00;

const FLOAT32_FRACTION_BITS = 23;
const FLOAT32_EXPONENT_BITS = 8;
const FLOAT32_BIAS = 127;
const FLOAT32_CANONICAL_NAN_BITS = 0x7FC00000;

const FLOAT64_FRACTION_BITS = 52;
const FLOAT64_EXPONENT_BITS = 11;
const FLOAT64_BIAS = 1023;
const FLOAT64_CANONICAL_NAN_BITS = 0x7FF8000000000000n;

interface FloatFormat {
  readonly fractionBits: number;
  readonly exponentBits: number;
  readonly exponentBias: number;
  readonly canonicalNaNBits: bigint;
}

const FLOAT16_FORMAT: FloatFormat = {
  fractionBits: FLOAT16_FRACTION_BITS,
  exponentBits: FLOAT16_EXPONENT_BITS,
  exponentBias: FLOAT16_BIAS,
  canonicalNaNBits: BigInt(FLOAT16_CANONICAL_NAN_BITS),
};

const FLOAT32_FORMAT: FloatFormat = {
  fractionBits: FLOAT32_FRACTION_BITS,
  exponentBits: FLOAT32_EXPONENT_BITS,
  exponentBias: FLOAT32_BIAS,
  canonicalNaNBits: BigInt(FLOAT32_CANONICAL_NAN_BITS),
};

const FLOAT64_FORMAT: FloatFormat = {
  fractionBits: FLOAT64_FRACTION_BITS,
  exponentBits: FLOAT64_EXPONENT_BITS,
  exponentBias: FLOAT64_BIAS,
  canonicalNaNBits: FLOAT64_CANONICAL_NAN_BITS,
};

function bitsToLittleEndianBytes(bits: bigint, byteCount: number) {
  const bytes = new Array<number>(byteCount);
  for (let i = 0; i < byteCount; i += 1) {
    bytes[i] = Number((bits >> BigInt(i * 8)) & 0xFFn);
  }
  return bytes;
}

function littleEndianBytesToBits(rawBytes: readonly number[]) {
  let bits = 0n;
  for (let i = 0; i < rawBytes.length; i += 1) {
    bits |= BigInt(rawBytes[i]!) << BigInt(i * 8);
  }
  return bits;
}

function roundShiftRightToEven(value: bigint, shift: number) {
  if (shift <= 0) {
    return value << BigInt(-shift);
  }
  const quotient = value >> BigInt(shift);
  const remainderMask = (1n << BigInt(shift)) - 1n;
  const remainder = value & remainderMask;
  const half = 1n << BigInt(shift - 1);
  if (remainder > half) {
    return quotient + 1n;
  }
  if (remainder < half) {
    return quotient;
  }
  return quotient & 1n ? quotient + 1n : quotient;
}

function decomposeFiniteNumber(value: number) {
  const abs = Math.abs(value);
  if (abs < 2 ** -1022) {
    return {
      sign: Object.is(value, -0) || value < 0 ? 1n : 0n,
      significand: BigInt(abs / 2 ** -1074),
      exponent: -1074,
    };
  }

  let exponent = Math.floor(Math.log2(abs));
  const scaled = abs / 2 ** exponent;
  if (scaled < 1) {
    exponent -= 1;
  } else if (scaled >= 2) {
    exponent += 1;
  }

  return {
    sign: Object.is(value, -0) || value < 0 ? 1n : 0n,
    significand: BigInt(abs / 2 ** (exponent - FLOAT64_FRACTION_BITS)),
    exponent: exponent - FLOAT64_FRACTION_BITS,
  };
}

function encodeFloatBits(value: number, format: FloatFormat) {
  const maxExponentBits = (1n << BigInt(format.exponentBits)) - 1n;
  const signBitShift = BigInt(format.exponentBits + format.fractionBits);

  if (Number.isNaN(value)) {
    return format.canonicalNaNBits;
  }

  const sign = Object.is(value, -0) || value < 0 ? 1n : 0n;
  if (!Number.isFinite(value)) {
    return (sign << signBitShift) | (maxExponentBits << BigInt(format.fractionBits));
  }
  if (value === 0) {
    return sign << signBitShift;
  }

  const { significand, exponent } = decomposeFiniteNumber(value);
  const significandBits = significand.toString(2).length;
  let unbiasedExponent = exponent + significandBits - 1;
  const minNormalExponent = 1 - format.exponentBias;
  const maxNormalExponent = format.exponentBias;
  const targetPrecision = format.fractionBits + 1;

  if (unbiasedExponent >= minNormalExponent) {
    const shift = unbiasedExponent - format.fractionBits;
    let roundedSignificand = exponent >= shift
      ? significand << BigInt(exponent - shift)
      : roundShiftRightToEven(significand, shift - exponent);

    const roundedWidth = roundedSignificand.toString(2).length;
    if (roundedWidth > targetPrecision) {
      roundedSignificand >>= 1n;
      unbiasedExponent += 1;
    }

    if (unbiasedExponent > maxNormalExponent) {
      return (sign << signBitShift) | (maxExponentBits << BigInt(format.fractionBits));
    }

    const exponentBits = BigInt(unbiasedExponent + format.exponentBias);
    const fractionMask = (1n << BigInt(format.fractionBits)) - 1n;
    const fractionBits = roundedSignificand & fractionMask;
    return (sign << signBitShift) | (exponentBits << BigInt(format.fractionBits)) | fractionBits;
  }

  const subnormalShift = minNormalExponent - format.fractionBits;
  const subnormalSignificand = exponent >= subnormalShift
    ? significand << BigInt(exponent - subnormalShift)
    : roundShiftRightToEven(significand, subnormalShift - exponent);

  if (subnormalSignificand === 0n) {
    return sign << signBitShift;
  }

  const normalThreshold = 1n << BigInt(format.fractionBits);
  if (subnormalSignificand >= normalThreshold) {
    return (sign << signBitShift) | (1n << BigInt(format.fractionBits));
  }

  return (sign << signBitShift) | subnormalSignificand;
}

function decodeFloatBits(bits: bigint, format: FloatFormat) {
  const signShift = BigInt(format.exponentBits + format.fractionBits);
  const sign = (bits >> signShift) & 1n;
  const exponentMask = (1n << BigInt(format.exponentBits)) - 1n;
  const fractionMask = (1n << BigInt(format.fractionBits)) - 1n;
  const exponentBits = Number((bits >> BigInt(format.fractionBits)) & exponentMask);
  const fractionBits = bits & fractionMask;
  const signMultiplier = sign === 0n ? 1 : -1;

  if (exponentBits === Number(exponentMask)) {
    if (fractionBits === 0n) {
      return signMultiplier === 1 ? Infinity : -Infinity;
    }
    return NaN;
  }

  if (exponentBits === 0) {
    if (fractionBits === 0n) {
      return signMultiplier === 1 ? 0 : -0;
    }
    return signMultiplier * Number(fractionBits) * 2 ** (1 - format.exponentBias - format.fractionBits);
  }

  return signMultiplier * (1 + Number(fractionBits) / 2 ** format.fractionBits) * 2 ** (exponentBits - format.exponentBias);
}

export function encodeFloat16(value: number) {
  return bitsToLittleEndianBytes(encodeFloatBits(value, FLOAT16_FORMAT), 2);
}

export function decodeFloat16(rawBytes: readonly number[]) {
  return decodeFloatBits(littleEndianBytesToBits(rawBytes), FLOAT16_FORMAT);
}

export function encodeFloat32(value: number) {
  return bitsToLittleEndianBytes(encodeFloatBits(value, FLOAT32_FORMAT), 4);
}

export function decodeFloat32(rawBytes: readonly number[]) {
  return decodeFloatBits(littleEndianBytesToBits(rawBytes), FLOAT32_FORMAT);
}

export function encodeFloat64(value: number) {
  return bitsToLittleEndianBytes(encodeFloatBits(value, FLOAT64_FORMAT), 8);
}

export function decodeFloat64(rawBytes: readonly number[]) {
  return decodeFloatBits(littleEndianBytesToBits(rawBytes), FLOAT64_FORMAT);
}
