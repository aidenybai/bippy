import "../src/index.js";

import { rendererAdapterFactories } from "./renderer-adapters.js";
import { runRendererTestHarness } from "./renderer-test-harness.js";

runRendererTestHarness(rendererAdapterFactories);
