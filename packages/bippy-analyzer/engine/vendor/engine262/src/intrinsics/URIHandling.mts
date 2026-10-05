import { Value, type Arguments } from '../value.mts';
import { CodePointAt, UTF16EncodeCodePoint } from '../static-semantics/all.mts';
import { Q, type ValueEvaluator } from '../completion.mts';
import {
  Assert,
  CreateBuiltinFunction,
  Realm,
  Throw,
  ToString,
} from '#self';
import type { CodePoint } from '#self';

function utf8Encode(codepoint: CodePoint) {
  if (codepoint <= 0x7F) {
    return [codepoint];
  }
  if (codepoint <= 0x07FF) {
    return [
      (((codepoint >> 6) & 0x1F) | 0xC0),
      (((codepoint >> 0) & 0x3F) | 0x80),
    ];
  }
  if (codepoint <= 0xFFFF) {
    return [
      (((codepoint >> 12) & 0x0F) | 0xE0),
      (((codepoint >> 6) & 0x3F) | 0x80),
      (((codepoint >> 0) & 0x3F) | 0x80),
    ];
  }
  if (codepoint <= 0x10FFFF) {
    return [
      (((codepoint >> 18) & 0x07) | 0xF0),
      (((codepoint >> 12) & 0x3F) | 0x80),
      (((codepoint >> 6) & 0x3F) | 0x80),
      (((codepoint >> 0) & 0x3F) | 0x80),
    ];
  }
  return null;
}

/** https://encoding.spec.whatwg.org/#utf-8-decoder */
function utf8Decode(bytes: readonly number[]): CodePoint | null {
  let codepoint = 0;
  let index = 0;
  let bytes_seen = 0;
  let bytes_needed = 0;
  let lower_boundary = 0x80;
  let upper_boundary = 0xBF;

  while (true) {
    // If byte is end-of-queue and UTF-8 bytes needed is not 0, then set UTF-8 bytes needed to 0 and return error.
    // If byte is end-of-queue, then return finished.
    if (!bytes.length) {
      if (bytes_needed === 0) {
        return null;
      }
      return codepoint as CodePoint;
    }

    const byte = bytes[index];
    if (bytes_needed === 0) {
      if (byte >= 0x00 && byte <= 0x7F) {
        return byte as CodePoint;
      } else if (byte >= 0xC2 && byte <= 0xDF) {
        bytes_needed = 1;
        codepoint = byte & 0x1F;
      } else if (byte >= 0xE0 && byte <= 0xEF) {
        if (byte === 0xE0) {
          lower_boundary = 0xA0;
        }
        if (byte === 0xED) {
          upper_boundary = 0x9F;
        }
        bytes_needed = 2;
        codepoint = byte & 0xF;
      } else if (byte >= 0xF0 && byte <= 0xF4) {
        if (byte === 0xF0) {
          lower_boundary = 0x90;
        }
        if (byte === 0xF4) {
          upper_boundary = 0x8F;
        }
        bytes_needed = 3;
        codepoint = byte & 0x7;
      } else {
        return null;
      }
      index += 1;
      continue;
    }

    if (byte < lower_boundary || byte > upper_boundary) {
      return null;
    }

    lower_boundary = 0x80;
    upper_boundary = 0xBF;

    codepoint = (codepoint << 6) | (byte & 0x3F);
    bytes_seen += 1;
    index += 1;

    if (bytes_seen === bytes_needed) {
      return codepoint as CodePoint;
    }
  }
}

/** https://tc39.es/ecma262/#sec-encode */
function Encode(string: string, extraUnescaped: string) {
  const len = string.length;
  let R = '';
  const alwaysUnescaped = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-.!~*\'()';
  const unescapedSet = alwaysUnescaped + extraUnescaped;
  let k = 0;
  while (k < len) {
    // Let C be the code unit at index k within string.
    const C = string[k];
    if (unescapedSet.includes(C)) {
      k += 1;
      R += C;
    } else {
      const cp = CodePointAt(string, k);
      if (cp.IsUnpairedSurrogate) {
        return Throw.URIError('URI malformed');
      }
      k += cp.CodeUnitCount;
      // Let Octets be the List of octets resulting by applying the UTF-8 transformation to cp.[[CodePoint]].
      const Octets = utf8Encode(cp.CodePoint)!;
      Octets.forEach((octet) => {
        const hex = octet.toString(16).toUpperCase().padStart(2, '0');
        R = `${R}%${hex}`;
      });
    }
  }
  return Value(R);
}

