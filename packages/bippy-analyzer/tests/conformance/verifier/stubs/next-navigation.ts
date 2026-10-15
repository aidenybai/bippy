const NEXT_CONTROL_FLOW_PATTERN = /^(?:redirect\(.*\)|notFound\(\))$/;

const router = {
  push: () => undefined,
  replace: () => undefined,
  refresh: () => undefined,
  back: () => undefined,
  forward: () => undefined,
  prefetch: () => undefined,
};

export const appRouter = router;
export const useRouter = () => router;
export const usePathname = () => "/";
export const useSearchParams = () => new URLSearchParams();
export const useParams = () => ({});
export const useSelectedLayoutSegment = () => null;
export const useSelectedLayoutSegments = () => [];
export const redirect = (url: string): never => {
  throw new Error(`redirect(${url})`);
};
export const permanentRedirect = redirect;
export const notFound = (): never => {
  throw new Error("notFound()");
};
export const ReadonlyURLSearchParams = URLSearchParams;
export const unstable_rethrow = (error: unknown): void => {
  if (error instanceof Error && NEXT_CONTROL_FLOW_PATTERN.test(error.message)) throw error;
};
export const useServerInsertedHTML = (): undefined => undefined;
