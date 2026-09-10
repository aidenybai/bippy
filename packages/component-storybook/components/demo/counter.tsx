'use client';

import { useState } from 'react';

interface CounterProps {
  initialCount?: number;
  label?: string;
  step?: number;
}

export const Counter = ({
  initialCount = 0,
  label = 'Counter',
  step = 1,
}: CounterProps) => {
  const [count, setCount] = useState(initialCount);

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
      <h3 className="mb-2 text-sm font-medium text-zinc-500">{label}</h3>
      <div className="flex items-center gap-3">
        <button
          className="rounded-md bg-zinc-100 px-3 py-1.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-200"
          onClick={() => setCount((previous) => previous - step)}
        >
          -
        </button>
        <span className="min-w-[3ch] text-center text-2xl font-bold tabular-nums text-zinc-900">
          {count}
        </span>
        <button
          className="rounded-md bg-zinc-100 px-3 py-1.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-200"
          onClick={() => setCount((previous) => previous + step)}
        >
          +
        </button>
      </div>
    </div>
  );
};
