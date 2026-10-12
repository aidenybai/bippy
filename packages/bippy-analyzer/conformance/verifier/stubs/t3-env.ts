/**
 * Stands in for t3-env's `createEnv`, which throws when a client reads a server variable.
 * Server components mount in the browser, so every variable reads from the runtime env
 * the app passes, which the harness fills with placeholders.
 */
interface EnvOptions {
  runtimeEnv?: Record<string, unknown>;
  experimental__runtimeEnv?: Record<string, unknown>;
}

export const createEnv = ({ runtimeEnv, experimental__runtimeEnv }: EnvOptions) => ({
  ...experimental__runtimeEnv,
  ...runtimeEnv,
});
