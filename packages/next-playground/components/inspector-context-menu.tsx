'use client';

import { cn } from './cn';

export interface InspectorContextMenuEntry {
  entryId: string;
  elementTag: string;
  previewText: string;
}

export interface InspectorContextMenuPosition {
  left: number;
  top: number;
}

interface InspectorContextMenuProps {
  activeEntryId: string | null;
  entries: InspectorContextMenuEntry[];
  onHoverEntry: (entryId: string) => void;
  onSelectEntry: (entryId: string) => void;
  position: InspectorContextMenuPosition;
}

export const InspectorContextMenu = ({
  activeEntryId,
  entries,
  onHoverEntry,
  onSelectEntry,
  position,
}: InspectorContextMenuProps): React.JSX.Element => {
  return (
    <div
      className="fixed z-[999999] min-w-[300px] max-w-[420px] rounded-md border border-neutral-700 bg-neutral-900 p-1 shadow-xl"
      data-inspector-ui="true"
      role="menu"
      style={{
        left: position.left,
        top: position.top,
      }}
    >
      {entries.map((innerEntry) => (
        <button
          className={cn(
            'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors',
            activeEntryId === innerEntry.entryId
              ? 'bg-neutral-700 text-neutral-100'
              : 'text-neutral-300 hover:bg-neutral-800',
          )}
          key={innerEntry.entryId}
          onClick={() => onSelectEntry(innerEntry.entryId)}
          onFocus={() => onHoverEntry(innerEntry.entryId)}
          onMouseEnter={() => onHoverEntry(innerEntry.entryId)}
          role="menuitem"
          type="button"
        >
          <span className="rounded bg-neutral-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-orange-300">
            {innerEntry.elementTag}
          </span>
          <span className="truncate text-[11px] text-neutral-300">
            {innerEntry.previewText}
          </span>
        </button>
      ))}
    </div>
  );
};
