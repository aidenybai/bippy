export default () => {
  const useFirst = Math.random() > 0.5;
  let reads = 0;
  let calls = 0;
  const create = (prefix: string) => ({
    prefix,
    consume(value: string) {
      calls++;
      return `${this.prefix}:${value}`;
    },
    get method() {
      reads++;
      return this.consume;
    },
  });
  const receiver = useFirst ? create("first") : create("second");
  const result = receiver.method("value");
  return (
    <main>
      <span>Result:</span>
      {`${result}:${reads}:${calls}`}
    </main>
  );
};
