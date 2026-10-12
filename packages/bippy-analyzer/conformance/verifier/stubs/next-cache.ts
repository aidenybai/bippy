/**
 * Stands in for `next/cache`, whose caching only exists on a server. Cached functions run
 * directly, and revalidating does nothing.
 */
export const unstable_cache = <Callback>(callback: Callback): Callback => callback;
export const unstable_noStore = () => undefined;
export const revalidatePath = () => undefined;
export const revalidateTag = () => undefined;
export const updateTag = () => undefined;
export const refresh = () => undefined;
export const cacheLife = () => undefined;
export const cacheTag = () => undefined;
export const unstable_cacheLife = cacheLife;
export const unstable_cacheTag = cacheTag;
export const unstable_expirePath = revalidatePath;
export const unstable_expireTag = revalidateTag;
