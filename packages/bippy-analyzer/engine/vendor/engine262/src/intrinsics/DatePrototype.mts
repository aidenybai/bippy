import {
  JSStringValue,
  NumberValue,
  ObjectValue,
  Value,
  wellKnownSymbols,
  type Arguments,
  type FunctionCallContext,
} from '../value.mts';
import {
  Q, X, type ValueCompletion, type ValueEvaluator,
} from '../completion.mts';
import { StringPad } from '../runtime-semantics/all.mts';
import { abs, truncateDiv } from '../abstract-ops/math.mts';
import {
  GetNamedTimeZoneOffsetNanoseconds, SystemTimeZoneIdentifier,
} from '../abstract-ops/temporal/addition.mts';
import { FormatTimeString } from '../abstract-ops/temporal/temporal.mts';
import { FormatOffsetTimeZoneIdentifier } from '../abstract-ops/temporal/time-zone.mts';
import { ParseTimeZoneIdentifier } from '../parser/TemporalParser.mts';
import { bootstrapPrototype } from './bootstrap.mts';
import type { DateObject } from './Date.mts';
import {
  surroundingAgent,
  Assert,
  DateFromTime,
  Day,
  HourFromTime,
  Invoke,
  LocalTime,
  MakeDate,
  MakeDay,
  MakeTime,
  MinuteFromTime,
  MonthFromTime,
  MillisecondFromTime,
  MillisecondsPerMinute,
  OrdinaryToPrimitive,
  SecondFromTime,
  TimeClip,
  TimeWithinDay,
  ToNumber,
  ToPrimitive,
  ToObject,
  UTC,
  WeekDay,
  YearFromTime,
  F, R,
  CreateTemporalInstant,
  Throw,
  NanosecondsPerMillisecond,
  NanosecondsPerMinute,
} from '#self';
import type { Realm } from '#self';


export function thisTimeValue(value: Value): ValueCompletion<NumberValue> {
  if (value instanceof ObjectValue && 'DateValue' in value) {
    return Value((value as DateObject).DateValue);
  }
  return Throw.TypeError('$1 is not a $2 object', value, 'Date');
}

/** https://tc39.es/ecma262/#sec-date.prototype.getdate */
function DateProto_getDate(_args: Arguments, { thisValue }: FunctionCallContext): ValueCompletion {
  const t = Q(thisTimeValue(thisValue));
  if (t.isNaN()) {
    return F(NaN);
  }
  return Value(Number(DateFromTime(LocalTime(R(t)))));
}

/** https://tc39.es/ecma262/#sec-date.prototype.getday */
function DateProto_getDay(_args: Arguments, { thisValue }: FunctionCallContext): ValueCompletion {
  const t = Q(thisTimeValue(thisValue));
  if (t.isNaN()) {
    return F(NaN);
  }
  return Value(Number(WeekDay(LocalTime(R(t)))));
}

/** https://tc39.es/ecma262/#sec-date.prototype.getfullyear */
function DateProto_getFullYear(_args: Arguments, { thisValue }: FunctionCallContext): ValueCompletion {
  const t = Q(thisTimeValue(thisValue));
  if (t.isNaN()) {
    return F(NaN);
  }
  return Value(Number(YearFromTime(LocalTime(R(t)))));
}

/** https://tc39.es/ecma262/#sec-date.prototype.gethours */
function DateProto_getHours(_args: Arguments, { thisValue }: FunctionCallContext): ValueCompletion {
  const t = Q(thisTimeValue(thisValue));
  if (t.isNaN()) {
    return F(NaN);
  }
  return Value(Number(HourFromTime(LocalTime(R(t)))));
}

/** https://tc39.es/ecma262/#sec-date.prototype.getmilliseconds */
function DateProto_getMilliseconds(_args: Arguments, { thisValue }: FunctionCallContext): ValueCompletion {
  const t = Q(thisTimeValue(thisValue));
  if (t.isNaN()) {
    return F(NaN);
  }
  return Value(Number(MillisecondFromTime(LocalTime(R(t)))));
}

/** https://tc39.es/ecma262/#sec-date.prototype.getminutes */
function DateProto_getMinutes(_args: Arguments, { thisValue }: FunctionCallContext): ValueCompletion {
  const t = Q(thisTimeValue(thisValue));
  if (t.isNaN()) {
    return F(NaN);
  }
  return Value(Number(MinuteFromTime(LocalTime(R(t)))));
}

