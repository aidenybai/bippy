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
  hasMemoCache,
} from '../core.js';

interface RenderInfo {
  displayName: string;
  fileName: string | null;
  reasons: string[];
  causedBy: RenderCause | null;
  time: number | null;
  isCompiled: boolean;
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
  const parts: string[] = [`phase=${phase}`, `component=${info.displayName}`];

  if (info.fileName) {
    parts.push(`file=${info.fileName}`);
  }

  if (info.isCompiled) {
    parts.push('compiled=true');
  }

  if (info.reasons.length > 0) {
    parts.push(`changed={${info.reasons.join(', ')}}`);
  }

  if (info.causedBy) {
    const propText = info.causedBy.prop ? `.${info.causedBy.prop}` : '';
    parts.push(`caused_by=${info.causedBy.componentName}${propText}`);
  }

  if (info.time !== null && info.time > 0) {
    parts.push(`time=${info.time.toFixed(2)}ms`);
  }

  return `[RENDER] ${parts.join(' | ')}`;
};

interface LogEntry {
  info: RenderInfo;
  phase: string;
  time: number;
}

const flushLogs = (entries: LogEntry[]): void => {
  const grouped = new Map<string, { count: number; totalTime: number; info: RenderInfo; phase: string }>();

  for (const entry of entries) {
    const key = formatRenderInfo(entry.info, entry.phase);
    const existing = grouped.get(key);
    if (existing) {
      existing.count++;
      existing.totalTime += entry.time;
    } else {
      grouped.set(key, { count: 1, totalTime: entry.time, info: entry.info, phase: entry.phase });
    }
  }

  for (const [baseMessage, { count, totalTime }] of grouped) {
    const parts: string[] = [baseMessage];
    if (count > 1) {
      parts.push(`count=${count}`);
      if (totalTime > 0) {
        parts.push(`total_time=${totalTime.toFixed(2)}ms`);
      }
    }
    globalThis.scanLog?.(parts.join(' | '));
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
      const isCompiled = hasMemoCache(fiber);

      if (phase === 'unmount') {
        const info: RenderInfo = { displayName, fileName, reasons: [], causedBy: null, time: null, isCompiled };
        logEntries.push({ info, phase, time: 0 });
        continue;
      }

      const changeInfo = phase === 'update' ? getChangeInfo(fiber) : { reasons: [], didPropsChange: false, didStateChange: false, didContextChange: false };

      let causedBy: RenderCause | null = null;
      if (phase === 'update' && changeInfo.didPropsChange && !changeInfo.didStateChange && !changeInfo.didContextChange) {
        causedBy = findRenderCause(fiber, renderedFiberIds);
      }

      const info: RenderInfo = { displayName, fileName, reasons: changeInfo.reasons, causedBy, time: selfTime, isCompiled };
      logEntries.push({ info, phase, time: selfTime });
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
