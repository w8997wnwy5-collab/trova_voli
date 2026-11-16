/**
 * True in the static GitHub Pages build (`npm run build:pages`): there is no server, so the demo search
 * engine runs in the browser and live providers (which need secret keys) are unavailable.
 */
export const STATIC_MODE = process.env.NEXT_PUBLIC_STATIC_EXPORT === '1';

/** Address of the full version with live fares, shown on the static demo (repository variable LIVE_APP_URL). */
export const LIVE_APP_URL = process.env.NEXT_PUBLIC_LIVE_APP_URL ?? '';
