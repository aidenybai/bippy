import { useEffect, useState } from 'react';
import { createTimeTravel } from './time-travel';
import type { ApplicationSnapshot, TimeTravelInstance } from './time-travel';

const timeTravel = createTimeTravel({
  maxHistoryLength: 50,
  onSnapshotCapture: (snapshot) => {
    console.log(`[TimeTravel] Snapshot captured #${snapshot.id}`, {
      timestamp: new Date(snapshot.timestamp).toISOString(),
      componentCount: snapshot.fiberSnapshots.size,
    });
  },
  onTimeTravel: (snapshot) => {
    console.log(`[TimeTravel] Restored to snapshot #${snapshot.id}`);
  },
});

const Counter = () => {
  const [count, setCount] = useState(0);
  const [message, setMessage] = useState('Hello');

  return (
    <div className="p-4 border rounded-lg bg-white shadow-sm">
      <h2 className="text-lg font-semibold mb-2">Counter Component</h2>
      <p className="mb-2">
        Count: <span className="font-mono text-xl">{count}</span>
      </p>
      <p className="mb-4">
        Message: <span className="italic">{message}</span>
      </p>
      <div className="flex gap-2">
        <button
          onClick={() => setCount(count + 1)}
          className="px-3 py-1 bg-blue-500 text-white rounded hover:bg-blue-600"
        >
          Increment
        </button>
        <button
          onClick={() => setCount(count - 1)}
          className="px-3 py-1 bg-red-500 text-white rounded hover:bg-red-600"
        >
          Decrement
        </button>
        <button
          onClick={() => setMessage(`Updated at ${Date.now()}`)}
          className="px-3 py-1 bg-green-500 text-white rounded hover:bg-green-600"
        >
          Update Message
        </button>
      </div>
    </div>
  );
};

const TimeTravelControls = ({
  timeTravelInstance,
}: {
  timeTravelInstance: TimeTravelInstance;
}) => {
  const [historyLength, setHistoryLength] = useState(0);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [isPaused, setIsPaused] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => {
      setHistoryLength(timeTravelInstance.getHistory().length);
      setCurrentIndex(timeTravelInstance.getCurrentIndex());
      setIsPaused(timeTravelInstance.isPaused());
    }, 100);
    return () => clearInterval(interval);
  }, [timeTravelInstance]);

  return (
    <div className="p-4 border rounded-lg bg-gray-50 shadow-sm">
      <h2 className="text-lg font-semibold mb-2">Time Travel Controls</h2>
      <div className="mb-4 text-sm text-gray-600">
        <p>
          History: {currentIndex + 1} / {historyLength} snapshots
        </p>
        <p>Status: {isPaused ? 'Paused' : 'Recording'}</p>
      </div>
      <div className="flex gap-2 flex-wrap">
        <button
          onClick={() => {
            timeTravelInstance.goBack();
            setCurrentIndex(timeTravelInstance.getCurrentIndex());
          }}
          disabled={!timeTravelInstance.canGoBack()}
          className="px-3 py-1 bg-purple-500 text-white rounded hover:bg-purple-600 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          ← Back
        </button>
        <button
          onClick={() => {
            timeTravelInstance.goForward();
            setCurrentIndex(timeTravelInstance.getCurrentIndex());
          }}
          disabled={!timeTravelInstance.canGoForward()}
          className="px-3 py-1 bg-purple-500 text-white rounded hover:bg-purple-600 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Forward →
        </button>
        <button
          onClick={() => {
            if (isPaused) {
              timeTravelInstance.resume();
            } else {
              timeTravelInstance.pause();
            }
            setIsPaused(timeTravelInstance.isPaused());
          }}
          className="px-3 py-1 bg-yellow-500 text-white rounded hover:bg-yellow-600"
        >
          {isPaused ? 'Resume' : 'Pause'}
        </button>
        <button
          onClick={() => {
            timeTravelInstance.clearHistory();
            setHistoryLength(0);
            setCurrentIndex(-1);
          }}
          className="px-3 py-1 bg-gray-500 text-white rounded hover:bg-gray-600"
        >
          Clear History
        </button>
      </div>
    </div>
  );
};

