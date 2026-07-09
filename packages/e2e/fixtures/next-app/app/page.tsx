import { HmrEdgeTargets } from "./hmr-edge-mount";
import { HmrTarget } from "./hmr-target";
import { TestHarness } from "./test-harness";

const Home = () => {
  return (
    <>
      <TestHarness />
      <HmrTarget />
      <HmrEdgeTargets />
    </>
  );
};

export default Home;
