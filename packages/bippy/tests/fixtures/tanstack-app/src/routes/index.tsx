import { createFileRoute } from "@tanstack/react-router";

import { TestHarness } from "../test-harness";

const Home = () => <TestHarness />;

export const Route = createFileRoute("/")({
  component: Home,
});
