import { SETUP_PATH } from "../types";
import { createNextContextSpec } from "./next";
import { isInstalled } from "./packages";
import type { HarnessSetup } from "./setup";
import type { ExportedValue } from "./source-references";

export interface ProviderSpec {
  packageName: string;
  modules?: string[];
  imports: string;
  wrap: (children: string) => string;
}

// HACK: hooks like `useNavigation` throw outside a data router, and React Router before 6.4 has
// only `MemoryRouter`.
const createRouterSpec = (packageName: string): ProviderSpec => ({
  packageName,
  imports: [
    `import * as ReactRouter from ${JSON.stringify(packageName)};`,
    "const DataRouter = ({ children }) => {",
    '  const [router] = useState(() => ReactRouter.createMemoryRouter([{ path: "*", element: children }]));',
    "  return createElement(ReactRouter.RouterProvider, { router });",
    "};",
  ].join("\n"),
  wrap: (children) =>
    `(isRouterless ? ${children} : createElement(ReactRouter.createMemoryRouter ? DataRouter : ReactRouter.MemoryRouter, null, ${children}))`,
});

const PROVIDER_SPECS: ProviderSpec[] = [
  {
    packageName: "@tanstack/react-query",
    imports: 'import { QueryClient, QueryClientProvider } from "@tanstack/react-query";',
    wrap: (children) =>
      `createElement(QueryClientProvider, { client: useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }))[0] }, ${children})`,
  },
  createRouterSpec("react-router"),
  createRouterSpec("react-router-dom"),
  {
    packageName: "@tanstack/react-router",
    imports: [
      'import * as TanStackRouter from "@tanstack/react-router";',
      "const TanStackRouterProvider = ({ children }) => {",
      "  const [router] = useState(() => TanStackRouter.createRouter({ routeTree: TanStackRouter.createRootRoute(), history: TanStackRouter.createMemoryHistory() }));",
      "  return createElement(TanStackRouter.RouterContextProvider, { router }, children);",
      "};",
    ].join("\n"),
    wrap: (children) => `createElement(TanStackRouterProvider, null, ${children})`,
  },
  {
    packageName: "next-auth",
    modules: ["next-auth/react"],
    imports: [
      'import { SessionProvider } from "next-auth/react";',
      'const SESSION = { user: { name: "Ada Lovelace", email: "ada@example.com" }, expires: "2100-01-01T00:00:00.000Z" };',
    ].join("\n"),
    wrap: (children) =>
      `createElement(SessionProvider, { session: SESSION, refetchOnWindowFocus: false }, ${children})`,
  },
  {
    packageName: "nuqs",
    modules: ["nuqs", "nuqs/adapters/testing"],
    imports: 'import { NuqsTestingAdapter } from "nuqs/adapters/testing";',
    wrap: (children) => `createElement(NuqsTestingAdapter, { hasMemory: true }, ${children})`,
  },
  ...["@xyflow/react", "reactflow"].map((packageName): ProviderSpec => ({
    packageName,
    imports: `import { ReactFlowProvider } from ${JSON.stringify(packageName)};`,
    wrap: (children) => `createElement(ReactFlowProvider, null, ${children})`,
  })),
  {
    packageName: "next-intl",
    imports: 'import { NextIntlClientProvider } from "next-intl";',
    wrap: (children) =>
      `createElement(NextIntlClientProvider, { locale: "en", messages: {}, onError: () => {} }, ${children})`,
  },
  {
    packageName: "react-hook-form",
    imports: 'import { FormProvider, useForm } from "react-hook-form";',
    wrap: (children) => `createElement(FormProvider, useForm(), ${children})`,
  },
];

const createReduxSpec = ({ file, exportName }: ExportedValue): ProviderSpec => ({
  packageName: "react-redux",
  imports: [
    'import { Provider as ReduxProvider } from "react-redux";',
    `import { ${exportName} as reduxStore } from ${JSON.stringify(file)};`,
  ].join("\n"),
  wrap: (children) => `createElement(ReduxProvider, { store: reduxStore }, ${children})`,
});

export const getInstalledProviders = (
  appDirectory: string,
  nextDirectory: string | null,
  reduxStore: ExportedValue | null,
): ProviderSpec[] => {
  const installed = PROVIDER_SPECS.filter((spec) => isInstalled(appDirectory, spec.packageName));
  const nextContextSpec = createNextContextSpec(nextDirectory);
  const reduxSpec =
    reduxStore && isInstalled(appDirectory, "react-redux") ? createReduxSpec(reduxStore) : null;
  const providers = [
    ...(nextContextSpec ? [nextContextSpec] : []),
    ...installed,
    ...(reduxSpec ? [reduxSpec] : []),
  ];
  return providers.some((spec) => spec.packageName === "react-router")
    ? providers.filter((spec) => spec.packageName !== "react-router-dom")
    : providers;
};

export const createProvidersSource = (providers: ProviderSpec[], setup: HarnessSetup): string => {
  const wrapped = providers.reduceRight(
    (children, provider) => provider.wrap(children),
    setup.file ? "createElement(SetupProviders, null, children)" : "children",
  );
  return [
    'import { createElement, useState } from "react";',
    ...providers.map((provider) => provider.imports),
    ...(setup.file
      ? [
          `import * as setup from ${JSON.stringify(SETUP_PATH)};`,
          "const SetupProviders = setup.default ?? (({ children }) => children);",
        ]
      : []),
    `export default function Providers({ children, isRouterless }) { return ${wrapped}; }`,
  ].join("\n");
};
