/**
 * Stands in for `next/navigation` outside a Next app router, which throws when a component
 * reads the router without one mounted.
 */
const router = {
  push: () => undefined,
  replace: () => undefined,
  refresh: () => undefined,
  back: () => undefined,
  forward: () => undefined,
  prefetch: () => undefined,
};

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
