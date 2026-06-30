import '../index.js';

import * as React from 'react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { pauseUpdates, areUpdatesPaused, instrument, secure, getRDTHook, _fiberRoots } from '../core.js';

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

const createExternalStore = (initialValue: number) => {
  let value = initialValue;
  const listeners = new Set<() => void>();

  return {
    getSnapshot: () => value,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    increment: () => {
      value++;
      listeners.forEach((listener) => listener());
    },
  };
};

const ExternalStoreCounter = ({ store }: { store: ReturnType<typeof createExternalStore> }) => {
  const count = React.useSyncExternalStore(store.subscribe, store.getSnapshot);
  return (
    <div>
      <span data-testid="external-count">{count}</span>
    </div>
  );
};

describe('pauseUpdates', () => {
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

  it('should return resume function', () => {
    const resumeUpdates = pauseUpdates();
    expect(typeof resumeUpdates).toBe('function');
    resumeUpdates();
  });

  it('should report areUpdatesPaused correctly', () => {
    expect(areUpdatesPaused()).toBe(false);
    const resumeUpdates = pauseUpdates();
    expect(areUpdatesPaused()).toBe(true);
    resumeUpdates();
    expect(areUpdatesPaused()).toBe(false);
  });

  it('should handle multiple pauseUpdates calls', () => {
    const resume1 = pauseUpdates();
    expect(areUpdatesPaused()).toBe(true);
    const resume2 = pauseUpdates();
    expect(areUpdatesPaused()).toBe(true);
    resume1();
    expect(areUpdatesPaused()).toBe(false);
    resume2();
    expect(areUpdatesPaused()).toBe(false);
  });

  it('should pause useState updates', async () => {
    render(<Counter />);

    expect(_fiberRoots.size).toBeGreaterThan(0);

    const countElement = screen.getByTestId('count');
    const incrementButton = screen.getByTestId('increment');

    expect(countElement.textContent).toBe('0');

    await act(async () => {
      fireEvent.click(incrementButton);
    });
    expect(countElement.textContent).toBe('1');

    const resumeUpdates = pauseUpdates();

    await act(async () => {
      fireEvent.click(incrementButton);
    });
    expect(countElement.textContent).toBe('1');

    await act(async () => {
      fireEvent.click(incrementButton);
    });
    expect(countElement.textContent).toBe('1');

    resumeUpdates();

    await act(async () => {
      fireEvent.click(incrementButton);
    });
    expect(countElement.textContent).toBe('2');
  });

  it('should pause useReducer updates', async () => {
    render(<ReducerCounter />);

    expect(_fiberRoots.size).toBeGreaterThan(0);

    const countElement = screen.getByTestId('reducer-count');
    const incrementButton = screen.getByTestId('reducer-increment');

    expect(countElement.textContent).toBe('0');

    await act(async () => {
      fireEvent.click(incrementButton);
    });
    expect(countElement.textContent).toBe('1');

    const resumeUpdates = pauseUpdates();

    await act(async () => {
      fireEvent.click(incrementButton);
    });
    expect(countElement.textContent).toBe('1');

    resumeUpdates();

    await act(async () => {
      fireEvent.click(incrementButton);
    });
    expect(countElement.textContent).toBe('2');
  });

  it('should pause useSyncExternalStore updates', async () => {
    const store = createExternalStore(0);
    render(<ExternalStoreCounter store={store} />);

    expect(_fiberRoots.size).toBeGreaterThan(0);

    const countElement = screen.getByTestId('external-count');

    expect(countElement.textContent).toBe('0');

    await act(async () => {
      store.increment();
    });
    expect(countElement.textContent).toBe('1');

    const resumeUpdates = pauseUpdates();

    await act(async () => {
      store.increment();
    });
    expect(countElement.textContent).toBe('1');

    await act(async () => {
      store.increment();
    });
    expect(countElement.textContent).toBe('1');

    resumeUpdates();

    await act(async () => {
      store.increment();
    });
    expect(countElement.textContent).toBe('4');
  });

  it('should work with renderers accessed via getRDTHook', () => {
    const rdtHook = getRDTHook();
    expect(rdtHook.renderers).toBeDefined();
  });

  it('should pause context updates', async () => {
    const TestContext = React.createContext(0);

    const ContextConsumer = () => {
      const value = React.useContext(TestContext);
      return <span data-testid="context-value">{value}</span>;
    };

    const ContextProvider = () => {
      const [contextValue, setContextValue] = React.useState(0);
      return (
        <TestContext.Provider value={contextValue}>
          <ContextConsumer />
          <button data-testid="update-context" onClick={() => setContextValue((previousValue) => previousValue + 1)}>
            Update Context
          </button>
        </TestContext.Provider>
      );
    };

    render(<ContextProvider />);

    const valueElement = screen.getByTestId('context-value');
    const updateButton = screen.getByTestId('update-context');

    expect(valueElement.textContent).toBe('0');

    await act(async () => {
      fireEvent.click(updateButton);
    });
    expect(valueElement.textContent).toBe('1');

    const resumeUpdates = pauseUpdates();

    await act(async () => {
      fireEvent.click(updateButton);
    });
    expect(valueElement.textContent).toBe('1');

    resumeUpdates();

    await act(async () => {
      fireEvent.click(updateButton);
    });
    expect(valueElement.textContent).toBe('2');
  });

  it('should pause useTransition updates', async () => {
    const TransitionComponent = () => {
      const [count, setCount] = React.useState(0);
      const [isPending, startTransition] = React.useTransition();

      return (
        <div>
          <span data-testid="transition-count">{count}</span>
          <span data-testid="transition-pending">{isPending ? 'pending' : 'idle'}</span>
          <button
            data-testid="transition-update"
            onClick={() => {
              startTransition(() => {
                setCount((previousCount) => previousCount + 1);
              });
            }}
          >
            Update
          </button>
        </div>
      );
    };

    render(<TransitionComponent />);

    const countElement = screen.getByTestId('transition-count');
    const updateButton = screen.getByTestId('transition-update');

    expect(countElement.textContent).toBe('0');

    await act(async () => {
      fireEvent.click(updateButton);
    });
    expect(countElement.textContent).toBe('1');

    const resumeUpdates = pauseUpdates();

    await act(async () => {
      fireEvent.click(updateButton);
    });
    expect(countElement.textContent).toBe('1');

    resumeUpdates();

    await act(async () => {
      fireEvent.click(updateButton);
    });
    expect(countElement.textContent).toBe('2');
  });

  it('should handle useDeferredValue gracefully', async () => {
    const DeferredComponent = () => {
      const [input, setInput] = React.useState('initial');
      const deferredInput = React.useDeferredValue(input);

      return (
        <div>
          <span data-testid="deferred-value">{deferredInput}</span>
          <button data-testid="update-input" onClick={() => setInput('updated')}>
            Update
          </button>
        </div>
      );
    };

    render(<DeferredComponent />);

    const valueElement = screen.getByTestId('deferred-value');
    const updateButton = screen.getByTestId('update-input');

    expect(valueElement.textContent).toBe('initial');

    await act(async () => {
      fireEvent.click(updateButton);
    });
    expect(valueElement.textContent).toBe('updated');

    const resumeUpdates = pauseUpdates();

    await act(async () => {
      fireEvent.click(screen.getByTestId('update-input'));
    });

    resumeUpdates();
  });
});
