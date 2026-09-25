'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import type { ComponentData, ScanResult } from '../scripts/component-scanner';
import { scan, subscribe } from '../scripts/component-scanner';

import { cn } from './cn';
import { ComponentFrame } from './component-frame';

interface HighlightOverlayProps {
  components: ComponentData[];
  highlightedIds: Set<number>;
}

const HighlightOverlay = ({ components, highlightedIds }: HighlightOverlayProps) => {
  const highlightedComponents = components.filter(
    (component) => highlightedIds.has(component.fiberId) && component.boundingRect,
  );

  if (highlightedComponents.length === 0) return null;

  return (
    <div className="pointer-events-none fixed inset-0 z-[9998]">
      {highlightedComponents.map((component) => {
        const rect = component.boundingRect!;
        return (
          <div key={component.fiberId}>
            <div
              className="absolute border-2 border-indigo-500 bg-indigo-500/5"
              style={{
                borderRadius: '4px',
                height: rect.height + 4,
                left: rect.x - 2,
                top: rect.y - 2,
                width: rect.width + 4,
              }}
            />
            <div
              className="absolute -translate-y-full rounded bg-indigo-500 px-1.5 py-0.5 text-[10px] font-bold text-white shadow-sm"
              style={{
                left: rect.x - 2,
                top: rect.y - 4,
              }}
            >
              &lt;{component.displayName} /&gt;
            </div>
          </div>
        );
      })}
    </div>
  );
};

