export const ABSTRACTION = "Abstraction";

export const ARITHMETIC = "Arithmetic";

export const LIMIT = 1_000_000_000;

const ABSTRACTION_DEFINITIONS = [
  `Infinity == ${LIMIT + 1}`,
  'Num(n) == {[kind |-> "number", value |-> n]}',
  'Str(s) == {[kind |-> "string", value |-> s]}',
  'Bool(b) == {[kind |-> "boolean", value |-> b]}',
  'Null == {[kind |-> "null"]}',
  'Undefined == {[kind |-> "undefined"]}',
  'NaN == {[kind |-> "NaN"]}',
  `Range(min, max, isMinIncluded, isMaxIncluded) ==
  {[kind |-> "range", min |-> min, max |-> max, isMinIncluded |-> isMinIncluded, isMaxIncluded |-> isMaxIncluded]}`,
  'OtherString(excluded) == {[kind |-> "other", isString |-> TRUE, excluded |-> excluded]}',
  'OtherValue(excluded) == {[kind |-> "other", isString |-> FALSE, excluded |-> excluded]}',
  'Object == {[kind |-> "object"]}',
  'Truthy == {[kind |-> "truthy"]}',
  'Falsy == {[kind |-> "falsy"]}',
  'Unknown == {[kind |-> "any"]}',
  `LOCAL IsExact(a) == a.kind \\in {"number", "string", "boolean", "null", "undefined", "NaN"}`,
  `LOCAL IsTruthy(a) ==
  CASE a.kind = "number" -> a.value /= 0
    [] a.kind = "string" -> a.value /= ""
    [] a.kind = "boolean" -> a.value
    [] OTHER -> FALSE`,
  `LOCAL InRange(r, n) ==
  /\\ IF r.isMinIncluded THEN r.min <= n ELSE r.min < n
  /\\ IF r.isMaxIncluded THEN n <= r.max ELSE n < r.max`,
  `LOCAL Contains(c, e) ==
  CASE c.kind = "range" -> e.kind = "number" /\\ InRange(c, e.value)
    [] c.kind = "other" -> (~c.isString \\/ e.kind = "string") /\\ e \\notin c.excluded
    [] c.kind = "object" -> FALSE
    [] c.kind = "truthy" -> IsTruthy(e)
    [] c.kind = "falsy" -> ~IsTruthy(e)
    [] c.kind = "any" -> TRUE
    [] OTHER -> c = e`,
  `LOCAL RangesOverlap(l, r) ==
  CASE l.max < r.min \\/ r.max < l.min -> FALSE
    [] l.max = r.min -> l.isMaxIncluded /\\ r.isMinIncluded
    [] r.max = l.min -> r.isMaxIncluded /\\ l.isMinIncluded
    [] OTHER -> TRUE`,
  `LOCAL RangeOverlaps(o, r) ==
  CASE o.kind = "range" -> RangesOverlap(o, r)
    [] o.kind = "truthy" -> ~(r.min = 0 /\\ r.max = 0)
    [] o.kind = "falsy" -> InRange(r, 0)
    [] OTHER -> o.kind = "other" /\\ ~o.isString`,
  `LOCAL OtherOverlaps(o, v) ==
  CASE o.kind \\in {"other", "truthy"} -> TRUE
    [] o.kind = "falsy" -> [kind |-> "string", value |-> ""] \\notin v.excluded
    [] OTHER -> ~v.isString`,
  `LOCAL Overlaps(o, v) ==
  CASE o.kind = "any" \\/ v.kind = "any" -> TRUE
    [] IsExact(v) -> Contains(o, v)
    [] IsExact(o) -> Contains(v, o)
    [] v.kind = "range" -> RangeOverlaps(o, v)
    [] v.kind = "other" -> OtherOverlaps(o, v)
    [] v.kind = "object" -> o.kind \\in {"object", "truthy", "other"}
    [] v.kind = "truthy" -> o.kind /= "falsy"
    [] OTHER -> o.kind \\in {"falsy", "other", "range"}`,
  `Labels(f, S) ==
  LET overlapping == {label \\in DOMAIN f : \\E a \\in f[label], b \\in S : Overlaps(a, b)}
  IN IF overlapping = {} THEN DOMAIN f ELSE overlapping`,
];

