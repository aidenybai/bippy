import { createFileRoute } from "@tanstack/react-router";

import { TestHarness } from "../test-harness";

export const Route = createFileRoute("/")({
  component: Home,
});

const Home = () => <TestHarness />;
