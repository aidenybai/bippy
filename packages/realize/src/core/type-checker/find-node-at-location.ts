import { isBindingElement } from "typescript/unstable/ast";
import type { SourceFile, Node } from "typescript/unstable/ast";
import { getRangeKey } from "../shared/get-range-key";
import { getLocationKey } from "../shared/get-location-key";
import type { SourceLocation } from "../../react-compiler/HIR/HIR";
import { GeneratedSource } from "../../react-compiler/HIR/HIR";

const nodesByRangeCache = new WeakMap<SourceFile, Map<string, Node>>();

const getNodesByRange = (sourceFile: SourceFile): Map<string, Node> => {
  const cachedNodes = nodesByRangeCache.get(sourceFile);
  if (cachedNodes) return cachedNodes;
  const nodesByRange = new Map<string, Node>();
  const visit = (node: Node): void => {
    nodesByRange.set(getRangeKey(node.getStart(sourceFile), node.getEnd()), node);
    if (isBindingElement(node) && node.propertyName && node.name && node.initializer)
      nodesByRange.set(getRangeKey(node.name.getStart(sourceFile), node.getEnd()), node);
    node.forEachChild(visit);
  };
  sourceFile.forEachChild(visit);
  nodesByRangeCache.set(sourceFile, nodesByRange);
  return nodesByRange;
};

export const findNodeAtLocation = (sourceFile: SourceFile, loc: SourceLocation): Node | null => {
  if (loc === GeneratedSource) return null;
  const nodesByRange = getNodesByRange(sourceFile);
  const node = nodesByRange.get(getLocationKey(loc));
  if (node || !loc.identifierName) return node ?? null;
  const nameEnd = loc.start.index + loc.identifierName.length;
  return nodesByRange.get(getRangeKey(loc.start.index, nameEnd)) ?? null;
};
