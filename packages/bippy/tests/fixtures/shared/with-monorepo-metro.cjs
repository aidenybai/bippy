const path = require("path");

const monorepoRoot = path.resolve(__dirname, "../../../../..");

module.exports = (projectRoot, config) => {
  config.watchFolders = [monorepoRoot];

  config.resolver.nodeModulesPaths = [
    path.resolve(projectRoot, "node_modules"),
    path.resolve(monorepoRoot, "node_modules"),
  ];

  // @ts-ignore
  config.resolver.unstable_enableSymlinks = true;
  // @ts-ignore
  config.resolver.unstable_enablePackageExports = true;
  // @ts-ignore
  config.resolver.disableHierarchicalLookup = true;

  return config;
};