/** https://tc39.es/ecma262/#sec-date.prototype.getmonth */
function DateProto_getMonth(_args: Arguments, { thisValue }: FunctionCallContext): ValueCompletion {
  const t = Q(thisTimeValue(thisValue));
  if (t.isNaN()) {
    return F(NaN);
  }
  return Value(Number(MonthFromTime(LocalTime(R(t)))));
}

/** https://tc39.es/ecma262/#sec-date.prototype.getseconds */
function DateProto_getSeconds(_args: Arguments, { thisValue }: FunctionCallContext): ValueCompletion {
  const t = Q(thisTimeValue(thisValue));
  if (t.isNaN()) {
    return F(NaN);
  }
  return Value(Number(SecondFromTime(LocalTime(R(t)))));
}

/** https://tc39.es/ecma262/#sec-date.prototype.gettime */
function DateProto_getTime(_args: Arguments, { thisValue }: FunctionCallContext): ValueCompletion {
  return Q(thisTimeValue(thisValue));
}

/** https://tc39.es/ecma262/#sec-date.prototype.gettimezoneoffset */
function DateProto_getTimezoneOffset(_args: Arguments, { thisValue }: FunctionCallContext): ValueCompletion {
  const t = Q(thisTimeValue(thisValue));
  if (t.isNaN()) {
    return F(NaN);
  }
  return F((R(t) - LocalTime(R(t))) / Number(MillisecondsPerMinute));
}

/** https://tc39.es/ecma262/#sec-date.prototype.getutcdate */
function DateProto_getUTCDate(_args: Arguments, { thisValue }: FunctionCallContext): ValueCompletion {
  const t = Q(thisTimeValue(thisValue));
  if (t.isNaN()) {
    return F(NaN);
  }
  return Value(Number(DateFromTime(R(t))));
}

/** https://tc39.es/ecma262/#sec-date.prototype.getutcday */
function DateProto_getUTCDay(_args: Arguments, { thisValue }: FunctionCallContext): ValueCompletion {
  const t = Q(thisTimeValue(thisValue));
  if (t.isNaN()) {
    return F(NaN);
  }
  return Value(Number(WeekDay(R(t))));
}

/** https://tc39.es/ecma262/#sec-date.prototype.getutcfullyear */
function DateProto_getUTCFullYear(_args: Arguments, { thisValue }: FunctionCallContext): ValueCompletion {
  const t = Q(thisTimeValue(thisValue));
  if (t.isNaN()) {
    return F(NaN);
  }
  return Value(Number(YearFromTime(R(t))));
}

/** https://tc39.es/ecma262/#sec-date.prototype.getutchours */
function DateProto_getUTCHours(_args: Arguments, { thisValue }: FunctionCallContext): ValueCompletion {
  const t = Q(thisTimeValue(thisValue));
  if (t.isNaN()) {
    return F(NaN);
  }
  return Value(Number(HourFromTime(R(t))));
}

/** https://tc39.es/ecma262/#sec-date.prototype.getutcmilliseconds */
function DateProto_getUTCMilliseconds(_args: Arguments, { thisValue }: FunctionCallContext): ValueCompletion {
  const t = Q(thisTimeValue(thisValue));
  if (t.isNaN()) {
    return F(NaN);
  }
  return Value(Number(MillisecondFromTime(R(t))));
}

/** https://tc39.es/ecma262/#sec-date.prototype.getutcminutes */
function DateProto_getUTCMinutes(_args: Arguments, { thisValue }: FunctionCallContext): ValueCompletion {
  const t = Q(thisTimeValue(thisValue));
  if (t.isNaN()) {
    return F(NaN);
  }
  return Value(Number(MinuteFromTime(R(t))));
}

/** https://tc39.es/ecma262/#sec-date.prototype.getutcmonth */
function DateProto_getUTCMonth(_args: Arguments, { thisValue }: FunctionCallContext): ValueCompletion {
  const t = Q(thisTimeValue(thisValue));
  if (t.isNaN()) {
    return F(NaN);
  }
  return Value(Number(MonthFromTime(R(t))));
}

