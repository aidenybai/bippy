interface Post {
  slug: string;
  publishedAt: string;
}

const posts: Post[] = [
  { slug: "oldest", publishedAt: "2024-04-01" },
  { slug: "newer", publishedAt: "2024-04-08" },
  { slug: "newest", publishedAt: "2024-04-09" },
];

const tags = ["react", "fiber", "parser", undefined];

export default function SortByDate() {
  const sorted = posts.sort((left, right) => {
    return new Date(right.publishedAt).getTime() - new Date(left.publishedAt).getTime();
  });
  const bySlug = posts.toSorted((left, right) => left.slug.localeCompare(right.slug));
  return (
    <>
      <ul>
        {sorted.map((post) => (
          <li key={post.slug}>{post.slug}</li>
        ))}
      </ul>
      <ol>
        {bySlug.map((post) => (
          <li key={post.slug}>{post.slug}</li>
        ))}
      </ol>
      <p>{tags.sort().join(",")}</p>
    </>
  );
}
