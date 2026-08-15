"use client";

import { ObjectInspector } from "react-inspector";

import { useFiberTree } from "./fiber-tree-context";
import { getObjectName, getPropsEntries, getStateEntries } from "./fiber-tree-model";
import { fiberTreeClassNames, setFiberTreeDisplayName } from "./fiber-tree-styles";
import type { InspectorEntry } from "./fiber-tree-types";

interface InspectorSectionProps {
  entries: InspectorEntry[];
  showIndices?: boolean;
  title: string;
}

interface InspectorValueProps {
  value: unknown;
}

const InspectorValue = ({ value }: InspectorValueProps) => {
  if (typeof value === "string") {
    return <span className="text-[#cedae0]">{JSON.stringify(value)}</span>;
  }
  if (typeof value === "number" || typeof value === "bigint") {
    return <span className="text-[#cedae0]">{String(value)}</span>;
  }
  if (typeof value === "boolean") {
    return <span className="text-[#cedae0]">{String(value)}</span>;
  }
  if (typeof value === "function") {
    return <span className="text-[#cedae0]">{`ƒ ${value.name || "anonymous"}()`}</span>;
  }
  if (value === null) return <span className="text-[#777d88]">null</span>;
  if (value === undefined) return <span className="text-[#777d88]">undefined</span>;
  if (Array.isArray(value)) {
    return <span className="text-[#cedae0]">{`Array(${value.length})`}</span>;
  }

  return <span className="text-[#cedae0]">{getObjectName(value)}</span>;
};

const InspectorSection = ({ entries, showIndices = false, title }: InspectorSectionProps) => {
  if (entries.length === 0) return null;

  return (
    <section className="border-b border-[#30343c] p-1">
      <h2 className="font-sans text-[13px] font-medium text-white">{title}</h2>
      <div>
        {entries.map((entry, entryIndex) => (
          <div key={`${entry.label}-${entryIndex}`} className="flex min-w-0 items-baseline">
            {showIndices ? (
              <span className="mr-1 inline-flex min-w-[22px] items-center justify-center rounded-[2px] bg-[rgba(0,0,0,0.25)] px-1 py-0.5 text-[11px] leading-4 text-[rgba(255,255,255,0.7)]">
                {entryIndex + 1}
              </span>
            ) : null}
            <div className="min-w-0 truncate pl-2">
              <span className={showIndices ? "text-[#61dafb]" : "text-[#ededed]"}>
                {entry.label}
              </span>
              <span className="mr-2 text-white">: </span>
              <InspectorValue value={entry.value} />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
};

const FiberTreeInspectorSkeleton = () => (
  <div className="motion-safe:[&_span]:animate-pulse" role="status">
    <span className="sr-only">Reading Fiber details…</span>
    <section className="border-b border-[#30343c] p-1">
      <div className="flex h-[22px] items-center">
        <span className="h-2.5 w-10 rounded-[2px] bg-[rgba(255,255,255,0.28)]" />
      </div>
      <div className="flex h-[22px] items-center gap-2 pl-2">
        <span className="h-2.5 w-12 rounded-[2px] bg-[rgba(237,237,237,0.24)]" />
        <span className="h-2.5 w-16 rounded-[2px] bg-[rgba(206,218,224,0.2)]" />
      </div>
      <div className="flex h-[22px] items-center gap-2 pl-2">
        <span className="h-2.5 w-16 rounded-[2px] bg-[rgba(237,237,237,0.24)]" />
        <span className="h-2.5 w-20 rounded-[2px] bg-[rgba(206,218,224,0.2)]" />
      </div>
    </section>
    <section className="border-b border-[#30343c] p-1">
      <div className="flex h-[22px] items-center">
        <span className="h-2.5 w-10 rounded-[2px] bg-[rgba(255,255,255,0.28)]" />
      </div>
      <div className="flex h-[22px] items-center gap-2">
        <span className="h-5 w-[22px] rounded-[2px] bg-[rgba(0,0,0,0.25)]" />
        <span className="h-2.5 w-12 rounded-[2px] bg-[rgba(97,218,251,0.28)]" />
        <span className="h-2.5 w-14 rounded-[2px] bg-[rgba(206,218,224,0.2)]" />
      </div>
    </section>
    <div className="flex h-[30px] items-center gap-2 p-1">
      <span className="size-2 rounded-[2px] bg-[rgba(143,148,157,0.4)]" />
      <span className="h-2.5 w-10 rounded-[2px] bg-[rgba(237,237,237,0.24)]" />
      <span className="h-2.5 w-24 rounded-[2px] bg-[rgba(119,125,136,0.28)]" />
    </div>
  </div>
);

export const FiberTreeInspector = () => {
  const { inspectedFiberNode } = useFiberTree();

  return (
    <aside className={fiberTreeClassNames.inspectedElementWrapper}>
      <div className={fiberTreeClassNames.inspectedElement}>
        <header className={fiberTreeClassNames.titleRow}>
          <div className={fiberTreeClassNames.selectedComponentName}>
            <div className={fiberTreeClassNames.componentName}>
              {inspectedFiberNode?.name ?? "Fiber"}
            </div>
          </div>
        </header>
        <div className={fiberTreeClassNames.inspectedElementView} data-fiber-inspection-boundary>
          {inspectedFiberNode ? (
            <div>
              <InspectorSection title="props" entries={getPropsEntries(inspectedFiberNode.fiber)} />
              <InspectorSection
                title="state"
                entries={getStateEntries(inspectedFiberNode.fiber)}
                showIndices
              />
              <div className="p-1 [&_span]:not-italic!">
                <ObjectInspector
                  data={inspectedFiberNode.fiber}
                  name="fiber"
                  expandLevel={0}
                  theme="chromeDark"
                />
              </div>
            </div>
          ) : (
            <FiberTreeInspectorSkeleton />
          )}
        </div>
      </div>
    </aside>
  );
};

setFiberTreeDisplayName(FiberTreeInspector, "FiberTreeInspector");
setFiberTreeDisplayName(FiberTreeInspectorSkeleton, "FiberTreeInspectorSkeleton");
setFiberTreeDisplayName(InspectorSection, "InspectorSection");
setFiberTreeDisplayName(InspectorValue, "InspectorValue");
