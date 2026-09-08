import {
  useFetcher,
  useFetchers,
  useLoaderData,
  useMatches,
  useRouteLoaderData,
  useSearchParams,
} from "react-router";

interface PostData {
  title: string;
  tags: string[];
  publishedAt: string | null;
}

interface ShellData {
  user: { name: string };
}

export const Post = () => {
  const post = useLoaderData() as PostData;
  const shell = useRouteLoaderData("shell") as ShellData;
  const matches = useMatches();
  const [searchParams] = useSearchParams();
  const tab = searchParams.get("tab") ?? "overview";
  const fetcher = useFetcher<{ liked: boolean }>();
  const pendingFetchers = useFetchers().filter((inflight) => inflight.state !== "idle");

  return (
    <article data-tab={tab}>
      <h1>{post.title}</h1>
      <p>By {shell.user.name}</p>
      {post.publishedAt ? <time>{post.publishedAt}</time> : <span>Draft</span>}
      <ul>
        {post.tags.map((tag) => (
          <li key={tag}>{tag}</li>
        ))}
      </ul>
      <ol className="breadcrumbs">
        {matches.map((match) => (
          <li key={match.id}>{match.pathname}</li>
        ))}
      </ol>
      <fetcher.Form method="post" action="/posts/hello/like">
        <input type="hidden" name="slug" value="hello" />
        <button type="submit" disabled={fetcher.state !== "idle"}>
          {fetcher.data?.liked ? "Liked" : "Like"}
        </button>
        {pendingFetchers.length > 0 && <output>{pendingFetchers.length} pending</output>}
      </fetcher.Form>
    </article>
  );
};
