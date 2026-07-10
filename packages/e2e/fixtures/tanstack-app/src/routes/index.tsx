import { createFileRoute } from "@tanstack/react-router";

import { HmrEdgeTargets } from "../hmr-edge-mount";
import { HmrTarget } from "../hmr-target";
import { TestHarness } from "../test-harness";

export const Route = createFileRoute("/")({
  component: Home,
});

function Home() {
  return (
    <>
      <TestHarness />
      <HmrTarget />
      <HmrEdgeTargets />
    </>
  );
}
