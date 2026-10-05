export default () => {
  const shouldThrow = Math.random() > 0.5;
  let order = "";
  let label = "returned";
  const receiver = {
    consume(value: string) {
      order += "C";
      return value;
    },
  };
  const getKey = (): "consume" => {
    order += "K";
    if (shouldThrow) throw new Error("key");
    return "consume";
  };
  const getValue = () => {
    order += "A";
    return "value";
  };
  try {
    receiver[getKey()](getValue());
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
