import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { useState, useEffect } from 'react';
import {
  createTimeTravelStore,
  useTimeTravelStore,
  useTimeTravelControls,
  createReducer,
  useUndoable,
} from './time-travel-robust';
import type { Action, TimeTravelStore } from './time-travel-robust';

interface CounterState {
  count: number;
}

const counterReducer = createReducer<CounterState>({
  INCREMENT: (state) => ({ count: state.count + 1 }),
  DECREMENT: (state) => ({ count: state.count - 1 }),
  SET: (state, payload) => ({ count: payload as number }),
});

describe('createTimeTravelStore', () => {
  let store: TimeTravelStore<CounterState>;

  beforeEach(() => {
    store = createTimeTravelStore(counterReducer, { count: 0 });
  });

  it('should initialize with initial state', () => {
    expect(store.getState()).toEqual({ count: 0 });
  });

  it('should dispatch actions and update state', () => {
    store.dispatch('INCREMENT');
    expect(store.getState()).toEqual({ count: 1 });

    store.dispatch('INCREMENT');
    expect(store.getState()).toEqual({ count: 2 });

    store.dispatch('DECREMENT');
    expect(store.getState()).toEqual({ count: 1 });
  });

  it('should track history', () => {
    store.dispatch('INCREMENT');
    store.dispatch('INCREMENT');
    store.dispatch('INCREMENT');

    const history = store.getHistory();
    expect(history.length).toBe(4);
    expect(history[0].state).toEqual({ count: 0 });
    expect(history[1].state).toEqual({ count: 1 });
    expect(history[2].state).toEqual({ count: 2 });
    expect(history[3].state).toEqual({ count: 3 });
  });

  it('should navigate back and forward', () => {
    store.dispatch('INCREMENT');
    store.dispatch('INCREMENT');
    store.dispatch('INCREMENT');

    expect(store.getState()).toEqual({ count: 3 });

    store.goBack();
    expect(store.getState()).toEqual({ count: 2 });

    store.goBack();
    expect(store.getState()).toEqual({ count: 1 });

    store.goForward();
    expect(store.getState()).toEqual({ count: 2 });
  });

  it('should go to specific snapshot', () => {
    store.dispatch('INCREMENT');
    store.dispatch('INCREMENT');
    store.dispatch('INCREMENT');

    store.goTo(1);
    expect(store.getState()).toEqual({ count: 1 });
    expect(store.getCurrentIndex()).toBe(1);
  });

  it('should reset to initial state', () => {
    store.dispatch('INCREMENT');
    store.dispatch('INCREMENT');

    store.reset();

    expect(store.getState()).toEqual({ count: 0 });
    expect(store.getHistory().length).toBe(1);
  });

  it('should jump to start and end', () => {
    store.dispatch('INCREMENT');
    store.dispatch('INCREMENT');
    store.dispatch('INCREMENT');

    store.jumpToStart();
    expect(store.getState()).toEqual({ count: 0 });

    store.jumpToEnd();
    expect(store.getState()).toEqual({ count: 3 });
  });

  it('should replay actions', () => {
    store.dispatch('INCREMENT');
    store.dispatch('INCREMENT');
    store.dispatch('DECREMENT');

    store.replay();

    expect(store.getState()).toEqual({ count: 1 });
    expect(store.getHistory().length).toBe(4);
  });

  it('should report canGoBack and canGoForward correctly', () => {
    expect(store.canGoBack()).toBe(false);
    expect(store.canGoForward()).toBe(false);

    store.dispatch('INCREMENT');
    expect(store.canGoBack()).toBe(true);
    expect(store.canGoForward()).toBe(false);

    store.goBack();
    expect(store.canGoBack()).toBe(false);
    expect(store.canGoForward()).toBe(true);
  });

  it('should respect maxHistory option', () => {
    const limitedStore = createTimeTravelStore(counterReducer, { count: 0 }, {
      maxHistory: 3,
    });

    limitedStore.dispatch('INCREMENT');
    limitedStore.dispatch('INCREMENT');
    limitedStore.dispatch('INCREMENT');
    limitedStore.dispatch('INCREMENT');

    expect(limitedStore.getHistory().length).toBe(3);
  });

  it('should notify subscribers on state change', () => {
    let notifyCount = 0;
    store.subscribe(() => {
      notifyCount++;
    });

    store.dispatch('INCREMENT');
    store.dispatch('INCREMENT');

    expect(notifyCount).toBe(2);
  });

  it('should return unsubscribe function', () => {
    let notifyCount = 0;
    const unsubscribe = store.subscribe(() => {
      notifyCount++;
    });

    store.dispatch('INCREMENT');
    expect(notifyCount).toBe(1);

    unsubscribe();
    store.dispatch('INCREMENT');
    expect(notifyCount).toBe(1);
  });
});

describe('useTimeTravelStore hook', () => {
  let store: TimeTravelStore<CounterState>;

  beforeEach(() => {
    store = createTimeTravelStore(counterReducer, { count: 0 });
  });

  afterEach(() => {
    cleanup();
  });

  it('should render with store state', () => {
    const TestComponent = () => {
      const state = useTimeTravelStore<CounterState, CounterState>(store);
      return <div data-testid="count">{state.count}</div>;
    };

    render(<TestComponent />);
    expect(screen.getByTestId('count').textContent).toBe('0');
  });

  it('should update when store changes', async () => {
    const TestComponent = () => {
      const state = useTimeTravelStore<CounterState, CounterState>(store);
      return (
        <div>
          <div data-testid="count">{state.count}</div>
          <button
            data-testid="increment"
            onClick={() => store.dispatch('INCREMENT')}
          >
            +
          </button>
        </div>
      );
    };

    render(<TestComponent />);
    expect(screen.getByTestId('count').textContent).toBe('0');

    await act(async () => {
      fireEvent.click(screen.getByTestId('increment'));
    });

    expect(screen.getByTestId('count').textContent).toBe('1');
  });

  it('should support selector', () => {
    const TestComponent = () => {
      const count = useTimeTravelStore<CounterState, number>(store, (s) => s.count);
      return <div data-testid="count">{count}</div>;
    };

    render(<TestComponent />);
    expect(screen.getByTestId('count').textContent).toBe('0');
  });
});

