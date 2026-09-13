export default () => {
  let calls = 0;
  let label = "returned";
  class Item {
    constructor() {
      calls++;
      throw new Error("constructor");
    }
  }
  try {
    new Item();
  } catch {
    label = "caught";
  }
  return (
    <main>
      <span>Result:</span>
      {`${label}:${calls}`}
    </main>
  );
};
