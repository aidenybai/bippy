import rehypeRaw from "rehype-raw";
import remarkGfm from "remark-gfm";
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

const getPluginSetting = (
  props: StaticObjectValue,
  name: string,
  packageName: string,
): boolean | null => {
  const plugins = getObjectProperty(props, name);
  if (isUndefinedValue(plugins)) return false;
  if (plugins.kind !== "list") return null;
  if (plugins.items.length === 0) return false;
  return plugins.items.length === 1 &&
    plugins.items[0].kind === "external" &&
    plugins.items[0].packageName === packageName &&
    plugins.items[0].origin === "binding"
    ? true
    : null;
};

const renderMarkdown = (props: StaticObjectValue): StaticValue => {
  const markdown = getObjectProperty(props, "children");
  const isGfmEnabled = getPluginSetting(props, "remarkPlugins", "remark-gfm");
  const isRawEnabled = getPluginSetting(props, "rehypePlugins", "rehype-raw");
  if (markdown.kind !== "primitive" || typeof markdown.value !== "string") {
    return unknownValue("dynamic react-markdown input");
  }
  if (isGfmEnabled === null || isRawEnabled === null) {
    return unknownValue("unsupported react-markdown plugins");
  }
  let markdownProcessor = unified().use(remarkParse);
  if (isGfmEnabled) markdownProcessor = markdownProcessor.use(remarkGfm);
  markdownProcessor = markdownProcessor.use(remarkRehype, {
    allowDangerousHtml: isRawEnabled,
  });
  if (isRawEnabled) markdownProcessor = markdownProcessor.use(rehypeRaw);
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
