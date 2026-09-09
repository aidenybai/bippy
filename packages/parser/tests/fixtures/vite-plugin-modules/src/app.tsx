interface DocMetadata {
  title: string;
  wordCount: number;
}

interface DocModule {
  default: DocMetadata;
}

const docs = import.meta.glob<DocModule>("./docs/*.md", { eager: true });
const docList = Object.values(docs).map((doc) => doc.default);

export const App = () => (
  <nav>
    <h1>{docList.length} guides</h1>
    <ul>
      {docList.map((doc) => (
        <li key={doc.title}>
          <strong>{doc.title}</strong>
          {doc.wordCount > 10 ? <span>long read</span> : <em>quick read</em>}
        </li>
      ))}
    </ul>
  </nav>
);
