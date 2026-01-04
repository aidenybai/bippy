import type { Fiber, FiberRoot } from '../types.js';
import {
  instrument,
  traverseRenderedFibers,
  getDisplayName,
  isCompositeFiber,
  traverseProps,
  traverseState,
  traverseContexts,
  getFiberId,
  getTimings,
} from '../core.js';

interface RenderInfo {
  displayName: string;
  fileName: string | null;
  reasons: string[];
  causedBy: RenderCause | null;
  time: number | null;
}

type StopFunction = () => void;

declare global {
  // eslint-disable-next-line no-var
  var scan: typeof scan | undefined;
  // eslint-disable-next-line no-var
  var stopScan: typeof stopScan | undefined;
  // eslint-disable-next-line no-var
  var scanLog: typeof console.log | undefined;
}

// HACK: replace globalThis.scanLog to customize logging (e.g. for Cursor debug mode)
globalThis.scanLog = globalThis.scanLog ?? console.log;

const getFileName = (fiber: Fiber): string | null => {
  const debugSource = fiber._debugSource;
  if (!debugSource?.fileName) {
    return null;
  }
  const fullPath = debugSource.fileName;
  const parts = fullPath.split('/');
  return parts[parts.length - 1] || null;
};

interface ChangeInfo {
  reasons: string[];
  didPropsChange: boolean;
  didStateChange: boolean;
  didContextChange: boolean;
}

const getChangeInfo = (fiber: Fiber): ChangeInfo => {
  const reasons: string[] = [];
  let didPropsChange = false;
  let didStateChange = false;
  let didContextChange = false;

  if (!fiber.alternate) {
    return { reasons, didPropsChange, didStateChange, didContextChange };
  }

  const changedProps: string[] = [];
  traverseProps(fiber, (propName, nextValue, prevValue) => {
    if (!Object.is(nextValue, prevValue)) {
      changedProps.push(propName);
    }
  });
  if (changedProps.length > 0) {
    didPropsChange = true;
    reasons.push(`props: ${changedProps.join(', ')}`);
  }

  const changedStateIndices: number[] = [];
  let stateIndex = 0;
  traverseState(fiber, (nextState, prevState) => {
    if (!Object.is(nextState?.memoizedState, prevState?.memoizedState)) {
      changedStateIndices.push(stateIndex);
    }
    stateIndex++;
  });
  if (changedStateIndices.length > 0) {
    didStateChange = true;
    reasons.push(`state: [${changedStateIndices.join(', ')}]`);
  }

  traverseContexts(fiber, (nextContext, prevContext) => {
    if (!Object.is(nextContext?.memoizedValue, prevContext?.memoizedValue)) {
      didContextChange = true;
      return true;
    }
  });
  if (didContextChange) {
    reasons.push('context');
  }

  return { reasons, didPropsChange, didStateChange, didContextChange };
};

interface RenderCause {
  componentName: string;
  prop: string | null;
}

const getChangedProps = (fiber: Fiber): string[] => {
  const changedProps: string[] = [];
  traverseProps(fiber, (propName, nextValue, prevValue) => {
    if (!Object.is(nextValue, prevValue)) {
      changedProps.push(propName);
    }
  });
  return changedProps;
};

const findRenderCause = (
  fiber: Fiber,
  renderedFiberIds: Set<number>,
): RenderCause | null => {
  let currentFiber = fiber.return;
  let lastRenderedParent: Fiber | null = null;
  let propFromParent: string | null = null;

  const changedProps = getChangedProps(fiber);
  if (changedProps.length > 0) {
    propFromParent = changedProps[0];
  }

  while (currentFiber) {
    if (!isCompositeFiber(currentFiber)) {
      currentFiber = currentFiber.return;
      continue;
    }

    const parentId = getFiberId(currentFiber);
    if (!renderedFiberIds.has(parentId)) {
      break;
    }

    lastRenderedParent = currentFiber;

    const parentChangeInfo = getChangeInfo(currentFiber);
    if (parentChangeInfo.didStateChange || parentChangeInfo.didContextChange) {
      return {
        componentName: getDisplayName(currentFiber.type) || 'Unknown',
        prop: propFromParent,
      };
    }

    currentFiber = currentFiber.return;
  }

  if (lastRenderedParent) {
    return {
      componentName: getDisplayName(lastRenderedParent.type) || 'Unknown',
      prop: propFromParent,
    };
  }

  return null;
};

