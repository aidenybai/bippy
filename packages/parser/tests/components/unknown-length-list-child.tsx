const stored = performance.getEntriesByType("mark").map((entry) => entry.name);

export const isPartial = true;

const Provider = ({ children }: { children: React.ReactNode }) => <section>{children}</section>;

export default function UnknownLengthListChild() {
  return (
    <Provider>
      <ul>
        <li>head</li>
        {stored.map((token) => (
          <li key={token}>{token}</li>
        ))}
        <li>tail</li>
      </ul>
      {stored.map((token) => (
        <b key={token}>{token}</b>
      ))}
      <i />
    </Provider>
  );
}
