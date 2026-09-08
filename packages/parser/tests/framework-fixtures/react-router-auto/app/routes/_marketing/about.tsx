import { useFetcher } from "react-router";

export default function About() {
  const fetcher = useFetcher<{ subscribed: boolean }>();
  return (
    <article>
      about
      <fetcher.Form method="post" action="/newsletter">
        <input name="email" type="email" />
        <button type="submit">{fetcher.state === "idle" ? "Subscribe" : "Subscribing…"}</button>
        {fetcher.data?.subscribed && <output>Thanks!</output>}
      </fetcher.Form>
    </article>
  );
}
