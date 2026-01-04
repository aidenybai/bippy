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

  let didPropsChange = false;
  traverseProps(fiber, (_propName, nextValue, prevValue) => {
    if (!Object.is(nextValue, prevValue)) {
      didPropsChange = true;
      return true;
    }
  });
  if (didPropsChange) {
    reasons.push('props');
  }

  let didStateChange = false;
  traverseState(fiber, (nextState, prevState) => {
    if (!Object.is(nextState?.memoizedState, prevState?.memoizedState)) {
      didStateChange = true;
      return true;
    }
  });
  if (didStateChange) {
    reasons.push('state');
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
  const reasonText = info.reasons.length > 0 ? info.reasons.join(', ') : 'mount';
  const fileText = info.fileName ? ` (${info.fileName})` : '';
  console.log(`[${phase}] ${info.displayName}${fileText} - ${reasonText}`);
};

let currentStopFunction: StopFunction | null = null;

export const scan = (): StopFunction => {
  if (typeof window === 'undefined') {
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

export const stopScan = (): void => {
  if (currentStopFunction) {
    currentStopFunction();
  }
};
