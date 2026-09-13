export default () => {
  let order = "";
  let value = 1;
  const state = {
    get value() {
      order += "G";
      return value;
    },
    set value(next: number) {
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
    return 2;
  };
  getReceiver()[getKey()] = getRight();
  const simple = `${order}:${value}`;
  order = "";
  getReceiver()[getKey()] += getRight();
  const compound = `${order}:${value}`;
  order = "";
  const previous = getReceiver()[getKey()]++;
  const postfix = `${order}:${previous}:${value}`;
  order = "";
  const next = --getReceiver()[getKey()];
  return (
    <main>
      <span>Result:</span>
      {`${simple}|${compound}|${postfix}|${order}:${next}:${value}`}
    </main>
  );
};
