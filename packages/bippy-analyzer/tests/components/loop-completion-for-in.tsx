export default () => {
  let trace = "";
  let label = "returned";
  const shouldThrow = Math.random() > 0.5;
  try {
    for (const index in { 0: true, 1: true, 2: true }) {
      trace += index;
      if (index === "1" && shouldThrow) throw "block";
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
