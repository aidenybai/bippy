export default () => {
  let trace = "";
  let label = "returned";
  const source = {
    get items() {
      trace += "R";
      throw "source";
    },
  };
  try {
    for (const item of source.items) {
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
