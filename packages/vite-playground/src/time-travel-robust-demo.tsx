import { useCallback } from 'react';
import {
  createTimeTravelStore,
  useTimeTravelStore,
  useTimeTravelControls,
  createReducer,
  useUndoable,
} from './time-travel-robust';
import type { Action, StateSnapshot } from './time-travel-robust';

interface TodoItem {
  id: number;
  text: string;
  completed: boolean;
}

interface TodoState {
  todos: TodoItem[];
  nextId: number;
  filter: 'all' | 'active' | 'completed';
}

const initialState: TodoState = {
  todos: [
    { id: 1, text: 'Learn React', completed: false },
    { id: 2, text: 'Build time travel', completed: true },
  ],
  nextId: 3,
  filter: 'all',
};

const todoReducer = createReducer<TodoState>({
  ADD_TODO: (state, payload) => ({
    ...state,
    todos: [
      ...state.todos,
      {
        id: state.nextId,
        text: payload as string,
        completed: false,
      },
    ],
    nextId: state.nextId + 1,
  }),

  TOGGLE_TODO: (state, payload) => ({
    ...state,
    todos: state.todos.map((todo) =>
      todo.id === payload ? { ...todo, completed: !todo.completed } : todo,
    ),
  }),

  DELETE_TODO: (state, payload) => ({
    ...state,
    todos: state.todos.filter((todo) => todo.id !== payload),
  }),

  SET_FILTER: (state, payload) => ({
    ...state,
    filter: payload as 'all' | 'active' | 'completed',
  }),

  CLEAR_COMPLETED: (state) => ({
    ...state,
    todos: state.todos.filter((todo) => !todo.completed),
  }),
});

const todoStore = createTimeTravelStore(todoReducer, initialState, {
  maxHistory: 50,
  onChange: (_state, action) => {
    if (action) {
      console.log(`[TodoStore] ${action.type}:`, action.payload);
    }
  },
});

const TodoInput = () => {
  const handleSubmit = useCallback((event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const input = form.elements.namedItem('todo') as HTMLInputElement;
    if (input.value.trim()) {
      todoStore.dispatch('ADD_TODO', input.value.trim());
      input.value = '';
    }
  }, []);

  return (
    <form onSubmit={handleSubmit} className="flex gap-2 mb-4">
      <input
        name="todo"
        type="text"
        placeholder="What needs to be done?"
        className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
      />
      <button
        type="submit"
        className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
      >
        Add
      </button>
    </form>
  );
};

const TodoItemComponent = ({ todo }: { todo: TodoItem }) => {
  return (
    <li className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg group">
      <input
        type="checkbox"
        checked={todo.completed}
        onChange={() => todoStore.dispatch('TOGGLE_TODO', todo.id)}
        className="w-5 h-5 rounded border-gray-300 text-blue-500 focus:ring-blue-500"
      />
      <span
        className={`flex-1 ${todo.completed ? 'line-through text-gray-400' : 'text-gray-700'}`}
      >
        {todo.text}
      </span>
      <button
        onClick={() => todoStore.dispatch('DELETE_TODO', todo.id)}
        className="opacity-0 group-hover:opacity-100 px-2 py-1 text-red-500 hover:bg-red-100 rounded transition-all"
      >
        ✕
      </button>
    </li>
  );
};