const formatRenderInfo = (info: RenderInfo, phase: string): string => {
  const fileText = info.fileName ? ` (${info.fileName})` : '';
  const reasonText = info.reasons.length > 0 ? ` { ${info.reasons.join(' | ')} }` : '';
  let causedByText = '';
  if (info.causedBy) {
    const propText = info.causedBy.prop ? `.${info.causedBy.prop}` : '';
    causedByText = ` ← ${info.causedBy.componentName}${propText}`;
  }
  const timeText = info.time !== null && info.time > 0 ? ` ${info.time.toFixed(2)}ms` : '';
  return `[${phase}] ${info.displayName}${fileText}${reasonText}${causedByText}${timeText}`;
};

interface LogEntry {
  message: string;
  totalTime: number;
}

const flushLogs = (entries: LogEntry[]): void => {
  const grouped = new Map<string, { count: number; totalTime: number }>();
  for (const entry of entries) {
    const existing = grouped.get(entry.message);
    if (existing) {
      existing.count++;
      existing.totalTime += entry.totalTime;
    } else {
      grouped.set(entry.message, { count: 1, totalTime: entry.totalTime });
    }
  }
  for (const [message, { count, totalTime }] of grouped) {
    const countSuffix = count > 1 ? ` x${count}` : '';
    const aggregateTime = count > 1 && totalTime > 0 ? ` (total: ${totalTime.toFixed(2)}ms)` : '';
    globalThis.scanLog?.(`${message}${countSuffix}${aggregateTime}`);
  }
};

let currentStopFunction: StopFunction | null = null;

const scan = (): StopFunction => {
  if (typeof globalThis === 'undefined') {
    return () => {};
  }

  if (currentStopFunction) {
    currentStopFunction();
  }

  let isActive = true;

  const onCommitFiberRoot = (_rendererID: number, root: FiberRoot): void => {
    if (!isActive) return;

    const renderedFiberIds = new Set<number>();
    const renderedFibers: Array<{ fiber: Fiber; phase: string }> = [];

    traverseRenderedFibers(root, (fiber: Fiber, phase) => {
      if (!isCompositeFiber(fiber)) return;
      renderedFiberIds.add(getFiberId(fiber));
      renderedFibers.push({ fiber, phase });
    });

    const logEntries: LogEntry[] = [];

    for (const { fiber, phase } of renderedFibers) {
      const displayName = getDisplayName(fiber.type) || 'Unknown';
      const fileName = getFileName(fiber);
      const { selfTime } = getTimings(fiber);

      if (phase === 'unmount') {
        const message = formatRenderInfo({ displayName, fileName, reasons: [], causedBy: null, time: null }, phase);
        logEntries.push({ message, totalTime: 0 });
        continue;
      }

      const changeInfo = phase === 'update' ? getChangeInfo(fiber) : { reasons: [], didPropsChange: false, didStateChange: false, didContextChange: false };

      let causedBy: RenderCause | null = null;
      if (phase === 'update' && changeInfo.didPropsChange && !changeInfo.didStateChange && !changeInfo.didContextChange) {
        causedBy = findRenderCause(fiber, renderedFiberIds);
      }

      const message = formatRenderInfo({ displayName, fileName, reasons: changeInfo.reasons, causedBy, time: selfTime }, phase);
      logEntries.push({ message, totalTime: selfTime });
    }

    flushLogs(logEntries);
  };

  instrument({ onCommitFiberRoot });

  const stop: StopFunction = () => {
    isActive = false;
    if (currentStopFunction === stop) {
      currentStopFunction = null;
    }
  };

  currentStopFunction = stop;

  return stop;
};

const stopScan = (): void => {
  if (currentStopFunction) {
    currentStopFunction();
  }
};

if (typeof globalThis !== 'undefined') {
  globalThis.scan = scan;
  globalThis.stopScan = stopScan;
}
