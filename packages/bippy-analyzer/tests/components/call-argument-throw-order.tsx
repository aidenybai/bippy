export default () => {
  const shouldThrow = Math.random() > 0.5;
  let label = "returned";
  const getFirst = () => {
    if (shouldThrow) throw "first";
    return "value";
  };
  const getSecond = () => {
    throw "second";
  };
  const consume = (first: string, second: string) => first + second;
  try {
    consume(getFirst(), getSecond());
  } catch (error) {
    label = String(error);
  }
  return (
    <main>
      <span>Result:</span>
      {label}
    </main>
  );
};
