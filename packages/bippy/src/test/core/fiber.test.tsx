
import { describe, expect, it } from 'vitest';
import {
  didFiberCommit,
  didFiberRender,
  getFiberFromHostInstance,
  getFiberStack,
  getMutatedHostFibers,
  getNearestHostFiber,
  getNearestHostFibers,
  getTimings,
  instrument,
  isCompositeFiber,
  isHostFiber,
  isValidFiber,
  traverseFiber,
} from '../../index.js';
import type { Fiber } from '../../types.js';
// FIXME(Alexis): Both React and @testing-library/react should be after index.js
// but the linter/import sorter keeps moving them on top
// biome-ignore lint/correctness/noUnusedImports: needed for JSX
import React from 'react';
import { render, screen } from '@testing-library/react';
import {
  BasicComponent,
  BasicComponentWithChildren,
  BasicComponentWithMultipleElements,
  BasicComponentWithMutation,
  BasicComponentWithUnmount,
  SlowComponent,
} from '../components.js';

describe('isValidFiber', () => {
  it('should return true for a valid fiber', () => {
    let maybeFiber: Fiber | null = null;
    instrument({
      onCommitFiberRoot: (_rendererID, fiberRoot) => {
        maybeFiber = fiberRoot.current.child;
      },
    });
    render(<BasicComponent />);
    expect(isValidFiber(maybeFiber as unknown as Fiber)).toBe(true);
  });

  it('should return false for a non-fiber', () => {
    expect(isValidFiber({})).toBe(false);
  });
});

describe('isHostFiber', () => {
  it('should return true for a host fiber', () => {
    let maybeHostFiber: Fiber | null = null;
    instrument({
      onCommitFiberRoot: (_rendererID, fiberRoot) => {
        maybeHostFiber = fiberRoot.current.child;
      },
    });
    render(<div>Hello</div>);
    expect(maybeHostFiber).not.toBeNull();
    expect(isHostFiber(maybeHostFiber as unknown as Fiber)).toBe(true);
  });

  it('should return false for a composite fiber', () => {
    let maybeHostFiber: Fiber | null = null;
    instrument({
      onCommitFiberRoot: (_rendererID, fiberRoot) => {
        maybeHostFiber = fiberRoot.current.child;
      },
    });
    render(<BasicComponent />);
    expect(maybeHostFiber).not.toBeNull();
    expect(isHostFiber(maybeHostFiber as unknown as Fiber)).toBe(false);
  });
});

describe('isCompositeFiber', () => {
  it('should return true for a composite fiber', () => {
    let maybeCompositeFiber: Fiber | null = null;
    instrument({
      onCommitFiberRoot: (_rendererID, fiberRoot) => {
        maybeCompositeFiber = fiberRoot.current.child;
      },
    });
    render(<BasicComponent />);
    expect(maybeCompositeFiber).not.toBeNull();
    expect(isCompositeFiber(maybeCompositeFiber as unknown as Fiber)).toBe(
      true,
    );
  });

  it('should return false for a host fiber', () => {
    let maybeCompositeFiber: Fiber | null = null;
    instrument({
      onCommitFiberRoot: (_rendererID, fiberRoot) => {
        maybeCompositeFiber = fiberRoot.current.child;
      },
    });
    render(<div>Hello</div>);
    expect(maybeCompositeFiber).not.toBeNull();
    expect(isCompositeFiber(maybeCompositeFiber as unknown as Fiber)).toBe(
      false,
    );
  });
});

describe('didFiberRender', () => {
  it('should return true for a fiber that has rendered', () => {
    let maybeRenderedFiber: Fiber | null = null;
    instrument({
      onCommitFiberRoot: (_rendererID, fiberRoot) => {
        maybeRenderedFiber = fiberRoot.current.child;
      },
    });
    render(<BasicComponent />);
    expect(maybeRenderedFiber).not.toBeNull();
    expect(didFiberRender(maybeRenderedFiber as unknown as Fiber)).toBe(true);
  });

  it("should return false for a fiber that hasn't rendered", () => {
    let maybeRenderedFiber: Fiber | null = null;
    instrument({
      onCommitFiberRoot: (_rendererID, fiberRoot) => {
        maybeRenderedFiber = fiberRoot.current.child;
      },
    });
    render(
      <div>
        <BasicComponentWithUnmount />
      </div>,
    );
    expect(maybeRenderedFiber).not.toBeNull();
    expect(didFiberRender(maybeRenderedFiber as unknown as Fiber)).toBe(false);
  });
});

describe('didFiberCommit', () => {
  it('should return true for a fiber that has committed', () => {
    let maybeRenderedFiber: Fiber | null = null;
    instrument({
      onCommitFiberRoot: (_rendererID, fiberRoot) => {
        maybeRenderedFiber = fiberRoot.current.child;
      },
    });
    render(<BasicComponentWithUnmount />);
    expect(maybeRenderedFiber).not.toBeNull();
    expect(didFiberCommit(maybeRenderedFiber as unknown as Fiber)).toBe(true);
  });

  it("should return false for a fiber that hasn't committed", () => {
    let maybeRenderedFiber: Fiber | null = null;
    instrument({
      onCommitFiberRoot: (_rendererID, fiberRoot) => {
        maybeRenderedFiber = fiberRoot.current.child;
      },
    });
    render(<BasicComponent />);
    expect(maybeRenderedFiber).not.toBeNull();
    expect(didFiberCommit(maybeRenderedFiber as unknown as Fiber)).toBe(false);
  });
});

