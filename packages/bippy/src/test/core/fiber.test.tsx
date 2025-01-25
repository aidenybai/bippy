// import bippy, then react
import { expect, it, describe, vi } from 'vitest';
await import('../../index.js');
// biome-ignore lint/correctness/noUnusedVariables: needed for JSX
const React = require('react');
import type { Fiber, FiberRoot } from '../../types.js';
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
// FIXME(Alexis): Both React and @testing-library/react should be after index.js
// but the linter/import sorter keeps moving them on top
import { render, type RenderOptions, screen } from '@testing-library/react';
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


  const onCommitFiberRoot = vi.fn();
  instrument({ onCommitFiberRoot });

  const renderWithFiber = (ui: React.ReactNode, options?: RenderOptions) => {
    const result = render(ui, options);
    const fiber: FiberRoot = onCommitFiberRoot.mock.lastCall?.[1];
    return { ...result, fiber };
  };

  const { fiber } = renderWithFiber(
    <div key="root">
      <div key="a">
        <div key="a1" />
        <div key="a2" />
      </div>
      <div key="b" />
      <div key="c" />
      <div key="d">
        <div key="d1">
          <div key="d11" />
        </div>
      </div>
    </div>,
  );

  it('should traverse a fiber', () => {
    const order: string[] = [];
    traverseFiber(fiber.current, fiber => {
      fiber.key && order.push(fiber.key);
    });
    expect(order).toEqual([
      'root',
      'a',
      'a1',
      'a2',
      'b',
      'c',
      'd',
      'd1',
      'd11',
    ]);
  });

  it('should traverse a fiber in reverse', () => {
    const order: string[] = [];
    const d11 = traverseFiber(fiber.current, fiber => fiber.key === 'd11');
    expect(d11?.key).toBe('d11');

    traverseFiber(
      d11,
      fiber => {
        fiber.key && order.push(fiber.key);
      },
      true,
    );
    expect(order).toEqual(['d11', 'd1', 'd', 'root']);
  });

  it('should traverse a fiber with entry and leave handlers', () => {
    const enterOrder: string[] = [];
    const leaveOrder: string[] = [];
    traverseFiber(fiber.current, {
      enter: fiber => {
        fiber.key && enterOrder.push(fiber.key);
      },
      leave: fiber => {
        fiber.key && leaveOrder.push(fiber.key);
      },
    });
    expect(enterOrder).toEqual([
      'root',
      'a',
      'a1',
      'a2',
      'b',
      'c',
      'd',
      'd1',
      'd11',
    ]);
    expect(leaveOrder).toEqual([
      'a1',
      'a2',
      'a',
      'b',
      'c',
      'd11',
      'd1',
      'd',
      'root',
    ]);
  });

  it('should traverse a fiber with entry and leave handlers in reverse', () => {
    const d11 = traverseFiber(fiber.current, fiber => fiber.key === 'd11');
    expect(d11?.key).toBe('d11');

    const enterOrder: string[] = [];
    const leaveOrder: string[] = [];
    traverseFiber(d11, {
      ascending: true,
      enter: fiber => {
        fiber.key && enterOrder.push(fiber.key);
      },
      leave: fiber => {
        fiber.key && leaveOrder.push(fiber.key);
      },
    });
    expect(enterOrder).toEqual(['d11', 'd1', 'd', 'root']);
    expect(leaveOrder).toEqual(['root', 'd', 'd1', 'd11']);
  });

  it('should traverse a fiber and get stack', () => {
    const stack: Fiber[] = [];
    traverseFiber(fiber.current, {
      enter: fiber => {
        if (fiber.key === 'd11') {
          const keys = stack.map(fiber => fiber.key).filter(Boolean);
          expect(keys).toEqual(['root', 'd', 'd1']);
        }

        stack.push(fiber);
      },
      leave: fiber => {
        const last = stack.pop();
        expect(last).toBe(fiber);
      },
    });
    expect(stack).toEqual([]);
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
