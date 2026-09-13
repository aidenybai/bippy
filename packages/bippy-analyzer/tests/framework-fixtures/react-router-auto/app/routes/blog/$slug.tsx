import { useParams } from "react-router";

interface MetaArgs {
  params: { slug?: string };
}

export const links = () => [
  { rel: "stylesheet", href: "/app.css" },
  { rel: "canonical", href: "/blog" },
];

export const meta = ({ params }: MetaArgs) => [
  { title: `Post ${params.slug}` },
  { name: "description", content: "A post" },
  { tagName: "link", rel: "alternate", href: "/feed.xml" },
];

export default function BlogPost() {
  const { slug } = useParams();
  return <h1>Post {slug}</h1>;
}
