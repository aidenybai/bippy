/**
 * The live document a renderer's host lends the analyzed program: the nodes,
 * ranges and selections it creates are the real objects, handed through
 * unchanged. A platform without a document (Node, React Native) has none.
 */
export interface HostDocument {
  readonly document: object;
  readonly globalObject: object;
  /** The document started from the page's own HTML shell, so a query that finds nothing is a real miss rather than a gap in what the analysis rendered. */
  readonly hasKnownMarkup: boolean;
  /** The `href` of the document's first `<base href>`, null without one. */
  getBaseHref(): string | null;
  /** `value instanceof <interfaceName>` against the document's own constructor; null when it installs none by that name. */
  isInstanceOf(value: object, interfaceName: string): boolean | null;
  /** Whether the object is one of the document's own (a node, range, token list) rather than the language's. */
  ownsObject(value: object): boolean;
}
