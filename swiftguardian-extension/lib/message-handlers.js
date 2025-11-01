import { runExtractor } from "./extractor.js";
import { derivePageKey } from "./url-utils.js";
import { getProcessedUrl, deleteProcessedUrl, pageSnapshots, getPromptGuardState, clearPromptGuardState } from "./cache-manager.js";
import { processPage } from "./tab-manager.js";
import { createSession, createTranslator } from "./llm-manager.js";
import { handleAnalyzePromptMessage } from "../promptguard.js";
import { handleFamilyCenterMessage } from "../family-center.js";
import { appendLlmLog, appendFamilyCenterLog } from "./cache-manager.js";

export function registerMessageHandlers() {
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    const handlers = {
      'classify-current-page': handleClassifyCurrentPage,
      'get-current-result': handleGetCurrentResult,
      'analyze-prompt': handleAnalyzePrompt,
      'analyze-family-center': handleAnalyzeFamilyCenter,
      'monitoring-mode-updated': handleMonitoringModeUpdated,
      'reanalyze-current-page': handleReanalyzePage,
      'start-llm-download': handleStartLLMDownload,
      'translate': handleTranslate,
      'get-promptguard-state': handleGetPromptGuardState,
      'clear-promptguard-state': handleClearPromptGuardState
    };

    const handler = handlers[request.action];
    if (handler) {
      handler(request, sender, sendResponse);
      return true; // Async response
    }
    
    return false;
  });
}

async function handleClassifyCurrentPage(request, sender, sendResponse) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab && tab.id && tab.url) {
    const extractor = await runExtractor(tab.id);
    const key = derivePageKey(tab.url, extractor);
    await processPage({ tabId: tab.id, rawUrl: tab.url, key, extractor });
  }
  sendResponse({ ok: true });
}

async function handleGetCurrentResult(request, sender, sendResponse) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id || !tab.url) return sendResponse(null);
    
    const extractor = await runExtractor(tab.id);
    const key = derivePageKey(tab.url, extractor);
    const entry = await getProcessedUrl(key);
    
    sendResponse({ key, entry });
  } catch (e) {
    console.warn('get-current-result failed:', e);
    sendResponse(null);
  }
}

function handleAnalyzePrompt(request, sender, sendResponse) {
  handleAnalyzePromptMessage(request, sendResponse, appendLlmLog);
}

function handleAnalyzeFamilyCenter(request, sender, sendResponse) {
  handleFamilyCenterMessage(request, sendResponse, appendFamilyCenterLog, appendLlmLog);
}

async function handleMonitoringModeUpdated(request, sender, sendResponse) {
  try {
    const mode = request.mode;
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id || !tab.url || !tab.url.startsWith('http')) {
      return sendResponse({ ok: true });
    }
    
    const extractor = await runExtractor(tab.id);
    const key = derivePageKey(tab.url, extractor);
    const entry = await getProcessedUrl(key);
    
    if (entry && entry.pipeline && entry.pipeline.startsWith('chatbots')) {
      const { processedUrls } = await chrome.storage.local.get(['processedUrls']);
      processedUrls[key] = { ...entry, monitoringMode: mode };
      await chrome.storage.local.set({ processedUrls });
      
      const chatbotType = entry.pipeline.split('-')[1];

      if (mode === 'none') {
        await chrome.tabs.reload(tab.id);
      } else {
        try {
          await chrome.scripting.executeScript({ 
            target: { tabId: tab.id }, 
            files: ['chatbot-interceptor.js'] 
          });
          console.log(`[PromptGuard] Interceptor armed for ${chatbotType}`);
        } catch (e) {
          console.warn('[PromptGuard] Failed to arm interceptor:', e);
        }
        chrome.runtime.sendMessage({ 
          action: 'chatbot-idle', 
          chatbotType, 
          monitoringMode: mode 
        });
      }
    }
    sendResponse({ ok: true });
  } catch (e) {
    console.warn('monitoring-mode-updated failed:', e);
    sendResponse({ ok: false, error: e.message });
  }
}

async function handleReanalyzePage(request, sender, sendResponse) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id || !tab.url || !tab.url.startsWith('http')) {
      return sendResponse({ ok: false, error: 'No active http(s) tab' });
    }
    
    const extractor = await runExtractor(tab.id);
    const key = derivePageKey(tab.url, extractor);

    await deleteProcessedUrl(key);
    pageSnapshots.delete(key);

    try {
      const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
      if (dataUrl) pageSnapshots.set(key, dataUrl);
    } catch (e) {
      console.warn('Fresh snapshot capture failed (reanalyze):', e);
    }

    chrome.runtime.sendMessage({ action: 'analyzing', pipeline: 'prepass' });
    await processPage({ tabId: tab.id, rawUrl: tab.url, key, extractor });

    sendResponse({ ok: true });
  } catch (e) {
    console.warn('reanalyze-current-page failed:', e);
    sendResponse({ ok: false, error: e.message });
  }
}

async function handleStartLLMDownload(request, sender, sendResponse) {
  try {
    await createSession({ temperature: 0.0, topK: 1 });
    sendResponse({ ok: true });
  } catch (e) {
    console.error('[LLM] Download trigger failed:', e);
    sendResponse({ ok: false, error: e.message });
  }
}

async function handleTranslate(request, sender, sendResponse) {
  try {
    const translator = await createTranslator({
      sourceLanguage: 'en',
      targetLanguage: request.targetLang
    });
    const translatedText = await translator.translate(request.text);
    const translatedReasoning = await translator.translate(request.reasoning);
    sendResponse({ translatedText, translatedReasoning });
  } catch (e) {
    console.error('[LLM] Translation failed:', e);
    sendResponse({ error: e.message });
  }
}

async function handleGetPromptGuardState(request, sender, sendResponse) {
  try {
    const state = await getPromptGuardState();
    sendResponse(state);
  } catch (e) {
    console.warn('get-promptguard-state failed:', e);
    sendResponse(null);
  }
}

async function handleClearPromptGuardState(request, sender, sendResponse) {
  try {
    await clearPromptGuardState();
    sendResponse({ ok: true });
  } catch (e) {
    console.warn('clear-promptguard-state failed:', e);
    sendResponse({ ok: false });
  }
}
