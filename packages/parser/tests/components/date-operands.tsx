interface Post {
  slug: string;
  date: string;
}

const posts: Post[] = [
  { slug: "oldest", date: "2022-04-04" },
  { slug: "newest", date: "2022-04-06T10:00:00Z" },
  { slug: "newer", date: "2022-04-05" },
];

const epoch = new Date(0);
const later = new Date(60_000);

// `Date` operands convert through `ToPrimitive`: arithmetic and relational
// operators take `valueOf()`, `+` and loose equality take the string form.
export default function DateOperands() {
  const sorted = posts.sort((left, right) => new Date(right.date) - new Date(left.date));
  const minutes = (later - epoch) / 60_000;
  const isOrdered = epoch < later;
  const isLooselyEqual = epoch == 0;
  const isIdentical = new Date(0) == new Date(0);
  return (
    <>
      <ul>
        {sorted.map((post) => (
          <li key={post.slug}>{post.slug}</li>
        ))}
      </ul>
      <p>{minutes}</p>
      <p>{+later}</p>
      <p>{String(isOrdered)}</p>
      <p>{String(isLooselyEqual)}</p>
      <p>{String(isIdentical)}</p>
      <p>{(later + "").length > 0 ? "string" : "empty"}</p>
      <p>{/x/ + "y"}</p>
    </>
  );
}

export const isExact = true;
