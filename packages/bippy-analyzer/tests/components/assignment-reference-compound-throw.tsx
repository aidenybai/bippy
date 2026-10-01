export default () => {
  const shouldThrow = Math.random() > 0.5;
  let order = "";
  let value = "old";
  let label = "returned";
  const state = {
    get value() {
      order += "G";
      return value;
    },
    set value(next: string) {
      order += "S";
      value = next;
    },
  };
  const getReceiver = () => {
    order += "B";
    return state;
  };
  const getKey = (): "value" => {
    order += "K";
    return "value";
  };
  const getRight = () => {
    order += "R";
    if (shouldThrow) throw new Error("right");
    return "new";
  };
  try {
    getReceiver()[getKey()] += getRight();
  } catch {
    label = "caught";
  }
  return (
    <main>
      <span>Result:</span>
      {`${label}:${order}:${value}`}
    </main>
  );
};
