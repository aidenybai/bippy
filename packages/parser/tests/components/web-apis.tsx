import * as React from "react";

const ParsedUrl = () => {
  const url = new URL("/team/acme?type=meeting&embed=&tab=1#top", "https://cal.example.com:8443");
  url.searchParams.set("tab", "2");
  url.searchParams.append("user", "jo");
  const relative = new URL("../other?x=1", url);
  return (
    <dl>
      <dt>{url.host}</dt>
      <dd>{url.pathname}</dd>
      <dd>{url.search}</dd>
      <dd>{url.href}</dd>
      <dd>{String(url)}</dd>
      <dd>{relative.pathname + relative.search}</dd>
      {url.pathname.endsWith("/embed") ? <b>embed path</b> : <i>regular path</i>}
      {typeof url.searchParams.get("embed") === "string" ? <b>embedded</b> : <i>standalone</i>}
      {url.searchParams.get("missing") === null && <s>no missing param</s>}
    </dl>
  );
};

const SearchParams = () => {
  const params = new URLSearchParams("a=1&b=2&a=3");
  params.delete("b");
  params.append("c", "4");
  const fromObject = new URLSearchParams({ q: "hello world", page: "2" });
  const fromPairs = new URLSearchParams([
    ["k", "v"],
    ["k", "w"],
  ]);
  fromPairs.sort();
  return (
    <ul>
      <li>{params.toString()}</li>
      <li>{params.getAll("a").join(",")}</li>
      <li>{params.has("b") ? "has b" : "no b"}</li>
      <li>{params.size}</li>
      <li>{fromObject.get("q")}</li>
      <li>{fromObject.toString()}</li>
      <li>{[...fromPairs].map(([key, value]) => `${key}=${value}`).join("&")}</li>
      {Array.from(fromPairs.keys()).map((key, index) => (
        <li key={index}>{key}</li>
      ))}
      {params instanceof URLSearchParams && <li>instance</li>}
    </ul>
  );
};

const useInsertionEffectByComputedName =
  React[`useInsertionEffect${Math.random().toFixed(1)}`.slice(0, -3)];

const ShapedStrings = () => {
  const [isInserted, setIsInserted] = React.useState(false);
  useInsertionEffectByComputedName(() => {
    setIsInserted(true);
  }, []);
  const prefixed = `id-${Math.random()}`;
  return (
    <p data-inserted={isInserted}>
      {prefixed.startsWith("id-") ? <b>prefixed</b> : <i>unprefixed</i>}
      {prefixed.slice(0, 3) === "id-" ? <b>sliced</b> : <i>unsliced</i>}
      {prefixed.length >= 3 ? <b>long</b> : <i>short</i>}
    </p>
  );
};

const SizedArrays = () => {
  const cleanups = Array(3).fill(null);
  // eslint-disable-next-line unicorn/no-new-array -- The length-only constructor form is the behavior under test.
  const empty = new Array(2);
  const mixed = Array("3");
  return (
    <ol>
      {cleanups.map((cleanup, index) => (
        <li key={index}>{cleanup === null ? "null" : "set"}</li>
      ))}
      <li>{empty.length}</li>
      <li>{mixed.length}</li>
      <li>{Array.from({ length: 2 }, (_, index) => index).join("|")}</li>
    </ol>
  );
};

export default function WebApis() {
  return (
    <main>
      <ParsedUrl />
      <SearchParams />
      <ShapedStrings />
      <SizedArrays />
    </main>
  );
}
