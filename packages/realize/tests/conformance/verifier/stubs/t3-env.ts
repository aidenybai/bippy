interface EnvOptions {
  runtimeEnv?: Record<string, unknown>;
  experimental__runtimeEnv?: Record<string, unknown>;
}

export const createEnv = (options: EnvOptions) => ({
  ...options.experimental__runtimeEnv,
  ...options.runtimeEnv,
});
