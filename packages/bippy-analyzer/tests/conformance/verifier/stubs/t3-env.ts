interface EnvOptions {
  runtimeEnv?: Record<string, unknown>;
  experimental__runtimeEnv?: Record<string, unknown>;
}

export const createEnv = ({ runtimeEnv, experimental__runtimeEnv }: EnvOptions) => ({
  ...experimental__runtimeEnv,
  ...runtimeEnv,
});
