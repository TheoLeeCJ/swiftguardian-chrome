import { PREPASS } from "../prompts.js";
import { createSession } from "./llm-manager.js";
import { appendLlmLog, pageSnapshots } from "./cache-manager.js";

// Fixed-rule prepass classification
export function ruleBasedPrepass(url, previewData) {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    const isHttp = u.protocol === 'http:' || u.protocol === 'https:';
    if (!isHttp) return 'exclude';

    // exclusions
    const excludedHosts = ['bing.com', 'microsoft.com', 'gmail.com'];
    if (host.endsWith('.google.com') || excludedHosts.some(h => host.endsWith(h))) {
      // exception for chatbots: google.com page containing "Meet AI Mode"
      const meet = !!previewData?.containsMeetAIMode;
      if ((host === 'google.com' || host.endsWith('.google.com')) && meet) {
        return 'chatbots-google';
      }
      return 'exclude';
    }

    // eBay special-case: only treat item pages as ecommerce; others excluded
    if (host.endsWith('ebay.com') || host.endsWith('ebay.com.sg')) {
      return u.pathname.includes('/itm/') ? 'ecommerce' : 'exclude';
    }

    // ecommerce hosts - other platforms
    const ecommerceHosts = ['amazon.com', 'shopee.com', 'shopee.sg', 'craigslist.org', 'aliexpress.com'];
    if (ecommerceHosts.some(h => host.endsWith(h) || host === h)) return 'ecommerce';

    // social hosts - check for Instagram posts
    const socialHosts = ['tiktok.com', 'facebook.com', 'twitter.com', 'x.com', 'instagram.com'];
    if (socialHosts.some(h => host.endsWith(h))) {
      // Special handling for Instagram posts
      if (host.includes('instagram.com') && u.pathname.includes('/p/')) {
        return 'social-instagram-post';
      }
      return 'social';
    }

    // chatbots hosts
    if (host.includes('chatgpt.com')) return 'chatbots-chatgpt';
    if (host.includes('claude.ai')) return 'chatbots-claude';

    return null;
  } catch {
    return null;
  }
}

// LLM-based prepass analysis
export async function analyzePrepass(imgSrc) {
  const session = await createSession({
    temperature: 0.25,
    topK: 3,
    expectedInputs: [{ type: 'image' }]
  });
  const response = await fetch(imgSrc);
  const blob = await response.blob();
  const imageBitmap = await createImageBitmap(blob);
  const prompt = [{ role: 'user', content: [{ type: 'text', value: PREPASS }, { type: 'image', value: imageBitmap }] }];
  return await session.prompt(prompt);
}

// Run LLM prepass and determine pipeline
export async function runLLMPrepass(key, rawUrl, snap) {
  if (!snap) return null;

  const prepassVerdict = await analyzePrepass(snap);
  if (prepassVerdict) {
    await appendLlmLog({ pipeline: 'prepass', key, url: rawUrl, text: prepassVerdict });
  }

  const m = (prepassVerdict || '').match(/(BlogPost|NewsArticle|Other|Rescan|Ecommerce)_291aec/i);
  const label = m ? m[1] : 'Other';
  
  if (label === 'NewsArticle') return 'news';
  if (label === 'Ecommerce') return 'ecommerce';
  if (label === 'Rescan') return 'rescan';
  return 'scam';
}
