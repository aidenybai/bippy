"use client";

import * as stylex from "@stylexjs/stylex";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { LayoutGrid, PanelTop } from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { ScrollArea } from "../components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "../components/ui/tooltip";
import { colors } from "../diagram/tokens.stylex";

export interface BoardItem {
  id: string;
  name: string;
}

interface BoardShellProps {
  items: readonly BoardItem[];
  children: ReactNode;
}

const SpecimenFilter = createContext<string | null>(null);
export const useSpecimenFilter = () => useContext(SpecimenFilter);

const styles = stylex.create({
  shell: {
    isolation: "isolate",
    display: "grid",
    height: "100dvh",
    gridTemplateColumns: "250px minmax(0, 1fr)",
    backgroundColor: colors.surface,
    color: colors.text,
    fontFamily: "system-ui, sans-serif",
    WebkitFontSmoothing: "antialiased",
    "@media (max-width: 899px)": { gridTemplateColumns: "184px minmax(0, 1fr)" },
    "@media (max-width: 767px)": {
      gridTemplateColumns: "minmax(0, 1fr)",
      gridTemplateRows: "auto minmax(0, 1fr)",
    },
  },
  sidebar: {
    display: "flex",
    minWidth: 0,
    minHeight: 0,
    flexDirection: "column",
    borderRight: `1px solid ${colors.border}`,
    "@media (max-width: 767px)": {
      borderRightWidth: 0,
      borderBottom: `1px solid ${colors.border}`,
    },
  },
  search: { padding: "24px 28px 12px", "@media (max-width: 767px)": { padding: 8 } },
  navigationScroll: {
    minHeight: 0,
    flex: 1,
    "@media (max-width: 767px)": { height: 40, flex: "none" },
  },
  navigation: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    padding: "0 28px 24px",
    "@media (max-width: 767px)": { flexDirection: "row", gap: 16, padding: "2px 8px 8px" },
  },
  link: {
    display: "flex",
    alignItems: "center",
    minHeight: 24,
    flexShrink: 0,
    fontSize: 13,
    lineHeight: "20px",
    whiteSpace: "nowrap",
    color: { default: colors.muted, ":hover": colors.text },
    textDecoration: "none",
    textUnderlineOffset: 3,
    outline: { default: "none", ":focus-visible": `2px solid ${colors.text}` },
    outlineOffset: 2,
  },
  active: { color: colors.text, textDecoration: "underline" },
  footer: {
    padding: "16px 28px 24px",
    fontSize: 12,
    color: colors.muted,
    "@media (max-width: 767px)": { display: "none" },
  },
  preview: { display: "flex", minWidth: 0, minHeight: 0, flexDirection: "column" },
  toolbar: {
    display: "flex",
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
    minHeight: 48,
    paddingInline: 24,
  },
  title: { fontSize: 12, fontWeight: 400, margin: 0, color: colors.muted },
  actions: { display: "flex", gap: 4 },
  canvas: { flex: 1, minHeight: 0, backgroundColor: colors.canvas },
  content: { padding: 24 },
  empty: { margin: 0, fontSize: 12, color: colors.muted },
});

export const BoardShell = ({ items, children }: BoardShellProps) => {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState(items[0]?.id ?? "");
  const [isOverview, setIsOverview] = useState(true);
  const searchRef = useRef<HTMLInputElement>(null);
  const visibleItems = items.filter((item) =>
    item.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  );
  const selected = items.find((item) => item.id === selectedId);
  useEffect(() => {
    const syncLocation = () => {
      const url = new URL(window.location.href);
      const component = url.searchParams.get("component");
      const id = component ?? url.hash.slice(1);
      if (items.some((item) => item.id === id)) setSelectedId(id);
      setIsOverview(!component);
    };
    const focusSearch = (event: KeyboardEvent) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === "k" &&
        !event.isComposing
      ) {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    syncLocation();
    window.addEventListener("popstate", syncLocation);
    window.addEventListener("hashchange", syncLocation);
    document.addEventListener("keydown", focusSearch);
    return () => {
      window.removeEventListener("popstate", syncLocation);
      window.removeEventListener("hashchange", syncLocation);
      document.removeEventListener("keydown", focusSearch);
    };
  }, [items]);
  const selectView = (overview: boolean, id = selectedId) => {
    setSelectedId(id);
    setIsOverview(overview);
    const url = new URL(window.location.href);
    if (overview) url.searchParams.delete("component");
    else url.searchParams.set("component", id);
    url.hash = "";
    window.history.pushState(null, "", url);
  };
  return (
    <SpecimenFilter value={isOverview ? null : selectedId}>
      <div {...stylex.props(styles.shell)}>
        <aside aria-label="Component sidebar" {...stylex.props(styles.sidebar)}>
          <div role="search" aria-label="Components" {...stylex.props(styles.search)}>
            <Input
              ref={searchRef}
              type="search"
              aria-label="Search components"
              aria-keyshortcuts="Meta+K Control+K"
              placeholder="Search components"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") setQuery("");
              }}
            />
          </div>
          <ScrollArea css={styles.navigationScroll} viewportProps={{ tabIndex: -1 }}>
            <nav aria-label="Components" {...stylex.props(styles.navigation)}>
              {visibleItems.map((item) => (
                <a
                  key={item.id}
                  href={isOverview ? `#${item.id}` : `?component=${item.id}`}
                  aria-current={selectedId === item.id ? "page" : undefined}
                  {...stylex.props(styles.link, selectedId === item.id && styles.active)}
                  onClick={(event) => {
                    if (
                      event.button !== 0 ||
                      event.metaKey ||
                      event.ctrlKey ||
                      event.shiftKey ||
                      event.altKey
                    )
                      return;
                    setSelectedId(item.id);
                    if (!isOverview) {
                      event.preventDefault();
                      selectView(false, item.id);
                    }
                  }}
                >
                  {item.name}
                </a>
              ))}
              {!visibleItems.length && (
                <p role="status" {...stylex.props(styles.empty)}>
                  No components found.
                </p>
              )}
            </nav>
          </ScrollArea>
          <footer {...stylex.props(styles.footer)}>
            <a href="/inspect" {...stylex.props(styles.link)}>
              Live inspector
            </a>
          </footer>
        </aside>
        <main aria-label="Diagram component board" {...stylex.props(styles.preview)}>
          <header {...stylex.props(styles.toolbar)}>
            <h1 {...stylex.props(styles.title)}>{isOverview ? "Components" : selected?.name}</h1>
            <div role="group" aria-label="Board view" {...stylex.props(styles.actions)}>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label="Show board"
                      aria-pressed={isOverview}
                      onClick={() => selectView(true)}
                    />
                  }
                >
                  <LayoutGrid size={14} aria-hidden />
                </TooltipTrigger>
                <TooltipContent>Board</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label="Show preview"
                      aria-pressed={!isOverview}
                      onClick={() => selectView(false)}
                    />
                  }
                >
                  <PanelTop size={14} aria-hidden />
                </TooltipTrigger>
                <TooltipContent>Preview</TooltipContent>
              </Tooltip>
            </div>
          </header>
          <ScrollArea css={styles.canvas} viewportProps={{ tabIndex: -1 }}>
            <div {...stylex.props(styles.content)}>{children}</div>
          </ScrollArea>
        </main>
      </div>
    </SpecimenFilter>
  );
};
