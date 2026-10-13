import "../../src/index"; // KEEP THIS LINE ON TOP

import { rendererAdapterFactories } from "./renderer-adapters";
import { runRendererTestHarness } from "./renderer-test-harness";

runRendererTestHarness(rendererAdapterFactories);
