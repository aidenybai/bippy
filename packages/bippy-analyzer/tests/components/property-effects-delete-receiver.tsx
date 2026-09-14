export default () => {
  let trace = "";
  const getTarget = () => {
    trace += "B";
    throw new Error("object");
  };
  const getKey = () => {
    trace += "K";
    return "value";
  };
  let label = "returned";
  try {
    delete getTarget()[getKey()];
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
