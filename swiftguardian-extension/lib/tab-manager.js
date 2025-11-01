import { runExtractor } from "./extractor.js";
import { derivePageKey } from "./url-utils.js";
import { getProcessedUrl, updateProcessedUrl, deleteProcessedUrl, pageSnapshots } from "./cache-manager.js";
import { ruleBasedPrepass, runLLMPrepass } from "./pipeline-router.js";
import { handleNewsPipeline, handleEcommercePipeline, handleScamPipeline, handleSocialPipeline } from "./pipeline-handlers.js";

export let activeTabId = null;
export let debounceTimer = null;

export function setActiveTabId(id) {
  activeTabId = id;
}

// Helper: robust popup opener for cached paths
async function openPopupSafe(tabId) {
  try {
    await chrome.action.openPopup();
  } catch (e) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab && tab.windowId) {
        await chrome.windows.update(tab.windowId, { focused: true });
        try { await chrome.tabs.update(tabId, { active: true }); } catch (_) {}
      }
      await chrome.action.openPopup();
    } catch (err) {
      console.warn('[SwiftGuardian] openPopupSafe failed:', err);
    }
  }
}

// Check and inject banner/overlay for cached results
export async function checkAndInjectBanner(tabId, url) {
  if (!url || !url.startsWith('http')) return;
  
  const extractor = await runExtractor(tabId);
  const key = derivePageKey(url, extractor);
  const existingEntry = await getProcessedUrl(key);
  
  if (!existingEntry || existingEntry.status !== 'complete') return;

  // For chatbot pages: re-inject interceptor
  if (existingEntry.pipeline && existingEntry.pipeline.startsWith('chatbots')) {
    const chatbotType = existingEntry.pipeline.split('-')[1];
    if (existingEntry.monitoringMode === 'none') return;
    
    if (chatbotType === 'google' || chatbotType === 'chatgpt') {
      console.log(`[PromptGuard] Re-injecting interceptor for ${chatbotType} on revisit`);
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          files: ['chatbot-interceptor.js']
        });
      } catch (e) {
        console.warn(`[PromptGuard] Failed to re-inject interceptor:`, e);
      }
    }
    return;
  }

  // Auto-open popup for questionable news
  if (existingEntry.pipeline === 'news' && existingEntry.news && existingEntry.news.verdict === 'Questionable') {
    const news = existingEntry.news;
    chrome.runtime.sendMessage({
      action: 'news-factcheck',
      phrase: news.phraseUsed,
      reviews: news.reviews,
      verdict: news.verdict,
      reasoning: news.reasoning,
      claimTitle: news.claimTitle
    });
    try {
      await openPopupSafe(tabId);
    } catch (e) {
      console.warn('Failed to open popup for news questionable result:', e);
    }
    return;
  }

  // Inject scam overlay
  if ((existingEntry.pipeline === 'scam' || !existingEntry.pipeline) && existingEntry.verdict === 'Scam') {
    console.log(`Injecting scam overlay for known scam URL: ${key}`);
    chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js']
    }).then(async () => {
      chrome.tabs.sendMessage(tabId, { action: 'injectScamBanner', reasoning: existingEntry.reasoning });
      chrome.runtime.sendMessage({ action: 'scam-verdict', verdict: existingEntry.verdict, reasoning: existingEntry.reasoning });
      await openPopupSafe(tabId);
    }).catch(err => console.error('Failed to inject overlay script:', err));
    return;
  }

  // Show ecommerce warnings - only open for 'Warning'
  if (existingEntry.pipeline === 'ecommerce' && existingEntry.verdict === 'Warning') {
    chrome.runtime.sendMessage({ action: 'scam-verdict', verdict: existingEntry.verdict, reasoning: existingEntry.reasoning });
    await openPopupSafe(tabId);
  }
}

// Handle tab updates
export async function handleTabUpdate(tabId) {
  clearTimeout(debounceTimer);

  const tab = await chrome.tabs.get(tabId);
  if (!tab.url || !tab.url.startsWith('http')) return;

  const extractor = await runExtractor(tabId);
  const key = derivePageKey(tab.url, extractor);

  // Check for chatbot pages
  const pipeline = ruleBasedPrepass(tab.url, extractor);
  if (pipeline && pipeline.startsWith('chatbots')) {
    await handleChatbotPage(tabId, key, pipeline, extractor);
    return;
  }

  // Snapshot at 1s
  setTimeout(async () => {
    try {
      const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'png' });
      if (dataUrl) pageSnapshots.set(key, dataUrl);
    } catch (e) {
      console.warn('Snapshot capture failed:', e);
    }
  }, 1000);

  const existingEntry = await getProcessedUrl(key);

  // Show cached result
  if (existingEntry && existingEntry.status === 'complete') {
    await checkAndInjectBanner(tabId, tab.url);
    // Removed unconditional auto-open to comply with rules
    return;
  }

  if (existingEntry && existingEntry.status === 'processing') {
    console.log(`URL already processing: ${key}`);
    return;
  }

  // Debounce to 3s for classification
  debounceTimer = setTimeout(() => {
    processPage({ tabId, rawUrl: tab.url, key, extractor });
  }, 3000);
}

