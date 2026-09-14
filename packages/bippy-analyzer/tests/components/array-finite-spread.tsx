export default () => {
  const original = Math.random() > 0.5 ? [1, 2, 3] : [4];
  const values = [...original];
  original.length = 0;
  return (
    <ul>
      {values.map((value) => (
        <li key={value}>
          <span>Value:</span>
          {value}
        </li>
      ))}
    </ul>
  );
};
