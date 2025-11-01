import { initializeApp } from "./lib/firebase/firebase-app.js";
import { getAuth, signInAnonymously } from "./lib/firebase/firebase-auth.js";

// Your web app's Firebase configuration
const firebaseConfig = {
  // FILL IN YOUR CONFIG
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app); // UNUSED FIREBASE FOR NOW, DO NOT REMOVE

function el(id) {
  return document.getElementById(id);
}

// el("dbgAuth").addEventListener("click", () => {
//   signInAnonymously(auth)
//     .then(() => {
//       // Signed in..
//     })
//     .catch((error) => {
//       const errorCode = error.code;
//       const errorMessage = error.message;
//       // ...
//     });
// });

/* global Translator */
const loading = el('loading');

// Main View elements
const mainView = el('mainView');

// Result containers
const verdictContainer = el('verdictContainer');
const verdictIcon = el('verdictIcon');
const verdictText = el('verdictText');
const reasoningText = el('reasoningText');

// Chatbot idle state
const chatbotIdleContainer = el('chatbotIdleContainer');
const chatbotIdleTitle = el('chatbotIdleTitle');
const chatbotIdleText = el('chatbotIdleText');

// PromptGuard containers
const promptGuardContainer = el('promptGuardContainer');
const promptGuardReasoning = el('promptGuardReasoning');

// News Fact Check container
const newsFactContainer = el('newsFactContainer');
// const newsFactText = el('newsFactText'); // removed
const newsFactIcon = el('newsFactIcon');
const newsFactHeader = el('newsFactHeader');
const newsFactSub = el('newsFactSub');
const newsFactList = el('newsFactList');
// New: re-analyze button
const reanalyzeBtn = el('reanalyzeBtn');

// New: LLM availability elements
const llmUnavailableContainer = el('llmUnavailableContainer');
const llmDownloadContainer = el('llmDownloadContainer');
const llmDownloadBtn = el('llmDownloadBtn');
const llmDownloadProgress = el('llmDownloadProgress');
const llmProgressBar = el('llmProgressBar');
const llmProgressText = el('llmProgressText');

let currentReasoning = '';
let currentLang = 'en';
// Cache summarizer instance (optional future reuse)
let scamSummarizer = null;
// New: delay timer for news display
let newsDelayTimer = null;

const VERDICT_STYLES = {
  Scam: {
    icon: 'gpp_bad',
    text: 'Potential Scam Detected',
    color: 'red',
  },
  Marketing: {
    icon: 'campaign',
    text: 'Marketing Content',
    color: 'amber',
  },
  Benign: {
    icon: 'verified_user',
    text: 'Looks Safe',
    color: 'green',
  },
  Uncertain: {
    icon: 'help_outline',
    text: 'Uncertain',
    color: 'gray',
  },
  Error: {
    icon: 'error',
    text: 'Analysis Error',
    color: 'red',
  },
  // Ecommerce-specific
  HighRiskScam: { icon: 'gpp_bad', text: 'High-risk Scam Detected', color: 'red' },
  Warning: { icon: 'warning', text: 'Caution Recommended', color: 'amber' },
  FlashDriveScam: { icon: 'warning', text: 'Suspicious Storage Device Listing', color: 'amber' },
  Safe: { icon: 'verified', text: 'Likely Safe (Ecommerce)', color: 'green' },
  Chatbot: { icon: 'smart_toy', text: 'Chatbot Page', color: 'blue' },
  SocialMedia: { icon: 'photo_camera', text: 'Social Media Site', color: 'blue' }
};

