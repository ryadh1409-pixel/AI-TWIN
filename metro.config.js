const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const twinAppRoot = path.resolve(projectRoot, 'twin-ai-app');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(projectRoot);

config.watchFolders = [twinAppRoot];

config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(twinAppRoot, 'node_modules'),
];

const upstreamResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName.startsWith('@/')) {
    const mapped = path
      .join(twinAppRoot, moduleName.slice(2))
      .replace(/\\/g, '/');
    if (typeof upstreamResolveRequest === 'function') {
      return upstreamResolveRequest(context, mapped, platform);
    }
    return context.resolveRequest(context, mapped, platform);
  }
  if (typeof upstreamResolveRequest === 'function') {
    return upstreamResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
