import { useParams } from "@remix-run/react";

interface Breadcrumbs {
  home?: string;
}

export const meta = ({ params }: { params: { slug: string } }) => ({
  title: `Post ${params.slug}`,
  description: false,
  keywords: ["remix", "blog"],
  "og:image": { url: "/cover.png" },
  "twitter:card": { name: "twitter:card", content: "summary" },
});

const Breadcrumbs = ({ home = "" }: Breadcrumbs) => (
  <ol>
    {home && <li>{home}</li>}
    <li>Posts</li>
  </ol>
);

export default function Post() {
  const { slug } = useParams();
  return (
    <article>
      <Breadcrumbs />
      <h1>{slug}</h1>
    </article>
  );
}
