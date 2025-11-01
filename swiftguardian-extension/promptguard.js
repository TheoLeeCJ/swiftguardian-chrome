import { PROMPTGUARD } from "./prompts.js";
import { createSession } from "./lib/llm-manager.js";
import { setPromptGuardState } from "./lib/cache-manager.js";

// Create a new session per call
async function analyzePromptWithGuard(message) {
  const session = await createSession({
    temperature: 0.0,
    topK: 1
  });
  const promptText = PROMPTGUARD.replace('TEMPLATE_MESSAGE', message || '');
  return await session.prompt(promptText);
}

export function handleAnalyzePromptMessage(request, sendResponse, appendLlmLog) {
  (async () => {
    try {
      const { message, platform } = request;

      // Check monitoring mode
      const { monitoringMode } = await chrome.storage.local.get(['monitoringMode']);
      const mode = monitoringMode || 'promptguard';
      if (mode === 'none') {
        sendResponse({ proceed: true, cleared: true });
        return;
      }
      if (mode === 'familycenter') {
        // Placeholder behavior until implemented
        sendResponse({ proceed: true, cleared: true });
        return;
      }

      // Show analyzing state immediately (do NOT auto-open popup)
      chrome.runtime.sendMessage({ action: 'promptguard-analyzing', platform });

      const result = await analyzePromptWithGuard(message);
      const isCleared = result.includes('Cleared_291aec') || result.includes('Placeholded_291aec');
      const isDetected = result.includes('Detected_291aec');

      await appendLlmLog({ pipeline: 'promptguard', platform, url: '', text: result });

      if (isCleared && !isDetected) {
        sendResponse({ proceed: true, cleared: true });
      } else {
        // Flagged or uncertain -> do not proceed; show popup info
        const reasoning = isDetected
          ? result.replace(/Detected_291aec.*$/, '').trim()
          : (result || 'Unable to analyze message clearly.');
        
        // Store state before sending message and opening popup
        await setPromptGuardState({ reasoning, platform, timestamp: Date.now() });
        
        chrome.runtime.sendMessage({ action: 'promptguard-flagged', reasoning, platform });
        // Auto-open only when flagged
        try {
          await chrome.action.openPopup();
        } catch (e) {
          console.warn('[PromptGuard] Failed to open popup on flag:', e);
        }
        sendResponse({ proceed: false, cleared: false });
      }
    } catch (e) {
      console.error('[PromptGuard] Analysis failed:', e);
      // Fail-open conservatively, but do not claim cleared
      sendResponse({ proceed: true, cleared: false, error: e.message });
    }
  })();
}
