import { GetNewTarget } from '#self';

/** https://tc39.es/ecma262/#sec-meta-properties-runtime-semantics-evaluation */
// NewTarget : `new` `.` `target`
export function Evaluate_NewTarget() {
  // 1. Return GetNewTarget().
  return GetNewTarget();
}
