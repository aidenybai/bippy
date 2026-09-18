import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { fromNativeValue } from "../evaluate/native-values.js";
import { getObjectProperty, isUndefinedValue, unknownValue } from "../evaluate/values.js";
import { stubValue } from "../evaluate/stubs.js";
import type {
  LibraryValueProvider,
  ModeledExports,
  StaticObjectValue,
  StaticValue,
  StubComponent,
} from "../types.js";
import { renderHast } from "./hast-util-to-jsx-runtime.js";

export const REACT_MARKDOWN_PACKAGES = ["react-markdown"];
export const REACT_MARKDOWN_MODELED_EXPORTS: ModeledExports = {
  "react-markdown": ["default", "Markdown"],
};

const markdownProcessor = unified().use(remarkParse).use(remarkRehype);

const hasPlugins = (props: StaticObjectValue): boolean =>
  ["remarkPlugins", "rehypePlugins"].some((name) => {
    const plugins = getObjectProperty(props, name);
    return !isUndefinedValue(plugins) && (plugins.kind !== "list" || plugins.items.length > 0);
  });

const renderMarkdown = (props: StaticObjectValue): StaticValue => {
  const markdown = getObjectProperty(props, "children");
  if (
    markdown.kind !== "primitive" ||
    typeof markdown.value !== "string" ||
    hasPlugins(props)
  ) {
    return unknownValue("dynamic react-markdown input");
  }
  const tree = markdownProcessor.runSync(markdownProcessor.parse(markdown.value));
  return renderHast(fromNativeValue(tree, "react-markdown tree", null), {
    components: getObjectProperty(props, "components"),
    fragment: { kind: "react-api", api: "Fragment" },
    passKeys: true,
    passNode: true,
  });
};

const MARKDOWN_STUB: StubComponent = {
  displayName: "Markdown",
  render: renderMarkdown,
};

export const reactMarkdownValue: LibraryValueProvider = (specifier, importedName) =>
  specifier === "react-markdown" && (importedName === "default" || importedName === "Markdown")
    ? stubValue(MARKDOWN_STUB)
    : null;
