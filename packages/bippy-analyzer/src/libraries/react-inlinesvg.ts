import { fromNativeValue } from "../evaluate/native-values.js";
import {
  getObjectProperty,
  getTruthiness,
  isKnownString,
  mapValue,
  objectValue,
  omitObjectKeys,
  unknownValue,
} from "../evaluate/values.js";
import { element, stubValue } from "../evaluate/stubs.js";
import type {
  LibraryValueProvider,
  ModeledExports,
  ProjectContext,
  StaticObjectEntry,
  StaticObjectValue,
  StaticValue,
  StubComponent,
} from "../types.js";
import { ClassComponentTag } from "../work-tags.js";
import { getDefaultExport, getInstalledModules } from "./installed-modules.js";

// react-inlinesvg fetches `src`, parses it with the browser's DOM parser,
// converts the node to elements with react-from-dom and renders that element
// with the remaining props cloned onto it. The settled tree is a pure function
// of the SVG text, which the dev server serves from the project, so the same
// converter runs here on the same file. Anything that rewrites the document
// (title, description, id uniquifying, a pre-processor) stays unknown. The
// `CacheProvider` entry point is plain React and analyzed from source. Up to
// v3 the default export is one `PureComponent`; from v4 a function component
// wraps the `ReactInlineSVG` function that renders.

export const REACT_INLINESVG_PACKAGES = ["react-inlinesvg"];

const [PACKAGE_NAME] = REACT_INLINESVG_PACKAGES;
const CONVERTER_PACKAGE = "react-from-dom";

export const REACT_INLINESVG_MODELED_EXPORTS: ModeledExports = { [PACKAGE_NAME]: ["default"] };

/** Props `ReactInlineSVG` consumes instead of forwarding to the `<svg>`. */
const OWN_PROPS = new Set([
  "baseURL",
  "cacheRequests",
  "children",
  "description",
  "fetchOptions",
  "innerRef",
  "loader",
  "onError",
  "onLoad",
  "preProcessor",
  "src",
  "title",
  "uniqueHash",
  "uniquifyIDs",
]);

const REWRITING_PROPS = ["preProcessor", "uniquifyIDs", "title", "description"];

interface DomConverter {
  (input: string | Node, options?: { nodeOnly: boolean }): unknown;
}

const loadConverter = (rootDirectory: string): DomConverter | null => {
  const module = getInstalledModules(rootDirectory).load(CONVERTER_PACKAGE, PACKAGE_NAME);
  const convert = module === null ? null : getDefaultExport(module);
  if (typeof convert !== "function") return null;
  return (input, options) => Reflect.apply(convert, undefined, [input, options]);
};

const isRewriting = (props: StaticObjectValue, name: string): boolean => {
  const value = getObjectProperty(props, name);
  const isInactive =
    name === "title"
      ? value.kind === "primitive" && value.value === undefined
      : getTruthiness(value) === false;
  return !isInactive;
};

const convertSvg = (svgText: string, rootDirectory: string): StaticValue => {
  const convert = loadConverter(rootDirectory);
  if (convert === null) return unknownValue(`${PACKAGE_NAME} without ${CONVERTER_PACKAGE}`);
  const node = convert(svgText, { nodeOnly: true });
  if (!(node instanceof SVGSVGElement)) return unknownValue(`${PACKAGE_NAME} src is not an <svg>`);
  return fromNativeValue(convert(node), `${CONVERTER_PACKAGE}()`, null);
};

const SVG_DATA_URI = /^data:image\/svg[^,]*?(;base64)?,(.*)/u;

const readSvgSource = (src: string, project: ProjectContext): string | null => {
  const dataUri = SVG_DATA_URI.exec(src);
  if (dataUri !== null) {
    return dataUri[1]
      ? Buffer.from(dataUri[2], "base64").toString()
      : decodeURIComponent(dataUri[2]);
  }
  return src.includes("<svg") ? src : project.readServedAsset(src);
};

const renderSvgSource = (
  src: StaticValue,
  props: StaticObjectValue,
  project: ProjectContext,
): StaticValue => {
  if (!isKnownString(src)) return unknownValue(`${PACKAGE_NAME} src`);
  const svgText = readSvgSource(src.value, project);
  if (svgText === null || project.rootDirectory === null) {
    return unknownValue(`${PACKAGE_NAME} src not served from the project`);
  }
  const svg = convertSvg(svgText, project.rootDirectory);
  if (svg.kind !== "element") return svg;
  const innerRef = getObjectProperty(props, "innerRef");
  const refEntries: StaticObjectEntry[] =
    innerRef.kind === "primitive" && innerRef.value === undefined
      ? []
      : [{ kind: "property", key: "ref", value: innerRef }];
  return {
    ...svg,
    props: objectValue([
      { kind: "spread", value: svg.props },
      ...refEntries,
      { kind: "spread", value: omitObjectKeys(props, OWN_PROPS) },
    ]),
  };
};

const renderSettledSvg = (props: StaticObjectValue, project: ProjectContext): StaticValue => {
  const rewriting = REWRITING_PROPS.find((name) => isRewriting(props, name));
  if (rewriting !== undefined) return unknownValue(`${PACKAGE_NAME} ${rewriting}`);
  return mapValue(getObjectProperty(props, "src"), (src) => renderSvgSource(src, props, project));
};

const isClassComponent = (component: unknown): boolean => {
  if (typeof component !== "function") return false;
  const prototype: unknown = Reflect.get(component, "prototype");
  return typeof prototype === "object" && prototype !== null && "isReactComponent" in prototype;
};

const isInstalledAsClass = (project: ProjectContext): boolean => {
  if (project.rootDirectory === null) return false;
  const module = getInstalledModules(project.rootDirectory).load(PACKAGE_NAME);
  return module !== null && isClassComponent(getDefaultExport(module));
};

const createInlineSvgStub = (project: ProjectContext): StubComponent => {
  const render: StubComponent["render"] = (props) => renderSettledSvg(props, project);
  if (isInstalledAsClass(project)) {
    return { displayName: "InlineSVG", tag: ClassComponentTag, render };
  }
  const settled: StubComponent = { displayName: "ReactInlineSVG", render };
  return {
    displayName: "InlineSVG",
    render: (props) => element({ kind: "stub", stub: settled }, props),
  };
};

export const reactInlineSvgValue: LibraryValueProvider = (specifier, importedName, { project }) =>
  specifier === PACKAGE_NAME && importedName === "default"
    ? stubValue(createInlineSvgStub(project))
    : null;
