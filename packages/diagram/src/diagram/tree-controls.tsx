"use client";

import * as stylex from "@stylexjs/stylex";
import { useEffect, useMemo, useState } from "react";
import { useFilter } from "@react-aria/i18n";
import {
  ChevronDown,
  ChevronUp,
  ChevronsDownUp,
  ChevronsUpDown,
  LocateFixed,
  type LucideIcon,
} from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "../components/ui/tooltip";
import type { TreeRow } from "./tree-model";
import { getNodeName } from "./accessibility";
import { useTreeView } from "./tree-context";

export interface TreeToolsProps {
  label: string;
  model: readonly TreeRow[];
  activeId: string | null;
  reveal: (nodeId: string, shouldFocus: boolean) => void;
  expandAll: () => void;
  collapseAll: () => void;
}

interface TreeAction {
  label: string;
  icon: LucideIcon;
  disabled: boolean;
  onClick: () => void;
}

const styles = stylex.create({
  tools: {
    position: "relative",
    display: "flex",
    alignItems: "center",
    gap: 2,
    boxSizing: "border-box",
    height: 32,
    padding: 4,
  },
  search: { minWidth: 0, width: 60, flex: 1, fontSize: 10, paddingInline: 8 },
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
  const actions: TreeAction[] = [
    { label: "Previous match", icon: ChevronUp, disabled: !current, onClick: () => getMatch(-1) },
    { label: "Next match", icon: ChevronDown, disabled: !current, onClick: () => getMatch(1) },
    {
      label: "Reveal active node",
      icon: LocateFixed,
      disabled: targetId === null || !model.some((row) => row.node.id === targetId),
      onClick: () => {
        if (targetId !== null) reveal(targetId, true);
      },
    },
    { label: "Expand all", icon: ChevronsUpDown, disabled: !model.length, onClick: expandAll },
    { label: "Collapse all", icon: ChevronsDownUp, disabled: !model.length, onClick: collapseAll },
  ];
  return (
    <div
      data-slot="tree-controls"
      data-tree-controls={label}
      role="group"
      aria-label={`${label} controls`}
      {...stylex.props(styles.tools)}
    >
      <Input
        type="search"
        density="compact"
        aria-label={`Search ${label}`}
        placeholder="Search"
        value={query}
        css={styles.search}
        onChange={(event) => {
          setQuery(event.target.value);
          setMatchIndex(0);
        }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
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
      {actions.map(({ label: actionLabel, icon: Icon, disabled, onClick }) => (
        <Tooltip key={actionLabel}>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={`${actionLabel} in ${label}`}
                disabled={disabled}
                onClick={onClick}
              />
            }
          >
            <Icon size={12} aria-hidden />
          </TooltipTrigger>
          <TooltipContent>{actionLabel}</TooltipContent>
        </Tooltip>
      ))}
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
