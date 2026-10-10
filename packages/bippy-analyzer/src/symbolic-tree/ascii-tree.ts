export interface TreeNode {
  label: string;
  children: TreeNode[];
}

export const createTreeNode = (label: string, children: TreeNode[] = []): TreeNode => ({
  label,
  children,
});

export const renderAsciiTree = (root: TreeNode): string[] => {
  const lines = [root.label];
  const walk = (children: TreeNode[], prefix: string): void => {
    children.forEach((child, index) => {
      const isLast = index === children.length - 1;
      lines.push(`${prefix}${isLast ? "└─ " : "├─ "}${child.label}`);
      walk(child.children, `${prefix}${isLast ? "   " : "│  "}`);
    });
  };
  walk(root.children, "");
  return lines;
};
