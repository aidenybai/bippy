// Using spec: 87c74ec2ae7d55cf10c58674478784d09f323ff1

import { bootstrapPrototype } from '../bootstrap.mts';
import { bootstrapTemporalDuration } from './Duration.mts';
import { bootstrapTemporalInstant } from './Instant.mts';
import { bootstrapTemporalPlainDate } from './PlainDate.mts';
import { bootstrapTemporalPlainDateTime } from './PlainDateTime.mts';
import { bootstrapTemporalPlainMonthDay } from './PlainMonthDay.mts';
import { bootstrapTemporalPlainTime } from './PlainTime.mts';
import { bootstrapTemporalPlainYearMonth } from './PlainYearMonth.mts';
import { bootstrapTemporalNow } from './Now.mts';
import { bootstrapTemporalZonedDateTime } from './ZonedDateTime.mts';
import { type Realm } from '#self';

export function bootstrapTemporal(realmRec: Realm) {
  const TemporalObject = bootstrapPrototype(realmRec, [
    ['Duration', bootstrapTemporalDuration(realmRec)],
    ['Instant', bootstrapTemporalInstant(realmRec)],
    ['PlainDateTime', bootstrapTemporalPlainDateTime(realmRec)],
    ['Now', bootstrapTemporalNow(realmRec)],
    ['PlainDate', bootstrapTemporalPlainDate(realmRec)],
    ['PlainTime', bootstrapTemporalPlainTime(realmRec)],
    ['PlainYearMonth', bootstrapTemporalPlainYearMonth(realmRec)],
    ['PlainMonthDay', bootstrapTemporalPlainMonthDay(realmRec)],
    ['ZonedDateTime', bootstrapTemporalZonedDateTime(realmRec)],
  ], realmRec.Intrinsics['%Object.prototype%'], 'Temporal');

  realmRec.Intrinsics['%Temporal%'] = TemporalObject;
  return TemporalObject;
}
