import "bippy/install-hook-only";
import "./index.css";

import * as bippy from "bippy";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { SectionFrame } from "./section-registry";
import { ariaHeadlessSections } from "./sections/aria-headless";
import { chartContentSections } from "./sections/charts-content";
import { formSections } from "./sections/forms";
import { miscSections } from "./sections/misc";
import { motionDndSections } from "./sections/motion-dnd";
import { overlaySections } from "./sections/overlays";
import { pickerMenuSections } from "./sections/pickers-menus";
import { radixSections } from "./sections/radix";
import { shadcnSections } from "./sections/shadcn";
import { stateSections } from "./sections/state";
import { uiKitSections } from "./sections/ui-kits";
import { virtualTableSections } from "./sections/virtual-table";

declare global {
  interface Window {
    __BIPPY__: typeof bippy;
    __SECTION_NAMES__: string[];
    __COMMIT_COUNT__: number;
  }
}

const librarySections = [
  ...stateSections,
  ...formSections,
  ...radixSections,
  ...shadcnSections,
  ...ariaHeadlessSections,
  ...uiKitSections,
  ...motionDndSections,
  ...pickerMenuSections,
  ...virtualTableSections,
  ...overlaySections,
  ...chartContentSections,
  ...miscSections,
];

window.__BIPPY__ = bippy;
window.__SECTION_NAMES__ = librarySections.map((librarySection) => librarySection.name);
window.__COMMIT_COUNT__ = 0;

bippy.instrument({
  onCommitFiberRoot: () => {
    window.__COMMIT_COUNT__++;
  },
});

const KitchenSink = () => (
  <main>
    {librarySections.map((librarySection) => (
      <SectionFrame
        key={librarySection.name}
        name={librarySection.name}
        Component={librarySection.Component}
      />
    ))}
  </main>
);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <KitchenSink />
  </StrictMode>,
);