async function initializePopup() {
  // Check for stored PromptGuard flagged state FIRST
  const promptGuardState = await new Promise(resolve => {
    chrome.runtime.sendMessage({ action: 'get-promptguard-state' }, resolve);
  });
  
  if (promptGuardState && promptGuardState.reasoning) {
    // Show flagged state and clear it
    showPromptGuardFlagged(promptGuardState.reasoning, promptGuardState.platform);
    chrome.runtime.sendMessage({ action: 'clear-promptguard-state' });
    return;
  }

  // Check LLM availability first
  const { llmAvailability } = await chrome.storage.local.get(['llmAvailability']);

  if (llmAvailability === 'unavailable') {
    showLLMUnavailable();
    return;
  }

  if (llmAvailability === 'downloadable') {
    // Show download UI, then re-check after 3s in case state flipped quickly
    showLLMDownload();
    setTimeout(async () => {
      const { llmAvailability: later } = await chrome.storage.local.get(['llmAvailability']);
      if (later === 'available') {
        // Re-init to show main content
        initializePopup();
      } else if (later === 'downloading') {
        showLLMDownloading();
      }
      // else remain on download UI
    }, 3000);
    return;
  }

  if (llmAvailability === 'downloading') {
    showLLMDownloading();
    return;
  }

  // Load saved language setting
  const data = await chrome.storage.local.get(['lang']);
  currentLang = data.lang || 'en';

  // Ask background for the correct-keyed result (uses og:url if present)
  const result = await new Promise(resolve => {
    chrome.runtime.sendMessage({ action: 'get-current-result' }, resolve);
  });

  if (!result || !result.entry) {
    // Not found -> trigger classification, keep spinner
    loading.classList.remove('hidden');
    verdictContainer.classList.add('hidden');
    chatbotIdleContainer.classList.add('hidden');
    chrome.runtime.sendMessage({ action: 'classify-current-page' });
    return;
  }

  if (result.entry.status === 'complete') {
    // If cached news results exist, show them
    if (result.entry.pipeline === 'news' && result.entry.news) {
      // New: if fake detected (Questionable), show analyzing for 2s before showing results
      if (result.entry.news.verdict === 'Questionable') {
        clearNewsDelay();
        showAnalyzing('news');
        newsDelayTimer = setTimeout(() => {
          showNewsFactCheck(result.entry.news);
        }, 2000);
      } else {
        showNewsFactCheck(result.entry.news);
      }
      return;
    }
    // Chatbot idle
    if (result.entry.verdict === 'Chatbot' && result.entry.pipeline && result.entry.pipeline.startsWith('chatbots')) {
      showChatbotIdle(result.entry);
    } else {
      showVerdict(result.entry.verdict, result.entry.reasoning);
    }
  } else if (result.entry.status === 'processing') {
    loading.classList.remove('hidden');
    verdictContainer.classList.add('hidden');
    chatbotIdleContainer.classList.add('hidden');
  } else {
    loading.classList.remove('hidden');
    verdictContainer.classList.add('hidden');
    chatbotIdleContainer.classList.add('hidden');
    chrome.runtime.sendMessage({ action: 'classify-current-page' });
  }
}

function showChatbotIdle(entry) {
  const chatbotType = entry.pipeline ? entry.pipeline.split('-')[1] : 'unknown';
  const nameMap = { google: 'Google AI Mode', chatgpt: 'ChatGPT', claude: 'Claude' };
  const chatbotName = nameMap[chatbotType] || 'Chatbot';
  const mode = entry.monitoringMode || 'none';

  chatbotIdleTitle.textContent = chatbotName;

  if (mode === 'promptguard') {
    chatbotIdleText.textContent = 'PromptGuard is active. Your messages will be scanned for sensitive data before sending to prevent accidental leaks.';
  } else if (mode === 'familycenter') {
    chatbotIdleText.textContent = 'Family Center protection is active. Messages will be monitored for signs of distress and logged for parental review. Messages are not blocked.';
  } else {
    chatbotIdleText.textContent = 'No protection is currently active. Enable PromptGuard to prevent personal information leakage or use Family Center to protect children when using chatbots.';
  }

  loading.classList.add('hidden');
  verdictContainer.classList.add('hidden');
  promptGuardContainer.classList.add('hidden');
  chatbotIdleContainer.classList.remove('hidden');
}

