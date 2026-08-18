// bippy installs before React, the recommended consumer integration.
import "bippy/install-hook-only";

import * as bippy from "bippy";
import { createRoot } from "react-dom/client";

import { App } from "./app";

window.__BIPPY__ = bippy;
window.__COMMIT_COUNT__ = 0;
window.__HMR_EFFECT_LOG__ = [];

bippy.instrument({
  onCommitFiberRoot: () => {
    window.__COMMIT_COUNT__++;
  },
});

createRoot(document.getElementById("root")!).render(<App />);
