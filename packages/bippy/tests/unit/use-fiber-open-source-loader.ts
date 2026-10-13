import type { LoadHook } from "node:module";

interface InjectionTarget {
  functionStart: string;
  probeName: string;
  sourceSuffix: string;
}

export const openSourceInjectionTargets: InjectionTarget[] = [
  {
    functionStart: "function useStore(api, selector = identity) {",
    probeName: "zustand/useStore",
    sourceSuffix: "/zustand/esm/react.mjs",
  },
  {
    functionStart: "function useBaseQuery(options, Observer, queryClient) {",
    probeName: "tanstack-query/useBaseQuery",
    sourceSuffix: "/@tanstack/react-query/build/modern/useBaseQuery.js",
  },
  {
    functionStart: "function useForm(props = {}) {",
    probeName: "react-hook-form/useForm",
    sourceSuffix: "/react-hook-form/dist/index.esm.mjs",
  },
  {
    functionStart: "const useSelector2 = (selector, equalityFnOrOptions = {}) => {",
    probeName: "react-redux/useSelector",
    sourceSuffix: "/react-redux/dist/react-redux.mjs",
  },
  {
    functionStart: "function useAtomValue(atom, options) {",
    probeName: "jotai/useAtomValue",
    sourceSuffix: "/jotai/esm/react.mjs",
  },
  {
    functionStart: "function useVirtualizerBase({",
    probeName: "tanstack-virtual/useVirtualizerBase",
    sourceSuffix: "/@tanstack/react-virtual/dist/esm/index.js",
  },
  {
    functionStart: "function useNavigate() {",
    probeName: "react-router/useNavigate",
    sourceSuffix: "/react-router/dist/production/chunk-YBLPXYCV.mjs",
  },
  {
    functionStart: "function useNavigate() {",
    probeName: "react-router/useNavigate",
    sourceSuffix: "/react-router/dist/development/chunk-62JRHF6Z.mjs",
  },
  {
    functionStart: "function useSpring(props, deps) {",
    probeName: "react-spring/useSpring",
    sourceSuffix: "/@react-spring/core/dist/react-spring_core.modern.mjs",
  },
  {
    functionStart: "function useFloating(_temp) {",
    probeName: "floating-ui/useFloating",
    sourceSuffix: "/@floating-ui/react/dist/floating-ui.react.mjs",
  },
  {
    functionStart: "function useFormik(_ref) {",
    probeName: "formik/useFormik",
    sourceSuffix: "/formik/dist/formik.esm.js",
  },
];

const injectProbe = (source: string, target: InjectionTarget): string => {
  const functionStartIndex = source.indexOf(target.functionStart);
  if (
    functionStartIndex === -1 ||
    source.indexOf(target.functionStart, functionStartIndex + 1) !== -1
  ) {
    throw new Error(`Could not uniquely inject useFiber into ${target.probeName}`);
  }
  const injectedCall = `globalThis.__useOpenSourceFiberProbe(${JSON.stringify(target.probeName)});`;
  const bodyStart = functionStartIndex + target.functionStart.length;
  if (target.functionStart.endsWith("({")) {
    const parametersEnd = source.indexOf("}) {", bodyStart) + "}) {".length;
    return `${source.slice(0, parametersEnd)}\n  ${injectedCall}${source.slice(parametersEnd)}`;
  }
  return `${source.slice(0, bodyStart)}\n  ${injectedCall}${source.slice(bodyStart)}`;
};

export const load: LoadHook = async (url, context, nextLoad) => {
  const result = await nextLoad(url, context);
  const sourcePath = new URL(url).pathname;
  const target = openSourceInjectionTargets.find(({ sourceSuffix }) =>
    sourcePath.endsWith(sourceSuffix),
  );
  if (!target || result.source === undefined) return result;
  const source =
    typeof result.source === "string" ? result.source : new TextDecoder().decode(result.source);
  return { ...result, source: injectProbe(source, target) };
};
