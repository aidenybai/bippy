export default () => {
  const shouldKeep = Math.random() > 0.5;
  let order = "";
  let value = shouldKeep ? "old" : "";
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
    return "new";
  };
  getReceiver()[getKey()] ||= getRight();
  return (
    <main>
      <span>Result:</span>
      {`${shouldKeep ? "kept" : "set"}:${order}:${value}`}
    </main>
  );
};
