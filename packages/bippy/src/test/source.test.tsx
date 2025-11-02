import '../index.js'; // KEEP THIS LINE ON TOP

import { render } from '@testing-library/react';
import React, { useState } from 'react';
import { expect, it } from 'vitest';
import type { Fiber } from '../types.js';
import { instrument } from '../index.js';
import { getSource, getOwnerStack } from '../source/index.js';

const mockFetch = (): Promise<Response> => {
  return Promise.resolve(
    new Response(JSON.stringify({}), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
};

const SimpleComponent = () => {
  return <div>Hello</div>;
};

const ComponentWithProps = ({ message }: { message: string }) => {
  return <div>{message}</div>;
};

const ComponentWithHooks = () => {
  const [count] = useState(0);
  return <div>{count}</div>;
};

const ExampleWithChild = ({ children }: { children: React.ReactNode }) => {
  return <div>{children}</div>;
};

it('getOwnerStack should return stack for simple component', () => {
  let capturedFiber: Fiber | null = null;
  instrument({
    onCommitFiberRoot: (_rendererID, fiberRoot) => {
      capturedFiber = fiberRoot.current.child;
    },
  });
  render(<SimpleComponent />);

  const result = getOwnerStack(capturedFiber as unknown as Fiber);

  expect(result).toBeTruthy();
  expect(typeof result).toBe('string');
  expect(result).toContain('SimpleComponent');
});

it('getOwnerStack should return stack for component with props', () => {
  let capturedFiber: Fiber | null = null;
  instrument({
    onCommitFiberRoot: (_rendererID, fiberRoot) => {
      capturedFiber = fiberRoot.current.child;
    },
  });
  render(<ComponentWithProps message="test" />);

  const result = getOwnerStack(capturedFiber as unknown as Fiber);

  expect(result).toBeTruthy();
  expect(typeof result).toBe('string');
});

it('getOwnerStack should return stack for component with hooks', () => {
  let capturedFiber: Fiber | null = null;
  instrument({
    onCommitFiberRoot: (_rendererID, fiberRoot) => {
      capturedFiber = fiberRoot.current.child;
    },
  });
  render(<ComponentWithHooks />);

  const result = getOwnerStack(capturedFiber as unknown as Fiber);

  expect(result).toBeTruthy();
  expect(typeof result).toBe('string');
});

it('getOwnerStack should return stack for nested component with props', () => {
  let capturedFiber: Fiber | null = null;
  instrument({
    onCommitFiberRoot: (_rendererID, fiberRoot) => {
      capturedFiber = fiberRoot.current.child.child.child;
    },
  });
  render(
    <ExampleWithChild>
      <ComponentWithProps message="test" />
    </ExampleWithChild>,
  );

  const result = getOwnerStack(capturedFiber as unknown as Fiber);

  expect(result).toBeTruthy();
  expect(typeof result).toBe('string');
});

it('getSource should return null for simple component without props/hooks', async () => {
  let capturedFiber: Fiber | null = null;
  instrument({
    onCommitFiberRoot: (_rendererID, fiberRoot) => {
      capturedFiber = fiberRoot.current.child;
    },
  });
  render(<SimpleComponent />);

  const result = await getSource(
    capturedFiber as unknown as Fiber,
    false,
    mockFetch,
  );

  expect(result).toBeNull();
});

it('getSource should work for component with props', async () => {
  let capturedFiber: Fiber | null = null;
  instrument({
    onCommitFiberRoot: (_rendererID, fiberRoot) => {
      capturedFiber = fiberRoot.current.child;
    },
  });
  render(<ComponentWithProps message="test" />);

  const result = await getSource(
    capturedFiber as unknown as Fiber,
    false,
    mockFetch,
  );

  expect(result?.fileName).toBeTruthy();
  expect(typeof result?.fileName).toBe('string');
});

it('getSource should work for component with hooks', async () => {
  let capturedFiber: Fiber | null = null;
  instrument({
    onCommitFiberRoot: (_rendererID, fiberRoot) => {
      capturedFiber = fiberRoot.current.child;
    },
  });
  render(<ComponentWithHooks />);

  const result = await getSource(
    capturedFiber as unknown as Fiber,
    false,
    mockFetch,
  );

  expect(result?.fileName).toBeTruthy();
  expect(typeof result?.fileName).toBe('string');
});

it('getSource should work for nested component with props', async () => {
  let capturedFiber: Fiber | null = null;
  instrument({
    onCommitFiberRoot: (_rendererID, fiberRoot) => {
      capturedFiber = fiberRoot.current.child.child.child;
    },
  });
  render(
    <ExampleWithChild>
      <ComponentWithProps message="test" />
    </ExampleWithChild>,
  );

  const result = await getSource(
    capturedFiber as unknown as Fiber,
    false,
    mockFetch,
  );

  expect(result?.fileName).toBeTruthy();
  expect(typeof result?.fileName).toBe('string');
});
