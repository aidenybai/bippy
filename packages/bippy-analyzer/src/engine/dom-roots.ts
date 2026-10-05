import type { Root } from "react-dom/client";
import { createCommitRecorder } from "../harness/commit-recorder.js";

export const recorder = createCommitRecorder({ recordCommits: true });
const roots = new Set<Root>();

export const trackRoot = (root: Root): Root => {
  roots.add(root);
  return root;
};

export const unmountRoots = (): void => {
  try {
    for (const root of roots) root.unmount();
  } finally {
    roots.clear();
    recorder.dispose();
  }
};
