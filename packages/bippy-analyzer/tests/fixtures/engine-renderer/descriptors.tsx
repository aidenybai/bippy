const trace: string[] = [];
export const getTrace = () => trace.slice();

const Descriptors = () => {
  const target = {
    label: "original",
    get value() {
      trace.push(this.label);
      return this.label;
    },
  };
  const alias = target;
  alias.label = "mutated";
  Object.defineProperty(target, "hidden", { value: 7 });
  const value = Reflect.get(target, "value", { label: "receiver" });
  return (
    <output data-label={value}>
      {target.label}:{Object.keys(target).join(",")}
    </output>
  );
};
export default Descriptors;
