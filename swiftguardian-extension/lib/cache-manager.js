export const pageSnapshots = new Map();

// Initialize processed URLs in storage
export async function initializeStorage() {
  const result = await chrome.storage.local.get(['processedUrls']);
  if (!result.processedUrls) {
    await chrome.storage.local.set({ processedUrls: {} });
  }
}

// Append raw LLM text to logs (keep last 50)
export async function appendLlmLog(entry) {
  try {
    const { llmLogs } = await chrome.storage.local.get(['llmLogs']);
    const arr = Array.isArray(llmLogs) ? llmLogs : [];
    arr.push({ ...entry, timestamp: new Date().toISOString() });
    const trimmed = arr.slice(-50);
    await chrome.storage.local.set({ llmLogs: trimmed });
  } catch (e) {
    console.warn('appendLlmLog failed:', e);
  }
}

// Append Family Center log entry (keep last 100)
export async function appendFamilyCenterLog(entry) {
  try {
    const { familyCenterLogs } = await chrome.storage.local.get(['familyCenterLogs']);
    const arr = Array.isArray(familyCenterLogs) ? familyCenterLogs : [];
    arr.push({ ...entry, timestamp: entry.timestamp || new Date().toISOString() });
    const trimmed = arr.slice(-100); // Keep last 100 entries
    await chrome.storage.local.set({ familyCenterLogs: trimmed });
  } catch (e) {
    console.warn('appendFamilyCenterLog failed:', e);
  }
}

// Get processed URL entry
export async function getProcessedUrl(key) {
  const { processedUrls } = await chrome.storage.local.get(['processedUrls']);
  return processedUrls?.[key] || null;
}

// Update processed URL entry
export async function updateProcessedUrl(key, data) {
  const { processedUrls } = await chrome.storage.local.get(['processedUrls']);
  processedUrls[key] = { ...processedUrls[key], ...data };
  await chrome.storage.local.set({ processedUrls });
}

// Delete processed URL entry
export async function deleteProcessedUrl(key) {
  const { processedUrls } = await chrome.storage.local.get(['processedUrls']);
  if (processedUrls[key]) {
    delete processedUrls[key];
    await chrome.storage.local.set({ processedUrls });
  }
}

// Get all processed URLs
export async function getAllProcessedUrls() {
  const { processedUrls } = await chrome.storage.local.get(['processedUrls']);
  return processedUrls || {};
}

// Get all Family Center logs
export async function getFamilyCenterLogs() {
  const { familyCenterLogs } = await chrome.storage.local.get(['familyCenterLogs']);
  return Array.isArray(familyCenterLogs) ? familyCenterLogs : [];
}

// Get/Set PromptGuard flagged state (temporary, cleared after popup reads it)
export async function getPromptGuardState() {
  const { promptGuardFlagged } = await chrome.storage.local.get(['promptGuardFlagged']);
  return promptGuardFlagged || null;
}

export async function setPromptGuardState(data) {
  await chrome.storage.local.set({ promptGuardFlagged: data });
}

export async function clearPromptGuardState() {
  await chrome.storage.local.remove(['promptGuardFlagged']);
}
