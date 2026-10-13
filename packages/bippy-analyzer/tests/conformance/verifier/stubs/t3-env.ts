// HACK: t3-env throws when a client reads a server variable, so every variable reads from
// runtimeEnv.
interface EnvOptions {
  runtimeEnv?: Record<string, unknown>;
  experimental__runtimeEnv?: Record<string, unknown>;
}

export const createEnv = ({ runtimeEnv, experimental__runtimeEnv }: EnvOptions) => ({
  ...experimental__runtimeEnv,
  ...runtimeEnv,
});
