export type CorpusFramework =
  | "vite"
  | "rsbuild"
  | "next"
  | "remix"
  | "react-router"
  | "docusaurus"
  | "cra";

export type CorpusPackageManager = "pnpm" | "yarn" | "npm";

/** How to boot an app's dev server and which page to compare against the static tree. */
export interface LiveTarget {
  /** Run from the root directory; installs dependencies. `null` when they are already installed. */
  installCommand: string | null;
  /** Run from the root directory; must serve `port` until killed. */
  devCommand: string;
  port: number;
  /** Path to open, `/` by default. */
  path?: string;
  /**
   * Module that mounts the app (`createRoot(el).render(<App />)`), relative
   * to the root directory. Its mount call is the static root.
   */
  entryFile: string;
  /** Milliseconds to allow the dev server's first compile. */
  readyTimeoutMs: number;
  /** Variables the app reads at boot, standing in for its `.env`. */
  environment?: Record<string, string>;
}

/** A corpus entry on disk, whether cloned from GitHub or living in this workspace. */
export interface CorpusCheckout {
  name: string;
  rootDirectory: string;
  /** Relative to `rootDirectory`. */
  appDirectory: string;
  /** Relative to `rootDirectory`. */
  entryFiles: string[];
  framework: CorpusFramework;
  reactVersion: string;
  live: LiveTarget | null;
  /** Resolved commit for cloned repositories; `null` for workspace apps. */
  commit: string | null;
  /**
   * Directories of linked workspace packages the resolver searches before
   * `node_modules`; empty when the checkout's dependencies are installed.
   */
  moduleDirectories: string[];
}

export interface CorpusRepository {
  /** `owner/name` on GitHub. */
  slug: string;
  defaultBranch: string;
  framework: CorpusFramework;
  packageManager: CorpusPackageManager;
  reactVersion: string;
  /** Directory whose component sources are scanned, relative to the repository root. */
  appDirectory: string;
  /** Route roots or mount points that make the best static entry points. */
  entryFiles: string[];
  /** `null` when the app needs a database or secrets before its first route renders. */
  live: LiveTarget | null;
  notes: string;
}

export const getRepositoryUrl = (repository: CorpusRepository): string =>
  `https://github.com/${repository.slug}.git`;

/** Filesystem-safe checkout directory name for a repository. */
export const getRepositoryDirectoryName = (repository: CorpusRepository): string =>
  repository.slug.replace("/", "__");

/**
 * Real-world React applications the analyzer is measured against. Metadata
 * was gathered from each repository's manifests; `live` targets are apps
 * whose first route renders without a backend.
 */
