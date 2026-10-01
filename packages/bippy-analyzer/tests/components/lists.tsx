interface Item {
  id: number;
  label: string;
}

const STATIC_ITEMS: Item[] = [
  { id: 1, label: "one" },
  { id: 2, label: "two" },
  { id: 3, label: "three" },
];

const Row = ({ item }: { item: Item }) => <li>{item.label}</li>;

const List = ({ items }: { items: Item[] }) => (
  <ul>
    {items.map((item) => (
      <Row key={item.id} item={item} />
    ))}
  </ul>
);

const Table = ({ rows }: { rows: string[][] }) => (
  <table>
    <tbody>
      {rows.map((row, rowIndex) => (
        <tr key={rowIndex}>
          {row.map((cell) => (
            <td key={cell}>{cell}</td>
          ))}
        </tr>
      ))}
    </tbody>
  </table>
);

const WithHeader = ({ items }: { items: Item[] }) => (
  <ol>
    <li>header</li>
    {items.map((item) => (
      <li key={item.id}>{item.label}</li>
    ))}
  </ol>
);

const Spread = ({ items }: { items: Item[] }) => (
  <div>
    {[<span key="h">h</span>, ...items.map((item) => <span key={item.id}>{item.label}</span>)]}
  </div>
);

const Filtered = () => (
  <nav>
    {STATIC_ITEMS.filter((item) => item.id !== 2).map((item) => (
      <a key={item.id} href={`/${item.label}`}>
        {item.label}
      </a>
    ))}
  </nav>
);

export default function Lists() {
  return (
    <div>
      <List items={STATIC_ITEMS} />
      <Table
        rows={[
          ["a", "b"],
          ["c", "d"],
        ]}
      />
      <WithHeader items={STATIC_ITEMS} />
      <Spread items={STATIC_ITEMS} />
      <Filtered />
    </div>
  );
}
