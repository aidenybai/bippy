import { notFound } from "next/navigation";
import { VIEW_MODES } from "@/lib/view-mode";
import { parseRoute } from "@/lib/route";
import { analyzeFile } from "@/server/analyze-file";
import { demoNames, examples } from "@/server/demos";
import { ClientApp } from "../client-app";

export const dynamicParams = false;

export const generateStaticParams = () => [
  { slug: [] },
  ...examples.flatMap((example) =>
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
  const example = examples.find((candidate) => candidate.name === route.name) ?? examples[0];
  if (!example) notFound();
  const analyzed = await analyzeFile(example.file);
  const view = analyzed?.views[example.name];
  const json = analyzed?.json[example.name];
  if (!view || json === undefined) notFound();
  return <ClientApp examples={examples} name={example.name} view={view} json={json} />;
};

export default Page;
