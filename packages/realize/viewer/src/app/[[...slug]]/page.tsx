import { notFound } from "next/navigation";
import { parseRoute } from "@/lib/route";
import { analyzeFile } from "@/server/analyze-file";
import { demoNames, examples } from "@/server/demos";
import { ClientApp } from "../client-app";

export const dynamic = "force-dynamic";

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
  if (!analyzed || !view) notFound();
  const json = route.mode === "json" ? (analyzed.json[example.name] ?? null) : null;
  return (
    <ClientApp examples={examples} name={example.name} mode={route.mode} view={view} json={json} />
  );
};

export default Page;
