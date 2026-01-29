import 'bippy/install-hook-only';
import { useEffect, useState, useRef } from 'react';
import { createTimeTravel } from './time-travel';
import type { ApplicationSnapshot, TimeTravelInstance } from './time-travel';

interface TodoItem {
  id: number;
  text: string;
  completed: boolean;
}

const timeTravel = createTimeTravel({
  maxHistoryLength: 100,
  onSnapshotCapture: (snapshot) => {
    console.log(
      `[TimeTravel] Snapshot #${snapshot.id} captured at ${new Date(snapshot.timestamp).toLocaleTimeString()}`,
    );
  },
  onTimeTravel: (snapshot) => {
    console.log(`[TimeTravel] Restored to snapshot #${snapshot.id}`);
  },
});

const TodoList = () => {
  const [todos, setTodos] = useState<TodoItem[]>([
    { id: 1, text: 'Learn React', completed: false },
    { id: 2, text: 'Build something cool', completed: false },
  ]);
  const [inputValue, setInputValue] = useState('');
  const nextId = useRef(3);

  const addTodo = () => {
    if (!inputValue.trim()) return;
    setTodos([
      ...todos,
      { id: nextId.current++, text: inputValue, completed: false },
    ]);
    setInputValue('');
  };

  const toggleTodo = (id: number) => {
    setTodos(
      todos.map((todo) =>
        todo.id === id ? { ...todo, completed: !todo.completed } : todo,
      ),
    );
  };

  const deleteTodo = (id: number) => {
    setTodos(todos.filter((todo) => todo.id !== id));
  };

  return (
    <div className="p-6 bg-white rounded-lg shadow-lg max-w-md">
      <h2 className="text-xl font-bold mb-4 text-gray-800">Todo List</h2>

      <div className="flex gap-2 mb-4">
        <input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addTodo()}
          placeholder="Add a new todo..."
          className="flex-1 px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          onClick={addTodo}
          className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
        >
          Add
        </button>
      </div>

      <ul className="space-y-2">
        {todos.map((todo) => (
          <li
            key={todo.id}
            className="flex items-center gap-3 p-3 bg-gray-50 rounded"
          >
            <input
              type="checkbox"
              checked={todo.completed}
              onChange={() => toggleTodo(todo.id)}
              className="w-5 h-5 cursor-pointer"
            />
            <span
              className={`flex-1 ${todo.completed ? 'line-through text-gray-400' : 'text-gray-700'}`}
            >
              {todo.text}
            </span>
            <button
              onClick={() => deleteTodo(todo.id)}
              className="px-2 py-1 text-red-500 hover:bg-red-100 rounded transition-colors"
            >
              ✕
            </button>
          </li>
        ))}
      </ul>

      {todos.length === 0 && (
        <p className="text-gray-400 text-center py-4">No todos yet!</p>
      )}

      <div className="mt-4 pt-4 border-t text-sm text-gray-500">
        {todos.filter((t) => t.completed).length} of {todos.length} completed
      </div>
    </div>
  );
};

