export interface StoreElement {
  children: number[];
  displayName: string | null;
  errorCount?: number;
  hocDisplayNames?: string[];
  id: number;
  isCollapsed?: boolean;
  isHidden?: boolean;
  isStrictMode?: boolean;
  key?: string | null;
  ownerId?: number | null;
  sourcePath?: string;
  parentId: number | null;
  type: string;
  warningCount?: number;
}

export interface ComponentFilter {
  isEnabled: boolean;
  kind: "activity" | "display-name" | "hoc" | "location" | "type";
  value: string;
}

export interface ComponentStoreOptions {
  collapseNodesByDefault?: boolean;
  onFiltersChanged?: () => void;
}

export interface ComponentStore {
  getElementAtIndex: (index: number) => StoreElement | null;
  getElementById: (id: number) => StoreElement | null;
  getIndexOfElementId: (id: number) => number | null;
  getOwnersTree: (id: number) => StoreElement[];
  getRoots: () => number[];
  getTransitionTimeline: () => never;
  getVisibleElements: () => StoreElement[];
  removeElement: (id: number, parentId: number) => void;
  setCollapsed: (id: number, isCollapsed: boolean) => void;
  setElements: (elements: StoreElement[]) => void;
  setFilters: (filters: ComponentFilter[]) => void;
  setIsProfiling: (isProfiling: boolean) => void;
}

const areFiltersEqual = (left: ComponentFilter[], right: ComponentFilter[]): boolean =>
  left.length === right.length &&
  left.every(
    (filter, index) =>
      filter.isEnabled === right[index]?.isEnabled &&
      filter.kind === right[index]?.kind &&
      filter.value === right[index]?.value,
  );

export const createComponentStore = (options: ComponentStoreOptions = {}): ComponentStore => {
  let elements = new Map<number, StoreElement>();
  let roots: number[] = [];
  let filters: ComponentFilter[] = [];
  let isProfiling = false;

  const isFiltered = (element: StoreElement): boolean =>
    filters.some((filter) => {
      if (!filter.isEnabled) return false;
      if (filter.kind === "type") return element.type === filter.value;
      if (filter.kind === "hoc") return element.hocDisplayNames?.includes(filter.value) ?? false;
      if (filter.kind === "activity")
        return element.type === "activity" && filter.value === "hidden";
      try {
        return new RegExp(filter.value, "i").test(
          filter.kind === "location" ? (element.sourcePath ?? "") : (element.displayName ?? ""),
        );
      } catch {
        return false;
      }
    });

  const getVisibleElements = (): StoreElement[] => {
    const visible: StoreElement[] = [];
    const visit = (id: number, isAncestorCollapsed: boolean): void => {
      const element = elements.get(id);
      if (!element || element.isHidden || isAncestorCollapsed) return;
      const filtered = isFiltered(element);
      if (!filtered && element.type !== "root") visible.push(element);
      const isCollapsed = !filtered && Boolean(element.isCollapsed);
      for (const childId of element.children) visit(childId, isCollapsed);
    };
    for (const rootId of roots) visit(rootId, false);
    return visible;
  };

  const setElements = (nextElements: StoreElement[]): void => {
    elements = new Map(
      nextElements.map((element) => [
        element.id,
        {
          ...element,
          isCollapsed:
            element.isCollapsed ??
            (options.collapseNodesByDefault === true &&
              element.type !== "root" &&
              element.children.length > 0),
        },
      ]),
    );
    roots = nextElements
      .filter((element) => element.parentId === null)
      .map((element) => element.id);
  };

  return {
    getElementAtIndex: (index) => getVisibleElements()[index] ?? null,
    getElementById: (id) => elements.get(id) ?? null,
    getIndexOfElementId: (id) => {
      const index = getVisibleElements().findIndex((element) => element.id === id);
      return index >= 0 ? index : null;
    },
    getOwnersTree: (id) => {
      const owner = elements.get(id);
      if (!owner) return [];
      return [owner, ...[...elements.values()].filter((element) => element.ownerId === id)];
    },
    getRoots: () => [...roots],
    getTransitionTimeline: () => {
      throw new Error("Transition timeline is unavailable during initial paint");
    },
    getVisibleElements,
    removeElement: (id, parentId) => {
      const element = elements.get(id);
      const parent = elements.get(parentId);
      if (!element || element.parentId !== parentId || !parent?.children.includes(id)) {
        throw new Error(`Element ${id} is not a child of ${parentId}`);
      }
      parent.children.splice(parent.children.indexOf(id), 1);
      const removeSubtree = (childId: number): void => {
        const child = elements.get(childId);
        if (!child) return;
        for (const descendantId of child.children) removeSubtree(descendantId);
        elements.delete(childId);
      };
      removeSubtree(id);
    },
    setCollapsed: (id, isCollapsed) => {
      const element = elements.get(id);
      if (!element || element.type === "root") return;
      element.isCollapsed = isCollapsed;
    },
    setElements,
    setFilters: (nextFilters) => {
      if (isProfiling) throw new Error("Cannot modify component filters while profiling");
      if (areFiltersEqual(filters, nextFilters)) return;
      filters = nextFilters.map((filter) => ({ ...filter }));
      options.onFiltersChanged?.();
    },
    setIsProfiling: (nextIsProfiling) => {
      isProfiling = nextIsProfiling;
    },
  };
};
