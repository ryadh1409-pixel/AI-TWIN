// Keep Metro's project root as this directory so `expo-router/entry` resolves to
// `twin-ai-app/node_modules/...` (not a parent monorepo root without expo-router).
const { getDefaultConfig } = require('expo/metro-config');

/** @type {import('expo/metro-config').MetroConfig} */
module.exports = getDefaultConfig(__dirname);
