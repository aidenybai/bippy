'use client';

import { useState } from 'react';

import { cn } from '../cn';

interface ToggleProps {
  defaultEnabled?: boolean;
  label: string;
  onToggle?: (enabled: boolean) => void;
}

export const Toggle = ({
  defaultEnabled = false,
  label,
  onToggle,
}: ToggleProps) => {
  const [isEnabled, setIsEnabled] = useState(defaultEnabled);

  const handleToggle = () => {
    const nextValue = !isEnabled;
    setIsEnabled(nextValue);
    onToggle?.(nextValue);
  };

  return (
    <div className="flex items-center justify-between rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
      <span className="text-sm font-medium text-zinc-700">{label}</span>
      <button
        aria-checked={isEnabled}
        className={cn(
          'relative inline-flex h-6 w-11 items-center rounded-full transition-colors',
          isEnabled ? 'bg-indigo-500' : 'bg-zinc-300',
        )}
        onClick={handleToggle}
        role="switch"
      >
        <span
          className={cn(
            'inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform',
            isEnabled ? 'translate-x-6' : 'translate-x-1',
          )}
        />
      </button>
    </div>
  );
};
