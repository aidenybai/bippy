import type { Fiber, FiberRoot } from '../types.js';
import {
  instrument,
  traverseRenderedFibers,
  getDisplayName,
  isCompositeFiber,
  traverseProps,
  traverseState,
  traverseContexts,
} from '../core.js';

interface RenderInfo {
  displayName: string;
  fileName: string | null;
  reasons: string[];
}

type StopFunction = () => void;

declare global {
  // eslint-disable-next-line no-var
  var scan: typeof scan | undefined;
  // eslint-disable-next-line no-var
  var stopScan: typeof stopScan | undefined;
}

const getFileName = (fiber: Fiber): string | null => {
  const debugSource = fiber._debugSource;
  if (!debugSource?.fileName) {
    return null;
  }
  const fullPath = debugSource.fileName;
  const parts = fullPath.split('/');
  return parts[parts.length - 1] || null;
};

const getChangeReasons = (fiber: Fiber): string[] => {
  const reasons: string[] = [];

  if (!fiber.alternate) {
    return reasons;
  }

  const changedProps: string[] = [];
  traverseProps(fiber, (propName, nextValue, prevValue) => {
    if (!Object.is(nextValue, prevValue)) {
      changedProps.push(propName);
    }
  });
  if (changedProps.length > 0) {
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
    reasons.push(`state: [${changedStateIndices.join(', ')}]`);
  }

  let didContextChange = false;
  traverseContexts(fiber, (nextContext, prevContext) => {
    if (!Object.is(nextContext?.memoizedValue, prevContext?.memoizedValue)) {
      didContextChange = true;
      return true;
    }
  });
  if (didContextChange) {
    reasons.push('context');
  }

  return reasons;
};

const logRender = (info: RenderInfo, phase: string): void => {
  const fileText = info.fileName ? ` (${info.fileName})` : '';
  const reasonText = info.reasons.length > 0 ? ` { ${info.reasons.join(' | ')} }` : '';
  console.log(`[${phase}] ${info.displayName}${fileText}${reasonText}`);
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

    traverseRenderedFibers(root, (fiber: Fiber, phase) => {
      if (!isCompositeFiber(fiber)) return;

      const displayName = getDisplayName(fiber.type) || 'Unknown';
      const fileName = getFileName(fiber);
      const reasons = phase === 'update' ? getChangeReasons(fiber) : [];

      logRender({ displayName, fileName, reasons }, phase);
    });
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
