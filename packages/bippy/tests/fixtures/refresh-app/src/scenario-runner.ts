import * as React from "react";

import { createHarnessTools } from "./harness";
import type { Scenario } from "./harness";
import { getScenarioNamesForReactMajor } from "./scenario-manifest";
import { classAndRefScenarios } from "./scenarios/classes-and-refs";
import { errorBoundaryScenarios } from "./scenarios/error-boundaries";
import { hookAndRenderingScenarios } from "./scenarios/hooks-and-rendering";
import { lazyScenarios } from "./scenarios/lazy";
import { remountSemanticsScenarios } from "./scenarios/remount-semantics";
import { runtimeApiScenarios } from "./scenarios/runtime-api";
import { signatureScenarios } from "./scenarios/signatures";
import { statePreservationScenarios } from "./scenarios/state-preservation";

// Experimental-channel builds report "0.0.0-experimental-<sha>-<date>";
// they are built from React main, so treat them as newer than any release.
const reactMajor = React.version.includes("experimental")
  ? 99
  : Number(React.version.split(".")[0]);

const scenarios: Record<string, Scenario> = {
  ...statePreservationScenarios,
  ...remountSemanticsScenarios,
  ...lazyScenarios,
  ...signatureScenarios,
  ...hookAndRenderingScenarios,
  ...errorBoundaryScenarios,
  ...classAndRefScenarios,
  ...runtimeApiScenarios,
};

export const initScenarios = async (): Promise<{
  runScenario: (scenarioName: string) => Promise<ScenarioRunResult>;
  scenarioNames: string[];
}> => {
  if (reactMajor >= 19) {
    // react-konva requires React 19, so it must stay out of the module
    // graph entirely when the fixture aliases an older React.
    const { multiRendererScenarios } = await import("./scenarios/multi-renderer");
    Object.assign(scenarios, multiRendererScenarios);
  }

  const expectedNames = getScenarioNamesForReactMajor(reactMajor);
  const registeredNames = Object.keys(scenarios).filter((registeredName) =>
    expectedNames.includes(registeredName),
  );
  for (const expectedName of expectedNames) {
    if (!registeredNames.includes(expectedName)) {
      throw new Error(`scenario listed in manifest but not registered: ${expectedName}`);
    }
  }

  const runScenario = async (scenarioName: string): Promise<ScenarioRunResult> => {
    const scenario = scenarios[scenarioName];
    if (!scenario) {
      return { status: "failed", error: `unknown scenario: ${scenarioName}` };
    }
    const tools = createHarnessTools();
    try {
      await scenario(tools);
      tools.expectBippyCommits();
      return { status: "passed" };
    } catch (error) {
      return {
        status: "failed",
        error: error instanceof Error ? (error.stack ?? error.message) : String(error),
      };
    }
  };

  return { runScenario, scenarioNames: [...registeredNames] };
};
