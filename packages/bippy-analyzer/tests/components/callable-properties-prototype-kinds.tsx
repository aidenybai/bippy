export default () => {
  const ordinary = function () {};
  const arrow = () => {};
  const asynchronous = async function () {};
  const bound = ordinary.bind(null);
  const methods = { method() {}, *generator() {} };
  class Holder {
    static name = "Holder";
    method() {}
    static method() {}
  }
  const values = [
    ordinary,
    arrow,
    asynchronous,
    bound,
    methods.method,
    methods.generator,
    Holder.prototype.method,
    Holder.method,
  ];
  const result = values
    .map((value) => `${typeof value.prototype}:${"prototype" in value}`)
    .join("|");
  return (
    <main>
      <span>Result:</span>
      {`${ordinary.hasOwnProperty("prototype")}:${ordinary.propertyIsEnumerable("prototype")}:${Holder.propertyIsEnumerable("name")}|${result}`}
    </main>
  );
};
