import '../index.js';

import * as React from 'react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { freeze, isFreezeActive, instrument, secure, getRDTHook, _fiberRoots } from '../core.js';

const Counter = () => {
  const [count, setCount] = React.useState(0);
  return (
    <div>
      <span data-testid="count">{count}</span>
      <button data-testid="increment" onClick={() => setCount((previousCount) => previousCount + 1)}>
        Increment
      </button>
    </div>
  );
};

const ReducerCounter = () => {
  const [state, dispatch] = React.useReducer(
    (currentState: { count: number }, action: { type: 'increment' | 'decrement' }) => {
      switch (action.type) {
        case 'increment':
          return { count: currentState.count + 1 };
        case 'decrement':
          return { count: currentState.count - 1 };
        default:
          return currentState;
      }
    },
    { count: 0 },
  );

  return (
    <div>
      <span data-testid="reducer-count">{state.count}</span>
      <button data-testid="reducer-increment" onClick={() => dispatch({ type: 'increment' })}>
        Increment
      </button>
    </div>
  );
};

describe('freeze', () => {
  beforeEach(() => {
    cleanup();
    instrument(
      secure(
        {
          onCommitFiberRoot: () => {},
        },
        { dangerouslyRunInProduction: true },
      ),
    );
  });

  afterEach(() => {
    cleanup();
  });

  it('should return unfreeze function', () => {
    const unfreeze = freeze();
    expect(typeof unfreeze).toBe('function');
    unfreeze();
  });

  it('should report isFreezeActive correctly', () => {
    expect(isFreezeActive()).toBe(false);
    const unfreeze = freeze();
    expect(isFreezeActive()).toBe(true);
    unfreeze();
    expect(isFreezeActive()).toBe(false);
  });

  it('should handle multiple freeze calls', () => {
    const unfreeze1 = freeze();
    expect(isFreezeActive()).toBe(true);
    const unfreeze2 = freeze();
    expect(isFreezeActive()).toBe(true);
    unfreeze1();
    expect(isFreezeActive()).toBe(false);
    unfreeze2();
    expect(isFreezeActive()).toBe(false);
  });

  it('should freeze useState updates', async () => {
    render(<Counter />);

    expect(_fiberRoots.size).toBeGreaterThan(0);

    const countElement = screen.getByTestId('count');
    const incrementButton = screen.getByTestId('increment');

    expect(countElement.textContent).toBe('0');

    await act(async () => {
      fireEvent.click(incrementButton);
    });
    expect(countElement.textContent).toBe('1');

    const unfreeze = freeze();

    await act(async () => {
      fireEvent.click(incrementButton);
    });
    expect(countElement.textContent).toBe('1');

    await act(async () => {
      fireEvent.click(incrementButton);
    });
    expect(countElement.textContent).toBe('1');

    unfreeze();

    await act(async () => {
      fireEvent.click(incrementButton);
    });
    expect(countElement.textContent).toBe('2');
  });

  it('should freeze useReducer updates', async () => {
    render(<ReducerCounter />);

    expect(_fiberRoots.size).toBeGreaterThan(0);

    const countElement = screen.getByTestId('reducer-count');
    const incrementButton = screen.getByTestId('reducer-increment');

    expect(countElement.textContent).toBe('0');

    await act(async () => {
      fireEvent.click(incrementButton);
    });
    expect(countElement.textContent).toBe('1');

    const unfreeze = freeze();

    await act(async () => {
      fireEvent.click(incrementButton);
    });
    expect(countElement.textContent).toBe('1');

    unfreeze();

    await act(async () => {
      fireEvent.click(incrementButton);
    });
    expect(countElement.textContent).toBe('2');
  });

  it('should work with renderers accessed via getRDTHook', () => {
    const rdtHook = getRDTHook();
    expect(rdtHook.renderers).toBeDefined();
  });
});
