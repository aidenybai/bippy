import { useRouter } from "next/router";

export default function Post() {
  const router = useRouter();
  return (
    <article>
      <h1>Post {router.query.id}</h1>
      {router.pathname === "/posts/[id]" ? <em>post route</em> : <strong>elsewhere</strong>}
      <p>at {router.pathname}</p>
    </article>
  );
}
