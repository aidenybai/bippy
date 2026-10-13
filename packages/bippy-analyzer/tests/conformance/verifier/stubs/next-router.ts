// HACK: next/router throws outside a mounted pages router.
const events = {
  on: () => undefined,
  off: () => undefined,
  emit: () => undefined,
};

const router = {
  pathname: "/",
  route: "/",
  asPath: "/",
  basePath: "",
  query: {},
  isReady: true,
  isFallback: false,
  isPreview: false,
  isLocaleDomain: false,
  events,
  push: async () => true,
  replace: async () => true,
  reload: () => undefined,
  back: () => undefined,
  forward: () => undefined,
  prefetch: async () => undefined,
  beforePopState: () => undefined,
};

export const useRouter = () => router;
export const withRouter = <Props>(component: Props) => component;
export default router;
