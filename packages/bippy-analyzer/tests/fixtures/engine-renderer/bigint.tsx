const BigIntComponent = () => {
  const largeInteger = 9007199254740993n;
  const adjacentNumber = 9007199254740992;
  return (
    <output>
      {String(largeInteger > adjacentNumber)}:{String(7n + 2n)}:{String(7n / 2n)}
    </output>
  );
};
export default BigIntComponent;
