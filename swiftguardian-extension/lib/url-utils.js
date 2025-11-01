// Utility: strip fragment (kept for general use)
export function cleanUrl(u) {
  try {
    const url = new URL(u);
    url.hash = '';
    return url.toString();
  } catch (e) {
    return u;
  }
}

// Normalize raw URL by stripping all query params and fragments
export function normalizeRawUrl(u) {
  try {
    const url = new URL(u);
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return u;
  }
}

// Exclude localhost URL from prompt only; otherwise return cleaned URL
export function maskUrlForPrompt(u) {
  try {
    const url = new URL(u);
    const host = (url.hostname || '').toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') {
      return '';
    }
    return cleanUrl(u);
  } catch {
    return '';
  }
}

// Derive key from og:url or normalized raw URL
export function derivePageKey(rawUrl, previewData) {
  const ogUrl = previewData?.previewData?.['og:url'];
  if (ogUrl) return ogUrl;
  return normalizeRawUrl(rawUrl);
}
