export default () => {
  let trace = "";
  const names = [];
  const key = {
    toString: () => {
      trace += "K";
      return "value";
    },
  };
  for (const target of [null, undefined]) {
    try {
      Object.hasOwn(target, key);
    } catch (error) {
      names.push(error.name);
    }
  }
  return (
    <main>
      <span>Result:</span>
      {`${names.join(",")}:${trace}`}
    </main>
  );
};
