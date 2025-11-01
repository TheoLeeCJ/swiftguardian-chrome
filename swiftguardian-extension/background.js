import { initializeStorage } from "./lib/cache-manager.js";
import { onAvailabilityChange } from "./lib/llm-manager.js";
import { setActiveTabId, handleTabUpdate, checkAndInjectBanner } from "./lib/tab-manager.js";
import { registerMessageHandlers } from "./lib/message-handlers.js";

// Initialize storage on startup
initializeStorage();

// Listen for LLM availability changes
onAvailabilityChange((availability, progress) => {
  chrome.runtime.sendMessage({ 
    action: 'llm-availability-updated', 
    availability 
  });
  // Changed: always forward progress if present to keep UI in sync
  if (typeof progress === 'number' && progress > 0 && progress <= 100) {
    chrome.runtime.sendMessage({ 
      action: 'llm-download-progress', 
      progress 
    });
  }
});

// Register all message handlers
registerMessageHandlers();

// Track active tab
chrome.tabs.onActivated.addListener(activeInfo => {
  setActiveTabId(activeInfo.tabId);
  handleTabUpdate(activeInfo.tabId);
});

// Handle navigation - main frame only
chrome.webNavigation.onCommitted.addListener(async (details) => {
  if (details.frameId !== 0) return;
  try {
    const tab = await chrome.tabs.get(details.tabId);
    if (!tab || !tab.url || !tab.url.startsWith('http')) return;

    // If navigation occurred in the active tab, run full update (cache-aware).
    // Otherwise, only (re)inject overlays/interceptors based on cache.
    if (tab.active) {
      handleTabUpdate(details.tabId);
    } else {
      checkAndInjectBanner(details.tabId, tab.url);
    }
  } catch (e) {
    console.warn('[Navigation] onCommitted handling failed:', e);
  }
});
