interface PageProps {
  params: { slug: string };
  searchParams: { query: string[] };
}

interface ParentMetadata {
  description: string;
}

export const generateMetadata = async (
  { params, searchParams }: PageProps,
  parent: Promise<ParentMetadata>,
) => {
  const inherited = await parent;
  Reflect.set(globalThis, "__bippyMetadataApplicationExecuted", true);
  return {
    title: `${params.slug}-${searchParams.query.join(",")}`,
    description: inherited.description,
    robots: inherited.description === "root-description" ? { index: false } : undefined,
  };
};

export default () => <main />;
