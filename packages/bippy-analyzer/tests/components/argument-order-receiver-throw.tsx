export default () => {
  const shouldThrow = Math.random() > 0.5;
  let order = "";
  let label = "returned";
  const receiver = {
    get method() {
      order += "G";
      return (value: string) => {
        order += "C";
        return value;
      };
    },
  };
  const getReceiver = () => {
    order += "B";
    if (shouldThrow) throw new Error("receiver");
    return receiver;
  };
  const getKey = (): "method" => {
    order += "K";
    return "method";
  };
  const getValue = () => {
    order += "A";
    return "value";
  };
  try {
    getReceiver()[getKey()](getValue());
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
