"use client";

import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

import { useFiberTree } from "./fiber-tree-context";
import { fiberTreeClassNames, setFiberTreeDisplayName } from "./fiber-tree-styles";

interface FiberTreeSearchProps {
  children?: ReactNode;
}

interface SearchButtonProps {
  icon: "close" | "down" | "up";
  label: string;
  onClick: () => void;
}

const searchButtonPaths = {
  close:
    "M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z",
  down: "M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z",
  up: "M7.41 15.41L12 10.83l4.59 4.58L18 14l-6-6-6 6z",
};

const SearchIcon = () => (
  <svg
    className={cn(fiberTreeClassNames.icon, fiberTreeClassNames.inputIcon)}
    viewBox="0 0 24 24"
    aria-hidden="true"
  >
    <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" />
  </svg>
);

const SearchButton = ({ icon, label, onClick }: SearchButtonProps) => (
  <button className={fiberTreeClassNames.button} type="button" aria-label={label} onClick={onClick}>
    <span className={fiberTreeClassNames.buttonContent}>
      <svg className={fiberTreeClassNames.icon} viewBox="0 0 24 24" aria-hidden="true">
        <path d={searchButtonPaths[icon]} />
      </svg>
    </span>
  </button>
);

export const FiberTreeSearch = ({ children }: FiberTreeSearchProps) => {
  const {
    searchResultFiberIds,
    searchResultIndex,
    searchText,
    setCurrentSearchResult,
    updateSearchText,
  } = useFiberTree();

  return (
    <header className={fiberTreeClassNames.treeSearchInput}>
      <div className={fiberTreeClassNames.searchInput}>
        {children ? (
          <>
            {children}
            <div className={fiberTreeClassNames.leftVRule} />
          </>
        ) : null}
        <SearchIcon />
        <input
          className={fiberTreeClassNames.input}
          aria-label="Search components"
          placeholder="Search (text or /regex/)"
          value={searchText}
          onChange={(event) => updateSearchText(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              setCurrentSearchResult(searchResultIndex + (event.shiftKey ? -1 : 1));
            } else if (event.key === "Escape") {
              updateSearchText("");
            }
          }}
        />
        {searchText ? (
          <>
            <span className={fiberTreeClassNames.indexLabel}>
              <input
                className={fiberTreeClassNames.indexInput}
                aria-label="Current search result"
                inputMode="numeric"
                size={1}
                value={searchResultFiberIds.length > 0 ? searchResultIndex + 1 : 0}
                onChange={(event) => {
                  const nextResultIndex = Number(event.currentTarget.value) - 1;
                  if (Number.isInteger(nextResultIndex)) {
                    setCurrentSearchResult(nextResultIndex);
                  }
                }}
              />
              {` | ${searchResultFiberIds.length}`}
            </span>
            <div className={fiberTreeClassNames.leftVRule} />
            <SearchButton
              icon="up"
              label="Previous search result"
              onClick={() => setCurrentSearchResult(searchResultIndex - 1)}
            />
            <SearchButton
              icon="down"
              label="Next search result"
              onClick={() => setCurrentSearchResult(searchResultIndex + 1)}
            />
            <SearchButton icon="close" label="Clear search" onClick={() => updateSearchText("")} />
          </>
        ) : null}
      </div>
    </header>
  );
};

setFiberTreeDisplayName(FiberTreeSearch, "FiberTreeSearch");
setFiberTreeDisplayName(SearchButton, "SearchButton");
setFiberTreeDisplayName(SearchIcon, "SearchIcon");
