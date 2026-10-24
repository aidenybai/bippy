import { notFound } from "next/navigation";
import { parseFileRoute } from "@/lib/route";
import { analyzeFile } from "@/server/analyze-file";
import { demos } from "@/server/demos";
import { ClientApp } from "../../client-app";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ path: string[] }>;
}

const Page = async ({ params }: PageProps) => {
  const { path } = await params;
  const route = parseFileRoute(path);
  if (!route) notFound();
  const analyzed = await analyzeFile(route.file);
  if (!analyzed) notFound();
  const [example] = analyzed.examples;
  const view = example ? (analyzed.views[example.name] ?? null) : null;
  if (!example || !view) notFound();
  const json = route.mode === "json" ? (analyzed.json[example.name] ?? null) : null;
  return (
    <ClientApp
      examples={demos.examples}
      name={`f/${route.file}`}
      mode={route.mode}
      view={view}
      json={json}
    />
  );
};

export default Page;
