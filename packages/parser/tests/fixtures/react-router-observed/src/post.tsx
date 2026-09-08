import { Suspense } from "react";
import {
  Await,
  unstable_useRoute,
  useActionData,
  useAsyncValue,
  useFetcher,
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
  const fetcher = useFetcher();
  const actionData = useActionData();

  return (
    <article data-tab={tab}>
      <h1>{post.title}</h1>
      <p>By {shell.user.name}</p>
      {shellRoute?.loaderData?.unreadCount ? (
        <mark>{shellRoute.loaderData.unreadCount}</mark>
      ) : null}
      {missingRoute === undefined ? <small>no such route</small> : <b>?</b>}
      {actionData === undefined ? <small>not submitted</small> : <b>submitted</b>}
      <fetcher.Form method="post" action="/posts/hello/like">
        <button type="submit">Like</button>
      </fetcher.Form>
      {post.publishedAt ? <time>{post.publishedAt}</time> : <span>Draft</span>}
      <Suspense fallback={<span>loading</span>}>
        <Await resolve={post.title} errorElement={<b>failed</b>}>
          {(title) => <h2>{title}</h2>}
        </Await>
        <Await resolve={post.tags}>
          <TagCount />
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
    </article>
  );
};
