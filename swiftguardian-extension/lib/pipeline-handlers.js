import { SCAM_DET, ECOMMERCE_DET, SOCIAL_MEDIA_SCANNER } from "../prompts.js";
import { createSession } from "./llm-manager.js";
import { runNewsPipeline } from "../news.js";
import { appendLlmLog, updateProcessedUrl } from "./cache-manager.js";
import { maskUrlForPrompt } from "./url-utils.js";
import { initializeApp } from "../lib/firebase/firebase-app.js";
import { getAuth } from "../lib/firebase/firebase-auth.js";
import { getFirestore, collection, addDoc, serverTimestamp } from "../lib/firebase/firebase-firestore.js";
import { getAI, getGenerativeModel, GoogleAIBackend, InferenceMode } from "../lib/firebase/firebase-ai.js";

// Firebase configuration
const firebaseConfig = {
  // FILL IN YOUR CONFIG
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Helper: robust popup opener (focus window/tab and retry)
async function openPopupForTab(tabId) {
  try {
    await chrome.action.openPopup();
    return;
  } catch (e) {
    // Try focusing the window/tab and retry
    try {
      if (typeof tabId === 'number') {
        const tab = await chrome.tabs.get(tabId);
        if (tab && tab.windowId) {
          await chrome.windows.update(tab.windowId, { focused: true });
          try { await chrome.tabs.update(tabId, { active: true }); } catch (_) {}
        }
      }
      await chrome.action.openPopup();
    } catch (err) {
      console.warn('[SwiftGuardian] Failed to open popup:', err);
    }
  }
}

// News pipeline handler
export async function handleNewsPipeline(key, rawUrl, snap, extractor) {
  chrome.runtime.sendMessage({ action: 'analyzing', pipeline: 'news' });
  
  try {
    const pageTitle = extractor?.previewData?.['og:title']
      || extractor?.previewData?.['twitter:title']
      || extractor?.previewData?.['page:title']
      || '';
    
    const news = await runNewsPipeline(snap, pageTitle);
    
    if (news.fullLlmResponse) {
      await appendLlmLog({ pipeline: 'news', key, url: rawUrl, text: news.fullLlmResponse });
    }
    if (news.verdictRawText) {
      await appendLlmLog({ pipeline: 'news-verdict', key, url: rawUrl, text: news.verdictRawText });
    }
    
    await updateProcessedUrl(key, {
      status: 'complete',
      verdict: 'Benign',
      reasoning: 'News article detected',
      pipeline: 'news',
      news
    });

    chrome.runtime.sendMessage({
      action: 'news-factcheck',
      phrase: news.phraseUsed,
      reviews: news.reviews,
      verdict: news.verdict,
      reasoning: news.reasoning,
      claimTitle: news.claimTitle
    });

    if (news.verdict === 'Questionable') {
      // Keep existing behavior; no tabId available here
      try { await chrome.action.openPopup(); } catch (e) { console.warn('Failed to open popup for news questionable result:', e); }
    }
  } catch (e) {
    console.warn('News pipeline failed:', e);
    await updateProcessedUrl(key, {
      status: 'complete',
      verdict: 'Uncertain',
      reasoning: 'Unable to run fact-check search',
      pipeline: 'news'
    });
  }
}

// Ecommerce pipeline handler (now accepts tabId)
export async function handleEcommercePipeline(tabId, key, rawUrl, snap, extractor) {
  chrome.runtime.sendMessage({ action: 'analyzing', pipeline: 'ecommerce' });
  
  const pageTitle = extractor?.previewData?.['og:title']
    || extractor?.previewData?.['twitter:title']
    || extractor?.previewData?.['page:title']
    || '';
  
  const { verdict, reasoning, rawText } = await runEcommercePipeline(snap, pageTitle);
  await appendLlmLog({ pipeline: 'ecommerce', key, url: rawUrl, text: rawText });
  
  if (verdict === 'Rescan') {
    return 'rescan';
  }
  
  await updateProcessedUrl(key, { status: 'complete', verdict, reasoning, pipeline: 'ecommerce' });
  chrome.runtime.sendMessage({ action: 'scam-verdict', verdict, reasoning });
  // Only auto-open for Warning (not HighRiskScam)
  if (verdict === 'Warning') {
    await openPopupForTab(tabId);
  }
  
  return verdict;
}

// Scam pipeline handler
export async function handleScamPipeline(tabId, key, rawUrl, snap, extractor) {
  chrome.runtime.sendMessage({ action: 'analyzing', pipeline: 'scam' });
  
  try {
    const pageTitle = extractor?.previewData?.['og:title']
      || extractor?.previewData?.['twitter:title']
      || extractor?.previewData?.['page:title']
      || '';
    const urlForPrompt = maskUrlForPrompt(rawUrl);

    const text = await analyzeScreenshotForScam(snap, urlForPrompt, pageTitle);
    await appendLlmLog({ pipeline: 'scam', key, url: rawUrl, text });
    
    const verdictMatch = text.match(/(Scam|Marketing|Uncertain|Benign)_291aec/);
    const verdict = verdictMatch ? verdictMatch[1] : 'Error';
    const reasoning = text.replace(/(\w+)_291aec/, '').trim();

    await updateProcessedUrl(key, { status: 'complete', verdict, reasoning, pipeline: 'scam' });

    if (verdict === 'Scam') {
      chrome.scripting.executeScript({
        target: { tabId },
        files: ['content.js']
      }).then(() => {
        chrome.tabs.sendMessage(tabId, { action: 'injectScamBanner', reasoning });
      }).catch(err => console.error('Failed to inject overlay on fresh classification:', err));
    }

    chrome.runtime.sendMessage({ action: 'scam-verdict', verdict, reasoning });
    // Only auto-open for Scam
    if (verdict === 'Scam') {
      await openPopupForTab(tabId);
    }
  } catch (e) {
    console.error('Error processing page (scam pipeline):', e);
    await updateProcessedUrl(key, { status: 'complete', verdict: 'Error', reasoning: e.message, pipeline: 'scam' });
    chrome.runtime.sendMessage({ action: 'scam-verdict', verdict: 'Error', reasoning: e.message });
    // Removed automatic popup on error to comply with auto-open rules
  }
}

// Social pipeline handler - updated for Instagram posts
export async function handleSocialPipeline(key, rawUrl, snap) {
  // Check if this is an Instagram post
  const isInstagramPost = rawUrl.includes('instagram.com') && rawUrl.includes('/p/');
  
  if (!isInstagramPost || !snap) {
    // Non-Instagram or no screenshot - just mark as benign
    await updateProcessedUrl(key, {
      status: 'complete',
      verdict: 'Benign',
      reasoning: 'Social media page (not analyzed)',
      pipeline: 'social'
    });
    return;
  }

  // Check if enrolled in family
  const { familyId, familyUserId } = await chrome.storage.local.get(['familyId', 'familyUserId']);
  if (!familyId || !familyUserId) {
    console.log('[SocialScanner] Not enrolled in family, skipping Instagram post scan');
    await updateProcessedUrl(key, {
      status: 'complete',
      verdict: 'SocialMedia',
      reasoning: 'Instagram post (not enrolled in family)',
      pipeline: 'social'
    });
    return;
  }

  chrome.runtime.sendMessage({ action: 'analyzing', pipeline: 'social' });

  try {
    const { verdict, summary, rawText, isCleared } = await runSocialMediaScan(snap);
    await appendLlmLog({ pipeline: 'social-instagram', key, url: rawUrl, text: rawText });

    // Only send to Firestore if flagged (not cleared)
    if (!isCleared) {
      // Send to Firestore
      try {
        if (auth.currentUser && auth.currentUser.uid === familyUserId) {
          const eventData = {
            src: familyUserId,
            type: 'social_media_flagged',
            platform: 'instagram',
            url: rawUrl,
            timestamp: serverTimestamp(),
            messagePreview: rawUrl,
            summary: summary,
            analysis: verdict
          };

          await addDoc(collection(db, 'families', familyId, 'events'), eventData);
          console.log('[SocialScanner] Flagged Instagram post sent to Firestore');
        } else {
          console.warn('[SocialScanner] User not authenticated, cannot send to Firestore');
        }
      } catch (firestoreError) {
        console.error('[SocialScanner] Failed to send to Firestore:', firestoreError);
        await appendLlmLog({ 
          pipeline: 'social-firestore-error', 
          key, 
          url: rawUrl, 
          text: `Firestore Error: ${firestoreError.message}` 
        });
      }
    }

    await updateProcessedUrl(key, {
      status: 'complete',
      verdict: isCleared ? 'SocialMedia' : 'Warning',
      reasoning: isCleared ? 'Instagram post analyzed - no issues detected' : summary,
      pipeline: 'social-instagram-post',
      socialScan: {
        flagged: !isCleared,
        summary
      }
    });

    // Do NOT open popup for social media sites
    // Only send message if flagged, but still don't open popup
    if (!isCleared) {
      chrome.runtime.sendMessage({ 
        action: 'social-flagged', 
        summary
      });
    }
  } catch (e) {
    console.error('[SocialScanner] Failed to analyze Instagram post:', e);
    await updateProcessedUrl(key, {
      status: 'complete',
      verdict: 'Error',
      reasoning: 'Failed to analyze Instagram post',
      pipeline: 'social'
    });
  }
}

// Helper: Run ecommerce LLM analysis
async function runEcommercePipeline(imgSrc, pageTitle) {
  const session = await createSession({
    temperature: 0.25,
    topK: 3,
    expectedInputs: [{ type: 'image' }]
  });
  const response = await fetch(imgSrc);
  const blob = await response.blob();
  const imageBitmap = await createImageBitmap(blob);
  const promptText = (ECOMMERCE_DET || '').replace('TEMPLATE_PAGETITLE', pageTitle || '');
  const prompt = [{ role: 'user', content: [{ type: 'text', value: promptText }, { type: 'image', value: imageBitmap }] }];
  const text = await session.prompt(prompt);
  const m = (text || '').match(/(Safe|HighRiskScam|Warning|Uncertain|FlashDriveScam|Rescan)_291aec/);
  let verdict = m ? m[1] : 'Uncertain';
  if (verdict === 'FlashDriveScam') verdict = 'Warning';
  const reasoning = (text || '').replace(/(\w+)_291aec/, '').trim();
  return { verdict, reasoning, rawText: text };
}

// Helper: Run scam LLM analysis (replaced to use Firebase AI SDK with on-device/cloud routing)
async function analyzeScreenshotForScam(imgSrc, urlForPrompt, pageTitle) {
  try {
    // Resolve user preference for inference mode
    const { inferenceMode } = await chrome.storage.local.get(['inferenceMode']);
    const pref = inferenceMode || 'on-device';
    const mode =
      pref === 'cloud' ? InferenceMode.ONLY_IN_CLOUD :
      pref === 'allow-cloud' ? InferenceMode.PREFER_IN_CLOUD :
      InferenceMode.ONLY_ON_DEVICE; // default on-device

    // Build prompt text
    const promptText = (SCAM_DET || '')
      .replace('TEMPLATE_URL', urlForPrompt || '')
      .replace('TEMPLATE_PAGETITLE', pageTitle || '');

    // Extract base64 and mime type from data URL
    const commaIdx = (imgSrc || '').indexOf(',');
    const header = (commaIdx !== -1 ? imgSrc.substring(0, commaIdx) : 'data:image/png;base64');
    const b64 = (commaIdx !== -1 ? imgSrc.substring(commaIdx + 1) : imgSrc);
    const mimeMatch = header.match(/^data:([^;]+);base64$/i);
    const mimeType = mimeMatch ? mimeMatch[1] : 'image/png';

    // Use Firebase AI (routes on-device/cloud based on mode)
    const ai = getAI(app, { backend: new GoogleAIBackend() });
    const model = getGenerativeModel(ai, { mode });
    const result = await model.generateContent([promptText, { inlineData: {data: b64, mimeType } }]);
    const response = result.response;
    const text = await response.text();
    return text || '';
  } catch (e) {
    // Fallback: keep behavior robust if Firebase AI path fails for any reason
    console.warn('[ScamPipeline] Firebase AI path failed, falling back to on-device LLM:', e);
    try {
      const session = await createSession({
        temperature: 0.25,
        topK: 3,
        expectedInputs: [{ type: 'image' }]
      });
      const response = await fetch(imgSrc);
      const blob = await response.blob();
      const imageBitmap = await createImageBitmap(blob);
      const promptText = (SCAM_DET || '')
        .replace('TEMPLATE_URL', urlForPrompt || '')
        .replace('TEMPLATE_PAGETITLE', pageTitle || '');
      const prompt = [{ role: 'user', content: [{ type: 'text', value: promptText }, { type: 'image', value: imageBitmap }] }];
      return await session.prompt(prompt);
    } catch (fallbackErr) {
      console.error('[ScamPipeline] Fallback on-device path also failed:', fallbackErr);
      throw fallbackErr;
    }
  }
}

// Helper: Run social media scanner
async function runSocialMediaScan(imgSrc) {
  const session = await createSession({
    temperature: 0.25,
    topK: 3,
    expectedInputs: [{ type: 'image' }]
  });
  const response = await fetch(imgSrc);
  const blob = await response.blob();
  const imageBitmap = await createImageBitmap(blob);
  const prompt = [{ role: 'user', content: [{ type: 'text', value: SOCIAL_MEDIA_SCANNER }, { type: 'image', value: imageBitmap }] }];
  const text = await session.prompt(prompt);

  // Parse output - split by separator
  const parts = text.split('SEPARATOR_VERDICT_291aec').map(p => p.trim()).filter(Boolean);
  
  let reasoning = '';
  let verdict = 'Cleared_291aec';

  if (parts.length >= 1) {
    reasoning = parts[0];
  }
  if (parts.length >= 2) {
    verdict = parts[1];
  }

  const isCleared = verdict.includes('Cleared_291aec');
  const summary = isCleared ? 'No harmful content detected.' : verdict.replace('Cleared_291aec', '').trim();

  return { verdict: summary, summary, rawText: text, isCleared };
}
