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
      break;
    } while (test());
    trace += "L";
  } catch (error) {
    label = String(error);
  }
  return (
    <main>
      <span>Result:</span>
      {`${label}:${trace}`}
    </main>
  );
};
