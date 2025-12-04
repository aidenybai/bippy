import '../index.js'; // KEEP THIS LINE ON TOP

import { render } from '@testing-library/react';
import React, { useState } from 'react';
import { expect, it } from 'vitest';
import type { Fiber } from '../types.js';
import { instrument } from '../index.js';
import { getSource, getOwnerStack } from '../source/index.js';
import { normalizeFileName } from '../source/get-source.js';

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

it('getOwnerStack should return stack for simple component', async () => {
  let capturedFiber: Fiber | null = null;
  instrument({
    onCommitFiberRoot: (_rendererID, fiberRoot) => {
      capturedFiber = fiberRoot.current.child;
    },
  });
  render(<SimpleComponent />);

  const result = await getOwnerStack(capturedFiber as unknown as Fiber);

  expect(result).toHaveLength(1);
  expect(result[0].functionName).toBe('SimpleComponent');
  expect(result[0].source).toBe('    in SimpleComponent');
});

it('getOwnerStack should return stack for component with props', async () => {
  let capturedFiber: Fiber | null = null;
  instrument({
    onCommitFiberRoot: (_rendererID, fiberRoot) => {
      capturedFiber = fiberRoot.current.child;
    },
  });
  render(<ComponentWithProps message="test" />);

  const result = await getOwnerStack(capturedFiber as unknown as Fiber);

  expect(result).toHaveLength(1);
  expect(result[0].functionName).toBe('ComponentWithProps');
  expect(result[0].fileName).toContain('source.test.tsx');
  expect(result[0].lineNumber).toBe(26);
  expect(result[0].columnNumber).toBe(31);
});

it('getOwnerStack should return stack for component with hooks', async () => {
  let capturedFiber: Fiber | null = null;
  instrument({
    onCommitFiberRoot: (_rendererID, fiberRoot) => {
      capturedFiber = fiberRoot.current.child;
    },
  });
  render(<ComponentWithHooks />);

  const result = await getOwnerStack(capturedFiber as unknown as Fiber);

  expect(result).toHaveLength(1);
  expect(result[0].functionName).toBe('ComponentWithHooks');
  expect(result[0].fileName).toContain('source.test.tsx');
  expect(result[0].lineNumber).toBe(30);
  expect(result[0].columnNumber).toBe(41);
});

it('getOwnerStack should return stack for nested component with props', async () => {
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

  const result = await getOwnerStack(capturedFiber as unknown as Fiber);

  expect(result).toHaveLength(3);
  expect(result[0].functionName).toBe('ComponentWithProps');
  expect(result[0].fileName).toContain('source.test.tsx');
  expect(result[0].lineNumber).toBe(26);
  expect(result[0].columnNumber).toBe(31);
  expect(result[1].functionName).toBe('div');
  expect(result[2].functionName).toBe('ExampleWithChild');
  expect(result[2].fileName).toContain('source.test.tsx');
  expect(result[2].lineNumber).toBe(33);
  expect(result[2].columnNumber).toBe(29);
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

it('normalizeFileName should strip webpack-internal:// prefix', () => {
  const input =
    'webpack-internal:///app-pages-browser/./src/components/providers.tsx';
  const result = normalizeFileName(input);
  expect(result).toBe('./src/components/providers.tsx');
});

it('normalizeFileName should strip webpack-internal:// with different app-pages-browser path', () => {
  const input =
    'webpack-internal:///app-pages-browser/./src/components/sections/hero/project-showcase.tsx';
  const result = normalizeFileName(input);
  expect(result).toBe('./src/components/sections/hero/project-showcase.tsx');
});

it('normalizeFileName should strip webpack:// prefix', () => {
  const input = 'webpack://./src/app.tsx';
  const result = normalizeFileName(input);
  expect(result).toBe('./src/app.tsx');
});

it('normalizeFileName should strip /app-pages-browser/ prefix', () => {
  const input = '/app-pages-browser/./src/components/test.tsx';
  const result = normalizeFileName(input);
  expect(result).toBe('./src/components/test.tsx');
});
