import {
  R2_BROWSER_IMAGES_ENABLED as DEFAULT_BROWSER_IMAGES_ENABLED,
  R2_SEO_IMAGES_ENABLED as DEFAULT_SEO_IMAGES_ENABLED,
} from "./r2-image-map.generated";

/**
 * Activation is disabled in repository defaults. A preview deployment may opt
 * in with VITE_VERCEL_ENV=preview (or development locally) plus the explicit
 * VITE_R2_* flags. Production never enables preview flags, and SEO has no
 * preview override in this phase.
 */
const viteEnv = (import.meta as ImportMeta & { env?: Record<string, unknown> }).env;
const isPreviewOrLocal =
  viteEnv?.VITE_VERCEL_ENV === "preview" || viteEnv?.VITE_VERCEL_ENV === "development";

const previewFlag = (value: unknown): boolean => value === "true";

export const R2_BROWSER_IMAGES_ENABLED =
  DEFAULT_BROWSER_IMAGES_ENABLED ||
  (isPreviewOrLocal && previewFlag(viteEnv?.VITE_R2_BROWSER_IMAGES));

export const R2_SEO_IMAGES_ENABLED = DEFAULT_SEO_IMAGES_ENABLED;

/**
 * Download delivery is restored as a reviewed part of the poster-download
 * feature. Verified R2 sources only: the resolver returns no source at all for
 * unmapped, invalid or unavailable identities, so enabling this flag can never
 * reintroduce the blocked Vercel Blob 403 path.
 */
export const R2_DOWNLOADS_ENABLED = true;