/** https://tc39.es/ecma262/#sec-date.prototype.getutcseconds */
function DateProto_getUTCSeconds(_args: Arguments, { thisValue }: FunctionCallContext): ValueCompletion {
  const t = Q(thisTimeValue(thisValue));
  if (t.isNaN()) {
    return F(NaN);
  }
  return Value(Number(SecondFromTime(R(t))));
}

/** https://tc39.es/ecma262/#sec-date.prototype.setdate */
function* DateProto_setDate([date = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const t = Q(thisTimeValue(thisValue));
  const dt = Q(yield* ToNumber(date));
  if (t.isNaN()) {
    return t;
  }
  const _t = LocalTime(R(t));
  const newDate = MakeDate(MakeDay(Number(YearFromTime(_t)), Number(MonthFromTime(_t)), R(dt)), Number(TimeWithinDay(_t)));
  const u = TimeClip(UTC(newDate));
  Q(surroundingAgent.debugger_tryTouchDuringPreview(thisValue as DateObject));
  (thisValue as DateObject).DateValue = u;
  return Value(u);
}

/** https://tc39.es/ecma262/#sec-date.prototype.setfullyear */
function* DateProto_setFullYear([year = Value.undefined, month, date]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const t = Q(thisTimeValue(thisValue));
  const y = R(Q(yield* ToNumber(year)));
  const localTime = t.isNaN() ? 0 : LocalTime(R(t));
  let m: number;
  if (month !== undefined) {
    m = R(Q(yield* ToNumber(month)));
  } else {
    m = Number(MonthFromTime(localTime));
  }
  let dt: number;
  if (date !== undefined) {
    dt = R(Q(yield* ToNumber(date)));
  } else {
    dt = Number(DateFromTime(localTime));
  }
  const newDate = MakeDate(MakeDay(y, m, dt), Number(TimeWithinDay(localTime)));
  const u = TimeClip(UTC(newDate));
  Q(surroundingAgent.debugger_tryTouchDuringPreview(thisValue as DateObject));
  (thisValue as DateObject).DateValue = u;
  return Value(u);
}

/** https://tc39.es/ecma262/#sec-date.prototype.sethours */
function* DateProto_setHours([hour = Value.undefined, min, sec, ms]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const t = Q(thisTimeValue(thisValue));
  const h = R(Q(yield* ToNumber(hour)));
  let m: number | undefined;
  if (min) {
    m = R(Q(yield* ToNumber(min)));
  }
  let s: number | undefined;
  if (sec) {
    s = R(Q(yield* ToNumber(sec)));
  }
  let milli: number | undefined;
  if (ms !== undefined) {
    milli = R(Q(yield* ToNumber(ms)));
  }
  if (t.isNaN()) {
    return t;
  }
  const localTime = LocalTime(R(t));
  m ??= Number(MinuteFromTime(localTime));
  s ??= Number(SecondFromTime(localTime));
  milli ??= Number(MillisecondFromTime(localTime));
  const date = MakeDate(Number(Day(localTime)), MakeTime(h, m, s, milli));
  const u = TimeClip(UTC(date));
  Q(surroundingAgent.debugger_tryTouchDuringPreview(thisValue as DateObject));
  (thisValue as DateObject).DateValue = u;
  return Value(u);
}

/** https://tc39.es/ecma262/#sec-date.prototype.setmilliseconds */
function* DateProto_setMilliseconds([millisecond = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const t = Q(thisTimeValue(thisValue));
  millisecond = Q(yield* ToNumber(millisecond));
  if (t.isNaN()) {
    return t;
  }
  const _t = LocalTime(R(t));
  const time = MakeTime(Number(HourFromTime(_t)), Number(MinuteFromTime(_t)), Number(SecondFromTime(_t)), R(millisecond));
  const u = TimeClip(UTC(MakeDate(Number(Day(_t)), time)));
  Q(surroundingAgent.debugger_tryTouchDuringPreview(thisValue as DateObject));
  (thisValue as DateObject).DateValue = u;
  return Value(u);
}

/** https://tc39.es/ecma262/#sec-date.prototype.setminutes */
function* DateProto_setMinutes([min = Value.undefined, sec, ms]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  // 1. Let t be LocalTime(? thisTimeValue(this value)).
  const tv = Q(thisTimeValue(thisValue));
  // 2. Let m be ? ToNumber(min).
  const m = R(Q(yield* ToNumber(min)));
  let s: number | undefined;
  if (sec) {
    s = R(Q(yield* ToNumber(sec)));
  }
  let milli: number | undefined;
  if (ms) {
    milli = R(Q(yield* ToNumber(ms)));
  }
  if (tv.isNaN()) {
    return tv;
  }
  const t = LocalTime(R(tv));
  s ??= Number(SecondFromTime(t));
  milli ??= Number(MillisecondFromTime(t));
  // 5. Let date be MakeDate(Day(t), MakeTime(HourFromTime(t), m, s, milli)).
  const date = MakeDate(Number(Day(t)), MakeTime(Number(HourFromTime(t)), m, s, milli));
  // 6. Let u be TimeClip(UTC(date)).
  const u = TimeClip(UTC(date));
  // 7. Set the [[DateValue]] internal slot of this Date object to u.
  Q(surroundingAgent.debugger_tryTouchDuringPreview(thisValue as DateObject));
  (thisValue as DateObject).DateValue = u;
  // 8. Return u.
  return Value(u);
}

/** https://tc39.es/ecma262/#sec-date.prototype.setmonth */
function* DateProto_setMonth([month = Value.undefined, date]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const t = Q(thisTimeValue(thisValue));
  const m = R(Q(yield* ToNumber(month)));
  let dt: number | undefined;
  if (date) {
    dt = R(Q(yield* ToNumber(date)));
  }
  if (t.isNaN()) {
    return t;
  }
  const localTime = LocalTime(R(t));
  dt ??= Number(DateFromTime(localTime));
  const newDate = MakeDate(MakeDay(Number(YearFromTime(localTime)), m, dt), Number(TimeWithinDay(localTime)));
  const u = TimeClip(UTC(newDate));
  Q(surroundingAgent.debugger_tryTouchDuringPreview(thisValue as DateObject));
  (thisValue as DateObject).DateValue = u;
  return Value(u);
}

/** https://tc39.es/ecma262/#sec-date.prototype.setseconds */
function* DateProto_setSeconds([sec = Value.undefined, ms]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const t = Q(thisTimeValue(thisValue));
  const s = R(Q(yield* ToNumber(sec)));
  let milli: number | undefined;
  if (ms) {
    milli = R(Q(yield* ToNumber(ms)));
  }
  if (t.isNaN()) {
    return t;
  }
  const localTime = LocalTime(R(t));
  milli ??= Number(MillisecondFromTime(localTime));
  const date = MakeDate(Number(Day(localTime)), MakeTime(Number(HourFromTime(localTime)), Number(MinuteFromTime(localTime)), s, milli));
  const u = TimeClip(UTC(date));
  Q(surroundingAgent.debugger_tryTouchDuringPreview(thisValue as DateObject));
  (thisValue as DateObject).DateValue = u;
  return Value(u);
}

/** https://tc39.es/ecma262/#sec-date.prototype.settime */
function* DateProto_setTime([time = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  Q(thisTimeValue(thisValue));
  const t = R(Q(yield* ToNumber(time)));
  const v = TimeClip(t);
  Q(surroundingAgent.debugger_tryTouchDuringPreview(thisValue as DateObject));
  (thisValue as DateObject).DateValue = v;
  return Value(v);
}

/** https://tc39.es/ecma262/#sec-date.prototype.setutcdate */
function* DateProto_setUTCDate([date = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const t = Q(thisTimeValue(thisValue));
  const dt = Q(yield* ToNumber(date));
  if (t.isNaN()) {
    return t;
  }
  const newDate = MakeDate(MakeDay(Number(YearFromTime(R(t))), Number(MonthFromTime(R(t))), R(dt)), Number(TimeWithinDay(R(t))));
  const v = TimeClip(newDate);
  Q(surroundingAgent.debugger_tryTouchDuringPreview(thisValue as DateObject));
  (thisValue as DateObject).DateValue = v;
  return Value(v);
}

/** https://tc39.es/ecma262/#sec-date.prototype.setutcfullyear */
function* DateProto_setUTCFullYear([year = Value.undefined, month, date]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  let t = Q(thisTimeValue(thisValue));
  if (t.isNaN()) {
    t = F(+0);
  }
  const y = Q(yield* ToNumber(year));
  let m: number;
  if (month !== undefined) {
    m = R(Q(yield* ToNumber(month)));
  } else {
    m = Number(MonthFromTime(R(t)));
  }
  let dt: number;
  if (date !== undefined) {
    dt = R(Q(yield* ToNumber(date)));
  } else {
    dt = Number(DateFromTime(R(t)));
  }
  const newDate = MakeDate(MakeDay(R(y), m, dt), Number(TimeWithinDay(R(t))));
  const v = TimeClip(newDate);
  Q(surroundingAgent.debugger_tryTouchDuringPreview(thisValue as DateObject));
  (thisValue as DateObject).DateValue = v;
  return Value(v);
}

/** https://tc39.es/ecma262/#sec-date.prototype.setutchours */
function* DateProto_setUTCHours([hour = Value.undefined, min, sec, ms]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const t = Q(thisTimeValue(thisValue));
  const h = Q(yield* ToNumber(hour));
  let m: number | undefined;
  if (min) {
    m = R(Q(yield* ToNumber(min)));
  }
  let s: number | undefined;
  if (sec) {
    s = R(Q(yield* ToNumber(sec)));
  }
  let milli: number | undefined;
  if (ms) {
    milli = R(Q(yield* ToNumber(ms)));
  }
  if (t.isNaN()) {
    return t;
  }
  m ??= Number(MinuteFromTime(R(t)));
  s ??= Number(SecondFromTime(R(t)));
  milli ??= Number(MillisecondFromTime(R(t)));
  const date = MakeDate(Number(Day(R(t))), MakeTime(R(h), m, s, milli));
  const v = TimeClip(date);
  Q(surroundingAgent.debugger_tryTouchDuringPreview(thisValue as DateObject));
  (thisValue as DateObject).DateValue = v;
  return Value(v);
}

/** https://tc39.es/ecma262/#sec-date.prototype.setutcmilliseconds */
function* DateProto_setUTCMilliseconds([millisecond = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const _tv = Q(thisTimeValue(thisValue));
  millisecond = Q(yield* ToNumber(millisecond));
  if (_tv.isNaN()) {
    return _tv;
  }
  const tv = R(_tv);
  const time = MakeTime(Number(HourFromTime(tv)), Number(MinuteFromTime(tv)), Number(SecondFromTime(tv)), R(millisecond));
  const v = TimeClip(MakeDate(Number(Day(tv)), time));
  Q(surroundingAgent.debugger_tryTouchDuringPreview(thisValue as DateObject));
  (thisValue as DateObject).DateValue = v;
  return Value(v);
}

/** https://tc39.es/ecma262/#sec-date.prototype.setutcminutes */
function* DateProto_setUTCMinutes([min = Value.undefined, sec, ms]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const t = Q(thisTimeValue(thisValue));
  const m = Q(yield* ToNumber(min));
  let s;
  if (sec) {
    s = R(Q(yield* ToNumber(sec)));
  }
  let milli;
  if (ms) {
    milli = R(Q(yield* ToNumber(ms)));
  }
  if (t.isNaN()) {
    return t;
  }
  const _t = R(t);
  s ??= Number(SecondFromTime(_t));
  milli ??= Number(MillisecondFromTime(_t));
  const date = MakeDate(Number(Day(_t)), MakeTime(Number(HourFromTime(_t)), R(m), s, milli));
  const v = TimeClip(date);
  Q(surroundingAgent.debugger_tryTouchDuringPreview(thisValue as DateObject));
  (thisValue as DateObject).DateValue = v;
  return Value(v);
}

/** https://tc39.es/ecma262/#sec-date.prototype.setutcmonth */
function* DateProto_setUTCMonth([month = Value.undefined, date]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const t = Q(thisTimeValue(thisValue));
  const m = Q(yield* ToNumber(month));
  let dt: number | undefined;
  if (date) {
    dt = R(Q(yield* ToNumber(date)));
  }
  if (t.isNaN()) {
    return t;
  }
  const _t = R(t);
  dt ??= Number(DateFromTime(_t));
  const newDate = MakeDate(MakeDay(Number(YearFromTime(_t)), R(m), dt), Number(TimeWithinDay(_t)));
  const v = TimeClip(newDate);
  Q(surroundingAgent.debugger_tryTouchDuringPreview(thisValue as DateObject));
  (thisValue as DateObject).DateValue = v;
  return Value(v);
}

/** https://tc39.es/ecma262/#sec-date.prototype.setutcseconds */
function* DateProto_setUTCSeconds([sec = Value.undefined, ms]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const t = Q(thisTimeValue(thisValue));
  const s = Q(yield* ToNumber(sec));
  let milli: number;
  if (ms) {
    milli = R(Q(yield* ToNumber(ms)));
  }
  if (t.isNaN()) {
    return t;
  }
  const _t = R(t);
  milli ??= Number(MillisecondFromTime(_t));
  const date = MakeDate(Number(Day(_t)), MakeTime(Number(HourFromTime(_t)), Number(MinuteFromTime(_t)), R(s), milli));
  const v = TimeClip(date);
  Q(surroundingAgent.debugger_tryTouchDuringPreview(thisValue as DateObject));
  (thisValue as DateObject).DateValue = v;
  return Value(v);
}

/** https://tc39.es/ecma262/#sec-date.prototype.todatestring */
function* DateProto_toDateString(_args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const O = thisValue;
  if (!(O instanceof ObjectValue)) {
    return Throw.TypeError('$1 is not a $2 object', O, 'Date');
  }
  const tv = Q(thisTimeValue(O));
  if (tv.isNaN()) {
    return Value('Invalid Date');
  }
  const t = LocalTime(R(tv));
  return DateString(Value(t));
}

/** https://tc39.es/ecma262/#sec-date.prototype.toisostring */
export function DateProto_toISOString(_args: Arguments, { thisValue }: FunctionCallContext): ValueCompletion<JSStringValue> {
  const t = Q(thisTimeValue(thisValue));
  if (!t.isFinite()) {
    return Throw.RangeError('Invalid time');
  }
  const _t = R(t);
  const year = Number(YearFromTime(_t));
  const month = Number(MonthFromTime(_t)) + 1;
  const date = Number(DateFromTime(_t));
  const hour = Number(HourFromTime(_t));
  const min = Number(MinuteFromTime(_t));
  const sec = Number(SecondFromTime(_t));
  const ms = Number(MillisecondFromTime(_t));

  let YYYY = String(year).padStart(4, '0');
  if (year < 0 || year > 9999) {
    YYYY = year < 0 ? `-${String(-year).padStart(6, '0')}` : `+${String(year).padStart(6, '0')}`;
  }
  const MM = String(month).padStart(2, '0');
  const DD = String(date).padStart(2, '0');
  const HH = String(hour).padStart(2, '0');
  const mm = String(min).padStart(2, '0');
  const ss = String(sec).padStart(2, '0');
  const sss = String(ms).padStart(3, '0');
  const format = `${YYYY}-${MM}-${DD}T${HH}:${mm}:${ss}.${sss}Z`;
  return Value(format);
}

/** https://tc39.es/ecma262/#sec-date.prototype.tojson */
function* DateProto_toJSON(_args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const O = Q(ToObject(thisValue));
  const tv = Q(yield* ToPrimitive(O, 'number'));
  if (tv instanceof NumberValue && !Number.isFinite(R(tv))) {
    return Value.null;
  }
  return Q(yield* Invoke(O, 'toISOString'));
}

/** https://tc39.es/ecma262/#sec-date.prototype.tolocaledatestring */
function DateProto_toLocaleDateString(_args: Arguments, context: FunctionCallContext) {
  return DateProto_toString([], context);
}

/** https://tc39.es/ecma262/#sec-date.prototype.tolocalestring */
function DateProto_toLocaleString(_args: Arguments, context: FunctionCallContext) {
  return DateProto_toString([], context);
}

/** https://tc39.es/ecma262/#sec-date.prototype.tolocaletimestring */
function DateProto_toLocaleTimeString(_args: Arguments, context: FunctionCallContext) {
  return DateProto_toString([], context);
}

/** https://tc39.es/ecma262/#sec-date.prototype.tostring */
function DateProto_toString(_args: Arguments, { thisValue }: FunctionCallContext): ValueCompletion {
  const tv = Q(thisTimeValue(thisValue));
  return ToDateString(tv);
}

/** https://tc39.es/ecma262/#sec-timestring */
export function TimeString(tv: number): string {
  const timeString = FormatTimeString(
    HourFromTime(tv),
    MinuteFromTime(tv),
    SecondFromTime(tv),
    0n,
    0n,
  );
  return `${timeString} GMT`;
}

/** https://tc39.es/ecma262/#sec-todatestring-day-names */
const daysOfTheWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
/** https://tc39.es/ecma262/#sec-todatestring-month-names */
const monthsOfTheYear = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** https://tc39.es/ecma262/#sec-datestring */
function DateString(tv: NumberValue) {
  Assert(tv instanceof NumberValue);
  Assert(!tv.isNaN());
  const _tv = R(tv);
  const weekday = daysOfTheWeek[Number(WeekDay(_tv))];
  const month = monthsOfTheYear[Number(MonthFromTime(_tv))];
  const day = String(DateFromTime(_tv)).padStart(2, '0');
  const yv = YearFromTime(_tv);
  const yearSign = yv >= 0 ? '' : '-';
  const year = Value(String(abs(yv)));
  const paddedYear = X(StringPad(year, F(4), Value('0'), 'start'));
  return Value(`${weekday} ${month} ${day} ${yearSign}${paddedYear}`);
}

/** https://tc39.es/ecma262/#sec-timezoneestring */
export function TimeZoneString(tv: number): string {
  const systemTimeZoneIdentifier = SystemTimeZoneIdentifier();
  let offsetMinutes = X(ParseTimeZoneIdentifier(systemTimeZoneIdentifier)).OffsetMinutes;
  if (offsetMinutes === undefined) {
    const offsetNanoseconds = GetNamedTimeZoneOffsetNanoseconds(systemTimeZoneIdentifier, BigInt(tv) * NanosecondsPerMillisecond);
    offsetMinutes = truncateDiv(offsetNanoseconds, NanosecondsPerMinute);
  }
  const offsetString = FormatOffsetTimeZoneIdentifier(offsetMinutes, 'unseparated');
  const tzName = '';
  return offsetString + tzName;
}

/** https://tc39.es/ecma262/#sec-todatestring */
export function ToDateString(tv: NumberValue) {
  Assert(tv instanceof NumberValue);
  if (tv.isNaN()) {
    return Value('Invalid Date');
  }
  const t = LocalTime(R(tv));
  return Value(`${DateString(Value(t)).stringValue()} ${TimeString(t)}${TimeZoneString(R(tv))}`);
}

/** https://tc39.es/ecma262/#sec-date.prototype.totimestring */
function DateProto_toTimeString(_args: Arguments, { thisValue }: FunctionCallContext): ValueCompletion {
  const O = thisValue;
  if (!(O instanceof ObjectValue)) {
    return Throw.TypeError('$1 is not a $2 object', O, 'Date');
  }
  const tv = Q(thisTimeValue(O));
  if (tv.isNaN()) {
    return Value('Invalid Date');
  }
  const t = LocalTime(R(tv));
  return Value(`${TimeString(t)}${TimeZoneString(R(tv))}`);
}

/** https://tc39.es/proposal-temporal/#sec-date.prototype.totemporalinstant */
function DateProto_toTemporalInstant(_args: Arguments, { thisValue }: FunctionCallContext): ValueCompletion {
  const dateObject = thisValue;
  const tv = Q(thisTimeValue(dateObject));
  if (!tv.isIntegralNumber()) return Throw.RangeError('Date value is not an integral number');
  const epochNanoseconds = BigInt(R(tv)) * NanosecondsPerMillisecond;
  return X(CreateTemporalInstant(epochNanoseconds));
}

/** https://tc39.es/ecma262/#sec-date.prototype.toutcstring */
function DateProto_toUTCString(_args: Arguments, { thisValue }: FunctionCallContext): ValueCompletion {
  const O = thisValue;
  if (!(O instanceof ObjectValue)) {
    return Throw.TypeError('$1 is not a $2 object', O, 'Date');
  }
  const tv = Q(thisTimeValue(O));
  if (tv.isNaN()) {
    return Value('Invalid Date');
  }
  const weekday = daysOfTheWeek[Number(WeekDay(R(tv)))];
  const month = monthsOfTheYear[Number(MonthFromTime(R(tv)))];
  const day = String(DateFromTime(R(tv))).padStart(2, '0');
  const yv = YearFromTime(R(tv));
  const yearSign = yv >= 0 ? '' : '-';
  const year = Value(String(abs(yv)));
  const paddedYear = X(StringPad(year, F(4), Value('0'), 'start'));
  return Value(`${weekday}, ${day} ${month} ${yearSign}${paddedYear} ${TimeString(R(tv))}`);
}

/** https://tc39.es/ecma262/#sec-date.prototype.valueof */
function DateProto_valueOf(_args: Arguments, { thisValue }: FunctionCallContext): ValueCompletion {
  return Q(thisTimeValue(thisValue));
}

/** https://tc39.es/ecma262/#sec-date.prototype-@@toprimitive */
function* DateProto_toPrimitive([hint = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const O = thisValue;
  if (!(O instanceof ObjectValue)) {
    return Throw.TypeError('$1 is not a $2 object', O, 'Date');
  }
  let tryFirst: 'string' | 'number';
  if (hint instanceof JSStringValue && (hint.stringValue() === 'string' || hint.stringValue() === 'default')) {
    tryFirst = 'string';
  } else if (hint instanceof JSStringValue && hint.stringValue() === 'number') {
    tryFirst = 'number';
  } else {
    return Throw.TypeError('Invalid hint: $1', hint);
  }
  return Q(yield* OrdinaryToPrimitive(O, tryFirst));
}

export function bootstrapDatePrototype(realmRec: Realm) {
  const proto = bootstrapPrototype(realmRec, [
    ['getDate', DateProto_getDate, 0],
    ['getDay', DateProto_getDay, 0],
    ['getFullYear', DateProto_getFullYear, 0],
    ['getHours', DateProto_getHours, 0],
    ['getMilliseconds', DateProto_getMilliseconds, 0],
    ['getMinutes', DateProto_getMinutes, 0],
    ['getMonth', DateProto_getMonth, 0],
    ['getSeconds', DateProto_getSeconds, 0],
    ['getTime', DateProto_getTime, 0],
    ['getTimezoneOffset', DateProto_getTimezoneOffset, 0],
    ['getUTCDate', DateProto_getUTCDate, 0],
    ['getUTCDay', DateProto_getUTCDay, 0],
    ['getUTCFullYear', DateProto_getUTCFullYear, 0],
    ['getUTCHours', DateProto_getUTCHours, 0],
    ['getUTCMilliseconds', DateProto_getUTCMilliseconds, 0],
    ['getUTCMinutes', DateProto_getUTCMinutes, 0],
    ['getUTCMonth', DateProto_getUTCMonth, 0],
    ['getUTCSeconds', DateProto_getUTCSeconds, 0],
    ['setDate', DateProto_setDate, 1],
    ['setFullYear', DateProto_setFullYear, 3],
    ['setHours', DateProto_setHours, 4],
    ['setMilliseconds', DateProto_setMilliseconds, 1],
    ['setMinutes', DateProto_setMinutes, 3],
    ['setMonth', DateProto_setMonth, 2],
    ['setSeconds', DateProto_setSeconds, 2],
    ['setTime', DateProto_setTime, 1],
    ['setUTCDate', DateProto_setUTCDate, 1],
    ['setUTCFullYear', DateProto_setUTCFullYear, 3],
    ['setUTCHours', DateProto_setUTCHours, 4],
    ['setUTCMilliseconds', DateProto_setUTCMilliseconds, 1],
    ['setUTCMinutes', DateProto_setUTCMinutes, 3],
    ['setUTCMonth', DateProto_setUTCMonth, 2],
    ['setUTCSeconds', DateProto_setUTCSeconds, 2],
    ['toDateString', DateProto_toDateString, 0],
    ['toISOString', DateProto_toISOString, 0],
    ['toJSON', DateProto_toJSON, 1],
    ['toLocaleDateString', DateProto_toLocaleDateString, 0],
    ['toLocaleString', DateProto_toLocaleString, 0],
    ['toLocaleTimeString', DateProto_toLocaleTimeString, 0],
    ['toString', DateProto_toString, 0],
    ['toTimeString', DateProto_toTimeString, 0],
    ['toTemporalInstant', DateProto_toTemporalInstant, 0],
    ['toUTCString', DateProto_toUTCString, 0],
    ['valueOf', DateProto_valueOf, 0],
    [wellKnownSymbols.toPrimitive, DateProto_toPrimitive, 1, { Writable: false, Enumerable: false, Configurable: true }],
  ], realmRec.Intrinsics['%Object.prototype%']);

  realmRec.Intrinsics['%Date.prototype%'] = proto;
}
