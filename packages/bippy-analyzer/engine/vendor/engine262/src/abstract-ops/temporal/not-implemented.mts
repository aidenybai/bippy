export function mark_TimeZoneAwareNotImplemented() {
  'Time zone aware operations are not implemented in this engine.';
}

export function mark_OtherCalendarNotImplemented() {
  'Other calendar than iso8601 are not implemented in this engine.';
}

export function unreachable_OtherCalendarNotImplemented(): never {
  throw new Error('Calendar other than ISO8601 is not supported, but this error should never triggered by the user code.');
}

export function temporal_todo(): never {
  throw new Error('This Temporal operation is not implemented yet.');
}