const FilterButtons = () => {
  const filter = useTimeTravelStore<TodoState, TodoState['filter']>(todoStore, (state) => state.filter);

  const filters: Array<{ value: 'all' | 'active' | 'completed'; label: string }> = [
    { value: 'all', label: 'All' },
    { value: 'active', label: 'Active' },
    { value: 'completed', label: 'Completed' },
  ];

  return (
    <div className="flex gap-2 mb-4">
      {filters.map(({ value, label }) => (
        <button
          key={value}
          onClick={() => todoStore.dispatch('SET_FILTER', value)}
          className={`px-3 py-1 rounded-full text-sm transition-colors ${
            filter === value
              ? 'bg-blue-500 text-white'
              : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
};

const TodoList = () => {
  const todoState = useTimeTravelStore<TodoState, TodoState>(todoStore);

  const filteredTodos = todoState.todos.filter((todo: TodoItem) => {
    if (todoState.filter === 'active') return !todo.completed;
    if (todoState.filter === 'completed') return todo.completed;
    return true;
  });

  const activeCount = todoState.todos.filter((t: TodoItem) => !t.completed).length;

  return (
    <div className="bg-white rounded-xl shadow-lg p-6 max-w-lg">
      <h2 className="text-2xl font-bold text-gray-800 mb-4">
        Todo List (Robust Store)
      </h2>

      <TodoInput />
      <FilterButtons />

      <ul className="space-y-2 mb-4">
        {filteredTodos.map((todo) => (
          <TodoItemComponent key={todo.id} todo={todo} />
        ))}
        {filteredTodos.length === 0 && (
          <li className="text-center text-gray-400 py-8">No todos to show</li>
        )}
      </ul>

      <div className="flex justify-between items-center pt-4 border-t text-sm text-gray-500">
        <span>{activeCount} items left</span>
        {todoState.todos.some((t: TodoItem) => t.completed) && (
          <button
            onClick={() => todoStore.dispatch('CLEAR_COMPLETED')}
            className="text-red-500 hover:text-red-700"
          >
            Clear completed
          </button>
        )}
      </div>
    </div>
  );
};

const TimeTravelPanel = () => {
  const controls = useTimeTravelControls(todoStore);

  return (
    <div className="bg-gray-900 rounded-xl shadow-lg p-6 max-w-lg text-white">
      <h2 className="text-2xl font-bold mb-4 flex items-center gap-2">
        <span>⏱️</span> Time Travel Controls
      </h2>

      <div className="mb-4">
        <div className="flex justify-between text-sm text-gray-400 mb-2">
          <span>Position</span>
          <span>
            {controls.currentIndex + 1} / {controls.historyLength}
          </span>
        </div>
        <input
          type="range"
          min={0}
          max={Math.max(0, controls.historyLength - 1)}
          value={controls.currentIndex}
          onChange={(e) => controls.goTo(Number(e.target.value))}
          className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
        />
      </div>

      <div className="grid grid-cols-4 gap-2 mb-4">
        <button
          onClick={controls.jumpToStart}
          disabled={!controls.canGoBack}
          className="px-3 py-2 bg-gray-700 rounded hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
        >
          ⏮ Start
        </button>
        <button
          onClick={controls.goBack}
          disabled={!controls.canGoBack}
          className="px-3 py-2 bg-purple-600 rounded hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
        >
          ← Back
        </button>
        <button
          onClick={controls.goForward}
          disabled={!controls.canGoForward}
          className="px-3 py-2 bg-purple-600 rounded hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
        >
          Forward →
        </button>
        <button
          onClick={controls.jumpToEnd}
          disabled={!controls.canGoForward}
          className="px-3 py-2 bg-gray-700 rounded hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
        >
          End ⏭
        </button>
      </div>

      <div className="flex gap-2 mb-4">
        <button
          onClick={controls.reset}
          className="flex-1 px-3 py-2 bg-red-600 rounded hover:bg-red-700 text-sm"
        >
          🔄 Reset
        </button>
        <button
          onClick={() => controls.replay()}
          className="flex-1 px-3 py-2 bg-green-600 rounded hover:bg-green-700 text-sm"
        >
          ▶ Replay All
        </button>
      </div>

      <div className="border-t border-gray-700 pt-4">
        <h3 className="text-sm font-semibold text-gray-400 mb-2">
          Action History
        </h3>
        <div className="max-h-48 overflow-y-auto space-y-1">
          {controls.history.map((snapshot: StateSnapshot<TodoState>, index: number) => (
            <button
              key={snapshot.id}
              onClick={() => controls.goTo(index)}
              className={`w-full text-left px-3 py-2 rounded text-xs transition-colors ${
                index === controls.currentIndex
                  ? 'bg-blue-600'
                  : 'bg-gray-800 hover:bg-gray-700'
              }`}
            >
              <div className="flex justify-between">
                <span className="font-mono">
                  {snapshot.action?.type ?? 'INITIAL'}
                </span>
                <span className="text-gray-500">
                  {new Date(snapshot.timestamp).toLocaleTimeString()}
                </span>
              </div>
              {snapshot.action?.payload !== undefined && (
                <div className="text-gray-400 truncate">
                  {JSON.stringify(snapshot.action.payload)}
                </div>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

const simpleCounterReducer = (state: number, action: Action): number => {
  switch (action.type) {
    case 'INCREMENT':
      return state + 1;
    case 'DECREMENT':
      return state - 1;
    case 'SET':
      return action.payload as number;
    default:
      return state;
  }
};

const UndoableCounterDemo = () => {
  const {
    state: count,
    past,
    future,
    canUndo,
    canRedo,
    dispatch,
    undo,
    redo,
    clearHistory,
  } = useUndoable(simpleCounterReducer, 0, { maxHistory: 20 });

  return (
    <div className="bg-white rounded-xl shadow-lg p-6 max-w-sm">
      <h2 className="text-2xl font-bold text-gray-800 mb-4">
        Undo/Redo Counter
      </h2>

      <div className="text-6xl font-bold text-center text-blue-500 mb-6">
        {count}
      </div>

      <div className="flex gap-2 mb-4">
        <button
          onClick={() => dispatch('DECREMENT')}
          className="flex-1 px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 text-xl"
        >
          −
        </button>
        <button
          onClick={() => dispatch('INCREMENT')}
          className="flex-1 px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 text-xl"
        >
          +
        </button>
      </div>

      <div className="flex gap-2 mb-4">
        <button
          onClick={undo}
          disabled={!canUndo}
          className="flex-1 px-3 py-2 bg-gray-200 rounded-lg hover:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          ↩ Undo ({past.length})
        </button>
        <button
          onClick={redo}
          disabled={!canRedo}
          className="flex-1 px-3 py-2 bg-gray-200 rounded-lg hover:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Redo ({future.length}) ↪
        </button>
      </div>

      <button
        onClick={clearHistory}
        className="w-full px-3 py-2 text-sm text-gray-500 hover:text-gray-700"
      >
        Clear History
      </button>

      <div className="mt-4 pt-4 border-t text-xs text-gray-500">
        <div>Past: [{past.join(', ')}]</div>
        <div>Present: {count}</div>
        <div>Future: [{future.join(', ')}]</div>
      </div>
    </div>
  );
};

export const RobustTimeTravelDemo = () => {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 p-8">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-white mb-2">
            Robust Time Travel Solution
          </h1>
          <p className="text-gray-400 max-w-2xl mx-auto">
            This approach uses a centralized store with action replay instead of
            directly manipulating React's fiber tree. It's more predictable,
            debuggable, and works with Redux DevTools.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
          <TodoList />
          <TimeTravelPanel />
        </div>

        <div className="flex justify-center mb-8">
          <UndoableCounterDemo />
        </div>

        <div className="bg-gray-800/50 rounded-xl p-6 text-gray-300">
          <h3 className="text-xl font-bold text-white mb-4">
            Why This is More Robust
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <h4 className="font-semibold text-green-400 mb-2">
                ✓ Advantages
              </h4>
              <ul className="text-sm space-y-1 text-gray-400">
                <li>• Predictable state transitions via reducer</li>
                <li>• Action replay for debugging</li>
                <li>• Works with Redux DevTools</li>
                <li>• Serializable state (can persist)</li>
                <li>• No reliance on React internals</li>
                <li>• Works in production builds</li>
                <li>• Supports middleware (logging, etc.)</li>
                <li>• Type-safe with TypeScript</li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold text-yellow-400 mb-2">
                ⚠ Trade-offs
              </h4>
              <ul className="text-sm space-y-1 text-gray-400">
                <li>• Requires restructuring state management</li>
                <li>• All state must go through the store</li>
                <li>• More boilerplate than useState</li>
                <li>• Learning curve for reducer pattern</li>
              </ul>
            </div>
          </div>

          <div className="mt-6 p-4 bg-gray-900 rounded-lg">
            <h4 className="font-semibold text-white mb-2">Usage Example</h4>
            <pre className="text-xs text-green-400 overflow-x-auto">
              {`// Create a store with reducer
const store = createTimeTravelStore(reducer, initialState);

// Use in components
const state = useTimeTravelStore(store);
const controls = useTimeTravelControls(store);

// Dispatch actions
store.dispatch('ADD_TODO', 'New task');

// Time travel
controls.goBack();
controls.goTo(5);
controls.replay();`}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RobustTimeTravelDemo;
