export default () => {
  let trace = "";
  const first = {
    name: "first",
    get value() {
      trace += this.name;
      return this.name;
    },
  };
  const second = {
    name: "second",
    get value() {
      trace += this.name;
      return this.name;
    },
  };
  const target = Math.random() > 0.5 ? first : second;
  const label = target.value;
  return (
    <main>
      <span>Result:</span>
      {`${label}:${trace}`}
    </main>
  );
};
