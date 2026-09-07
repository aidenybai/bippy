"use client";

import * as stylex from "@stylexjs/stylex";
import { useEffect, useMemo, useState } from "react";
import { useFilter } from "@react-aria/i18n";
import { ChevronDown, ChevronUp, ChevronsDownUp, ChevronsUpDown, LocateFixed } from "lucide-react";
import type { TreeRow } from "./tree-model";
import { getNodeName } from "./accessibility";
import { colors } from "./tokens.stylex";
import { useTreeView } from "./tree-context";

export interface TreeToolsProps {
  label: string;
  model: readonly TreeRow[];
  activeId: string | null;
  reveal: (nodeId: string, shouldFocus: boolean) => void;
  expandAll: () => void;
  collapseAll: () => void;
}

const styles = stylex.create({
  tools: {
    position: "relative",
    display: "flex",
    alignItems: "center",
    gap: 2,
    height: 28,
    marginBottom: 4,
    color: colors.muted,
  },
  search: {
    minWidth: 0,
    width: 60,
    flex: 1,
    height: 24,
    boxSizing: "border-box",
    padding: "0 4px",
    borderWidth: 0,
    borderRadius: 0,
    backgroundColor: "transparent",
    color: colors.text,
    fontFamily: "inherit",
    fontSize: 10,
    "::placeholder": { color: colors.muted },
  },
  button: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 24,
    height: 24,
    flexShrink: 0,
    padding: 0,
    borderWidth: 0,
    appearance: "none",
    backgroundColor: "transparent",
    color: "inherit",
    cursor: "pointer",
    ":disabled": { cursor: "default", color: colors.muted },
  },
  focus: {
    outline: { default: "none", ":focus-visible": `2px solid ${colors.blue}` },
    outlineOffset: -2,
    "@media (forced-colors: active)": { outlineColor: "Highlight" },
  },
  status: {
    position: "absolute",
    width: 1,
    height: 1,
    overflow: "hidden",
    clipPath: "inset(50%)",
    whiteSpace: "nowrap",
  },
});

export const TreeTools = ({
  label,
  model,
  activeId,
  reveal,
  expandAll,
  collapseAll,
}: TreeToolsProps) => {
  const [query, setQuery] = useState("");
  const [matchIndex, setMatchIndex] = useState(0);
  const [lastActiveId, setLastActiveId] = useState(activeId);
  const { contains } = useFilter({ sensitivity: "base" });
  useEffect(() => {
    if (activeId !== null) setLastActiveId(activeId);
  }, [activeId]);
  const matches = useMemo(
    () =>
      query.trim()
        ? model.filter((row) => contains(`${getNodeName(row.node)} ${row.node.id}`, query.trim()))
        : [],
    [model, query, contains],
  );
  const currentIndex = matches.length ? matchIndex % matches.length : 0;
  const current = matches[currentIndex];
  const targetId = activeId ?? lastActiveId;
  const getMatch = (step: number, shouldFocus = false) => {
    if (!matches.length) return;
    const nextIndex = (currentIndex + step + matches.length) % matches.length;
    setMatchIndex(nextIndex);
    reveal(matches[nextIndex].node.id, shouldFocus);
  };
  return (
    <div
      data-slot="tree-controls"
      data-tree-controls={label}
      role="group"
      aria-label={`${label} controls`}
      {...stylex.props(styles.tools)}
    >
      <input
        type="search"
        aria-label={`Search ${label}`}
        placeholder="Search"
        value={query}
        {...stylex.props(styles.search, styles.focus)}
        onChange={(event) => {
          setQuery(event.target.value);
          setMatchIndex(0);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            getMatch(0, true);
          } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            getMatch(event.key === "ArrowDown" ? 1 : -1);
          } else if (event.key === "Escape") {
            setQuery("");
            setMatchIndex(0);
          }
        }}
      />
      <button
        type="button"
        aria-label={`Previous match in ${label}`}
        title="Previous match"
        disabled={!current}
        onClick={() => getMatch(-1)}
        {...stylex.props(styles.button, styles.focus)}
      >
        <ChevronUp size={12} aria-hidden="true" />
      </button>
      <button
        type="button"
        aria-label={`Next match in ${label}`}
        title="Next match"
        disabled={!current}
        onClick={() => getMatch(1)}
        {...stylex.props(styles.button, styles.focus)}
      >
        <ChevronDown size={12} aria-hidden="true" />
      </button>
      <button
        type="button"
        aria-label={`Reveal active node in ${label}`}
        title="Reveal active node"
        disabled={targetId === null || !model.some((row) => row.node.id === targetId)}
        onClick={() => {
          if (targetId !== null) reveal(targetId, true);
        }}
        {...stylex.props(styles.button, styles.focus)}
      >
        <LocateFixed size={12} aria-hidden="true" />
      </button>
      <button
        type="button"
        aria-label={`Expand all in ${label}`}
        title="Expand all"
        disabled={!model.length}
        onClick={expandAll}
        {...stylex.props(styles.button, styles.focus)}
      >
        <ChevronsUpDown size={12} aria-hidden="true" />
      </button>
      <button
        type="button"
        aria-label={`Collapse all in ${label}`}
        title="Collapse all"
        disabled={!model.length}
        onClick={collapseAll}
        {...stylex.props(styles.button, styles.focus)}
      >
        <ChevronsDownUp size={12} aria-hidden="true" />
      </button>
      <span role="status" {...stylex.props(styles.status)}>
        {query.trim()
          ? current
            ? `${currentIndex + 1} of ${matches.length}: ${getNodeName(current.node)}. Enter to reveal. Up and Down for more matches.`
            : "No matches."
          : ""}
      </span>
    </div>
  );
};

export const TreeControls = () => {
  const { label, model, interaction, reveal, expandAll, collapseAll } = useTreeView();
  return (
    <TreeTools
      label={label}
      model={model}
      activeId={interaction.activeId}
      reveal={reveal}
      expandAll={expandAll}
      collapseAll={collapseAll}
    />
  );
};