export const CORPUS_REPOSITORIES: CorpusRepository[] = [
  {
    slug: "calcom/cal.diy",
    defaultBranch: "main",
    framework: "next",
    packageManager: "yarn",
    reactVersion: "18.2.0",
    appDirectory: "apps/web",
    entryFiles: ["apps/web/app/layout.tsx", "apps/web/app/page.tsx"],
    live: null,
    notes: "Prisma + Postgres and NextAuth secrets are required before `/` renders.",
  },
  {
    slug: "shadcn-ui/ui",
    defaultBranch: "main",
    framework: "next",
    packageManager: "pnpm",
    reactVersion: "19.2.3",
    appDirectory: "apps/v4",
    entryFiles: ["apps/v4/app/layout.tsx", "apps/v4/app/(app)/(root)/page.tsx"],
    live: null,
    notes:
      "Static docs and registry site on the App Router; server components dominate the routes.",
  },
  {
    slug: "excalidraw/excalidraw",
    defaultBranch: "master",
    framework: "vite",
    packageManager: "yarn",
    reactVersion: "19.0.0",
    appDirectory: "excalidraw-app",
    entryFiles: ["excalidraw-app/index.tsx", "excalidraw-app/App.tsx"],
    live: {
      installCommand: "yarn install --immutable",
      devCommand: "yarn --cwd excalidraw-app start --port 3005 --strictPort --host 127.0.0.1",
      port: 3005,
      entryFile: "excalidraw-app/index.tsx",
      readyTimeoutMs: 180_000,
    },
    notes: "Yarn workspaces; the app package renders the whiteboard with no backend.",
  },
  {
    slug: "tldraw/tldraw",
    defaultBranch: "main",
    framework: "vite",
    packageManager: "yarn",
    reactVersion: "^19.2.1",
    appDirectory: "apps/examples",
    entryFiles: ["apps/examples/src/index.tsx"],
    live: {
      installCommand: "yarn install --immutable",
      devCommand:
        "yarn workspace examples.tldraw.com dev --port 5420 --strictPort --host 127.0.0.1",
      port: 5420,
      entryFile: "apps/examples/src/index.tsx",
      readyTimeoutMs: 180_000,
    },
    notes: "Examples gallery; the canvas itself uses a custom renderer on top of DOM.",
  },
  {
    slug: "dubinc/dub",
    defaultBranch: "main",
    framework: "next",
    packageManager: "pnpm",
    reactVersion: "19.1.3",
    appDirectory: "apps/web",
    entryFiles: ["apps/web/app/layout.tsx"],
    live: null,
    notes: "Needs Postgres, Redis and auth secrets.",
  },
  {
    slug: "twentyhq/twenty",
    defaultBranch: "main",
    framework: "vite",
    packageManager: "yarn",
    reactVersion: "^19.2.0",
    appDirectory: "packages/twenty-front",
    entryFiles: ["packages/twenty-front/src/index.tsx"],
    live: null,
    notes: "GraphQL backend required at boot.",
  },
  {
    slug: "formbricks/formbricks",
    defaultBranch: "main",
    framework: "next",
    packageManager: "pnpm",
    reactVersion: "19.2.6",
    appDirectory: "apps/web",
    entryFiles: ["apps/web/app/layout.tsx"],
    live: null,
    notes: "Prisma + Postgres required.",
  },
  {
    slug: "triggerdotdev/trigger.dev",
    defaultBranch: "main",
    framework: "remix",
    packageManager: "pnpm",
    reactVersion: "^18.2.0",
    appDirectory: "apps/webapp",
    entryFiles: ["apps/webapp/app/root.tsx"],
    live: null,
    notes: "Remix app backed by Postgres and Redis.",
  },
  {
    slug: "novuhq/novu",
    defaultBranch: "next",
    framework: "vite",
    packageManager: "pnpm",
    reactVersion: "^19.2.3",
    appDirectory: "apps/dashboard",
    entryFiles: ["apps/dashboard/src/main.tsx"],
    live: null,
    notes: "Dashboard authenticates against the API before rendering.",
  },
  {
    slug: "chakra-ui/chakra-ui",
    defaultBranch: "main",
    framework: "next",
    packageManager: "pnpm",
    reactVersion: "19.2.6",
    appDirectory: "apps/www",
    entryFiles: ["apps/www/app/layout.tsx"],
    live: null,
    notes: "Docs site; the component library itself lives in packages/react.",
  },
  {
    slug: "pierrecomputer/pierre",
    defaultBranch: "main",
    framework: "next",
    packageManager: "pnpm",
    reactVersion: "19.2.7",
    appDirectory: "apps/docs",
    entryFiles: ["apps/docs/app/layout.tsx"],
    live: null,
    notes: "Small docs app; useful for a compact App Router sample.",
  },
  {
    slug: "alan2207/bulletproof-react",
    defaultBranch: "master",
    framework: "vite",
    packageManager: "yarn",
    reactVersion: "^18.3.1",
    appDirectory: "apps/react-vite",
    entryFiles: ["apps/react-vite/src/main.tsx", "apps/react-vite/src/app/index.tsx"],
    live: {
      installCommand: "yarn --cwd apps/react-vite install --frozen-lockfile",
      devCommand: "yarn --cwd apps/react-vite dev --port 3010 --strictPort --host 127.0.0.1",
      port: 3010,
      entryFile: "apps/react-vite/src/main.tsx",
      readyTimeoutMs: 120_000,
      environment: {
        VITE_APP_API_URL: "https://api.bulletproofapp.com",
        VITE_APP_ENABLE_API_MOCKING: "true",
      },
    },
    notes: "Reference architecture app; API is mocked in the browser with MSW.",
  },
  {
    slug: "lukevella/rallly",
    defaultBranch: "main",
    framework: "next",
    packageManager: "pnpm",
    reactVersion: "19.2.6",
    appDirectory: "apps/web",
    entryFiles: ["apps/web/src/app/layout.tsx"],
    live: null,
    notes: "Prisma + Postgres required.",
  },
  {
    slug: "umami-software/umami",
    defaultBranch: "master",
    framework: "next",
    packageManager: "pnpm",
    reactVersion: "^19.2.8",
    appDirectory: "src",
    entryFiles: ["src/app/layout.tsx"],
    live: null,
    notes: "Database required at build time.",
  },
  {
    slug: "mantinedev/mantine",
    defaultBranch: "master",
    framework: "next",
    packageManager: "yarn",
    reactVersion: "19.2.8",
    appDirectory: "packages/@mantine/core/src",
    entryFiles: ["packages/@mantine/core/src/index.ts"],
    live: null,
    notes: "Component library sources are the interesting part; the docs app is heavy to boot.",
  },
  {
    slug: "marmelab/react-admin",
    defaultBranch: "master",
    framework: "vite",
    packageManager: "yarn",
    reactVersion: "^18.3.1",
    appDirectory: "examples/simple",
    entryFiles: ["examples/simple/src/index.tsx"],
    live: {
      installCommand: "yarn install --immutable",
      devCommand: "yarn workspace simple dev --port 8080 --strictPort --host 127.0.0.1",
      port: 8080,
      entryFile: "examples/simple/src/index.tsx",
      readyTimeoutMs: 180_000,
    },
    notes: "Framework-heavy admin UI with a fake REST data provider.",
  },
  {
    slug: "TanStack/router",
    defaultBranch: "main",
    framework: "vite",
    packageManager: "pnpm",
    reactVersion: "^19.0.0",
    appDirectory: "examples/react/basic",
    entryFiles: ["examples/react/basic/src/main.tsx"],
    live: {
      installCommand: "pnpm install --frozen-lockfile",
      devCommand:
        "pnpm --filter tanstack-router-react-example-basic dev --port 3001 --strictPort --host 127.0.0.1",
      port: 3001,
      entryFile: "examples/react/basic/src/main.tsx",
      readyTimeoutMs: 180_000,
    },
    notes: "Router example with code-based routes and a mock API.",
  },
  {
    slug: "remix-run/react-router",
    defaultBranch: "main",
    framework: "react-router",
    packageManager: "pnpm",
    reactVersion: "^19.2.7",
    appDirectory: "playground/framework",
    entryFiles: ["playground/framework/app/root.tsx"],
    live: null,
    notes: "Framework-mode playground; hydration wraps the app in router internals.",
  },
  {
    slug: "documenso/documenso",
    defaultBranch: "main",
    framework: "react-router",
    packageManager: "npm",
    reactVersion: "^19.2.7",
    appDirectory: "apps/remix",
    entryFiles: ["apps/remix/app/root.tsx"],
    live: null,
    notes: "Prisma + Postgres required.",
  },
  {
    slug: "makeplane/plane",
    defaultBranch: "preview",
    framework: "react-router",
    packageManager: "pnpm",
    reactVersion: "19.2.8",
    appDirectory: "apps/web",
    entryFiles: ["apps/web/app/root.tsx"],
    live: null,
    notes: "Django API required.",
  },
  {
    slug: "outline/outline",
    defaultBranch: "main",
    framework: "vite",
    packageManager: "yarn",
    reactVersion: "^18.3.1",
    appDirectory: "app",
    entryFiles: ["app/index.tsx"],
    live: null,
    notes: "Koa server with Postgres and Redis serves the SPA.",
  },
  {
    slug: "vercel/ai-chatbot",
    defaultBranch: "main",
    framework: "next",
    packageManager: "pnpm",
    reactVersion: "19.2.7",
    appDirectory: ".",
    entryFiles: ["app/layout.tsx"],
    live: null,
    notes:
      "Auth and database required; small enough to read end to end. Components live beside `app/`.",
  },
  {
    slug: "heroui-inc/heroui",
    defaultBranch: "v3",
    framework: "next",
    packageManager: "pnpm",
    reactVersion: "19.2.6",
    appDirectory: "packages/react/src/components",
    entryFiles: ["packages/react/src/components/button/button.tsx"],
    live: null,
    notes: "Component library on react-aria-components; compound components built from slots.",
  },
  {
    slug: "refinedev/refine",
    defaultBranch: "main",
    framework: "vite",
    packageManager: "pnpm",
    reactVersion: "^19.1.0",
    appDirectory: "examples/base-antd",
    entryFiles: ["examples/base-antd/src/index.tsx"],
    live: null,
    notes: "Ant Design example; the monorepo install is very large.",
  },
  {
    slug: "pmndrs/react-three-fiber",
    defaultBranch: "master",
    framework: "vite",
    packageManager: "yarn",
    reactVersion: "19.2.0",
    appDirectory: "example",
    entryFiles: ["example/src/index.tsx"],
    live: null,
    notes: "The canvas subtree is reconciled by a custom renderer, not react-dom.",
  },
  {
    slug: "facebook/docusaurus",
    defaultBranch: "main",
    framework: "docusaurus",
    packageManager: "pnpm",
    reactVersion: "^19.2.5",
    appDirectory: "packages/docusaurus-theme-classic/src",
    entryFiles: ["packages/docusaurus-theme-classic/src/theme/Layout/index.tsx"],
    live: null,
    notes: "Theme components are plain React; the framework injects them through swizzling.",
  },
  {
    slug: "mui/material-ui",
    defaultBranch: "master",
    framework: "next",
    packageManager: "pnpm",
    reactVersion: "19.2.8",
    appDirectory: "packages/mui-material/src",
    entryFiles: ["packages/mui-material/src/Button/Button.js"],
    live: null,
    notes: "Component library in JavaScript with styled() wrappers and PropTypes.",
  },
  {
    slug: "payloadcms/payload",
    defaultBranch: "main",
    framework: "next",
    packageManager: "pnpm",
    reactVersion: "19.2.6",
    appDirectory: "packages/ui/src",
    entryFiles: ["packages/ui/src/elements/Button/index.tsx"],
    live: null,
    notes: "Admin UI package; App Router app needs a database.",
  },
  {
    slug: "supabase/supabase",
    defaultBranch: "master",
    framework: "next",
    packageManager: "pnpm",
    reactVersion: "^19.2.6",
    appDirectory: "apps/studio/components",
    entryFiles: ["apps/studio/pages/_app.tsx"],
    live: null,
    notes: "Studio uses the Pages Router and needs the platform API.",
  },
  {
    slug: "appsmithorg/appsmith",
    defaultBranch: "release",
    framework: "cra",
    packageManager: "yarn",
    reactVersion: "^17.0.2",
    appDirectory: "app/client/src",
    entryFiles: ["app/client/src/index.tsx"],
    live: null,
    notes: "React 17 with class components and Redux; Java backend required.",
  },
];
