import { useFetcher } from "@remix-run/react";

export default function Index() {
  const fetcher = useFetcher();
  return (
    <fetcher.Form method="post">
      <button type="submit">Like</button>
    </fetcher.Form>
  );
}
