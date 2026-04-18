/**
 * Root entry shim: root `package.json` used to set `main` to Expo AppEntry, which
 * resolves `App` next to the repo root. The real UI lives in `twin-ai-app/App.tsx`.
 *
 * Prefer running the app from `twin-ai-app` (`npm start --prefix twin-ai-app` or `npm run app`).
 */
export { default } from './twin-ai-app/App';
