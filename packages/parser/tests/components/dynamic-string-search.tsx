const copyright = `© ${new Date().getFullYear()} Acme, all rights reserved.`;
const label = `${new Date().getTime() % 2 === 0} flag`;

const hasMarkup = /<\/?[a-z][^>]*>/i.test(copyright);
const hasPlaceholder = copyright.match(/\{\{(\w+)\}\}/) !== null;
const isBeta = /BETA/i.test(copyright);
const segments = copyright.split("|");
const withoutTags = copyright.replace(/<[^>]+>/g, "");
const tagOffset = copyright.indexOf("</");
const hasQuote = label.includes('"');

export const isExact = true;

export default function DynamicStringSearch() {
  return (
    <footer>
      {hasMarkup ? <mark>markup</mark> : <span>plain text</span>}
      {hasPlaceholder ? <mark>placeholder</mark> : <span>interpolated</span>}
      {isBeta ? <mark>beta</mark> : <span>stable</span>}
      <em>{segments.length === 1 ? "one segment" : "several segments"}</em>
      <em>{withoutTags === copyright ? "unchanged" : "stripped"}</em>
      <em>{tagOffset === -1 ? "no closing tag" : "closing tag"}</em>
      <em>{hasQuote ? "quoted" : "bare"}</em>
    </footer>
  );
}
