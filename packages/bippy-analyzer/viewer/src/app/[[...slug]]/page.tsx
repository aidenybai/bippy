import { notFound } from "next/navigation";
import { VIEW_MODES } from "@/lib/view-mode";
import { parseRoute } from "@/lib/route";
import { demoNames, demos } from "@/server/demos";
import { ClientApp } from "../client-app";

export const dynamicParams = false;

export const generateStaticParams = () => [
  { slug: [] },
  ...demos.examples.flatMap((example) =>
    VIEW_MODES.map((mode) => ({
      slug: mode === "code" ? [example.name] : [example.name, mode],
    })),
  ),
];

interface PageProps {
  params: Promise<{ slug?: string[] }>;
}

const Page = async ({ params }: PageProps) => {
  const { slug } = await params;
  const route = parseRoute(slug, demoNames);
  if (!route) notFound();
  const view = route.name === null ? null : (demos.views[route.name] ?? null);
  const json =
    route.mode === "json" && route.name !== null ? (demos.json[route.name] ?? null) : null;
  return (
    <ClientApp
      examples={demos.examples}
      name={route.name}
      mode={route.mode}
      view={view}
      json={json}
    />
  );
};

export default Page;
