// Load order mirrors an app that installs bippy before everything else:
// bippy hook -> react-refresh injectIntoGlobalHook -> react-dom.
import "bippy/install-hook-only";
import "./install-refresh";

import * as bippy from "bippy";

window.__BIPPY__ = bippy;

const bootstrap = async (): Promise<void> => {
  const { runScenario, scenarioNames } = await import("./scenario-runner");
  window.__RUN_SCENARIO__ = runScenario;
  window.__SCENARIO_NAMES__ = scenarioNames;
  window.__HARNESS_READY__ = true;
};

void bootstrap();
