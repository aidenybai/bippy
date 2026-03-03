import { isObjectRecord } from './primitives.js';
import { NextRefreshHelpers } from './types.js';

export const isNextRefreshHelpers = (
  maybeNextRefreshHelpers: unknown,
): maybeNextRefreshHelpers is NextRefreshHelpers => {
  if (!isObjectRecord(maybeNextRefreshHelpers)) {
    return false;
  }

  const maybeGetRefreshBoundarySignature =
    maybeNextRefreshHelpers['getRefreshBoundarySignature'];
  const maybeIsReactRefreshBoundary =
    maybeNextRefreshHelpers['isReactRefreshBoundary'];
  const maybeRegisterExportsForReactRefresh =
    maybeNextRefreshHelpers['registerExportsForReactRefresh'];
  const maybeScheduleUpdate = maybeNextRefreshHelpers['scheduleUpdate'];
  const maybeShouldInvalidateReactRefreshBoundary =
    maybeNextRefreshHelpers['shouldInvalidateReactRefreshBoundary'];

  return (
    typeof maybeGetRefreshBoundarySignature === 'function' &&
    typeof maybeIsReactRefreshBoundary === 'function' &&
    typeof maybeRegisterExportsForReactRefresh === 'function' &&
    typeof maybeScheduleUpdate === 'function' &&
    typeof maybeShouldInvalidateReactRefreshBoundary === 'function'
  );
};

export const getNextRefreshHelpers = (): NextRefreshHelpers | null => {
  if (!isObjectRecord(globalThis)) {
    return null;
  }

  const maybeRefreshHelpers = globalThis['$RefreshHelpers$'];
  if (!isNextRefreshHelpers(maybeRefreshHelpers)) {
    return null;
  }

  return maybeRefreshHelpers;
};