function showNewsFactCheck(news) {
  // Verdict-aware styles
  const isQuestionable = news?.verdict === 'Questionable';

  // If verdict is True or null (Unrelated), show simplified "no issues" view
  if (news?.verdict === 'True' || news?.verdict === null) {
    newsFactContainer.className = 'p-4 rounded-lg bg-green-50 border border-green-200';
    if (newsFactIcon) {
      newsFactIcon.className = 'material-symbols-outlined text-2xl text-green-600';
      newsFactIcon.textContent = 'check_circle';
    }
    newsFactHeader.textContent = 'News Article: No Issues Found';
    newsFactSub.textContent = 'SwiftGuardian NewsGuard';
    newsFactList.innerHTML = `<div class="text-xs text-green-700 bg-green-100 p-2 rounded">
      <strong>Disclaimer:</strong> This analysis is performed by AI and should not be considered definitive. Always verify important information through multiple trusted sources.
    </div>`;

    loading.classList.add('hidden');
    verdictContainer.classList.add('hidden');
    chatbotIdleContainer.classList.add('hidden');
    promptGuardContainer.classList.add('hidden');
    newsFactContainer.classList.remove('hidden');
    return;
  }

  // Questionable verdict - show full details
  const containerClass = isQuestionable
    ? 'hidden p-4 rounded-lg bg-amber-50 border border-amber-200'
    : 'hidden p-4 rounded-lg bg-sky-50 border border-sky-200';
  newsFactContainer.className = containerClass.replace('hidden ', '');
  if (newsFactIcon) {
    newsFactIcon.className = isQuestionable
      ? 'material-symbols-outlined text-2xl text-amber-600'
      : 'material-symbols-outlined text-2xl text-sky-600';
    newsFactIcon.textContent = isQuestionable ? 'report' : 'fact_check';
  }

  const header = isQuestionable
    ? 'Here are some articles which may provide more context.'
    : 'Fact-check Results';
  newsFactHeader.textContent = header;

  const phrase = news?.phraseUsed || '';
  newsFactSub.textContent = phrase ? `Using query: "${phrase}"` : 'News Article / Blog Post';

  // Build list
  const reviews = Array.isArray(news?.reviews) ? news.reviews : [];
  if (reviews.length) {
    const truncate = (s, n = 80) => (s && s.length > n ? s.slice(0, n - 1) + '…' : s || '');
    const items = reviews.map(r => {
      const url = r.url || '#';
      const title = truncate(r.title || url, 100);
      const pub = [r.publisherName, r.publisherSite].filter(Boolean).join(' · ');
      const rating = r.textualRating || '';
      return `<div class="mb-2 p-2 rounded bg-white/70 border border-slate-200">
        <a href="${url}" target="_blank" rel="noopener" class="text-sm font-semibold text-blue-700 hover:text-blue-900 break-words">${title}</a>
        <div class="text-xs text-slate-600 mt-1 break-words">${rating}</div>
        <div class="text-[10px] text-slate-500 mt-0.5">${pub}</div>
      </div>`;
    }).join('');
    newsFactList.innerHTML = items;
  } else {
    // No results -> show generic label
    newsFactList.innerHTML = `<div class="text-sm text-slate-700">News Article / Blog Post</div>`;
  }

  loading.classList.add('hidden');
  verdictContainer.classList.add('hidden');
  chatbotIdleContainer.classList.add('hidden');
  promptGuardContainer.classList.add('hidden');
  newsFactContainer.classList.remove('hidden');
}

// New: helper to clear any pending news delay
function clearNewsDelay() {
  if (newsDelayTimer) {
    clearTimeout(newsDelayTimer);
    newsDelayTimer = null;
  }
}

function showLLMUnavailable() {
  loading.classList.add('hidden');
  verdictContainer.classList.add('hidden');
  chatbotIdleContainer.classList.add('hidden');
  newsFactContainer.classList.add('hidden');
  promptGuardContainer.classList.add('hidden');
  llmDownloadContainer.classList.add('hidden');
  llmUnavailableContainer.classList.remove('hidden');
}

function showLLMDownload() {
  loading.classList.add('hidden');
  verdictContainer.classList.add('hidden');
  chatbotIdleContainer.classList.add('hidden');
  newsFactContainer.classList.add('hidden');
  promptGuardContainer.classList.add('hidden');
  llmUnavailableContainer.classList.add('hidden');
  llmDownloadProgress.classList.add('hidden');
  llmDownloadContainer.classList.remove('hidden');
}

function showLLMDownloading() {
  loading.classList.add('hidden');
  verdictContainer.classList.add('hidden');
  chatbotIdleContainer.classList.add('hidden');
  newsFactContainer.classList.add('hidden');
  promptGuardContainer.classList.add('hidden');
  llmUnavailableContainer.classList.add('hidden');
  llmDownloadContainer.classList.add('hidden');
  llmDownloadProgress.classList.remove('hidden');
}

function updateDownloadProgress(progress) {
  const pct = Math.max(0, Math.min(100, Math.round(progress)));
  llmProgressBar.style.width = `${pct}%`;
  llmProgressText.textContent = `${pct}%`;
}

