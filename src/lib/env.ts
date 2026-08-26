/**
 * Must mirror the basePath logic in next.config.js exactly — Next.js only
 * auto-prefixes basePath for its own asset pipeline (Link/Image/metadata),
 * not for raw client-side fetches like service worker registration.
 */
export const BASE_PATH = process.env.NODE_ENV === "production" ? "/vrikshafx" : "";
