export const FromLength = ({ count }: { count: number }) => (
  <ul>
    {Array.from({ length: count }, (_, index) => (
      <li key={index}>{index}</li>
    ))}
  </ul>
);

export const SpreadArray = ({ count }: { count: number }) => (
  <ul>
    {[...Array(count)].map((_, index) => (
      <li key={index}>{index}</li>
    ))}
  </ul>
);