export const StorybookPanel = () => {
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [highlightedIds, setHighlightedIds] = useState<Set<number>>(new Set());
  const [filterText, setFilterText] = useState('');
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isHighlightAll, setIsHighlightAll] = useState(false);
  const [showInternals, setShowInternals] = useState(true);
  const didInitialScanRef = useRef(false);

  useEffect(() => {
    const unsubscribe = subscribe((result) => {
      setScanResult(result);
    });

    // HACK: setTimeout to let React finish initial render before scanning
    const timeoutId = setTimeout(() => {
      if (!didInitialScanRef.current) {
        didInitialScanRef.current = true;
        setScanResult(scan());
      }
    }, 100);

    return () => {
      unsubscribe();
      clearTimeout(timeoutId);
    };
  }, []);

  const handleToggleHighlight = useCallback((fiberId: number) => {
    setHighlightedIds((previous) => {
      const next = new Set(previous);
      if (next.has(fiberId)) {
        next.delete(fiberId);
      } else {
        next.add(fiberId);
      }
      return next;
    });
  }, []);

  const filteredComponents = (scanResult?.components ?? []).filter((component) => {
    if (!showInternals && component.isFrameworkInternal) return false;
    if (filterText && !component.displayName.toLowerCase().includes(filterText.toLowerCase())) {
      return false;
    }
    return true;
  });

  const handleHighlightAll = useCallback(() => {
    const shouldHighlightAll = !isHighlightAll;
    setIsHighlightAll(shouldHighlightAll);
    if (shouldHighlightAll) {
      setHighlightedIds(
        new Set(
          filteredComponents
            .filter((component) => component.boundingRect)
            .map((component) => component.fiberId),
        ),
      );
    } else {
      setHighlightedIds(new Set());
    }
  }, [filteredComponents, isHighlightAll]);

  const handleRescan = useCallback(() => {
    setScanResult(scan());
  }, []);

  const MAX_VISIBLE = 200;
  const visibleComponents = filteredComponents.slice(0, MAX_VISIBLE);
  const displayedCount = filteredComponents.length;
  const userCount = scanResult?.userComponentCount ?? 0;
  const totalCount = scanResult?.totalCount ?? 0;
  const isTruncated = filteredComponents.length > MAX_VISIBLE;

  return (
    <>
      <HighlightOverlay
        components={scanResult?.components ?? []}
        highlightedIds={highlightedIds}
      />

      <div
        className={cn(
          'fixed right-0 top-0 z-[9999] flex h-screen flex-col border-l border-zinc-200 bg-zinc-50/95 backdrop-blur-sm transition-all',
          isCollapsed ? 'w-10' : 'w-[380px]',
        )}
      >
        {isCollapsed ? (
          <button
            className="flex h-full w-full items-center justify-center"
            onClick={() => setIsCollapsed(false)}
          >
            <span className="rotate-90 whitespace-nowrap text-xs font-bold tracking-wider text-zinc-500">
              STORYBOOK
            </span>
          </button>
        ) : (
          <>
            <div className="shrink-0 border-b border-zinc-200 bg-white px-3 py-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="flex h-6 w-6 items-center justify-center rounded bg-indigo-500">
                    <svg className="h-3.5 w-3.5 text-white" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path d="M4 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1V5z" strokeLinecap="round" strokeLinejoin="round" />
                      <path d="M14 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1V5z" strokeLinecap="round" strokeLinejoin="round" />
                      <path d="M4 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1v-4z" strokeLinecap="round" strokeLinejoin="round" />
                      <path d="M14 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                  <h2 className="text-sm font-bold text-zinc-900">Storybook</h2>
                  <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-500">
                    {displayedCount}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    className="rounded p-1 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600"
                    onClick={handleRescan}
                    title="Rescan"
                  >
                    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                  <button
                    className={cn(
                      'rounded p-1 transition-colors',
                      isHighlightAll
                        ? 'bg-indigo-100 text-indigo-600'
                        : 'text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600',
                    )}
                    onClick={handleHighlightAll}
                    title="Highlight all visible"
                  >
                    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" strokeLinecap="round" strokeLinejoin="round" />
                      <path d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                  <button
                    className="rounded p-1 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600"
                    onClick={() => setIsCollapsed(true)}
                    title="Collapse"
                  >
                    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path d="M13 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                </div>
              </div>

              <div className="mt-2 flex items-center gap-2">
                <div className="relative flex-1">
                  <svg
                    className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    viewBox="0 0 24 24"
                  >
                    <path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <input
                    className="w-full rounded-md border border-zinc-200 bg-zinc-50 py-1.5 pl-8 pr-3 text-xs text-zinc-700 placeholder:text-zinc-400 focus:border-indigo-300 focus:outline-none focus:ring-1 focus:ring-indigo-200"
                    onChange={(event) => setFilterText(event.target.value)}
                    placeholder="Filter components..."
                    value={filterText}
                  />
                </div>
                <button
                  className={cn(
                    'shrink-0 rounded-md border px-2 py-1.5 text-[10px] font-medium transition-colors',
                    showInternals
                      ? 'border-indigo-200 bg-indigo-50 text-indigo-600'
                      : 'border-zinc-200 bg-white text-zinc-500 hover:bg-zinc-50',
                  )}
                  onClick={() => setShowInternals(!showInternals)}
                  title={showInternals ? `Showing all ${totalCount} components` : `Showing ${userCount} user components (${totalCount - userCount} internals hidden)`}
                >
                  {showInternals ? 'All' : 'User'}
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-3 py-3">
              {!scanResult ? (
                <div className="flex h-full items-center justify-center">
                  <p className="text-xs text-zinc-400">Scanning components...</p>
                </div>
              ) : filteredComponents.length === 0 ? (
                <div className="flex h-32 items-center justify-center">
                  <div className="text-center">
                    <p className="text-xs text-zinc-400">No components found</p>
                    {!showInternals && (
                      <button
                        className="mt-1 text-[10px] text-indigo-500 hover:text-indigo-700"
                        onClick={() => setShowInternals(true)}
                      >
                        Show framework internals
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  {visibleComponents.map((component) => (
                    <div key={component.fiberId} style={{ marginLeft: Math.min(component.domDepth, 5) * 12 }}>
                      <ComponentFrame
                        component={component}
                        isHighlighted={highlightedIds.has(component.fiberId)}
                        onToggleHighlight={handleToggleHighlight}
                      />
                    </div>
                  ))}
                  {isTruncated && (
                    <p className="py-2 text-center text-[10px] text-zinc-400">
                      Showing {MAX_VISIBLE} of {displayedCount} components. Use search to find specific components.
                    </p>
                  )}
                </div>
              )}
            </div>

            <div className="shrink-0 border-t border-zinc-200 bg-white px-3 py-2">
              <p className="text-[10px] text-zinc-400">
                {scanResult
                  ? `${userCount} user · ${totalCount - userCount} internal · ${new Date(scanResult.timestamp).toLocaleTimeString()}`
                  : 'Waiting for scan...'}
              </p>
            </div>
          </>
        )}
      </div>
    </>
  );
};
