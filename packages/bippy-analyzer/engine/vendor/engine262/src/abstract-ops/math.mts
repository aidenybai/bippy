/** https://tc39.es/ecma262/#eqn-truncate */
export function truncateDiv(x: bigint, y: bigint): bigint {
  // https://tc39.es/ecma262/#sec-numeric-types-bigint-divide
  return x / y;
}

export function truncate(x: number) {
  const xd = Math.trunc(x);
  if (Object.is(xd, -0)) return 0;
  return xd;
}

/** https://tc39.es/ecma262/#eqn-floor */
export function floorDiv(x: bigint, y: bigint): bigint {
  // Return floor(x / y) (round toward -infinity).
  const q = x / y; // truncating division toward 0
  if (x % y !== 0n && ((x < 0n) !== (y < 0n))) {
    return q - 1n;
  }
  return q;
}

/** https://tc39.es/ecma262/#eqn-abs */
export function abs(x: number): number
export function abs(x: bigint): bigint
export function abs(x: bigint | number): bigint | number
export function abs(x: bigint | number): bigint | number {
  if (x < 0) {
    return -x;
  }
  return x;
}

/** https://tc39.es/ecma262/#clamping */
export function clamp<T extends bigint>(lower: T, x: T, upper: T): T
export function clamp(lower: number, x: number, upper: number): number
export function clamp(lower: number | bigint, x: number | bigint, upper: number | bigint): number | bigint {
  if (x < lower) return lower;
  if (x > upper) return upper;
  return x;
}

/** https://tc39.es/ecma262/#eqn-min */
export function min(x: bigint, y: bigint): bigint {
  return x < y ? x : y;
}

/** https://tc39.es/ecma262/#eqn-max */
export function max(x: bigint, y: bigint): bigint {
  return x > y ? x : y;
}

/** https://tc39.es/ecma262/#eqn-modulo */
export function modulo(x: bigint, y: bigint): bigint
export function modulo(x: number, y: number): number
export function modulo(x: number | bigint, y: number | bigint): number | bigint {
  // (x % y + y) % y
  return (((x as bigint) % (y as bigint)) + (y as bigint)) % (y as bigint);
}

/** https://tc39.es/ecma262/#eqn-remainder */
export function remainder(x: bigint, y: bigint): bigint
export function remainder(x: number, y: number): number
export function remainder(x: number | bigint, y: number | bigint): number | bigint {
  if (typeof x === 'bigint' && typeof y === 'bigint') {
    return (x >= 0 ? modulo(abs(x), y) : -modulo(abs(x), y));
  } else if (typeof x === 'number' && typeof y === 'number') {
    return (x >= 0 ? modulo(Math.abs(x), y) : -modulo(Math.abs(x), y));
  } else {
    throw new TypeError('Mismatched types for remainder operation');
  }
}

/** https://tc39.es/ecma262/#eqn-ceiling */
export function ceiling(x: number): number
export function ceiling(x: bigint): bigint
export function ceiling(x: number | bigint): number | bigint {
  if (typeof x === 'bigint') {
    return x;
  } else {
    return Math.ceil(x);
  }
}