async function showVerdict(verdict, reasoning) {
  const style = VERDICT_STYLES[verdict] || VERDICT_STYLES.Error;
  currentReasoning = reasoning;

  const colorClasses = {
    red: 'bg-red-100 text-red-800',
    amber: 'bg-amber-100 text-amber-800',
    green: 'bg-green-100 text-green-800',
    gray: 'bg-slate-100 text-slate-800',
    blue: 'bg-blue-100 text-blue-800',
  };
  const iconColorClass = {
    red: 'text-red-600',
    amber: 'text-amber-600',
    green: 'text-green-600',
    gray: 'text-slate-600',
    blue: 'text-blue-600',
  };

  verdictContainer.className = `p-4 rounded-lg flex items-start gap-3 ${colorClasses[style.color]}`;
  verdictIcon.textContent = style.icon;
  verdictIcon.className = `material-symbols-outlined text-2xl ${iconColorClass[style.color]}`;

  let finalReasoning = reasoning;

  if (currentLang !== 'en') {
    // Translate both header and reasoning
    reasoningText.textContent = 'Translating...';
    verdictText.textContent = '...';
    try {
      const response = await chrome.runtime.sendMessage({
        action: 'translate',
        text: style.text,
        reasoning,
        targetLang: currentLang
      });
      if (response && response.translatedText && response.translatedReasoning) {
        verdictText.textContent = response.translatedText;
        reasoningText.textContent = response.translatedReasoning;
        finalReasoning = response.translatedReasoning;
      } else {
        verdictText.textContent = style.text;
        reasoningText.textContent = reasoning;
        finalReasoning = reasoning;
      }
    } catch (_) {
      verdictText.textContent = style.text;
      reasoningText.textContent = reasoning;
      finalReasoning = reasoning;
    }
  } else {
    verdictText.textContent = style.text;
    reasoningText.textContent = reasoning;
    finalReasoning = reasoning;
  }

  loading.classList.add('hidden');
  verdictContainer.classList.remove('hidden');
  chatbotIdleContainer.classList.add('hidden');

  // New: cancel pending news delay when switching to verdict view
  clearNewsDelay();

  // Summarize only for Scam verdicts (if toggle enabled)
  if (verdict === 'Scam') {
    await maybeSummarizeScam(finalReasoning);
  } else {
    // No-op (legacy hide call removed)
  }
}

// No-op; legacy function kept to avoid refactors in other calls
function hideScamSummary() {
  // Intentionally empty; summaries now inline-replace reasoningText
}

// Summarizer flow for scam reasoning (translated or raw)
// Replaces the reasoningText with the summary when ready
async function maybeSummarizeScam(textToSummarize) {
  try {
    const { summarizeScamDetections } = await chrome.storage.local.get(['summarizeScamDetections']);
    if (!summarizeScamDetections) {
      return;
    }
  } catch {
    return;
  }

  if (!self.Summarizer || !reasoningText) {
    return;
  }

  const originalText = String(textToSummarize || '');

  // Avoid re-summarizing if already summarized for this exact text
  if (reasoningText.dataset.summaryFor === originalText) {
    return;
  }

  try {
    const availability = await self.Summarizer.availability();
    if (availability === 'unavailable') {
      return;
    }

    const options = {
      expectedInputLanguages: [currentLang || 'en'],
      outputLanguage: currentLang || 'en',
      type: 'key-points',
      format: 'plain-text',
      length: 'short',
      monitor(m) {
        // Use title attribute for unobtrusive status
        m.addEventListener('downloadprogress', (e) => {
          const pct = Math.round(e.loaded * 100);
          if (reasoningText) reasoningText.title = `Downloading summarizer... ${pct}%`;
        });
      }
    };

    const doSummarize = async () => {
      try {
        if (!scamSummarizer) {
          scamSummarizer = await self.Summarizer.create(options);
        }
        // Optional: show a transient status in title
        if (reasoningText) reasoningText.title = 'Summarizing...';

        const summary = await scamSummarizer.summarize(originalText, {
          context: 'You are given an explanation of why a webpage is a scam. Capture the key points and present them simply.',
        });

        if (summary && reasoningText) {
          // Replace * with *\n and show newlines
          const formatted = String(summary);
          reasoningText.style.whiteSpace = 'pre-wrap';
          reasoningText.textContent = formatted;
          reasoningText.dataset.summaryFor = originalText;
          reasoningText.title = '';
        }
      } catch (e) {
        console.warn('[Summarizer] summarize failed:', e);
        if (reasoningText) reasoningText.title = 'Summarization not available';
      }
    };

    if (availability === 'downloadable') {
      // If popup was auto-opened, we may not have user activation.
      if (navigator.userActivation && !navigator.userActivation.isActive) {
        // Invite click on the reasoning to start summarization
        if (reasoningText) {
          reasoningText.title = 'Click to download summarizer and show a short summary';
          const clickOnce = async () => {
            reasoningText.removeEventListener('click', clickOnce);
            await doSummarize();
          };
          reasoningText.addEventListener('click', clickOnce, { once: true });
        }
        return;
      }
      await doSummarize();
      return;
    }

    // availability likely 'available'
    await doSummarize();
  } catch (e) {
    console.warn('[Summarizer] Error:', e);
    if (reasoningText) reasoningText.title = 'Summarization not available';
  }
}