// Handle chatbot pages
async function handleChatbotPage(tabId, key, pipeline, extractor) {
  console.log(`[PromptGuard] Detected chatbot page: ${pipeline}`);
  const chatbotType = pipeline.split('-')[1];
  
  const { monitoringMode } = await chrome.storage.local.get(['monitoringMode']);
  const mode = monitoringMode || 'promptguard';
  
  if (mode !== 'none' && (chatbotType === 'google' || chatbotType === 'chatgpt')) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['chatbot-interceptor.js']
      });
      console.log(`[PromptGuard] Injected interceptor for ${chatbotType}`);
    } catch (e) {
      console.warn(`[PromptGuard] Failed to inject interceptor:`, e);
    }
  }

  await updateProcessedUrl(key, {
    status: 'complete',
    count: 1,
    timestamp: new Date().toISOString(),
    verdict: 'Chatbot',
    reasoning: `${chatbotType.charAt(0).toUpperCase() + chatbotType.slice(1)} chatbot page`,
    pipeline,
    monitoringMode: mode,
    keySource: extractor?.previewData?.['og:url'] ? 'og:url' : 'url',
    meta: extractor?.previewData || {}
  });
  
  chrome.runtime.sendMessage({ 
    action: 'chatbot-idle', 
    chatbotType, 
    monitoringMode: mode 
  });
}

// Process page through pipelines
export async function processPage({ tabId, rawUrl, key, extractor }) {
  const existingEntry = await getProcessedUrl(key);

  if (existingEntry && existingEntry.status !== 'processing') {
    if (existingEntry.status === 'complete') {
      console.log(`Already processed ${key}.`);
      // No auto popup here; allow banner injector to handle allowed cases
      await checkAndInjectBanner(tabId, rawUrl);
    }
    return;
  }
  
  if (existingEntry && existingEntry.status === 'processing') {
    await updateProcessedUrl(key, { count: (existingEntry.count || 1) + 1 });
    console.log(`Processing already in progress for ${key}. Count: ${existingEntry.count + 1}`);
    return;
  }

  // Mark as processing
  await updateProcessedUrl(key, {
    status: 'processing',
    count: 1,
    timestamp: new Date().toISOString(),
    pipeline: 'prepass',
    keySource: extractor?.previewData?.['og:url'] ? 'og:url' : 'url',
    meta: extractor?.previewData || {}
  });

  chrome.runtime.sendMessage({ action: 'analyzing', pipeline: 'prepass' });

  // Determine pipeline
  let pipeline = ruleBasedPrepass(rawUrl, extractor);
  
  // Safety check for chatbots
  if (pipeline && pipeline.startsWith('chatbots')) {
    await handleChatbotPage(tabId, key, pipeline, extractor);
    return;
  }

  if (pipeline === 'exclude') {
    await updateProcessedUrl(key, {
      status: 'complete',
      verdict: 'Benign',
      reasoning: 'Excluded domain',
      pipeline: 'exclude'
    });
    return;
  }

  // Run LLM prepass if no rule matched
  if (!pipeline) {
    let snap = pageSnapshots.get(key);
    if (!snap) {
      try {
        const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'png' });
        if (dataUrl) {
          pageSnapshots.set(key, dataUrl);
          snap = dataUrl;
        }
      } catch (e) {
        console.warn('Snapshot capture for prepass failed:', e);
      }
    }

    try {
      pipeline = await runLLMPrepass(key, rawUrl, snap);
      if (pipeline === 'rescan') {
        await handleRescan(tabId, rawUrl, key, extractor);
        return;
      }
    } catch (e) {
      console.warn('PREPASS failed, default to scam pipeline:', e);
      pipeline = 'scam';
    }
  }

  // Get snapshot
  let snap = pageSnapshots.get(key);
  if (!snap) {
    try {
      snap = await chrome.tabs.captureVisibleTab(null, { format: 'png' });
      pageSnapshots.set(key, snap);
    } catch (e) {
      console.warn('Snapshot capture (fallback) failed:', e);
    }
  }

  // Route to appropriate pipeline
  if (pipeline === 'news') {
    await handleNewsPipeline(key, rawUrl, snap, extractor);
  } else if (pipeline === 'ecommerce') {
    const result = await handleEcommercePipeline(tabId, key, rawUrl, snap, extractor);
    if (result === 'rescan') {
      await handleRescan(tabId, rawUrl, key, extractor);
    }
  } else if (pipeline === 'social' || pipeline === 'social-instagram-post') {
    await handleSocialPipeline(key, rawUrl, snap);
  } else {
    await handleScamPipeline(tabId, key, rawUrl, snap, extractor);
  }
}

// Handle rescan
async function handleRescan(tabId, rawUrl, key, extractor) {
  console.log(`[SwiftGuardian] Page not fully loaded, will retry in 2s: ${key}`);
  await deleteProcessedUrl(key);
  pageSnapshots.delete(key);
  setTimeout(() => {
    console.log(`[SwiftGuardian] Retrying classification for: ${key}`);
    processPage({ tabId, rawUrl, key, extractor });
  }, 2000);
}
