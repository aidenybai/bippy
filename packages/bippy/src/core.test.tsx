import type React from 'react';
import { render, type RenderOptions } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { instrument, traverseFiber } from './core.js';
import type { FiberRoot } from './types.js';

describe('traverseFiber', () => {
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
    const handler = vi.fn();
    traverseFiber(fiber.current, fiber => handler(fiber.key));
    const keys = handler.mock.calls.map(call => call[0]).slice(1);
    const expected = ['root', 'a', 'a1', 'a2', 'b', 'c', 'd', 'd1', 'd11'];
    expect(keys).toEqual(expected);
  });

  it('should traverse a fiber in reverse', () => {
    const handler = vi.fn();
    const d11 = traverseFiber(fiber.current, fiber => fiber.key === 'd11');
    expect(d11?.key).toBe('d11');
    traverseFiber(d11, fiber => handler(fiber.key), true);
    const keys = handler.mock.calls.map(call => call[0]).slice(0, -1);
    expect(keys).toEqual(['d11', 'd1', 'd', 'root']);
  });
});
