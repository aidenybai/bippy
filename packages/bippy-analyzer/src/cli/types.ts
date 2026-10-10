import type picocolors from "picocolors";

export type View = "data" | "render" | "states" | "bailouts";

type Colors = ReturnType<typeof picocolors.createColors>;

export interface TreeNode {
  label: string;
  children: TreeNode[];
}

export interface PrintOptions {
  views: Set<View>;
  colors: Colors;
  rootDirectory: string;
  maxDepth: number;
  isShowingAttributes: boolean;
}

export interface ComponentPrintContext extends PrintOptions {
  effects: Map<string, string>;
  triggers: Map<string, string>;
}

export interface AnalyzeCliOptions {
  component?: string[];
  file?: string;
  view: View[];
  hierarchy: boolean;
  depth: number;
  attributes: boolean;
  json: boolean;
  color: boolean;
}
