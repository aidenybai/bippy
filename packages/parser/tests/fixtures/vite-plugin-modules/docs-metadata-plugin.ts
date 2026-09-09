const MARKDOWN_PATH = /\.md$/;

export const docsMetadataPlugin = () => ({
  name: "fixture-docs-metadata",
  transform(source: string, id: string) {
    if (!MARKDOWN_PATH.test(id)) return null;
    const heading = source.match(/^#\s+(.+)$/m);
    const metadata = {
      title: heading ? heading[1].trim() : "Untitled",
      wordCount: source.split(/\s+/).filter((word) => word.length > 0).length,
    };
    return { code: `export default ${JSON.stringify(metadata)};`, map: null };
  },
});
