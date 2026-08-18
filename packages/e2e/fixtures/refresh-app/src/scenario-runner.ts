import { createHarnessTools } from "./harness";
import type { Scenario } from "./harness";
import { scenarioNames as manifestNames } from "./scenario-manifest";
import { classAndRefScenarios } from "./scenarios/classes-and-refs";
import { errorBoundaryScenarios } from "./scenarios/error-boundaries";
import { hookAndRenderingScenarios } from "./scenarios/hooks-and-rendering";
import { lazyScenarios } from "./scenarios/lazy";
import { multiRendererScenarios } from "./scenarios/multi-renderer";
import { remountSemanticsScenarios } from "./scenarios/remount-semantics";
import { runtimeApiScenarios } from "./scenarios/runtime-api";
import { signatureScenarios } from "./scenarios/signatures";
import { statePreservationScenarios } from "./scenarios/state-preservation";

const scenarios: Record<string, Scenario> = {
  ...statePreservationScenarios,
  ...remountSemanticsScenarios,
  ...lazyScenarios,
  ...signatureScenarios,
  ...hookAndRenderingScenarios,
  ...errorBoundaryScenarios,
  ...classAndRefScenarios,
  ...runtimeApiScenarios,
  ...multiRendererScenarios,
};

const registeredNames = Object.keys(scenarios);
for (const manifestName of manifestNames) {
  if (!registeredNames.includes(manifestName)) {
    throw new Error(`scenario listed in manifest but not registered: ${manifestName}`);
  }
}
for (const registeredName of registeredNames) {
  if (!manifestNames.includes(registeredName)) {
    throw new Error(`scenario registered but missing from manifest: ${registeredName}`);
  }
}

export const scenarioNames = registeredNames;

export const runScenario = async (scenarioName: string): Promise<ScenarioRunResult> => {
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