const ARITHMETIC_DEFINITIONS = [
  `LOCAL Limit == ${LIMIT}`,
  "LOCAL Low(n) == IF n < -Limit THEN -Infinity ELSE IF n > Limit THEN Limit ELSE n",
  "LOCAL High(n) == IF n > Limit THEN Infinity ELSE IF n < -Limit THEN -Limit ELSE n",
  `LOCAL RangeOf(min, max, isMinIncluded, isMaxIncluded) ==
  [kind |-> "range",
   min |-> Low(min),
   max |-> High(max),
   isMinIncluded |-> isMinIncluded \\/ Low(min) /= min,
   isMaxIncluded |-> isMaxIncluded \\/ High(max) /= max]`,
  `LOCAL NumberOf(n) ==
  IF -Limit <= n /\\ n <= Limit THEN [kind |-> "number", value |-> n] ELSE RangeOf(n, n, TRUE, TRUE)`,
  "LOCAL ShiftBound(b, n) == IF b \\in {-Infinity, Infinity} THEN b ELSE b + n",
  `LOCAL Shift(a, n) ==
  CASE a.kind = "number" -> NumberOf(a.value + n)
    [] a.kind = "NaN" -> a
    [] a.kind = "range" ->
         RangeOf(ShiftBound(a.min, n), ShiftBound(a.max, n), a.isMinIncluded, a.isMaxIncluded)
    [] OTHER -> [kind |-> "any"]`,
  "LOCAL SumBound(a, b) == IF a \\in {-Infinity, Infinity} THEN a ELSE ShiftBound(b, a)",
  `LOCAL CanSumToNaN(l, r) ==
  \\/ l.max = Infinity /\\ l.isMaxIncluded /\\ r.min = -Infinity /\\ r.isMinIncluded
  \\/ l.min = -Infinity /\\ l.isMinIncluded /\\ r.max = Infinity /\\ r.isMaxIncluded
  \\/ {l.min, r.min} = {-Infinity, Infinity}
  \\/ {l.max, r.max} = {-Infinity, Infinity}`,
  `LOCAL AddRanges(l, r) ==
  IF CanSumToNaN(l, r)
  THEN [kind |-> "any"]
  ELSE RangeOf(SumBound(l.min, r.min), SumBound(l.max, r.max),
               l.isMinIncluded /\\ r.isMinIncluded, l.isMaxIncluded /\\ r.isMaxIncluded)`,
  `LOCAL Add(l, r) ==
  CASE r.kind = "number" -> Shift(l, r.value)
    [] l.kind = "number" -> Shift(r, l.value)
    [] l.kind = "range" /\\ r.kind = "range" -> AddRanges(l, r)
    [] OTHER -> [kind |-> "any"]`,
  `LOCAL Negate(a) ==
  CASE a.kind = "number" -> NumberOf(-a.value)
    [] a.kind = "NaN" -> a
    [] OTHER -> [kind |-> "any"]`,
  "Plus(S, T) == {Add(a, b) : a \\in S, b \\in T}",
  "Negative(S) == {Negate(a) : a \\in S}",
  "Minus(S, T) == Plus(S, Negative(T))",
];

const getPublicNames = (definitions: string[]): string[] =>
  definitions
    .filter((definition) => !definition.startsWith("LOCAL "))
    .map((definition) => definition.split(/[ (]/)[0]);

export const ABSTRACTION_NAMES = [
  ABSTRACTION,
  ARITHMETIC,
  "Values",
  ...getPublicNames(ABSTRACTION_DEFINITIONS),
  ...getPublicNames(ARITHMETIC_DEFINITIONS),
];

const formatModule = (name: string, extended: string, definitions: string[]): string =>
  [
    `---- MODULE ${name} ----`,
    `EXTENDS ${extended}`,
    ...definitions.flatMap((definition) => ["", definition]),
    "====",
  ].join("\n");

export const LIBRARY_MODULES: ReadonlyMap<string, string> = new Map([
  [ABSTRACTION, formatModule(ABSTRACTION, "Integers, TLC", ABSTRACTION_DEFINITIONS)],
  [ARITHMETIC, formatModule(ARITHMETIC, ABSTRACTION, ARITHMETIC_DEFINITIONS)],
]);
