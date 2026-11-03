/**
 * True in the static GitHub Pages build (`npm run build:pages`): there is no server, so the demo search
 * engine runs in the browser and live providers (which need secret keys) are unavailable.
 */
export const STATIC_MODE = process.env.NEXT_PUBLIC_STATIC_EXPORT === '1';
