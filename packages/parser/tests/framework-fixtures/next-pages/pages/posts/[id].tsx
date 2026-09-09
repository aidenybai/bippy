import { useRouter } from "next/router";

export default function Post() {
  const router = useRouter();
  return (
    <article>
      <h1>Post {router.query.id}</h1>
      <p>at {router.pathname}</p>
    </article>
  );
}
