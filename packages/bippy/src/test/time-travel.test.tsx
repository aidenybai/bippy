import '../index.js';

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import React, { useState } from 'react';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { TimeTravel, createTimeTravel } from '../time-travel.js';

afterEach(() => {
  cleanup();
});

const Counter = ({ initialCount = 0 }: { initialCount?: number }) => {
  const [count, setCount] = useState(initialCount);

  return (
    <div>
      <span data-testid="count">{count}</span>
      <button data-testid="increment" onClick={() => setCount((previousCount) => previousCount + 1)}>
        +
      </button>
      <button data-testid="decrement" onClick={() => setCount((previousCount) => previousCount - 1)}>
        -
      </button>
    </div>
  );
};

const TodoApp = () => {
  const [todos, setTodos] = useState<string[]>([]);
  const [inputValue, setInputValue] = useState('');

  const addTodo = () => {
    if (inputValue.trim()) {
      setTodos((previousTodos) => [...previousTodos, inputValue]);
      setInputValue('');
    }
  };

  const removeTodo = (index: number) => {
    setTodos((previousTodos) => previousTodos.filter((_, itemIndex) => itemIndex !== index));
  };

  return (
    <div>
      <input
        data-testid="todo-input"
        value={inputValue}
        onChange={(event) => setInputValue(event.target.value)}
      />
      <button data-testid="add-todo" onClick={addTodo}>
        Add
      </button>
      <ul data-testid="todo-list">
        {todos.map((todo, index) => (
          <li key={index}>
            <span data-testid={`todo-${index}`}>{todo}</span>
            <button data-testid={`remove-${index}`} onClick={() => removeTodo(index)}>
              Remove
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
};

const MultiStateComponent = () => {
  const [name, setName] = useState('');
  const [age, setAge] = useState(0);
  const [active, setActive] = useState(false);

  return (
    <div>
      <input
        data-testid="name-input"
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <input
        data-testid="age-input"
        type="number"
        value={age}
        onChange={(event) => setAge(Number(event.target.value))}
      />
      <button data-testid="toggle-active" onClick={() => setActive((previousActive) => !previousActive)}>
        {active ? 'Active' : 'Inactive'}
      </button>
      <div data-testid="state-display">
        {name} - {age} - {active ? 'active' : 'inactive'}
      </div>
    </div>
  );
};

describe('TimeTravel', () => {
  describe('createTimeTravel', () => {
    it('should create a TimeTravel instance', () => {
      const timeTravel = createTimeTravel({
        dangerouslyRunInProduction: true,
      });
      expect(timeTravel).toBeInstanceOf(TimeTravel);
    });

    it('should accept options', () => {
      const onSnapshot = vi.fn();
      const timeTravel = createTimeTravel({
        maxHistoryLength: 50,
        onSnapshot,
        dangerouslyRunInProduction: true,
      });
      expect(timeTravel).toBeInstanceOf(TimeTravel);
    });
  });

  describe('snapshot tracking', () => {
    it('should capture snapshots on commit', async () => {
      const onSnapshot = vi.fn();
      createTimeTravel({
        onSnapshot,
        dangerouslyRunInProduction: true,
      });

      render(<Counter />);

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });

      expect(onSnapshot).toHaveBeenCalled();
    });

    it('should track state changes', async () => {
      const onSnapshot = vi.fn();
      const timeTravel = createTimeTravel({
        onSnapshot,
        dangerouslyRunInProduction: true,
      });

      render(<Counter />);

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });

      const initialHistory = timeTravel.getHistory();
      expect(initialHistory.length).toBeGreaterThan(0);

      const incrementButton = screen.getByTestId('increment');

      await act(async () => {
        fireEvent.click(incrementButton);
        await new Promise((resolve) => setTimeout(resolve, 10));
      });

      const updatedHistory = timeTravel.getHistory();
      expect(updatedHistory.length).toBeGreaterThanOrEqual(initialHistory.length);
    });

    it('should filter components by name', async () => {
      const onSnapshot = vi.fn();
      const timeTravel = createTimeTravel({
        onSnapshot,
        trackComponents: ['Counter'],
        dangerouslyRunInProduction: true,
      });

      render(
        <div>
          <Counter />
          <TodoApp />
        </div>,
      );

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });

      const history = timeTravel.getHistory();
      for (const snapshot of history) {
        for (const fiberSnapshot of snapshot.fibers.values()) {
          expect(fiberSnapshot.displayName).toBe('Counter');
        }
      }
    });

    it('should filter components by function', async () => {
      const trackFunction = vi.fn((displayName: string | null) => {
        return displayName === 'Counter' || displayName === 'TodoApp';
      });
      const timeTravel = createTimeTravel({
        trackComponents: trackFunction,
        dangerouslyRunInProduction: true,
      });

      render(
        <div>
          <Counter />
          <TodoApp />
        </div>,
      );

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });

      expect(trackFunction).toHaveBeenCalled();
    });
  });

  describe('history navigation', () => {
    it('should track history length', async () => {
      const timeTravel = createTimeTravel({
        dangerouslyRunInProduction: true,
      });

      render(<Counter />);

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });

      const history = timeTravel.getHistory();
      expect(history.length).toBeGreaterThan(0);
    });

    it('should return current snapshot', async () => {
      const timeTravel = createTimeTravel({
        dangerouslyRunInProduction: true,
      });

      render(<Counter />);

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });

      const current = timeTravel.getCurrentSnapshot();
      expect(current).not.toBeNull();
      expect(current?.fibers).toBeDefined();
    });

    it('should report canGoBack and canGoForward correctly', async () => {
      const timeTravel = createTimeTravel({
        dangerouslyRunInProduction: true,
      });

      render(<Counter />);

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });

      expect(timeTravel.canGoForward()).toBe(false);

      const incrementButton = screen.getByTestId('increment');

      for (let iterationIndex = 0; iterationIndex < 3; iterationIndex++) {
        await act(async () => {
          fireEvent.click(incrementButton);
          await new Promise((resolve) => setTimeout(resolve, 10));
        });
      }

      const currentIndex = timeTravel.getCurrentIndex();
      if (currentIndex > 0) {
        expect(timeTravel.canGoBack()).toBe(true);
      }
    });

    it('should navigate back and forward', async () => {
      const timeTravel = createTimeTravel({
        dangerouslyRunInProduction: true,
      });

      render(<Counter />);

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });

      const incrementButton = screen.getByTestId('increment');

      for (let iterationIndex = 0; iterationIndex < 3; iterationIndex++) {
        await act(async () => {
          fireEvent.click(incrementButton);
          await new Promise((resolve) => setTimeout(resolve, 10));
        });
      }

      const historyLength = timeTravel.getHistory().length;

      if (historyLength > 1) {
        const previousIndex = timeTravel.getCurrentIndex();
        timeTravel.goBack();
        expect(timeTravel.getCurrentIndex()).toBe(previousIndex - 1);

        timeTravel.goForward();
        expect(timeTravel.getCurrentIndex()).toBe(previousIndex);
      }
    });

    it('should go to specific index', async () => {
      const timeTravel = createTimeTravel({
        dangerouslyRunInProduction: true,
      });

      render(<Counter />);

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });

      const incrementButton = screen.getByTestId('increment');

      for (let iterationIndex = 0; iterationIndex < 5; iterationIndex++) {
        await act(async () => {
          fireEvent.click(incrementButton);
          await new Promise((resolve) => setTimeout(resolve, 10));
        });
      }

      const history = timeTravel.getHistory();
      if (history.length > 2) {
        timeTravel.goToIndex(1);
        expect(timeTravel.getCurrentIndex()).toBe(1);
      }
    });

    it('should go to specific commit ID', async () => {
      const timeTravel = createTimeTravel({
        dangerouslyRunInProduction: true,
      });

      render(<Counter />);

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });

      const incrementButton = screen.getByTestId('increment');

      await act(async () => {
        fireEvent.click(incrementButton);
        await new Promise((resolve) => setTimeout(resolve, 10));
      });

      const history = timeTravel.getHistory();
      if (history.length > 0) {
        const targetCommitId = history[0].commitId;
        timeTravel.goToCommitId(targetCommitId);
        expect(timeTravel.getCurrentSnapshot()?.commitId).toBe(targetCommitId);
      }
    });
  });

  describe('timeline methods', () => {
    it('should get state timeline for a fiber', async () => {
      const timeTravel = createTimeTravel({
        dangerouslyRunInProduction: true,
      });

      render(<Counter />);

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });

      const incrementButton = screen.getByTestId('increment');

      for (let iterationIndex = 0; iterationIndex < 3; iterationIndex++) {
        await act(async () => {
          fireEvent.click(incrementButton);
          await new Promise((resolve) => setTimeout(resolve, 10));
        });
      }

      const history = timeTravel.getHistory();
      if (history.length > 0) {
        const firstFiberId = history[0].fibers.keys().next().value;
        if (firstFiberId !== undefined) {
          const timeline = timeTravel.getStateTimeline(firstFiberId, 0);
          expect(timeline).toBeDefined();
          expect(Array.isArray(timeline)).toBe(true);
        }
      }
    });

    it('should get component history by display name', async () => {
      const timeTravel = createTimeTravel({
        dangerouslyRunInProduction: true,
      });

      render(<Counter />);

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });

      const componentHistory = timeTravel.getComponentHistory('Counter');
      expect(Array.isArray(componentHistory)).toBe(true);
    });
  });

  describe('diff functionality', () => {
    it('should compute diff between snapshots', async () => {
      const timeTravel = createTimeTravel({
        dangerouslyRunInProduction: true,
      });

      render(<Counter />);

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });

      const incrementButton = screen.getByTestId('increment');

      await act(async () => {
        fireEvent.click(incrementButton);
        await new Promise((resolve) => setTimeout(resolve, 10));
      });

      const history = timeTravel.getHistory();
      if (history.length >= 2) {
        const diffResult = timeTravel.diff(0, history.length - 1);
        expect(diffResult).toBeDefined();
        expect(diffResult instanceof Map).toBe(true);
      }
    });
  });

  describe('export/import', () => {
    it('should export history to JSON', async () => {
      const timeTravel = createTimeTravel({
        dangerouslyRunInProduction: true,
      });

      render(<Counter />);

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });

      const exported = timeTravel.exportHistory();
      expect(typeof exported).toBe('string');

      const parsed = JSON.parse(exported);
      expect(parsed.history).toBeDefined();
      expect(parsed.currentIndex).toBeDefined();
    });

    it('should import history from JSON', async () => {
      const timeTravel = createTimeTravel({
        dangerouslyRunInProduction: true,
      });

      render(<Counter />);

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });

      const incrementButton = screen.getByTestId('increment');

      await act(async () => {
        fireEvent.click(incrementButton);
        await new Promise((resolve) => setTimeout(resolve, 10));
      });

      const exported = timeTravel.exportHistory();
      timeTravel.clear();

      expect(timeTravel.getHistory().length).toBe(0);

      timeTravel.importHistory(exported);
      expect(timeTravel.getHistory().length).toBeGreaterThan(0);
    });
  });

  describe('clear functionality', () => {
    it('should clear history', async () => {
      const timeTravel = createTimeTravel({
        dangerouslyRunInProduction: true,
      });

      render(<Counter />);

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });

      expect(timeTravel.getHistory().length).toBeGreaterThan(0);

      timeTravel.clear();

      expect(timeTravel.getHistory().length).toBe(0);
      expect(timeTravel.getCurrentIndex()).toBe(-1);
    });
  });

  describe('max history length', () => {
    it('should respect max history length', async () => {
      const maxLength = 5;
      const timeTravel = createTimeTravel({
        maxHistoryLength: maxLength,
        dangerouslyRunInProduction: true,
      });

      render(<Counter />);

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });

      const incrementButton = screen.getByTestId('increment');

      for (let iterationIndex = 0; iterationIndex < maxLength + 5; iterationIndex++) {
        await act(async () => {
          fireEvent.click(incrementButton);
          await new Promise((resolve) => setTimeout(resolve, 10));
        });
      }

      expect(timeTravel.getHistory().length).toBeLessThanOrEqual(maxLength);
    });
  });

  describe('callbacks', () => {
    it('should call onSnapshot callback', async () => {
      const onSnapshot = vi.fn();
      createTimeTravel({
        onSnapshot,
        dangerouslyRunInProduction: true,
      });

      render(<Counter />);

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });

      expect(onSnapshot).toHaveBeenCalled();
    });

    it('should call onRestore callback when navigating', async () => {
      const onRestore = vi.fn();
      const timeTravel = createTimeTravel({
        onRestore,
        dangerouslyRunInProduction: true,
      });

      render(<Counter />);

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });

      const incrementButton = screen.getByTestId('increment');

      for (let iterationIndex = 0; iterationIndex < 3; iterationIndex++) {
        await act(async () => {
          fireEvent.click(incrementButton);
          await new Promise((resolve) => setTimeout(resolve, 10));
        });
      }

      if (timeTravel.canGoBack()) {
        timeTravel.goBack();
        expect(onRestore).toHaveBeenCalled();
      }
    });
  });

  describe('complex state tracking', () => {
    it('should track multiple state hooks', async () => {
      const timeTravel = createTimeTravel({
        trackComponents: ['MultiStateComponent'],
        dangerouslyRunInProduction: true,
      });

      render(<MultiStateComponent />);

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });

      const nameInput = screen.getByTestId('name-input');
      const ageInput = screen.getByTestId('age-input');
      const toggleButton = screen.getByTestId('toggle-active');

      await act(async () => {
        fireEvent.change(nameInput, { target: { value: 'John' } });
        await new Promise((resolve) => setTimeout(resolve, 10));
      });

      await act(async () => {
        fireEvent.change(ageInput, { target: { value: '25' } });
        await new Promise((resolve) => setTimeout(resolve, 10));
      });

      await act(async () => {
        fireEvent.click(toggleButton);
        await new Promise((resolve) => setTimeout(resolve, 10));
      });

      const history = timeTravel.getHistory();
      expect(history.length).toBeGreaterThan(0);

      const lastSnapshot = history[history.length - 1];
      for (const fiberSnapshot of lastSnapshot.fibers.values()) {
        if (fiberSnapshot.displayName === 'MultiStateComponent') {
          expect(fiberSnapshot.hookStates.length).toBeGreaterThan(0);
        }
      }
    });

    it('should track array state changes', async () => {
      const timeTravel = createTimeTravel({
        trackComponents: ['TodoApp'],
        dangerouslyRunInProduction: true,
      });

      render(<TodoApp />);

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });

      const todoInput = screen.getByTestId('todo-input');
      const addButton = screen.getByTestId('add-todo');

      await act(async () => {
        fireEvent.change(todoInput, { target: { value: 'First todo' } });
        await new Promise((resolve) => setTimeout(resolve, 10));
      });

      await act(async () => {
        fireEvent.click(addButton);
        await new Promise((resolve) => setTimeout(resolve, 10));
      });

      await act(async () => {
        fireEvent.change(todoInput, { target: { value: 'Second todo' } });
        await new Promise((resolve) => setTimeout(resolve, 10));
      });

      await act(async () => {
        fireEvent.click(addButton);
        await new Promise((resolve) => setTimeout(resolve, 10));
      });

      const history = timeTravel.getHistory();
      expect(history.length).toBeGreaterThan(0);
    });
  });
});
