export interface TreeModelNode {
  children: string[];
  errorCount?: number;
  isCollapsed?: boolean;
  isHidden?: boolean;
  key?: string | null;
  name: string;
  ownerUid?: string | null;
  parentUid: string | null;
  uid: string;
  warningCount?: number;
}

export interface TreeModelState {
  activityUid: string | null;
  inspectedUid: string | null;
  ownerUid: string | null;
  searchIndex: number | null;
  searchResults: string[];
  searchText: string;
}

export interface TreeModel {
  dispatch: (action: TreeModelAction) => void;
  getFlatTree: () => TreeModelNode[];
  getOwnerTree: () => TreeModelNode[];
  getState: () => TreeModelState;
  setNodes: (nodes: TreeModelNode[]) => void;
}

export interface TreeModelAction {
  index?: number;
  text?: string;
  type:
    | "clear-owner"
    | "next-error"
    | "next-owner"
    | "next-search"
    | "next-sibling"
    | "next"
    | "previous-error"
    | "previous-owner"
    | "previous-search"
    | "previous-sibling"
    | "previous"
    | "select-child"
    | "select-index"
    | "select-owner"
    | "select-parent"
    | "select-search-index"
    | "select-uid"
    | "set-activity"
    | "set-search";
  uid?: string | null;
}

const getWrappedIndex = (index: number, length: number): number =>
  ((index % length) + length) % length;

const createNodeMap = (nodes: TreeModelNode[]): Map<string, TreeModelNode> =>
  new Map(nodes.map((node) => [node.uid, { ...node, children: [...node.children] }]));

