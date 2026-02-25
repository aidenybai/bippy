import { useCallback } from 'react';
import {
  createTimeTravelStore,
  useTimeTravelStore,
  useTimeTravelControls,
  createReducer,
} from './time-travel-robust';
import type { StateSnapshot } from './time-travel-robust';

interface TodoItem {
  id: number;
  text: string;
  completed: boolean;
}

interface TodoState {
  todos: TodoItem[];
  nextId: number;
}

const initialState: TodoState = {
  todos: [
    { id: 1, text: 'Learn React', completed: false },
    { id: 2, text: 'Build time travel', completed: false },
  ],
  nextId: 3,
};

const todoReducer = createReducer<TodoState>({
  ADD_TODO: (state, payload) => ({
    ...state,
    todos: [
      ...state.todos,
      { id: state.nextId, text: payload as string, completed: false },
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
});

const store = createTimeTravelStore(todoReducer, initialState, {
  maxHistory: 100,
  onChange: (_state, action) => {
    if (action) {
      console.log(`[Store] ${action.type}:`, action.payload);
    }
  },
});

const TodoInput = () => {
  const handleSubmit = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const form = event.currentTarget;
      const input = form.elements.namedItem('todo') as HTMLInputElement;
      if (input.value.trim()) {
        store.dispatch('ADD_TODO', input.value.trim());
        input.value = '';
      }
    },
    [],
  );

  return (
    <form onSubmit={handleSubmit} className="flex gap-2 mb-4">
      <input
        name="todo"
        type="text"
        placeholder="Add a new todo..."
        className="flex-1 px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      <button
        type="submit"
        className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
      >
        Add
      </button>
    </form>
  );
};

const TodoItemRow = ({ todo }: { todo: TodoItem }) => (
  <li className="flex items-center gap-3 p-3 bg-gray-50 rounded group">
    <input
      type="checkbox"
      checked={todo.completed}
      onChange={() => store.dispatch('TOGGLE_TODO', todo.id)}
      className="w-5 h-5 cursor-pointer"
    />
    <span
      className={`flex-1 ${todo.completed ? 'line-through text-gray-400' : 'text-gray-700'}`}
    >
      {todo.text}
    </span>
    <button
      onClick={() => store.dispatch('DELETE_TODO', todo.id)}
      className="opacity-0 group-hover:opacity-100 px-2 py-1 text-red-500 hover:bg-red-100 rounded transition-all"
    >
      ✕
    </button>
  </li>
);

const TodoList = () => {
  const todoState = useTimeTravelStore<TodoState, TodoState>(store);
  const activeCount = todoState.todos.filter(
    (t: TodoItem) => !t.completed,
  ).length;

  return (
    <div className="p-6 bg-white rounded-lg shadow-lg max-w-md">
      <h2 className="text-xl font-bold mb-4 text-gray-800">Todo List</h2>
      <TodoInput />
      <ul className="space-y-2">
        {todoState.todos.map((todo: TodoItem) => (
          <TodoItemRow key={todo.id} todo={todo} />
        ))}
      </ul>
      {todoState.todos.length === 0 && (
        <p className="text-gray-400 text-center py-4">No todos yet!</p>
      )}
      <div className="mt-4 pt-4 border-t text-sm text-gray-500">
        {activeCount} of {todoState.todos.length} remaining
      </div>
    </div>
  );
};

const TimeTravelSlider = () => {
  const controls = useTimeTravelControls(store);

  return (
    <div className="p-6 bg-gray-800 rounded-lg shadow-lg max-w-md text-white">
      <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
        <span>⏱️</span> Time Travel Controls
      </h2>

      <div className="mb-4">
        <div className="flex justify-between text-sm text-gray-400 mb-1">
          <span>History Position</span>
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
          className="w-full h-2 bg-gray-600 rounded-lg appearance-none cursor-pointer accent-blue-500"
          disabled={controls.historyLength === 0}
        />
      </div>

      <div className="grid grid-cols-4 gap-2 mb-4">
        <button
          onClick={controls.jumpToStart}
          disabled={!controls.canGoBack}
          className="px-2 py-2 bg-gray-700 rounded hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
        >
          ⏮ Start
        </button>
        <button
          onClick={controls.goBack}
          disabled={!controls.canGoBack}
          className="px-2 py-2 bg-purple-600 rounded hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
        >
          ← Back
        </button>
        <button
          onClick={controls.goForward}
          disabled={!controls.canGoForward}
          className="px-2 py-2 bg-purple-600 rounded hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
        >
          Forward →
        </button>
        <button
          onClick={controls.jumpToEnd}
          disabled={!controls.canGoForward}
          className="px-2 py-2 bg-gray-700 rounded hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
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
          ▶ Replay
        </button>
      </div>

      <div className="border-t border-gray-700 pt-4">
        <h3 className="text-sm font-semibold text-gray-400 mb-2">
          Action History
        </h3>
        <div className="max-h-48 overflow-y-auto space-y-1">
          {controls.history.map(
            (snapshot: StateSnapshot<TodoState>, index: number) => (
              <button
                key={snapshot.id}
                onClick={() => controls.goTo(index)}
                className={`w-full text-left px-3 py-2 rounded text-xs transition-colors ${
                  index === controls.currentIndex
                    ? 'bg-blue-600'
                    : 'bg-gray-700 hover:bg-gray-600'
                }`}
              >
                <div className="flex justify-between">
                  <span className="font-mono">
                    {snapshot.action?.type ?? 'INITIAL'}
                  </span>
                  <span className="text-gray-400">
                    {new Date(snapshot.timestamp).toLocaleTimeString()}
                  </span>
                </div>
                {snapshot.action?.payload !== undefined && (
                  <div className="text-gray-400 truncate">
                    {JSON.stringify(snapshot.action.payload)}
                  </div>
                )}
              </button>
            ),
          )}
        </div>
      </div>
    </div>
  );
};

export default function App() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 to-gray-800 p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold text-white mb-2 text-center">
          React Time Travel Demo
        </h1>
        <p className="text-gray-400 text-center mb-8">
          Store-based time travel with action replay
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <TodoList />
          <TimeTravelSlider />
        </div>

        <div className="mt-8 p-4 bg-gray-800/50 rounded-lg text-gray-400 text-sm">
          <h3 className="font-semibold text-gray-300 mb-2">How it works:</h3>
          <ol className="list-decimal list-inside space-y-1">
            <li>All state changes go through a reducer (like Redux)</li>
            <li>Each action is recorded with its payload and timestamp</li>
            <li>Use the slider to jump to any point in history</li>
            <li>Use Replay to re-run all actions from the beginning</li>
          </ol>
        </div>
      </div>
    </div>
  );
}
