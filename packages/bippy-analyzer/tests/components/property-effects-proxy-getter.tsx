export default () => {
  let trace = "";
  const handler = {
    get set() {
      trace += "G";
      throw new Error("trap");
    },
  };
  const target = new Proxy({ value: "old" }, handler);
  const getValue = () => {
    trace += "R";
    return "new";
  };
  let label = "returned";
  try {
    target.value = getValue();
  } catch (error) {
    label = error.message;
  }
  return (
    <main>
      <span>Result:</span>
      {`${label}:${trace}`}
    </main>
  );
};