const HistoryViewer = ({
  timeTravelInstance,
}: {
  timeTravelInstance: TimeTravelInstance;
}) => {
  const [history, setHistory] = useState<ApplicationSnapshot[]>([]);
  const [currentIndex, setCurrentIndex] = useState(-1);

  useEffect(() => {
    const interval = setInterval(() => {
      setHistory(timeTravelInstance.getHistory());
      setCurrentIndex(timeTravelInstance.getCurrentIndex());
    }, 200);
    return () => clearInterval(interval);
  }, [timeTravelInstance]);

  return (
    <div className="p-4 border rounded-lg bg-gray-50 shadow-sm max-h-64 overflow-y-auto">
      <h2 className="text-lg font-semibold mb-2">State History</h2>
      {history.length === 0 ? (
        <p className="text-gray-500 text-sm">No snapshots yet...</p>
      ) : (
        <ul className="space-y-1">
          {history.map((snapshot, index) => (
            <li
              key={snapshot.id}
              onClick={() => {
                timeTravelInstance.goToSnapshot(index);
                setCurrentIndex(index);
              }}
              className={`p-2 rounded cursor-pointer text-sm ${
                index === currentIndex
                  ? 'bg-blue-100 border border-blue-300'
                  : 'bg-white border border-gray-200 hover:bg-gray-100'
              }`}
            >
              <span className="font-mono text-xs text-gray-500">
                #{snapshot.id}
              </span>{' '}
              <span className="text-gray-600">
                {new Date(snapshot.timestamp).toLocaleTimeString()}
              </span>
              <span className="text-gray-400 ml-2">
                ({snapshot.fiberSnapshots.size} components)
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export const TimeTravelDemo = () => {
  return (
    <div className="p-8 space-y-6">
      <div className="mb-8">
        <h1 className="text-2xl font-bold mb-2">
          React Time Travel Debugging Demo
        </h1>
        <p className="text-gray-600">
          This demonstrates time travel debugging using bippy. Interact with the
          Counter component, then use the controls to travel back and forth
          through state history.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Counter />
        <TimeTravelControls timeTravelInstance={timeTravel} />
      </div>

      <HistoryViewer timeTravelInstance={timeTravel} />

      <div className="mt-8 p-4 bg-gray-100 rounded-lg">
        <h2 className="text-lg font-semibold mb-2">Usage Examples</h2>
        <pre className="bg-gray-800 text-green-400 p-4 rounded text-sm overflow-x-auto">
          {`// 1. Create a global time travel instance
import { createTimeTravel } from './time-travel';

const timeTravel = createTimeTravel({
  maxHistoryLength: 50,
  onSnapshotCapture: (snapshot) => console.log('Captured:', snapshot.id),
  onTimeTravel: (snapshot) => console.log('Restored:', snapshot.id),
});

// Navigate through history
timeTravel.goBack();      // Go to previous state
timeTravel.goForward();   // Go to next state
timeTravel.goToSnapshot(5); // Jump to specific snapshot

// Control recording
timeTravel.pause();       // Stop recording
timeTravel.resume();      // Resume recording
timeTravel.clearHistory(); // Clear all snapshots

// 2. Watch specific component's state
import { watchComponentState } from './time-travel';

const counterWatcher = watchComponentState<number>('Counter', 0); // Watch first hook

// Access history
const history = counterWatcher.getHistory();
const currentState = counterWatcher.getCurrent();

// Restore to specific state
counterWatcher.goTo(2); // Go to 3rd recorded state

// 3. Track specific component only
import { createComponentTimeTravel } from './time-travel';

const counterTimeTravel = createComponentTimeTravel('Counter');
counterTimeTravel.goBack();`}
        </pre>
      </div>
    </div>
  );
};

export default TimeTravelDemo;
