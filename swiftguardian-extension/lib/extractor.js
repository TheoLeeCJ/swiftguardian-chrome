// Execute extractor (content.js) to gather OG/Twitter/page meta + special flags
export async function runExtractor(tabId) {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    const data = await chrome.tabs.sendMessage(tabId, { action: 'extractPreviewData' });
    return data || {};
  } catch (e) {
    console.warn('Extractor failed:', e);
    return {};
  }
}
