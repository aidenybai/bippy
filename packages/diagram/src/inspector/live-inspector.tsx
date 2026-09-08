"use client";

import * as stylex from "@stylexjs/stylex";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Button } from "../components/ui/button";
import { TreeRoot, TreeView } from "../components/ui/tree";
import { colors } from "../diagram/tokens.stylex";
import {
  getIsInspectionMessage,
  type InspectionMessage,
  type CapturedFiberRoot,
} from "./inspection-protocol";

import type { TreeNode } from "../diagram/tree-model";

interface InspectionRootEntry {
  key: string;
  root: CapturedFiberRoot;
  url: string;
  truncated: boolean;
}

interface SelectedFiber {
  rootKey: string;
  nodeId: string;
}

const styles = stylex.create({
  root: {
    height: "100dvh",
    display: "flex",
    flexDirection: "column",
    color: colors.text,
    backgroundColor: colors.canvas,
    fontFamily: "system-ui, sans-serif",
    fontSize: 12,
  },
  header: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 12,
    padding: 16,
    backgroundColor: colors.surface,
    borderBottom: `1px solid ${colors.border}`,
  },
  title: { fontSize: 12, fontWeight: 400, margin: 0 },
  link: { color: colors.muted, textDecoration: "none", ":hover": { color: colors.text } },
  source: {
    margin: 0,
    flex: 1,
    minWidth: 100,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: colors.muted,
  },
  actions: { display: "flex", alignItems: "center", gap: 4 },
  info: {
    paddingInline: 16,
    paddingBlock: 8,
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 12,
    color: colors.muted,
    backgroundColor: colors.surface,
  },
  notice: {
    margin: 0,
    paddingInline: 16,
    paddingBottom: 12,
    color: colors.muted,
    backgroundColor: colors.surface,
    lineHeight: 1.6,
  },
  trees: {
    flex: 1,
    minHeight: 0,
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr)",
    gap: 16,
    padding: 16,
  },
  columns: (count: number) => ({ gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` }),
  column: { minWidth: 0, minHeight: 0, backgroundColor: colors.surface },
  heading: {
    margin: 0,
    height: 26,
    fontSize: 12,
    fontWeight: 400,
    color: colors.muted,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  empty: { padding: 24, lineHeight: 1.8, color: colors.muted },
  command: { display: "block", marginBlock: 12, overflowWrap: "anywhere", color: colors.text },
  footer: { padding: 16, paddingRight: 64, color: colors.muted, backgroundColor: colors.surface },
});

export const LiveInspector = () => {
  const [message, setMessage] = useState<InspectionMessage | null>(null);
  const [connection, setConnection] = useState("Not connected");
  const [isPaused, setIsPaused] = useState(false);
  const [showOwners, setShowOwners] = useState(false);
  const [rootKey, setRootKey] = useState<string | null>(null);
  const [selected, setSelected] = useState<SelectedFiber | null>(null);
  const [retry, setRetry] = useState(0);
  const [size, setSize] = useState({ width: 960, height: 640 });
  const bodyRef = useRef<HTMLDivElement>(null);
  const pausedRef = useRef(false);
  const latestRef = useRef<InspectionMessage | null>(null);
  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const observer = new ResizeObserver(([entry]) =>
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height }),
    );
    observer.observe(body);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    let socket: WebSocket | undefined;
    const connect = () => {
      socket?.close();
      const bridge = new URLSearchParams(location.hash.slice(1)).get("bridge");
      if (!bridge) {
        setConnection("Not connected");
        return;
      }
      try {
        const url = new URL(bridge);
        if (
          url.protocol !== "ws:" ||
          url.hostname !== "127.0.0.1" ||
          !url.searchParams.get("session")
        )
          throw new Error("Invalid local bridge address");
        setConnection("Connecting");
        const next = new WebSocket(url);
        socket = next;
        next.onopen = () => {
          if (socket === next) setConnection("Connected");
        };
        next.onclose = () => {
          if (socket === next) setConnection("Disconnected");
        };
        next.onerror = () => {
          if (socket === next) setConnection("Connection failed");
        };
        next.onmessage = (event) => {
          if (socket !== next || typeof event.data !== "string" || event.data.length > 32000000)
            return;
          try {
            const value: unknown = JSON.parse(event.data);
            if (!getIsInspectionMessage(value)) {
              setConnection("Invalid capture");
              return;
            }
            latestRef.current = value;
            if (!pausedRef.current) setMessage(value);
          } catch {
            setConnection("Invalid capture");
          }
        };
      } catch {
        setConnection("Invalid local bridge address");
      }
    };
    connect();
    window.addEventListener("hashchange", connect);
    return () => {
      window.removeEventListener("hashchange", connect);
      const previous = socket;
      socket = undefined;
      previous?.close();
    };
  }, [retry]);
  const entries = useMemo(
    () =>
      message?.frames.flatMap((frame) =>
        frame.roots.map((root) => ({
          key: `${frame.id}/${root.id}`,
          root,
          url: frame.url,
          truncated: frame.truncated || root.truncated,
        })),
      ) ?? [],
    [message],
  );
  const current =
    entries.find((entry) => entry.key === rootKey) ??
    entries.reduce<InspectionRootEntry | undefined>(
      (largest, entry) =>
        !largest || entry.root.nodes.length > largest.root.nodes.length ? entry : largest,
      undefined,
    );
  const hasOwners = current?.root.nodes.some((node) => node.ownerId !== undefined) ?? false;
  const isPaired = showOwners && hasOwners;
  const selectedNode =
    current?.key === selected?.rootKey
      ? current?.root.nodes.find((node) => node.id === selected?.nodeId)
      : undefined;
  const nodes = useMemo(() => {
    if (!current) return [];
    const detailsByComponent = new Map<string, TreeNode[]>();
    for (const detail of current.root.details) {
      if (!detail.componentId) continue;
      const details = detailsByComponent.get(detail.componentId) ?? [];
      details.push(detail);
      detailsByComponent.set(detail.componentId, details);
    }
    return current.root.nodes.flatMap((node) => [node, ...(detailsByComponent.get(node.id) ?? [])]);
  }, [current]);
  const columnCount = 1 + Number(isPaired);
  const selectedDetail =
    current?.key === selected?.rootKey
      ? current?.root.details.find((node) => node.id === selected?.nodeId)
      : undefined;
  const width = Math.max(160, (size.width - 16 * (columnCount - 1)) / columnCount);
  const height = Math.max(120, size.height - 26);
  const togglePause = () => {
    pausedRef.current = !pausedRef.current;
    setIsPaused(pausedRef.current);
    if (!pausedRef.current && latestRef.current) setMessage(latestRef.current);
  };
  return (
    <main aria-label="Live fiber inspector" {...stylex.props(styles.root)}>
      <header {...stylex.props(styles.header)}>
        <a href="/" {...stylex.props(styles.link)}>
          Board
        </a>
        <h1 {...stylex.props(styles.title)}>Live fibers</h1>
        <p {...stylex.props(styles.source)}>
          {current?.url ?? message?.target ?? "Inspect a real React app with bippy"}
        </p>
        <div {...stylex.props(styles.actions)}>
          <Button variant="ghost" disabled={!message} aria-pressed={isPaused} onClick={togglePause}>
            {isPaused ? "Resume" : "Pause"}
          </Button>
          <Button
            variant="ghost"
            disabled={!hasOwners}
            aria-pressed={isPaired}
            onClick={() => setShowOwners((value) => !value)}
          >
            Owner view
          </Button>
          <Button variant="ghost" onClick={() => setRetry((value) => value + 1)}>
            Reconnect
          </Button>
        </div>
      </header>
      <div {...stylex.props(styles.info)}>
        <span role="status">
          {connection}
          {connection === "Connected"
            ? ` · ${isPaused ? "paused" : (message?.status ?? "loading")}`
            : ""}
        </span>
        <span data-testid="inspection-count">{current?.root.nodes.length ?? 0} fibers</span>
        <span data-testid="inspection-flow-count">
          {current?.root.edges.length ?? 0} relationships · {current?.root.details.length ?? 0}{" "}
          details
        </span>
        <span data-testid="inspection-sequence">Update {message?.sequence ?? 0}</span>
        {current && (
          <span>
            React {current.root.reactVersion} · {current.root.build}
          </span>
        )}
        {entries.length > 1 && (
          <div role="group" aria-label="React roots" {...stylex.props(styles.actions)}>
            {entries.map((entry, index) => (
              <Button
                key={entry.key}
                variant="ghost"
                aria-pressed={entry.key === current?.key}
                onClick={() => setRootKey(entry.key)}
              >
                Root {index + 1}
              </Button>
            ))}
          </div>
        )}
      </div>
      <p {...stylex.props(styles.notice)}>
        {message?.error ??
          (current
            ? `${current.root.build === "production" ? "Production names may be minified. " : ""}${hasOwners ? "Owner links come from React debug data. " : "Owner data is unavailable in this root. "}Select a fiber to inspect its dataflow. Context reads and dispatch targets come from React; reference links show identity, not executed calls or computed dependencies. Values stay in the app.${current.truncated ? " Capture limit reached; some fibers or relationship details are omitted." : ""}`
            : "The app runs in a separate browser context. Our inspector is not part of its fiber tree.")}
      </p>
      <div ref={bodyRef} {...stylex.props(styles.trees, styles.columns(columnCount))}>
        {current ? (
          <TreeRoot
            key={current.key}
            nodes={nodes}
            dataflowEdges={current.root.edges}
            onSelect={(nodeId) => setSelected({ rootKey: current.key, nodeId })}
          >
            <section {...stylex.props(styles.column)}>
              <h2 {...stylex.props(styles.heading)}>Parent tree</h2>
              <TreeView
                label="Live parent tree"
                width={width}
                height={height}
                controls
                traceComponents
              />
            </section>
            {isPaired && (
              <section {...stylex.props(styles.column)}>
                <h2 {...stylex.props(styles.heading)}>Owner tree</h2>
                <TreeView
                  label="Live owner tree"
                  traceComponents
                  relationship="owner"
                  width={width}
                  height={height}
                  controls
                />
              </section>
            )}
          </TreeRoot>
        ) : (
          <div {...stylex.props(styles.empty)}>
            <p>Run the capture launcher while this dev server is running:</p>
            <code {...stylex.props(styles.command)}>pnpm --filter diagram inspect</code>
            <p>
              It opens shadcn/ui’s dashboard and a connected inspector. Pass another URL to inspect
              a local development app with readable names and owner metadata.
            </p>
            <code {...stylex.props(styles.command)}>
              pnpm --filter diagram inspect http://localhost:3000
            </code>
          </div>
        )}
      </div>
      <footer {...stylex.props(styles.footer)}>
        {selectedNode
          ? `${selectedNode.label} · ${selectedNode.id} · work tag ${selectedNode.tag}`
          : selectedDetail
            ? `${selectedDetail.label} · component detail, not a separate fiber`
            : "Select a fiber to inspect its dataflow. Expand, search, and navigate with the same tree controls as the board."}
      </footer>
    </main>
  );
};
