/**
 * Root shim when `package.json` `main` points at `expo/AppEntry.js` (repo root).
 * Prefer `npm run app` / `expo start` from `twin-ai-app` (`main`: `expo-router/entry`).
 */
import TwinApp from './twin-ai-app/App';
export default TwinApp;