/** https://tc39.es/ecma262/#sec-decode */
function Decode(string: string, preserveEscapeSet: string) {
  const len = string.length;
  let R = '';
  let k = 0;
  while (k < len) {
    // Let C be the code unit at index k within string.
    const C = string[k];
    let S = C;
    if (C === '\u{0025}') {
      if (k + 3 > len) {
        return Throw.URIError('URI malformed');
      }
      const escape = string.substring(k, k + 3);
      const B = ParseHexOctet(string, k + 1);
      if (typeof B !== 'number') {
        return Throw.URIError('URI malformed');
      }
      k += 2;
      // Let n be the number of leading 1 bits in B.
      const n = B.toString(2).padStart(8, '0').match(/^1+/)?.[0].length || 0;
      if (n === 0) {
        // Let asciiChar be the code unit whose numeric value is B.
        const asciiChar = String.fromCharCode(B);
        if (preserveEscapeSet.includes(asciiChar)) {
          S = escape;
        } else {
          S = asciiChar;
        }
      } else {
        if (n === 1 || n > 4) {
          return Throw.URIError('URI malformed');
        }
        const Octets = [B];
        let j = 1;
        while (j < n) {
          k += 1;
          if (k + 3 > len) {
            return Throw.URIError('URI malformed');
          }
          // If the code unit at index k within string is not U+0025 PERCENT SIGN (%),
          if (string[k] !== '\u{0025}') {
            return Throw.URIError('URI malformed');
          }
          const continuationByte = ParseHexOctet(string, k + 1);
          if (typeof continuationByte !== 'number') {
            return Throw.URIError('URI malformed');
          }
          Octets.push(continuationByte);
          k += 2;
          j += 1;
        }
        Assert(Octets.length === n);
        // If Octets does not contain a valid UTF-8 encoding of a Unicode code point, ...
        // Let V be the code point obtained by applying the UTF-8 transformation to Octets, that is, from a List of octets into a 21-bit value.
        const V = utf8Decode(Octets);
        if (V === null) {
          return Throw.URIError('URI malformed');
        }
        S = UTF16EncodeCodePoint(V);
      }
    }
    R += S;
    k += 1;
  }
  return Value(R);
}

function ParseHexOctet(string: string, position: number): number | string[] {
  const len = string.length;
  Assert(position + 2 <= len);
  const hexDigits = string.substring(position, position + 2);
  // Let parseResult be ParseText(hexDigits, HexDigits[~Sep]).
  // If parseResult is not a Parse Node, return parseResult.
  if (!/^[0-9A-Fa-f]{2}$/.test(hexDigits)) {
    return [];
  }
  const parseResult = parseInt(hexDigits, 16);
  if (Number.isNaN(parseResult)) {
    return [];
  }
  const n = parseResult;
  // eslint-disable-next-line yoda
  Assert(0 <= n && n <= 255);
  return n;
}

/** https://tc39.es/ecma262/#sec-decodeuri-encodeduri */
function* decodeURI([encodedURI = Value.undefined]: Arguments): ValueEvaluator {
  // 1. Let uriString be ? ToString(encodedURI).
  const uriString = Q(yield* ToString(encodedURI));
  // 2. Let preserveEscapeSet be ";/?:@&=+$,#".
  const preserveEscapeSet = ';/?:@&=+$,#';
  // 3. Return ? Decode(uriString, reservedURISet).
  return Q(Decode(uriString, preserveEscapeSet));
}

/** https://tc39.es/ecma262/#sec-decodeuricomponent-encodeduricomponent */
function* decodeURIComponent([encodedURIComponent = Value.undefined]: Arguments): ValueEvaluator {
  // 1. Let componentString be ? ToString(encodedURIComponent).
  const componentString = Q(yield* ToString(encodedURIComponent));
  // 2. Let preserveEscapeSet be the empty String.
  const preserveEscapeSet = '';
  // 3. Return ? Decode(componentString, reservedURIComponentSet).
  return Q(Decode(componentString, preserveEscapeSet));
}

/** https://tc39.es/ecma262/#sec-encodeuri-uri */
function* encodeURI([uri = Value.undefined]: Arguments): ValueEvaluator {
  // 1. Let uriString be ? ToString(uri).
  const uriString = Q(yield* ToString(uri));
  // 2. Let extraUnescaped be ";/?:@&=+$,#".
  const extraUnescaped = ';/?:@&=+$,#';
  // 3. Return ? Encode(uriString, unescapedURISet).
  return Q(Encode(uriString, extraUnescaped));
}

/** https://tc39.es/ecma262/#sec-encodeuricomponent-uricomponent */
function* encodeURIComponent([uriComponent = Value.undefined]: Arguments): ValueEvaluator {
  // 1. Let componentString be ? ToString(uriComponent).
  const componentString = Q(yield* ToString(uriComponent));
  // 2. Let extraUnescaped be the empty String.
  const extraUnescaped = '';
  // 3. Return ? Encode(componentString, unescapedURIComponentSet).
  return Q(Encode(componentString, extraUnescaped));
}

export function bootstrapURIHandling(realmRec: Realm) {
  ([
    ['decodeURI', decodeURI, 1],
    ['decodeURIComponent', decodeURIComponent, 1],
    ['encodeURI', encodeURI, 1],
    ['encodeURIComponent', encodeURIComponent, 1],
  ] as const).forEach(([name, f, length]) => {
    realmRec.Intrinsics[`%${name}%`] = CreateBuiltinFunction(f, length, Value(name), [], realmRec);
  });
}
