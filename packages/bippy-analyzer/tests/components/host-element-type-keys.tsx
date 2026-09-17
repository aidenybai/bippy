import { Children, isValidElement, type ReactNode } from "react";

interface TagAttributes {
  [attribute: string]: unknown;
}

interface TagsByName {
  [tagName: string]: TagAttributes[];
}

const collectTags = (children: ReactNode): TagsByName => {
  let tagsByName: TagsByName = {};
  Children.forEach(children, (child) => {
    if (!isValidElement<TagAttributes>(child)) return;
    tagsByName = {
      ...tagsByName,
      [String(child.type)]: [...(tagsByName[String(child.type)] ?? []), child.props],
    };
  });
  return tagsByName;
};

const Head = ({ children }: { children?: ReactNode }) => {
  const tagsByName = collectTags(children);
  let summary: TagAttributes = { title: "static" };
  Object.keys(tagsByName).forEach((tagName) => {
    summary = { ...summary, [tagName]: tagsByName[tagName].length };
  });
  return (
    <dl>
      {Object.entries(summary).map(([name, count]) => (
        <div key={name}>
          <dt>{name}</dt>
          <dd>{`${count}`}</dd>
        </div>
      ))}
    </dl>
  );
};

export const isExact = true;

export default () => (
  <Head>
    <meta name="description" content="static analysis" />
    <meta name="author" content="parser" />
    <link rel="canonical" href="https://example.com" />
  </Head>
);
