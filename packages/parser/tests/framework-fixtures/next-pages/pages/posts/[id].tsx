import { useRouter } from "next/router";
import { useEffect, useState } from "react";

export default function Post() {
  const router = useRouter();
  const [isNavigating, setIsNavigating] = useState(false);
  useEffect(() => {
    const onRouteChangeStart = () => setIsNavigating(true);
    router.events.on("routeChangeStart", onRouteChangeStart);
    return () => router.events.off("routeChangeStart", onRouteChangeStart);
  }, [router.events]);
  return (
    <article>
      <h1>Post {router.query.id}</h1>
      {router.pathname === "/posts/[id]" ? <em>post route</em> : <strong>elsewhere</strong>}
      {isNavigating ? <progress /> : null}
    </article>
  );
}
