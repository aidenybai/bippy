import { describe, expect, it, vi } from 'vitest';
import type { Fiber, ContextDependency } from '../../types.js';
import {
  traverseProps,
  traverseState,
  traverseContexts,
  instrument,
} from '../../index.js';
// biome-ignore lint/correctness/noUnusedImports: needed for JSX
import React from 'react';
import { render } from '@testing-library/react';
import { ComplexComponent, CountContext, ExtraContext } from '../components.js';

describe('traverseProps', () => {
  it('should return the props of the fiber', () => {
    let maybeFiber: Fiber | null = null;
    instrument({
      onCommitFiberRoot: (_rendererID, fiberRoot) => {
        maybeFiber = fiberRoot.current.child;
      },
    });
    render(<ComplexComponent countProp={0} />);
    const selector = vi.fn();
    traverseProps(maybeFiber as unknown as Fiber, selector);
    expect(selector).toHaveBeenCalledWith('countProp', 0, 0);
  });

  it('should stop selector at the first prop', () => {
    let maybeFiber: Fiber | null = null;
    instrument({
      onCommitFiberRoot: (_rendererID, fiberRoot) => {
        maybeFiber = fiberRoot.current.child;
      },
    });
    render(<ComplexComponent countProp={1} extraProp={null} />);
    const selector = vi.fn();
    traverseProps(maybeFiber as unknown as Fiber, selector);
    expect(selector).toBeCalledTimes(2);
  });

  it('should stop selector at the first prop', () => {
    let maybeFiber: Fiber | null = null;
    instrument({
      onCommitFiberRoot: (_rendererID, fiberRoot) => {
        maybeFiber = fiberRoot.current.child;
      },
    });
    render(<ComplexComponent countProp={1} extraProp={null} />);
    const selector = vi.fn(() => true);
    traverseProps(maybeFiber as unknown as Fiber, selector);
    expect(selector).toBeCalledTimes(1);
  });
});

describe('traverseState', () => {
  it('should return the state of the fiber', () => {
    let maybeFiber: Fiber | null = null;
    instrument({
      onCommitFiberRoot: (_rendererID, fiberRoot) => {
        maybeFiber = fiberRoot.current.child;
      },
    });
    render(<ComplexComponent countProp={1} />);
    const states: Array<{ next: unknown; prev: unknown }> = [];
    const selector = vi.fn((nextState, prevState) => {
      states.push({
        next: nextState.memoizedState,
        prev: prevState.memoizedState,
      });
    });
    traverseState(maybeFiber as unknown as Fiber, selector);
    expect(states[0].next).toEqual(1);
    expect(states[0].prev).toEqual(0);
    expect(states[1].next).toEqual(0);
    expect(states[1].prev).toEqual(0);
  });

  it('should call selector many times for a fiber with multiple states', () => {
    let maybeFiber: Fiber | null = null;
    instrument({
      onCommitFiberRoot: (_rendererID, fiberRoot) => {
        maybeFiber = fiberRoot.current.child;
      },
    });
    render(<ComplexComponent countProp={1} />);
    const selector = vi.fn();
    traverseState(maybeFiber as unknown as Fiber, selector);
    expect(selector).toBeCalledTimes(3);
  });

  it('should stop selector at the first state', () => {
    let maybeFiber: Fiber | null = null;
    instrument({
      onCommitFiberRoot: (_rendererID, fiberRoot) => {
        maybeFiber = fiberRoot.current.child;
      },
    });
    render(<ComplexComponent countProp={1} />);
    const selector = vi.fn(() => true);
    traverseState(maybeFiber as unknown as Fiber, selector);
    expect(selector).toBeCalledTimes(1);
  });
});

describe('traverseContexts', () => {
  it('should return the contexts of the fiber', () => {
    let maybeFiber: Fiber | null = null;
    instrument({
      onCommitFiberRoot: (_rendererID, fiberRoot) => {
        maybeFiber = fiberRoot.current.child.child;
      },
    });
    render(
      <CountContext.Provider value={1}>
        <ComplexComponent countProp={1} />
      </CountContext.Provider>,
    );
    const contexts: ContextDependency<unknown>[] = [];
    const selector = vi.fn((context) => {
      contexts.push(context);
    });
    traverseContexts(maybeFiber as unknown as Fiber, selector);
    expect(contexts).toHaveLength(2);
    expect(contexts[0].context).toBe(CountContext);
    expect(contexts[0].memoizedValue).toBe(1);
    expect(contexts[1].context).toBe(ExtraContext);
    expect(contexts[1].memoizedValue).toBe(0);
  });

  it('should stop selector at the first context', () => {
    let maybeFiber: Fiber | null = null;
    instrument({
      onCommitFiberRoot: (_rendererID, fiberRoot) => {
        maybeFiber = fiberRoot.current.child;
      },
    });
    render(<ComplexComponent countProp={1} />);
    const selector = vi.fn(() => true);
    traverseContexts(maybeFiber as unknown as Fiber, selector);
    expect(selector).toBeCalledTimes(1);
  });
});
