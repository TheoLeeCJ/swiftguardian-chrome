import { NEWS_DETECTOR } from "./prompts.js";
import { createSession } from "./lib/llm-manager.js";

function extractPhrasesFromLLM(text) {
  console.log(text);
  const raw = String(text || '');
  // Remove code fences while keeping inner content
  const cleaned = raw.replace(/```/g, '').trim();

  // Prefer content between START and END (case-insensitive, non-greedy)
  const m = cleaned.match(/PHRASES_START_21093a([\s\S]*?)(?:PHRASES_END_21093a|$)/i);
  const segment = m ? m[1] : cleaned;

  // Split by pipe, semicolon, or newline; be lenient with spacing
  const parts = segment
    .split(/[|;\n\r]+/g)
    .map(s =>
      s
        // strip bullets/quotes and trailing punctuation/whitespace
        .replace(/^[\s\-•"'\u201C\u201D]+/, '')
        .replace(/["'\u201C\u201D\s;]+$/, '')
        .trim()
    )
    .filter(Boolean);

  // Deduplicate (case-insensitive), keep order, cap at 3
  const seen = new Set();
  const phrases = [];
  for (const p of parts) {
    const key = p.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      phrases.push(p);
    }
    if (phrases.length >= 3) break;
  }

  return phrases;
}

function extractHeadlineFromLLM(text) {
  const raw = String(text || '');
  const cleaned = raw.replace(/```/g, '').trim();
  
  // Extract content between HEADLINE_START and HEADLINE_END markers
  const m = cleaned.match(/HEADLINE_START_21093a\s*([\s\S]*?)(?:HEADLINE_END_21093a|$)/i);
  if (m && m[1]) {
    return m[1].trim();
  }
  
  // Fallback: no headline found
  return '';
}

export async function runNewsPipeline(imgSrc, claimTitle = '') {
  // Create session for image+text
  const session = await createSession({
    temperature: 0.2,
    topK: 3,
    expectedInputs: [{ type: 'image' }]
  });

  // Build prompt with screenshot
  const resp = await fetch(imgSrc);
  const blob = await resp.blob();
  const imageBitmap = await createImageBitmap(blob);
  const prompt = [
    {
      role: 'user',
      content: [
        { type: 'text', value: NEWS_DETECTOR },
        { type: 'image', value: imageBitmap }
      ]
    }
  ];

  // Get LLM output
  const text = (await session.prompt(prompt)) || '';

  // Robust parsing
  const phrases = extractPhrasesFromLLM(text);
  const extractedHeadline = extractHeadlineFromLLM(text);
  console.log('[SwiftGuardian][News] Phrases:', phrases);
  console.log('[SwiftGuardian][News] Extracted headline:', extractedHeadline);

  // Configuration for proxy server
  const PROXY_URL = 'http://localhost:5000/factcheck'; // NEED TO HOST THE NEWS-PROXY.PY YOURSELF
  const EXTENSION_API_KEY = "[FILL IN]";

  // Fact-check search function using proxy (no API key needed from user)
  async function searchFactCheck(query) {
    try {
      const response = await fetch(`${PROXY_URL}?query=${encodeURIComponent(query)}`, {
        headers: {
          'X-API-Key': EXTENSION_API_KEY
        }
      });
      
      if (!response.ok) {
        throw new Error(`Proxy request failed: ${response.status}`);
      }
      
      return await response.json();
    } catch (e) {
      console.error('[NewsGuard] Fact-check proxy request failed:', e);
      throw e;
    }
  }

  // Try Fact Check API sequentially until we get results
  let reviews = [];
  let phraseUsed = '';

  if (phrases.length) {
    for (const p of phrases) {
      try {
        const data = await searchFactCheck(p);
        const collected = [];
        if (Array.isArray(data.claims) && data.claims.length) {
          for (const claim of data.claims) {
            const claimReviews = Array.isArray(claim.claimReview) ? claim.claimReview : [];
            for (const r of claimReviews) {
              collected.push({
                publisherName: r?.publisher?.name || '',
                publisherSite: r?.publisher?.site || '',
                title: r?.title || '',
                url: r?.url || '',
                textualRating: ''
              });
              if (collected.length >= 3) break;
            }
            if (collected.length >= 3) break;
          }
        }
        if (collected.length > 0) {
          reviews = collected;
          phraseUsed = p;
          console.log('[SwiftGuardian][News] Using phrase:', phraseUsed, 'Reviews:', reviews);
          break;
        }
      } catch (e) {
        console.warn('[SwiftGuardian][News] FactCheck API fetch failed for phrase:', p, e);
      }
    }
  } else {
    console.warn('[SwiftGuardian][News] No phrases extracted.');
  }

  if (!phraseUsed && phrases.length) phraseUsed = phrases[0];

  // If we have reviews, run a text-only verdict prompt
  let verdict = null;
  let verdictReasoning = '';
  let verdictRawText = '';
  if (reviews.length > 0) {
    // Use extracted headline, fallback to claimTitle or phraseUsed
    const headline = extractedHeadline || claimTitle || phraseUsed || '';
    const headlineForPrompt = String(headline).slice(0, 300);
    const reviewText = reviews.map(r => {
      return [
        `Publisher: ${r.publisherName} (${r.publisherSite})`,
        `Title: ${r.title}`,
        `URL: ${r.url}`,
      ].join('\n');
    }).join('\n---\n');

    const verdictPrompt =
`You are reading about a news article titled "${headlineForPrompt}" and have obtained results for it from a search engine.
The results are as follows:
${reviewText}

First, think about what the original headline is saying for 1 sentence.
Evaluate whether the results support, are not directly related, or straight-up debunk the headline.
It's incredibly important that you only paste the False_21093a tag for the most severe conflicts. If you are unsure, label it Unrelated instead.
Then think about whether the results support, debunk or are unrelated to the headline for 1 sentence, then output either True_21093a, Unrelated_21093a or False_21093a.`;

    console.log(verdictPrompt);

    try {
      const textSession = await createSession({ temperature: 0.0, topK: 1 });
      verdictRawText = await textSession.prompt(verdictPrompt);
      // Make mutually exclusive to avoid overrides
      if (/Questionable_21093a/i.test(verdictRawText) || /False_21093a/i.test(verdictRawText)) {
        verdict = 'Questionable';
      } else if (/Unrelated_21093a/i.test(verdictRawText)) {
        verdict = null; // Unrelated -> don't show verdict
      } else if (/True_21093a/i.test(verdictRawText)) {
        verdict = 'True';
      }
      verdictReasoning = String(verdictRawText || '').replace(/(True|Questionable|Unrelated|False)_21093a/gi, '').trim();
    } catch (e) {
      console.warn('[SwiftGuardian][News] Verdict prompt failed:', e);
    }
  }

  // ratings for backward-compat
  const ratings = reviews.map(r => r.textualRating).filter(Boolean);

  return {
    phrases,
    phraseUsed,
    reviews,
    ratings,
    verdict,
    reasoning: verdictReasoning,
    claimTitle: extractedHeadline || claimTitle || '',
    verdictRawText,
    fullLlmResponse: text // Add full response for logging
  };
}
