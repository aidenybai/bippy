const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [monorepoRoot];

config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(monorepoRoot, 'node_modules'),
];

// @ts-ignore
config.resolver.unstable_enableSymlinks = true;
// @ts-ignore
config.resolver.unstable_enablePackageExports = true;
// @ts-ignore
config.resolver.disableHierarchicalLookup = true;

module.exports = config;
