export default () => {
  let trace = "";
  let label = "returned";
  const test = () => {
    trace += "T";
    throw "test";
  };
  try {
    do {
      trace += "B";
    } while (test());
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
