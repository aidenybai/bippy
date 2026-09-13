export default () => {
  const receiver = {
    calls: 0,
    matches(value: number) {
      this.calls++;
      return value === 2;
    },
  };
  const some = [1, 2, 3].some(receiver.matches, receiver);
  const every = [2, 1, 3].every(receiver.matches, receiver);
  return (
    <main>
      <span>Receiver:</span>
      {`${some}:${every}:${receiver.calls}`}
    </main>
  );
};
