/**
 * Stands in for `next/cache`, whose caching only exists on a server. Cached functions run
 * directly, and revalidating does nothing.
 */
export const unstable_cache = <Callback>(callback: Callback): Callback => callback;
export const unstable_noStore = () => undefined;
export const revalidatePath = () => undefined;
export const revalidateTag = () => undefined;
