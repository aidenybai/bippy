export const sourceFetch = (): Promise<Response> =>
  Promise.resolve(new Response("not found", { status: 404 }));