export const createTreeModel = (initialNodes: TreeModelNode[] = []): TreeModel => {
  let nodes = createNodeMap(initialNodes);
  let state: TreeModelState = {
    activityUid: null,
    inspectedUid: null,
    ownerUid: null,
    searchIndex: null,
    searchResults: [],
    searchText: "",
  };

  const getRoots = (): TreeModelNode[] =>
    [...nodes.values()].filter((node) => node.parentUid === null);

  const getFlatTree = (): TreeModelNode[] => {
    const flatTree: TreeModelNode[] = [];
    const visit = (node: TreeModelNode): void => {
      if (node.isHidden) return;
      flatTree.push(node);
      if (node.isCollapsed) return;
      for (const childUid of node.children) {
        const child = nodes.get(childUid);
        if (child) visit(child);
      }
    };
    for (const root of getRoots()) visit(root);
    return flatTree;
  };

  const getOwnerTree = (): TreeModelNode[] => {
    if (!state.ownerUid) return [];
    const ownerTree: TreeModelNode[] = [];
    const owner = nodes.get(state.ownerUid);
    if (owner) ownerTree.push(owner);
    for (const node of nodes.values()) {
      if (node.uid !== state.ownerUid && node.ownerUid === state.ownerUid) ownerTree.push(node);
    }
    return ownerTree;
  };

  const getActiveTree = (): TreeModelNode[] =>
    state.ownerUid === null ? getFlatTree() : getOwnerTree();

  const setInspectedByOffset = (offset: number, values = getActiveTree()): void => {
    if (values.length === 0) {
      state = { ...state, inspectedUid: null };
      return;
    }
    const currentIndex = values.findIndex((node) => node.uid === state.inspectedUid);
    const startingIndex = currentIndex < 0 ? (offset > 0 ? -1 : 0) : currentIndex;
    const nextIndex = getWrappedIndex(startingIndex + offset, values.length);
    state = { ...state, inspectedUid: values[nextIndex].uid };
  };

  const updateSearch = (text: string, shouldAdvance: boolean): void => {
    const searchResults =
      text === ""
        ? []
        : getFlatTree()
            .filter(
              (node) =>
                node.name.toLowerCase().includes(text.toLowerCase()) ||
                node.key?.toLowerCase().includes(text.toLowerCase()),
            )
            .map((node) => node.uid);
    let searchIndex: number | null = searchResults.length === 0 ? null : 0;
    if (shouldAdvance && searchResults.length > 0) {
      const previousIndex = searchResults.indexOf(state.inspectedUid ?? "");
      searchIndex = getWrappedIndex(previousIndex + 1, searchResults.length);
    }
    state = {
      ...state,
      inspectedUid: searchIndex === null ? state.inspectedUid : searchResults[searchIndex],
      searchIndex,
      searchResults,
      searchText: text,
    };
  };

  const selectSearchOffset = (offset: number): void => {
    if (state.searchResults.length === 0) return;
    const searchIndex = getWrappedIndex(
      (state.searchIndex ?? -1) + offset,
      state.searchResults.length,
    );
    state = {
      ...state,
      inspectedUid: state.searchResults[searchIndex],
      searchIndex,
    };
  };

  const selectSibling = (offset: number): void => {
    const current = state.inspectedUid ? nodes.get(state.inspectedUid) : undefined;
    if (!current) return;
    const siblingUids = current.parentUid
      ? (nodes.get(current.parentUid)?.children ?? [])
      : getRoots().map((node) => node.uid);
    const index = siblingUids.indexOf(current.uid);
    if (index < 0) return;
    state = {
      ...state,
      inspectedUid: siblingUids[getWrappedIndex(index + offset, siblingUids.length)],
    };
  };

  const selectErrorOffset = (offset: number): void => {
    const flatTree = getFlatTree();
    const visibleUids = new Set(flatTree.map((node) => node.uid));
    const errorUids = new Set<string>();
    for (const node of nodes.values()) {
      if ((node.errorCount ?? 0) === 0 && (node.warningCount ?? 0) === 0) continue;
      let candidate: TreeModelNode | undefined = node;
      while (candidate && !visibleUids.has(candidate.uid)) {
        candidate = candidate.parentUid ? nodes.get(candidate.parentUid) : undefined;
      }
      if (candidate) errorUids.add(candidate.uid);
    }
    const errors = flatTree.filter((node) => errorUids.has(node.uid));
    setInspectedByOffset(offset, errors);
  };

  const dispatch = (action: TreeModelAction): void => {
    if (action.type === "next") setInspectedByOffset(1);
    else if (action.type === "previous") setInspectedByOffset(-1);
    else if (action.type === "next-sibling") selectSibling(1);
    else if (action.type === "previous-sibling") selectSibling(-1);
    else if (action.type === "next-search") selectSearchOffset(1);
    else if (action.type === "previous-search") selectSearchOffset(-1);
    else if (action.type === "next-error") selectErrorOffset(1);
    else if (action.type === "previous-error") selectErrorOffset(-1);
    else if (action.type === "next-owner") setInspectedByOffset(1, getOwnerTree());
    else if (action.type === "previous-owner") setInspectedByOffset(-1, getOwnerTree());
    else if (action.type === "select-uid") {
      let current = action.uid ? nodes.get(action.uid) : undefined;
      while (current) {
        current.isCollapsed = false;
        current.isHidden = false;
        current = current.parentUid ? nodes.get(current.parentUid) : undefined;
      }
      state = { ...state, inspectedUid: action.uid ?? null, ownerUid: null };
    } else if (action.type === "select-index") {
      state = { ...state, inspectedUid: getActiveTree()[action.index ?? -1]?.uid ?? null };
    } else if (action.type === "select-search-index") {
      const searchIndex = action.index ?? -1;
      if (state.searchResults[searchIndex]) {
        state = { ...state, inspectedUid: state.searchResults[searchIndex], searchIndex };
      }
    } else if (action.type === "select-child") {
      const current = state.inspectedUid ? nodes.get(state.inspectedUid) : undefined;
      if (current) {
        current.isCollapsed = false;
        state = { ...state, inspectedUid: current.children[0] ?? current.uid };
      }
    } else if (action.type === "select-parent") {
      const current = state.inspectedUid ? nodes.get(state.inspectedUid) : undefined;
      const parent = current?.parentUid ? nodes.get(current.parentUid) : undefined;
      if (current && current.children.length > 0 && !current.isCollapsed)
        current.isCollapsed = true;
      else if (parent) state = { ...state, inspectedUid: parent.uid };
    } else if (action.type === "select-owner") {
      state = { ...state, inspectedUid: action.uid ?? null, ownerUid: action.uid ?? null };
    } else if (action.type === "clear-owner") state = { ...state, ownerUid: null };
    else if (action.type === "set-search") {
      updateSearch(action.text ?? "", action.text === state.searchText);
    } else if (action.type === "set-activity") {
      state = { ...state, activityUid: action.uid ?? null };
    }
  };

  const setNodes = (nextNodes: TreeModelNode[]): void => {
    const previousNodes = nodes;
    nodes = createNodeMap(nextNodes);
    let inspectedUid = state.inspectedUid;
    while (inspectedUid && !nodes.has(inspectedUid)) {
      inspectedUid = previousNodes.get(inspectedUid)?.parentUid ?? null;
    }
    const ownerUid = state.ownerUid && nodes.has(state.ownerUid) ? state.ownerUid : null;
    state = { ...state, inspectedUid, ownerUid };
    if (state.searchText) updateSearch(state.searchText, false);
  };

  return { dispatch, getFlatTree, getOwnerTree, getState: () => state, setNodes };
};