const TimeTravelSlider = ({
  timeTravelInstance,
}: {
  timeTravelInstance: TimeTravelInstance;
}) => {
  const [history, setHistory] = useState<ApplicationSnapshot[]>([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [isPaused, setIsPaused] = useState(false);
  const [isNavigating, setIsNavigating] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => {
      if (!isNavigating) {
        setHistory(timeTravelInstance.getHistory());
        setCurrentIndex(timeTravelInstance.getCurrentIndex());
        setIsPaused(timeTravelInstance.isPaused());
      }
    }, 100);
    return () => clearInterval(interval);
  }, [timeTravelInstance, isNavigating]);

  const handleSliderChange = (newIndex: number) => {
    setIsNavigating(true);
    timeTravelInstance.pause();
    const didNavigate = timeTravelInstance.goToSnapshot(newIndex);
    if (didNavigate) {
      setCurrentIndex(newIndex);
    }
    setTimeout(() => setIsNavigating(false), 500);
  };

  const handleResume = () => {
    timeTravelInstance.resume();
    setIsPaused(false);
    setIsNavigating(false);
  };

  return (
    <div className="p-6 bg-gray-800 rounded-lg shadow-lg max-w-md text-white">
      <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
        <span>🕐</span> Time Travel Debugger
      </h2>

      <div className="mb-4">
        <div className="flex justify-between text-sm text-gray-400 mb-1">
          <span>History Position</span>
          <span>
            {currentIndex + 1} / {history.length}
          </span>
        </div>
        <input
          type="range"
          min={0}
          max={Math.max(0, history.length - 1)}
          value={currentIndex}
          onChange={(e) => handleSliderChange(Number(e.target.value))}
          className="w-full h-2 bg-gray-600 rounded-lg appearance-none cursor-pointer accent-blue-500"
          disabled={history.length === 0}
        />
      </div>

      <div className="flex gap-2 mb-4">
        <button
          onClick={() => handleSliderChange(Math.max(0, currentIndex - 1))}
          disabled={currentIndex <= 0}
          className="flex-1 px-3 py-2 bg-purple-600 text-white rounded hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          ← Back
        </button>
        <button
          onClick={() =>
            handleSliderChange(Math.min(history.length - 1, currentIndex + 1))
          }
          disabled={currentIndex >= history.length - 1}
          className="flex-1 px-3 py-2 bg-purple-600 text-white rounded hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          Forward →
        </button>
      </div>

      <div className="flex gap-2 mb-4">
        {isPaused ? (
          <button
            onClick={handleResume}
            className="flex-1 px-3 py-2 bg-green-600 text-white rounded hover:bg-green-700 transition-colors"
          >
            ▶ Resume Recording
          </button>
        ) : (
          <button
            onClick={() => {
              timeTravelInstance.pause();
              setIsPaused(true);
            }}
            className="flex-1 px-3 py-2 bg-yellow-600 text-white rounded hover:bg-yellow-700 transition-colors"
          >
            ⏸ Pause Recording
          </button>
        )}
        <button
          onClick={() => {
            timeTravelInstance.clearHistory();
            setHistory([]);
            setCurrentIndex(-1);
          }}
          className="px-3 py-2 bg-red-600 text-white rounded hover:bg-red-700 transition-colors"
        >
          🗑 Clear
        </button>
      </div>

      <div className="text-sm">
        <div
          className={`inline-flex items-center gap-2 px-2 py-1 rounded ${isPaused ? 'bg-yellow-900 text-yellow-300' : 'bg-green-900 text-green-300'}`}
        >
          <span
            className={`w-2 h-2 rounded-full ${isPaused ? 'bg-yellow-400' : 'bg-green-400 animate-pulse'}`}
          />
          {isPaused ? 'Paused' : 'Recording'}
        </div>
      </div>

      {history.length > 0 && (
        <div className="mt-4 pt-4 border-t border-gray-700">
          <h3 className="text-sm font-semibold text-gray-400 mb-2">
            Recent Snapshots
          </h3>
          <div className="max-h-32 overflow-y-auto space-y-1">
            {history
              .slice(-10)
              .reverse()
              .map((snapshot, reverseIndex) => {
                const index = history.length - 1 - reverseIndex;
                return (
                  <button
                    key={snapshot.id}
                    onClick={() => handleSliderChange(index)}
                    className={`w-full text-left px-2 py-1 rounded text-xs transition-colors ${
                      index === currentIndex
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                    }`}
                  >
                    #{snapshot.id} -{' '}
                    {new Date(snapshot.timestamp).toLocaleTimeString()} (
                    {snapshot.fiberSnapshots.size} components)
                  </button>
                );
              })}
          </div>
        </div>
      )}
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
          Interact with the todo list, then use the slider to travel back in
          time!
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <TodoList />
          <TimeTravelSlider timeTravelInstance={timeTravel} />
        </div>

        <div className="mt-8 p-4 bg-gray-800/50 rounded-lg text-gray-400 text-sm">
          <h3 className="font-semibold text-gray-300 mb-2">How to test:</h3>
          <ol className="list-decimal list-inside space-y-1">
            <li>Add, complete, or delete some todos</li>
            <li>Watch the snapshot count increase</li>
            <li>Use the slider to go back to a previous state</li>
            <li>The todo list should restore to that point in time!</li>
          </ol>
        </div>
      </div>
    </div>
  );
}
