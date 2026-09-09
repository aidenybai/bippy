import { Suspense } from "react";
import {
  Await,
  unstable_useRoute,
  useActionData,
  useAsyncValue,
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
  author: Promise<string>;
}

interface ShellData {
  user: { name: string };
}

const TagCount = () => {
  const tags = useAsyncValue() as string[];
  return <output>{tags.length}</output>;
};

export const Post = () => {
  const post = useLoaderData() as PostData;
  const shell = useRouteLoaderData("shell") as ShellData;
  const matches = useMatches();
  const [searchParams] = useSearchParams();
  const tab = searchParams.get("tab") ?? "overview";
  const shellRoute = unstable_useRoute("shell");
  const missingRoute = unstable_useRoute("nope");
  const actionData = useActionData();
  const fetcher = useFetcher<{ liked: boolean }>();
  const pendingFetchers = useFetchers().filter((inflight) => inflight.state !== "idle");

  return (
    <article data-tab={tab}>
      <h1>{post.title}</h1>
      <p>By {shell.user.name}</p>
      {shellRoute?.loaderData?.unreadCount ? (
        <mark>{shellRoute.loaderData.unreadCount}</mark>
      ) : null}
      {missingRoute === undefined ? <small>no such route</small> : <b>?</b>}
      {actionData === undefined ? <small>not submitted</small> : <b>submitted</b>}
      {post.publishedAt ? <time>{post.publishedAt}</time> : <span>Draft</span>}
      <Suspense fallback={<span>loading</span>}>
        <Await resolve={post.title} errorElement={<b>failed</b>}>
          {(title) => <h2>{title}</h2>}
        </Await>
        <Await resolve={post.tags}>
          <TagCount />
        </Await>
        <Await resolve={post.author} errorElement={<b>no author</b>}>
          {(author) => <address>{author}</address>}
        </Await>
      </Suspense>
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
