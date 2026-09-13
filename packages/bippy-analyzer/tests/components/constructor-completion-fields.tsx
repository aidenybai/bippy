export default () => {
  const shouldThrow = Math.random() > 0.5;
  let order = "";
  let label = "returned";
  const getFirst = () => {
    order += "A";
    if (shouldThrow) throw new Error("field");
    return 1;
  };
  const getSecond = () => {
    order += "B";
    return 2;
  };
  class Item {
    first = getFirst();
    second = getSecond();
    constructor() {
      order += "C";
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
      {`${label}:${order}`}
    </main>
  );
};
