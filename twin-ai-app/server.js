/**
 * Entry when you run `npm run server` or `node server.js` from twin-ai-app/.
 * Delegates to the repo-root server (RAG + Express app in twin-ai-app/server/index.js).
 */
require(require('path').join(__dirname, '..', 'server.js'));