describe('useTimeTravelControls hook', () => {
  let store: TimeTravelStore<CounterState>;

  beforeEach(() => {
    store = createTimeTravelStore(counterReducer, { count: 0 });
  });

  afterEach(() => {
    cleanup();
  });

  it('should provide controls', async () => {
    const TestComponent = () => {
      const controls = useTimeTravelControls(store);
      return (
        <div>
          <div data-testid="history-length">{controls.historyLength}</div>
          <div data-testid="current-index">{controls.currentIndex}</div>
          <div data-testid="can-go-back">{controls.canGoBack ? 'yes' : 'no'}</div>
          <button
            data-testid="dispatch"
            onClick={() => store.dispatch('INCREMENT')}
          >
            +
          </button>
          <button data-testid="go-back" onClick={controls.goBack}>
            Back
          </button>
        </div>
      );
    };

    render(<TestComponent />);

    expect(screen.getByTestId('history-length').textContent).toBe('1');
    expect(screen.getByTestId('current-index').textContent).toBe('0');
    expect(screen.getByTestId('can-go-back').textContent).toBe('no');

    await act(async () => {
      fireEvent.click(screen.getByTestId('dispatch'));
    });

    expect(screen.getByTestId('history-length').textContent).toBe('2');
    expect(screen.getByTestId('can-go-back').textContent).toBe('yes');

    await act(async () => {
      fireEvent.click(screen.getByTestId('go-back'));
    });

    expect(screen.getByTestId('current-index').textContent).toBe('0');
  });
});

describe('useUndoable hook', () => {
  afterEach(() => {
    cleanup();
  });

  it('should provide undo/redo functionality', async () => {
    const simpleReducer = (state: number, action: Action): number => {
      switch (action.type) {
        case 'INCREMENT':
          return state + 1;
        case 'DECREMENT':
          return state - 1;
        default:
          return state;
      }
    };

    const TestComponent = () => {
      const { state, dispatch, undo, redo, canUndo, canRedo, past, future } =
        useUndoable(simpleReducer, 0);

      return (
        <div>
          <div data-testid="value">{state}</div>
          <div data-testid="past-length">{past.length}</div>
          <div data-testid="future-length">{future.length}</div>
          <div data-testid="can-undo">{canUndo ? 'yes' : 'no'}</div>
          <div data-testid="can-redo">{canRedo ? 'yes' : 'no'}</div>
          <button
            data-testid="increment"
            onClick={() => dispatch('INCREMENT')}
          >
            +
          </button>
          <button data-testid="undo" onClick={undo}>
            Undo
          </button>
          <button data-testid="redo" onClick={redo}>
            Redo
          </button>
        </div>
      );
    };

    render(<TestComponent />);

    expect(screen.getByTestId('value').textContent).toBe('0');
    expect(screen.getByTestId('can-undo').textContent).toBe('no');
    expect(screen.getByTestId('can-redo').textContent).toBe('no');

    await act(async () => {
      fireEvent.click(screen.getByTestId('increment'));
    });

    expect(screen.getByTestId('value').textContent).toBe('1');
    expect(screen.getByTestId('can-undo').textContent).toBe('yes');
    expect(screen.getByTestId('past-length').textContent).toBe('1');

    await act(async () => {
      fireEvent.click(screen.getByTestId('increment'));
    });

    expect(screen.getByTestId('value').textContent).toBe('2');
    expect(screen.getByTestId('past-length').textContent).toBe('2');

    await act(async () => {
      fireEvent.click(screen.getByTestId('undo'));
    });

    expect(screen.getByTestId('value').textContent).toBe('1');
    expect(screen.getByTestId('can-redo').textContent).toBe('yes');
    expect(screen.getByTestId('future-length').textContent).toBe('1');

    await act(async () => {
      fireEvent.click(screen.getByTestId('redo'));
    });

    expect(screen.getByTestId('value').textContent).toBe('2');
    expect(screen.getByTestId('future-length').textContent).toBe('0');
  });
});

describe('createReducer', () => {
  it('should create a reducer from handlers', () => {
    const reducer = createReducer<{ value: number }>({
      ADD: (state, payload) => ({ value: state.value + (payload as number) }),
      SUBTRACT: (state, payload) => ({ value: state.value - (payload as number) }),
    });

    let state = { value: 10 };

    state = reducer(state, { type: 'ADD', payload: 5, timestamp: Date.now() });
    expect(state).toEqual({ value: 15 });

    state = reducer(state, { type: 'SUBTRACT', payload: 3, timestamp: Date.now() });
    expect(state).toEqual({ value: 12 });
  });

  it('should return state unchanged for unknown actions', () => {
    const reducer = createReducer<{ value: number }>({
      ADD: (state, payload) => ({ value: state.value + (payload as number) }),
    });

    const state = { value: 10 };
    const newState = reducer(state, { type: 'UNKNOWN', timestamp: Date.now() });

    expect(newState).toBe(state);
  });
});
