export default () => {
  let trace = "";
  let label = "returned";
  const items = () => {
    trace += "R";
    return null;
  };
  try {
    for (const key in items()) {
      trace += key;
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
