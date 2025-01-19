import type React from 'react';
import { render, type RenderOptions } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { instrument, traverseFiber } from './core.js';
import type { Fiber, FiberRoot } from './types.js';

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
