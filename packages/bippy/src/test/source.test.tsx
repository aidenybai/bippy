import '../index.js'; // KEEP THIS LINE ON TOP

import { render } from '@testing-library/react';
import React, { useState } from 'react';
import { expect, it } from 'vitest';
import type { Fiber } from '../types.js';
import { instrument } from '../index.js';
import { getSource, getOwnerStack } from '../source/index.js';
import { normalizeFileName } from '../source/get-source.js';
import { extractLocation } from '../source/parse-stack.js';

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
  expect(result[0].lineNumber).toBe(28);
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
  expect(result[0].lineNumber).toBe(32);
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
  expect(result[0].lineNumber).toBe(28);
  expect(result[0].columnNumber).toBe(31);
  expect(result[1].functionName).toBe('div');
  expect(result[2].functionName).toBe('ExampleWithChild');
  expect(result[2].fileName).toContain('source.test.tsx');
  expect(result[2].lineNumber).toBe(35);
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

it('normalizeFileName should strip http:// host prefix (Vite dev server)', () => {
  const input = 'http://localhost:5173/src/features/my-component.tsx';
  const result = normalizeFileName(input);
  expect(result).toBe('/src/features/my-component.tsx');
});

it('normalizeFileName should strip http:// host prefix and query parameters', () => {
  const input = 'http://127.0.0.1:5173/src/main.tsx?t=123';
  const result = normalizeFileName(input);
  expect(result).toBe('/src/main.tsx');
});

it('normalizeFileName should strip https:// host prefix for /@fs/ paths', () => {
  const input = 'https://example.local:5173/@fs/Users/me/proj/src/app.tsx';
  const result = normalizeFileName(input);
  expect(result).toBe('/@fs/Users/me/proj/src/app.tsx');
});

it('extractLocation should strip outer parentheses from Chrome stack trace format', () => {
  const result = extractLocation('(file.js:10:5)');
  expect(result).toEqual(['file.js', '10', '5']);
});

it('extractLocation should preserve parentheses in Next.js route group paths', () => {
  const result = extractLocation(
    '/_next/static/chunks/09f9e_(docs)_some-page__components.js:42:15',
  );
  expect(result).toEqual([
    '/_next/static/chunks/09f9e_(docs)_some-page__components.js',
    '42',
    '15',
  ]);
});

it('extractLocation should handle Chrome stack trace with route group path', () => {
  const result = extractLocation(
    '(/_next/static/chunks/(docs)/page.js:10:5)',
  );
  expect(result).toEqual(['/_next/static/chunks/(docs)/page.js', '10', '5']);
});

it('extractLocation should handle path without any parentheses', () => {
  const result = extractLocation('/src/components/button.tsx:25:10');
  expect(result).toEqual(['/src/components/button.tsx', '25', '10']);
});

it('extractLocation should handle path starting with route group (no Chrome wrap)', () => {
  const result = extractLocation('(docs)/page.tsx:10:5');
  expect(result).toEqual(['(docs)/page.tsx', '10', '5']);
});

it('extractLocation should handle file with parentheses in name', () => {
  const result = extractLocation('file(1).js:10:5');
  expect(result).toEqual(['file(1).js', '10', '5']);
});
