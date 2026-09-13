export default () => {
  let calls = 0;
  let bodies = 0;
  let label = "returned";
  const getValue = () => {
    calls++;
    throw new Error("field");
  };
  class Item {
    value = getValue();
    constructor() {
      bodies++;
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
      {`${label}:${calls}:${bodies}`}
    </main>
  );
};
