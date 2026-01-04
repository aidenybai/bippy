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
} from '../core.js';

interface RenderInfo {
  displayName: string;
  fileName: string | null;
  reasons: string[];
  causedBy: string | null;
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

const findRenderCause = (
  fiber: Fiber,
  renderedFiberIds: Set<number>,
): string | null => {
  let currentFiber = fiber.return;

  while (currentFiber) {
    if (!isCompositeFiber(currentFiber)) {
      currentFiber = currentFiber.return;
      continue;
    }

    const parentId = getFiberId(currentFiber);
    if (!renderedFiberIds.has(parentId)) {
      break;
    }

    const parentChangeInfo = getChangeInfo(currentFiber);
    if (parentChangeInfo.didStateChange || parentChangeInfo.didContextChange) {
      return getDisplayName(currentFiber.type) || 'Unknown';
    }

    currentFiber = currentFiber.return;
  }

  return null;
};

let lastLogMessage: string | null = null;
let lastLogCount = 0;

const flushLog = (): void => {
  if (lastLogMessage && lastLogCount > 0) {
    const countSuffix = lastLogCount > 1 ? ` x${lastLogCount}` : '';
    globalThis.scanLog?.(`${lastLogMessage}${countSuffix}`);
  }
  lastLogMessage = null;
  lastLogCount = 0;
};

const logRender = (info: RenderInfo, phase: string): void => {
  const fileText = info.fileName ? ` (${info.fileName})` : '';
  const reasonText = info.reasons.length > 0 ? ` { ${info.reasons.join(' | ')} }` : '';
  const causedByText = info.causedBy ? ` ← ${info.causedBy}` : '';
  const message = `[${phase}] ${info.displayName}${fileText}${reasonText}${causedByText}`;

  if (message === lastLogMessage) {
    lastLogCount++;
  } else {
    flushLog();
    lastLogMessage = message;
    lastLogCount = 1;
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

    for (const { fiber, phase } of renderedFibers) {
      const displayName = getDisplayName(fiber.type) || 'Unknown';
      const fileName = getFileName(fiber);
      const changeInfo = phase === 'update' ? getChangeInfo(fiber) : { reasons: [], didPropsChange: false, didStateChange: false, didContextChange: false };

      let causedBy: string | null = null;
      if (phase === 'update' && changeInfo.didPropsChange && !changeInfo.didStateChange && !changeInfo.didContextChange) {
        causedBy = findRenderCause(fiber, renderedFiberIds);
      }

      logRender({ displayName, fileName, reasons: changeInfo.reasons, causedBy }, phase);
    }

    flushLog();
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
