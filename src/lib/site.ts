// Optional canonical origin for absolute metadata URLs. Unset or invalid → no
// metadataBase and no canonical tags, matching the previous behavior.
export function siteUrl(): URL | undefined {
  const raw = process.env.PUBLIC_SITE_URL?.trim();
  if (!raw) return undefined;
  try {
    return new URL(raw);
  } catch {
    return undefined;
  }
}
