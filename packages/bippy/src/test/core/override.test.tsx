import { describe, expect, it, afterEach } from 'vitest';
import { instrument } from '../../index.js';
import {
  overrideProps,
  overrideHookState,
  overrideContext,
  injectOverrideMethods,
} from '../../override.js';
import type { Fiber } from '../../types.js';
// biome-ignore lint/style/useImportType: <explanation>
import React from 'react';
import { useState, useContext, createContext } from 'react';
import { render, screen, cleanup } from '@testing-library/react';

const PropsTestComponent = ({
  count,
  message,
}: {
  count: number;
  message: string;
}) => {
  return (
    <div>
      <span data-testid="count">{count}</span>
      <span data-testid="message">{message}</span>
    </div>
  );
};

const HookStateTestComponent = () => {
  const [count, setCount] = useState(0);
  const [name, setName] = useState('initial');

  return (
    <div>
      <span data-testid="count">{count}</span>
      <span data-testid="name">{name}</span>
      <button type="button" onClick={() => setCount((c) => c + 1)}>
        increment
      </button>
      <button type="button" onClick={() => setName('updated')}>
        update name
      </button>
    </div>
  );
};

const TestContext = createContext({ value: 'initial', nested: { count: 0 } });

const ContextTestComponent = () => {
  const context = useContext(TestContext);
  return (
    <div>
      <span data-testid="context-value">{context.value}</span>
      <span data-testid="context-count">{context.nested.count}</span>
    </div>
  );
};

const ContextProvider = ({ children }: { children: React.ReactNode }) => {
  return (
    <TestContext.Provider value={{ value: 'provided', nested: { count: 5 } }}>
      {children}
    </TestContext.Provider>
  );
};

describe('overrideProps', () => {
  afterEach(() => {
    cleanup();
  });

  it('should call injectOverrideMethods and handle props override', () => {
    let targetFiber: Fiber | null = null;

    instrument({
      onCommitFiberRoot: (_rendererID, fiberRoot) => {
        let current = fiberRoot.current.child;
        while (current) {
          if (current.type === PropsTestComponent) {
            targetFiber = current;
            break;
          }
          current = current.child || current.sibling;
        }
      },
    });

    render(<PropsTestComponent count={1} message="hello" />);
    expect(screen.getByTestId('count').textContent).toBe('1');
    expect(screen.getByTestId('message').textContent).toBe('hello');

    if (targetFiber) {
      expect(() =>
        overrideProps(targetFiber as Fiber, {
          count: 42,
          message: 'overridden',
        })
      ).not.toThrow();
    }
  });

  it('should handle nested props structure', () => {
    let targetFiber: Fiber | null = null;

    instrument({
      onCommitFiberRoot: (_rendererID, fiberRoot) => {
        let current = fiberRoot.current.child;
        while (current) {
          if (current.type === PropsTestComponent) {
            targetFiber = current;
            break;
          }
          current = current.child || current.sibling;
        }
      },
    });

    render(<PropsTestComponent count={1} message="hello" />);

    if (targetFiber) {
      expect(() =>
        overrideProps(targetFiber as Fiber, {
          nested: {
            deep: {
              value: 'test',
            },
          },
        })
      ).not.toThrow();
    }
  });
});

describe('overrideHookState', () => {
  afterEach(() => {
    cleanup();
  });

  it('should call injectOverrideMethods and handle hook state override', () => {
    let targetFiber: Fiber | null = null;

    instrument({
      onCommitFiberRoot: (_rendererID, fiberRoot) => {
        let current = fiberRoot.current.child;
        while (current) {
          if (current.type === HookStateTestComponent) {
            targetFiber = current;
            break;
          }
          current = current.child || current.sibling;
        }
      },
    });

    render(<HookStateTestComponent />);
    expect(screen.getByTestId('count').textContent).toBe('0');

    if (targetFiber) {
      expect(() =>
        overrideHookState(targetFiber as Fiber, 0, 42)
      ).not.toThrow();
    }
  });

  it('should handle object values for hook state', () => {
    let targetFiber: Fiber | null = null;

    instrument({
      onCommitFiberRoot: (_rendererID, fiberRoot) => {
        let current = fiberRoot.current.child;
        while (current) {
          if (current.type === HookStateTestComponent) {
            targetFiber = current;
            break;
          }
          current = current.child || current.sibling;
        }
      },
    });

    render(<HookStateTestComponent />);

    if (targetFiber) {
      expect(() =>
        overrideHookState(targetFiber as Fiber, 0, { count: 100, name: 'test' })
      ).not.toThrow();
    }
  });

  it('should convert hook id to string', () => {
    let targetFiber: Fiber | null = null;

    instrument({
      onCommitFiberRoot: (_rendererID, fiberRoot) => {
        let current = fiberRoot.current.child;
        while (current) {
          if (current.type === HookStateTestComponent) {
            targetFiber = current;
            break;
          }
          current = current.child || current.sibling;
        }
      },
    });

    render(<HookStateTestComponent />);

    if (targetFiber) {
      expect(() =>
        overrideHookState(targetFiber as Fiber, 1, 'test')
      ).not.toThrow();
    }
  });
});

describe('overrideContext', () => {
  afterEach(() => {
    cleanup();
  });

  it('should call injectOverrideMethods and handle context override', () => {
    let targetFiber: Fiber | null = null;

    instrument({
      onCommitFiberRoot: (_rendererID, fiberRoot) => {
        let current = fiberRoot.current.child;
        while (current) {
          if (current.type === ContextTestComponent) {
            targetFiber = current;
            break;
          }
          current = current.child || current.sibling;
        }
      },
    });

    render(
      <ContextProvider>
        <ContextTestComponent />
      </ContextProvider>
    );

    expect(screen.getByTestId('context-value').textContent).toBe('provided');

    if (targetFiber) {
      expect(() =>
        overrideContext(targetFiber as Fiber, TestContext, 'overridden')
      ).not.toThrow();
    }
  });

  it('should handle object values for context override', () => {
    let targetFiber: Fiber | null = null;

    instrument({
      onCommitFiberRoot: (_rendererID, fiberRoot) => {
        let current = fiberRoot.current.child;
        while (current) {
          if (current.type === ContextTestComponent) {
            targetFiber = current;
            break;
          }
          current = current.child || current.sibling;
        }
      },
    });

    render(
      <ContextProvider>
        <ContextTestComponent />
      </ContextProvider>
    );

    if (targetFiber) {
      expect(() =>
        overrideContext(targetFiber as Fiber, TestContext, {
          value: 'new',
          nested: { count: 999 },
        })
      ).not.toThrow();
    }
  });
});

describe('injectOverrideMethods', () => {
  it('should inject override methods into renderer', () => {
    const result = injectOverrideMethods();

    expect(result).toBeDefined();
  });

  it('should handle case when no renderers are available', () => {
    expect(() => injectOverrideMethods()).not.toThrow();
  });
});
