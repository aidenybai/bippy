export default () => {
  let trace = "";
  const first = () => {
    trace += "F";
    throw "first";
  };
  const target = {
    get method() {
      trace += "M";
      return () => {
        trace += "C";
      };
    },
  };
  const argument = () => {
    trace += "A";
  };
  let label = "returned";
  try {
    (first(), target.method)(argument());
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