describe('getMutatedHostFibers', () => {
  it('should return all host fibers that have committed and rendered', () => {
    let maybeFiber: Fiber | null = null;
    let mutatedHostFiber: Fiber<HTMLDivElement> | null = null;
    instrument({
      onCommitFiberRoot: (_rendererID, fiberRoot) => {
        maybeFiber = fiberRoot.current.child;
        mutatedHostFiber = fiberRoot.current.child.child;
      },
    });
    render(<BasicComponentWithMutation />);
    const mutatedHostFibers = getMutatedHostFibers(
      maybeFiber as unknown as Fiber,
    );
    expect(getMutatedHostFibers(maybeFiber as unknown as Fiber)).toHaveLength(
      1,
    );
    expect(mutatedHostFiber).toBe(mutatedHostFibers[0]);
  });
});

describe('getFiberStack', () => {
  it('should return the fiber stack', () => {
    let maybeFiber: Fiber | null = null;
    let manualFiberStack: Array<Fiber> = [];
    instrument({
      onCommitFiberRoot: (_rendererID, fiberRoot) => {
        manualFiberStack = [];
        maybeFiber = fiberRoot.current.child.child;
        manualFiberStack.push(fiberRoot.current.child.child);
        manualFiberStack.push(fiberRoot.current.child);
      },
    });
    render(
      <BasicComponentWithChildren>
        <BasicComponentWithUnmount />
      </BasicComponentWithChildren>,
    );
    const fiberStack = getFiberStack(maybeFiber as unknown as Fiber);
    expect(fiberStack).toEqual(manualFiberStack);
  });
});

describe('getNearestHostFiber', () => {
  it('should return the nearest host fiber', () => {
    let maybeFiber: Fiber | null = null;
    let maybeHostFiber: Fiber | null = null;
    instrument({
      onCommitFiberRoot: (_rendererID, fiberRoot) => {
        maybeFiber = fiberRoot.current.child;
        maybeHostFiber = fiberRoot.current.child.child;
      },
    });
    render(<BasicComponent />);
    expect(getNearestHostFiber(maybeFiber as unknown as Fiber)).toBe(
      (maybeFiber as unknown as Fiber).child,
    );
    expect(maybeHostFiber).toBe(
      getNearestHostFiber(maybeFiber as unknown as Fiber),
    );
  });

  it('should return null for unmounted fiber', () => {
    let maybeFiber: Fiber | null = null;
    instrument({
      onCommitFiberRoot: (_rendererID, fiberRoot) => {
        maybeFiber = fiberRoot.current.child;
      },
    });
    render(<BasicComponentWithUnmount />);
    expect(getNearestHostFiber(maybeFiber as unknown as Fiber)).toBe(null);
  });
});

describe('getNearestHostFibers', () => {
  it('should return all host fibers', () => {
    let maybeFiber: Fiber | null = null;
    instrument({
      onCommitFiberRoot: (_rendererID, fiberRoot) => {
        maybeFiber = fiberRoot.current.child;
      },
    });
    render(<BasicComponentWithMultipleElements />);
    expect(getNearestHostFibers(maybeFiber as unknown as Fiber)).toHaveLength(
      2,
    );
  });
});

describe('getTimings', () => {
  it('should return the timings of the fiber', () => {
    let maybeFiber: Fiber | null = null;
    instrument({
      onCommitFiberRoot: (_rendererID, fiberRoot) => {
        maybeFiber = fiberRoot.current.child;
      },
    });
    render(<SlowComponent />);
    const timings = getTimings(maybeFiber as unknown as Fiber);
    expect(timings.selfTime).toBeGreaterThan(0);
    expect(timings.totalTime).toBeGreaterThan(0);
  });
});

describe('traverseFiber', () => {
  it('should return the nearest host fiber', () => {
    let maybeFiber: Fiber | null = null;
    instrument({
      onCommitFiberRoot: (_rendererID, fiberRoot) => {
        maybeFiber = fiberRoot.current.child;
      },
    });
    render(<BasicComponent />);
    expect(
      traverseFiber(
        maybeFiber as unknown as Fiber,
        (fiber) => fiber.type === 'div',
      ),
    ).toBe((maybeFiber as unknown as Fiber)?.child);
  });
});

describe('getFiberFromHostInstance', () => {
  it('should return the fiber from the host instance', () => {
    render(<div>HostInstance</div>);
    const fiber = getFiberFromHostInstance(screen.getByText('HostInstance'));
    expect(fiber).not.toBeNull();
    expect(fiber?.type).toBe('div');
  });
});
