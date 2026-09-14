export default () => {
  const values = [1, 2, 3];
  const alias = values;
  if (Math.random() > 0.5) values[1] = 9;
  return (
    <main>
      <span>Identity:</span>
      {alias === values ? "same" : "different"}
      <ul>
        {values.map((value) => (
          <li key={value}>
            <span>Value:</span>
            {value}
          </li>
        ))}
      </ul>
    </main>
  );
};
