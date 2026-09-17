export default () => {
  let trace = "";
  let label = "returned";
  const shouldThrow = Math.random() > 0.5;
  const test = (index) => {
    trace += "T";
    if (shouldThrow) throw null;
    return index < 1;
  };
  try {
    for (let index = 0; test(index); index++) {
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
