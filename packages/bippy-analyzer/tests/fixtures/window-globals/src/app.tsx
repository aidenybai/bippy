interface PublicEnvironment {
  MODE: string;
  ALLOW_INDEXING?: string;
}

declare global {
  var ENV: PublicEnvironment;
}

export const App = () => {
  const isIndexable = ENV.ALLOW_INDEXING !== "false";
  return (
    <main data-mode={ENV.MODE}>
      {isIndexable ? null : <meta name="robots" content="noindex" />}
      <p>{ENV.MODE}</p>
    </main>
  );
};
