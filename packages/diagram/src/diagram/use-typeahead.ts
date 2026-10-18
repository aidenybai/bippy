"use client";

import { useRef } from "react";
import { useCollator } from "@react-aria/i18n";
import type { TreeRow } from "./tree-model";

export const useTypeahead = () => {
  const collator = useCollator({ usage: "search", sensitivity: "base" });
  const search = useRef({ text: "", time: 0 });
  return (rows: readonly TreeRow[], focusedId: string | null, key: string) => {
    const now = performance.now();
    const text = now - search.current.time > 1000 ? key : search.current.text + key;
    search.current = { text, time: now };
    const query = [...text].every((character) => collator.compare(character, key) === 0)
      ? key
      : text;
    const start = Math.max(
      0,
      rows.findIndex((row) => row.node.id === focusedId),
    );
    for (let offset = query.length === 1 ? 1 : 0; offset <= rows.length; offset++) {
      const row = rows[(start + offset) % rows.length];
      if (row && collator.compare(row.node.label.slice(0, query.length), query) === 0)
        return row.node.id;
    }
  };
};
