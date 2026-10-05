export default () => {
  let trace = "";
  let label = "returned";
  const items = () => {
    trace += "R";
    throw null;
  };
  try {
    for (const item of items()) {
      trace += item;
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
