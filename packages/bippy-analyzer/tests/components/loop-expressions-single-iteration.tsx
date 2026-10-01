export default () => {
  let trace = "";
  let label = "returned";

  try {
    do {
      trace += "B";
    } while (((trace += "T"), false));
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
