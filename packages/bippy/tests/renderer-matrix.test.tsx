import "../src/index.js"; // KEEP THIS LINE ON TOP

import { rendererAdapterFactories } from "./renderer-adapters.js";
import { runRendererTestHarness } from "./renderer-test-harness.js";

runRendererTestHarness(rendererAdapterFactories);
