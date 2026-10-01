export default () => {
  let trace = "";
  let label = "returned";
  const test = () => {
    trace += "T";
    throw "test";
  };
  try {
    while (test()) {
      trace += "B";
    }
    trace += "L";
  } catch {
    label = "caught";
  }
  return (
    <main>
      <span>Result:</span>
      {`${label}:${trace}`}
    </main>
  );
};
