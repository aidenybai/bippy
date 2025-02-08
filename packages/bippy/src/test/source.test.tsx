import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getFiberSource } from '../source.js';
import type { Fiber } from '../types.js';
import * as errorStackParser from 'error-stack-parser-es/lite';
import { SourceMapConsumer } from 'source-map-js';

vi.mock('error-stack-parser-es/lite', () => ({
  parseStack: vi.fn(),
}));

vi.mock('source-map-js', () => ({
  SourceMapConsumer: vi.fn(),
}));

describe('getFiberSource', () => {
  const mockFetch = vi.fn();
  const originalFetch = global.fetch;
  const mockConsole = {
    error: vi.fn(),
    warn: vi.fn(),
  };

  beforeEach(() => {
    global.fetch = mockFetch;
    global.console = { ...console, ...mockConsole };
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.clearAllMocks();
  });

  it('should return debug source when _debugSource is present', async () => {
    const mockFiber = {
      _debugSource: {
        fileName: 'test.tsx',
        lineNumber: 42,
        columnNumber: 10,
      },
      tag: 0,
      key: null,
      elementType: null,
      type: null,
      stateNode: null,
      return: null,
      child: null,
      sibling: null,
      index: 0,
      ref: null,
      pendingProps: null,
      memoizedProps: null,
      updateQueue: null,
      memoizedState: null,
      dependencies: null,
      mode: 0,
      flags: 0,
      subtreeFlags: 0,
      deletions: null,
      lanes: 0,
      childLanes: 0,
      alternate: null,
    } as unknown as Fiber;

    const result = await getFiberSource(mockFiber);
    expect(result).toEqual({
      fileName: 'test.tsx',
      lineNumber: 42,
      columnNumber: 10,
    });
  });

  it('should handle _debugSource without columnNumber', async () => {
    const mockFiber = {
      _debugSource: {
        fileName: 'test.tsx',
        lineNumber: 42,
      },
      tag: 0,
      key: null,
      elementType: null,
      type: null,
      stateNode: null,
      return: null,
      child: null,
      sibling: null,
      index: 0,
      ref: null,
      pendingProps: null,
      memoizedProps: null,
      updateQueue: null,
      memoizedState: null,
      dependencies: null,
      mode: 0,
      flags: 0,
      subtreeFlags: 0,
      deletions: null,
      lanes: 0,
      childLanes: 0,
      alternate: null,
    } as unknown as Fiber;

    const result = await getFiberSource(mockFiber);
    expect(result).toEqual({
      fileName: 'test.tsx',
      lineNumber: 42,
      columnNumber: 0,
    });
  });

  it('should handle source map resolution', async () => {
    const mockFiber = {
      tag: 0,
      key: null,
      elementType: null,
      type: () => {},
      stateNode: null,
      return: null,
      child: null,
      sibling: null,
      index: 0,
      ref: null,
      pendingProps: null,
      memoizedProps: null,
      updateQueue: null,
      memoizedState: null,
      dependencies: null,
      mode: 0,
      flags: 0,
      subtreeFlags: 0,
      deletions: null,
      lanes: 0,
      childLanes: 0,
      alternate: null,
    } as unknown as Fiber;

    const mockSourceMapContent = {
      version: 3,
      sources: ['original.tsx'],
      names: [],
      mappings: 'AAAA',
    };

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve('//# sourceMappingURL=file.js.map'),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockSourceMapContent),
      });

    vi.mocked(errorStackParser.parseStack).mockReturnValue([
      {
        file: 'file:///path/to/file.js',
        line: 1,
        col: 1,
      },
    ]);

    vi.mocked(SourceMapConsumer).mockImplementation(
      () =>
        ({
          originalPositionFor: () => ({
            source: 'original.tsx',
            line: 10,
            column: 5,
          }),
        }) as unknown as SourceMapConsumer,
    );

    // Mock RDT hook
    const mockRDTHook = {
      renderers: new Map([
        [
          1,
          {
            currentDispatcherRef: { current: null },
          },
        ],
      ]),
    };
    Object.defineProperty(global, '__REACT_DEVTOOLS_GLOBAL_HOOK__', {
      value: mockRDTHook,
      configurable: true,
    });

    const result = await getFiberSource(mockFiber);
    expect(result).toEqual({
      fileName: 'original.tsx',
      lineNumber: 10,
      columnNumber: 5,
    });
  });

  it('should return null when no source is found', async () => {
    const mockFiber = {
      tag: 0,
      key: null,
      elementType: null,
      type: () => {},
      stateNode: null,
      return: null,
      child: null,
      sibling: null,
      index: 0,
      ref: null,
      pendingProps: null,
      memoizedProps: null,
      updateQueue: null,
      memoizedState: null,
      dependencies: null,
      mode: 0,
      flags: 0,
      subtreeFlags: 0,
      deletions: null,
      lanes: 0,
      childLanes: 0,
      alternate: null,
    } as unknown as Fiber;

    mockFetch.mockResolvedValue({ ok: false });
    vi.mocked(errorStackParser.parseStack).mockReturnValue([]);

    const result = await getFiberSource(mockFiber);
    expect(result).toBeNull();
  });

  it('should handle file:// protocol paths', async () => {
    const mockFiber = {
      tag: 0,
      key: null,
      elementType: null,
      type: () => {},
      stateNode: null,
      return: null,
      child: null,
      sibling: null,
      index: 0,
      ref: null,
      pendingProps: null,
      memoizedProps: null,
      updateQueue: null,
      memoizedState: null,
      dependencies: null,
      mode: 0,
      flags: 0,
      subtreeFlags: 0,
      deletions: null,
      lanes: 0,
      childLanes: 0,
      alternate: null,
    } as unknown as Fiber;

    mockFetch.mockResolvedValue({ ok: false });
    vi.mocked(errorStackParser.parseStack).mockReturnValue([
      {
        file: 'file:///Users/test/project/src/component.tsx',
        line: 1,
        col: 1,
      },
    ]);

    const result = await getFiberSource(mockFiber);
    expect(result).toEqual({
      fileName: '/_build/@fs/Users/test/project/src/component.tsx',
      lineNumber: 1,
      columnNumber: 1,
    });
  });
});
