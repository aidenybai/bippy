import 'bippy/install-hook-only';

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { useState } from 'react';
import {
  createTimeTravel,
  watchComponentState,
} from './time-travel';
import type { TimeTravelInstance } from './time-travel';

const Counter = () => {
  const [count, setCount] = useState(0);
  return (
    <div>
      <span data-testid="count">{count}</span>
      <button data-testid="increment" onClick={() => setCount(count + 1)}>
        +
      </button>
      <button data-testid="decrement" onClick={() => setCount(count - 1)}>
        -
      </button>
    </div>
  );
};


describe('Time Travel', () => {
  let timeTravel: TimeTravelInstance;

  beforeEach(() => {
    timeTravel = createTimeTravel({
      maxHistoryLength: 50,
    });
  });

  afterEach(() => {
    timeTravel.destroy();
    cleanup();
  });

  it('should capture snapshots on state changes', async () => {
    render(<Counter />);

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    const initialHistoryLength = timeTravel.getHistory().length;
    expect(initialHistoryLength).toBeGreaterThan(0);

    const incrementButton = screen.getByTestId('increment');

    await act(async () => {
      fireEvent.click(incrementButton);
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(timeTravel.getHistory().length).toBeGreaterThan(initialHistoryLength);
  });

  it('should track history length correctly', async () => {
    render(<Counter />);

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    const incrementButton = screen.getByTestId('increment');

    for (let clickIndex = 0; clickIndex < 5; clickIndex++) {
      await act(async () => {
        fireEvent.click(incrementButton);
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
    }

    expect(timeTravel.getHistory().length).toBeGreaterThanOrEqual(5);
  });

  it('should be able to pause and resume recording', async () => {
    render(<Counter />);

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    timeTravel.pause();
    expect(timeTravel.isPaused()).toBe(true);

    const historyLengthWhenPaused = timeTravel.getHistory().length;

    const incrementButton = screen.getByTestId('increment');
    await act(async () => {
      fireEvent.click(incrementButton);
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(timeTravel.getHistory().length).toBe(historyLengthWhenPaused);

    timeTravel.resume();
    expect(timeTravel.isPaused()).toBe(false);

    await act(async () => {
      fireEvent.click(incrementButton);
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(timeTravel.getHistory().length).toBeGreaterThan(historyLengthWhenPaused);
  });

  it('should clear history', async () => {
    render(<Counter />);

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    const incrementButton = screen.getByTestId('increment');
    await act(async () => {
      fireEvent.click(incrementButton);
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(timeTravel.getHistory().length).toBeGreaterThan(0);

    timeTravel.clearHistory();

    expect(timeTravel.getHistory().length).toBe(0);
    expect(timeTravel.getCurrentIndex()).toBe(-1);
  });

  it('should navigate back and forward', async () => {
    render(<Counter />);

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    const incrementButton = screen.getByTestId('increment');

    for (let clickIndex = 0; clickIndex < 3; clickIndex++) {
      await act(async () => {
        fireEvent.click(incrementButton);
        await new Promise((resolve) => setTimeout(resolve, 30));
      });
    }

    const historyLength = timeTravel.getHistory().length;
    expect(historyLength).toBeGreaterThanOrEqual(3);

    const currentIndex = timeTravel.getCurrentIndex();
    expect(currentIndex).toBe(historyLength - 1);

    expect(timeTravel.canGoBack()).toBe(true);
    expect(timeTravel.canGoForward()).toBe(false);

    const wentBack = timeTravel.goBack();
    expect(wentBack).toBe(true);
    expect(timeTravel.getCurrentIndex()).toBe(currentIndex - 1);

    expect(timeTravel.canGoForward()).toBe(true);

    const wentForward = timeTravel.goForward();
    expect(wentForward).toBe(true);
    expect(timeTravel.getCurrentIndex()).toBe(currentIndex);
  });

  it('should go to specific snapshot', async () => {
    render(<Counter />);

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    const incrementButton = screen.getByTestId('increment');

    for (let clickIndex = 0; clickIndex < 5; clickIndex++) {
      await act(async () => {
        fireEvent.click(incrementButton);
        await new Promise((resolve) => setTimeout(resolve, 30));
      });
    }

    const wentToSnapshot = timeTravel.goToSnapshot(2);
    expect(wentToSnapshot).toBe(true);
    expect(timeTravel.getCurrentIndex()).toBe(2);
  });

  it('should not go to invalid snapshot index', () => {
    expect(timeTravel.goToSnapshot(-1)).toBe(false);
    expect(timeTravel.goToSnapshot(1000)).toBe(false);
  });
});

describe('watchComponentState', () => {
  afterEach(() => {
    cleanup();
  });

  it('should watch component state changes', async () => {
    const watcher = watchComponentState<number>('Counter', 0);

    render(<Counter />);

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    const incrementButton = screen.getByTestId('increment');

    for (let clickIndex = 0; clickIndex < 3; clickIndex++) {
      await act(async () => {
        fireEvent.click(incrementButton);
        await new Promise((resolve) => setTimeout(resolve, 30));
      });
    }

    const history = watcher.getHistory();
    expect(history.length).toBeGreaterThan(0);

    watcher.destroy();
  });
});
