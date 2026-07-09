import { HmrTarget } from "./hmr-target";
import { TestHarness } from "./test-harness";

const Home = () => {
  return (
    <>
      <TestHarness />
      <HmrTarget />
    </>
  );
};

export default Home;
