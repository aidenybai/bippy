/** An assignment inside one operand of an uncertain `?:`, `&&` or `||` only happens on that side. */
const Delivery = ({ isExpress }: { isExpress: boolean }) => {
  let carrier = "post";
  const eta = isExpress ? ((carrier = "courier"), "tomorrow") : "next week";
  return (
    <p>
      {carrier}:{eta}
    </p>
  );
};

const Tags = ({ isHot }: { isHot: boolean }) => {
  const tags: string[] = [];
  const meta = { hits: 0 };
  const label = (isHot && (tags.push("hot"), "hot")) || ((meta.hits = 1), "cold");
  return (
    <ul data-label={label} data-hits={meta.hits}>
      {tags.map((tag) => (
        <li key={tag}>{tag}</li>
      ))}
    </ul>
  );
};

export default function ConditionalAssignments() {
  const isExpress = Math.random() < 0.5;
  const isHot = Math.random() < 0.5;
  return (
    <div>
      <Delivery isExpress={isExpress} />
      <Delivery isExpress={true} />
      <Tags isHot={isHot} />
      <Tags isHot={false} />
    </div>
  );
}