chrome.runtime.onMessage.addListener(async function (request) {
  if (request.action === 'scam-verdict') {
    showVerdict(request.verdict, request.reasoning);
  } else if (request.action === 'chatbot-idle') {
    // New: cancel any pending news result delay
    clearNewsDelay();
    showChatbotIdle({
      pipeline: `chatbots-${request.chatbotType}`,
      monitoringMode: request.monitoringMode
    });
  } else if (request.action === 'promptguard-analyzing') {
    // New: cancel any pending news result delay
    clearNewsDelay();
    showPromptGuardAnalyzing(request.platform);
  } else if (request.action === 'promptguard-flagged') {
    // New: cancel any pending news result delay
    clearNewsDelay();
    showPromptGuardFlagged(request.reasoning, request.platform);
  } else if (request.action === 'analyzing') {
    hideScamSummary();
    // New: cancel any pending news result delay
    clearNewsDelay();
    showAnalyzing(request.pipeline);
  } else if (request.action === 'news-factcheck') {
    hideScamSummary();
    // New: if fake detected (Questionable), show analyzing for 2s first
    if (request.verdict === 'Questionable') {
      clearNewsDelay();
      showAnalyzing('news');
      newsDelayTimer = setTimeout(() => {
        showNewsFactCheck({
          phraseUsed: request.phrase,
          reviews: request.reviews,
          verdict: request.verdict,
          reasoning: request.reasoning,
          claimTitle: request.claimTitle
        });
      }, 1000);
    } else {
      showNewsFactCheck({
        phraseUsed: request.phrase,
        reviews: request.reviews,
        verdict: request.verdict,
        reasoning: request.reasoning,
        claimTitle: request.claimTitle
      });
    }
  } else if (request.action === 'llm-availability-updated') {
    if (request.availability === 'unavailable') {
      showLLMUnavailable();
    } else if (request.availability === 'downloadable') {
      showLLMDownload();
    } else if (request.availability === 'downloading') {
      showLLMDownloading();
    } else if (request.availability === 'available') {
      // Reinitialize to show actual content
      initializePopup();
    }
  } else if (request.action === 'llm-download-progress') {
    // Ensure progress view is visible even if availability event arrived late
    showLLMDownloading();
    updateDownloadProgress(request.progress);
  }
});

if (reanalyzeBtn) {
  reanalyzeBtn.addEventListener('click', () => {
    // Show analyzing state right away
    showAnalyzing('prepass');
    // Ask background to purge cache and re-run
    chrome.runtime.sendMessage({ action: 'reanalyze-current-page' }, (res) => {
      // No-op; background will drive updates via messages
      // If needed, we could handle errors here
    });
  });
}

// New: wire up Download Model button
if (llmDownloadBtn) {
  llmDownloadBtn.addEventListener('click', () => {
    // Switch UI to progress immediately
    showLLMDownloading();
    updateDownloadProgress(0);
    // Trigger download in background
    chrome.runtime.sendMessage({ action: 'start-llm-download' }, (res) => {
      if (!res || res.ok !== true) {
        // If failed to trigger, return to download screen
        console.warn('[LLM] Failed to start model download:', res?.error);
        showLLMDownload();
      }
    });
  });
}

function showAnalyzing(pipeline) {
  // Map pipeline to friendly label
  const labelMap = {
    prepass: 'Pre-pass classification',
    ecommerce: 'Ecommerce review',
    scam: 'Scam detection',
    news: 'News fact-check'
  };
  const label = labelMap[pipeline] || 'Analysis';
  loading.classList.remove('hidden');
  verdictContainer.classList.add('hidden');
  chatbotIdleContainer.classList.add('hidden');
  promptGuardContainer.classList.add('hidden');
  newsFactContainer.classList.add('hidden');
  const loadingText = document.querySelector('#loading p');
  if (loadingText) {
    loadingText.textContent = `Analyzing (${label})...`;
  }
  // New: clear pending display timers when entering analyzing state
  clearNewsDelay();
}

function showPromptGuardAnalyzing(platform) {
  loading.classList.remove('hidden');
  verdictContainer.classList.add('hidden');
  chatbotIdleContainer.classList.add('hidden');
  promptGuardContainer.classList.add('hidden');
  const loadingText = document.querySelector('#loading p');
  if (loadingText) {
    loadingText.textContent = `Running PromptGuard on ${platform}...`;
  }
}

function showPromptGuardFlagged(reasoning, platform) {
  loading.classList.add('hidden');
  verdictContainer.classList.add('hidden');
  chatbotIdleContainer.classList.add('hidden');
  promptGuardContainer.classList.remove('hidden');

  promptGuardReasoning.textContent = reasoning || 'Sensitive data detected in your message.';
}

initializePopup();