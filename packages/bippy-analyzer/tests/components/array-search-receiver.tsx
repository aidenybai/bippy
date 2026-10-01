export default () => {
  const receiver = {
    target: 2,
    calls: 0,
    matches(value: number) {
      this.calls++;
      return value === this.target;
    },
  };
  const found = [1, 2, 3].find(receiver.matches, receiver);
  return (
    <main>
      <span>Search:</span>
      {`${found}:${receiver.calls}`}
    </main>
  );
};
