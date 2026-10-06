'use client';

import { useState } from 'react';

import type { ComponentData } from '../scripts/component-scanner';

import { cn } from './cn';

interface ComponentFrameProps {
  component: ComponentData;
  isHighlighted: boolean;
  onToggleHighlight: (fiberId: number) => void;
}

const ValueDisplay = ({ value }: { value: unknown }) => {
  if (value === null) return <span className="text-zinc-400">null</span>;
  if (value === undefined) return <span className="text-zinc-400">undefined</span>;
  if (typeof value === 'string') return <span className="text-emerald-600">&quot;{value}&quot;</span>;
  if (typeof value === 'number') return <span className="text-amber-600">{value}</span>;
  if (typeof value === 'boolean') return <span className="text-violet-600">{String(value)}</span>;
  if (typeof value === 'string' && value.startsWith('[Function:')) {
    return <span className="text-blue-500 italic">{value}</span>;
  }
  if (Array.isArray(value)) {
    return (
      <span className="text-zinc-600">
        [{value.length} items]
      </span>
    );
  }
  if (typeof value === 'object') {
    const objectKeys = Object.keys(value);
    return (
      <span className="text-zinc-600">
        {'{'}
        {objectKeys.slice(0, 3).join(', ')}
        {objectKeys.length > 3 ? ', ...' : ''}
        {'}'}
      </span>
    );
  }
  return <span className="text-zinc-500">{String(value)}</span>;
};

const PropsTable = ({ props }: { props: Record<string, unknown> }) => {
  const entries = Object.entries(props);
  if (entries.length === 0) {
    return <p className="text-xs text-zinc-400 italic">No props</p>;
  }
  return (
    <div className="space-y-1">
      {entries.map(([propKey, propValue]) => (
        <div className="flex items-start gap-2 text-xs" key={propKey}>
          <span className="shrink-0 font-medium text-zinc-700">{propKey}:</span>
          <ValueDisplay value={propValue} />
        </div>
      ))}
    </div>
  );
};

const HooksTable = ({ hooks }: { hooks: ComponentData['hooks'] }) => {
  if (hooks.length === 0) {
    return <p className="text-xs text-zinc-400 italic">No hooks</p>;
  }
  return (
    <div className="space-y-1">
      {hooks.map((hookEntry) => (
        <div className="flex items-start gap-2 text-xs" key={hookEntry.index}>
          <span className="shrink-0 font-medium text-zinc-700">
            hook[{hookEntry.index}]:
          </span>
          <ValueDisplay value={hookEntry.value} />
        </div>
      ))}
    </div>
  );
};

const StateTable = ({ state }: { state: Record<string, unknown> }) => {
  const entries = Object.entries(state);
  if (entries.length === 0) {
    return <p className="text-xs text-zinc-400 italic">Empty state</p>;
  }
  return (
    <div className="space-y-1">
      {entries.map(([stateKey, stateValue]) => (
        <div className="flex items-start gap-2 text-xs" key={stateKey}>
          <span className="shrink-0 font-medium text-zinc-700">{stateKey}:</span>
          <ValueDisplay value={stateValue} />
        </div>
      ))}
    </div>
  );
};

export const ComponentFrame = ({
  component,
  isHighlighted,
  onToggleHighlight,
}: ComponentFrameProps) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const hasProps = Object.keys(component.props).length > 0;
  const hasHooks = component.hooks.length > 0;
  const hasState = component.state !== null && Object.keys(component.state).length > 0;
  const hasChildren = component.children.length > 0;
  const hasRect = component.boundingRect !== null;

  return (
    <div
      className={cn(
        'rounded-lg border transition-all',
        isHighlighted
          ? 'border-indigo-400 bg-indigo-50/50 shadow-md shadow-indigo-100'
          : 'border-zinc-200 bg-white shadow-sm',
      )}
    >
      <div className="flex items-center justify-between px-3 py-2">
        <button
          className="flex items-center gap-2"
          onClick={() => setIsExpanded(!isExpanded)}
        >
          <svg
            className={cn(
              'h-3 w-3 text-zinc-400 transition-transform',
              isExpanded && 'rotate-90',
            )}
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path
              clipRule="evenodd"
              d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z"
              fillRule="evenodd"
            />
          </svg>
          <span className="text-sm font-semibold text-zinc-900">
            &lt;{component.displayName} /&gt;
          </span>
          <div className="flex gap-1">
            {hasProps && (
              <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600">
                props
              </span>
            )}
            {hasHooks && (
              <span className="rounded bg-violet-50 px-1.5 py-0.5 text-[10px] font-medium text-violet-600">
                hooks
              </span>
            )}
            {hasState && (
              <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-600">
                state
              </span>
            )}
          </div>
        </button>
        {hasRect && (
          <button
            className={cn(
              'rounded px-2 py-1 text-[10px] font-medium transition-colors',
              isHighlighted
                ? 'bg-indigo-500 text-white'
                : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200',
            )}
            onClick={() => onToggleHighlight(component.fiberId)}
          >
            {isHighlighted ? 'Hide' : 'Highlight'}
          </button>
        )}
      </div>

      {isExpanded && (
        <div className="space-y-3 border-t border-zinc-100 px-3 py-3">
          {hasProps && (
            <div>
              <h4 className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-emerald-600">
                Props
              </h4>
              <PropsTable props={component.props} />
            </div>
          )}

          {hasHooks && (
            <div>
              <h4 className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-violet-600">
                Hooks
              </h4>
              <HooksTable hooks={component.hooks} />
            </div>
          )}

          {hasState && component.state && (
            <div>
              <h4 className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-amber-600">
                State
              </h4>
              <StateTable state={component.state} />
            </div>
          )}

          {hasChildren && (
            <div>
              <h4 className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-blue-500">
                Children
              </h4>
              <div className="flex flex-wrap gap-1">
                {component.children.map((childName, childIndex) => (
                  <span
                    className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-600"
                    key={`${childName}-${childIndex}`}
                  >
                    &lt;{childName} /&gt;
                  </span>
                ))}
              </div>
            </div>
          )}

          {hasRect && component.boundingRect && (
            <div>
              <h4 className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                Bounds
              </h4>
              <p className="font-mono text-[10px] text-zinc-400">
                {Math.round(component.boundingRect.width)}x{Math.round(component.boundingRect.height)}
                {' '}at ({Math.round(component.boundingRect.x)}, {Math.round(component.boundingRect.y)})
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
