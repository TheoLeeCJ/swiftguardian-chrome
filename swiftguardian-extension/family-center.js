import { DISTRESS_CHECKER } from "./prompts.js";
import { createSession } from "./lib/llm-manager.js";
import { initializeApp } from "./lib/firebase/firebase-app.js";
import { getAuth, signInWithCustomToken } from "./lib/firebase/firebase-auth.js";
import { getFirestore, collection, addDoc, serverTimestamp } from "./lib/firebase/firebase-firestore.js";

// Firebase configuration
const firebaseConfig = {
  // FILL IN YOUR CONFIG
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Cache for signed-in user
let currentUser = null;

// Sign in with the stored anonymous user
async function ensureSignedIn(familyUserId) {
  // If already signed in as the correct user, return
  if (currentUser && currentUser.uid === familyUserId) {
    return currentUser;
  }

  // We can't "sign in" as an existing anonymous user with just the UID
  // The user needs to stay signed in from settings.js
  // So we just check if auth.currentUser matches
  if (auth.currentUser && auth.currentUser.uid === familyUserId) {
    currentUser = auth.currentUser;
    return currentUser;
  }

  // If not signed in, we have a problem - can't authenticate
  throw new Error('User not authenticated. Please rejoin the family from settings.');
}

// Create a new session per call
async function analyzePromptForDistress(message) {
  const session = await createSession({
    temperature: 0.0,
    topK: 1
  });
  const promptText = DISTRESS_CHECKER.replace('TEMPLATE_MESSAGE', message || '');
  return await session.prompt(promptText);
}

export function handleFamilyCenterMessage(request, sendResponse, appendFamilyCenterLog, appendLlmLog) {
  (async () => {
    try {
      const { message, platform } = request;

      console.log('[FamilyCenter] Analyzing message for distress signals');

      const result = await analyzePromptForDistress(message);
      
      // Parse the new format: split by separator
      const parts = result.split('SEPARATOR_VERDICT_291aec');
      const reasoning = parts[0]?.trim() || '';
      const verdictPart = parts[1]?.trim() || result;
      
      const isCleared = verdictPart.includes('Cleared_291aec');
      const summary = isCleared ? 'No distress signals detected.' : verdictPart.replace('Cleared_291aec', '').trim();
      const analysis = isCleared ? reasoning : `${reasoning}\n\nSummary: ${summary}`;

      // Log to LLM logs for debugging
      await appendLlmLog({ pipeline: 'familycenter', platform, url: '', text: result });

      // Also log to Family Center specific logs
      await appendFamilyCenterLog({ 
        platform, 
        message: message.slice(0, 500),
        analysis: summary,
        timestamp: new Date().toISOString(),
        flagged: !isCleared
      });

      // Only send flagged events to Firestore
      if (!isCleared) {
        const { familyId, familyUserId } = await chrome.storage.local.get(['familyId', 'familyUserId']);
        if (familyId && familyUserId) {
          try {
            // Ensure we're authenticated
            await ensureSignedIn(familyUserId);

            const eventData = {
              src: familyUserId,
              type: 'distress_detected',
              platform: platform,
              timestamp: serverTimestamp(),
              messagePreview: message.slice(0, 200),
              analysis: summary,
              reasoning: reasoning,
              flagged: true
            };

            await addDoc(collection(db, 'families', familyId, 'events'), eventData);
            console.log('[FamilyCenter] Flagged event sent to Firestore');
          } catch (firestoreError) {
            console.error('[FamilyCenter] Failed to send event to Firestore:', firestoreError);
            
            // Log Firestore error to LLM logs for debugging
            await appendLlmLog({ 
              pipeline: 'familycenter-firestore-error', 
              platform, 
              url: familyId, 
              text: `Firestore Error: ${firestoreError.message}\n\nStack: ${firestoreError.stack}\n\nFamily ID: ${familyId}\nUser ID: ${familyUserId}\n\nAuth State: ${auth.currentUser ? `Signed in as ${auth.currentUser.uid}` : 'Not signed in'}` 
            });
          }
        }
      }

      if (isCleared) {
        console.log('[FamilyCenter] Message cleared - no distress signals detected');
      } else {
        console.log('[FamilyCenter] Distress signals detected - logged for review');
      }

      // Always allow the message to be sent (non-blocking)
      sendResponse({ proceed: true, cleared: isCleared, logged: true });
    } catch (e) {
      console.error('[FamilyCenter] Analysis failed:', e);
      
      // Log analysis error to LLM logs
      await appendLlmLog({ 
        pipeline: 'familycenter-analysis-error', 
        platform: request.platform || 'unknown', 
        url: '', 
        text: `Analysis Error: ${e.message}\n\nStack: ${e.stack}` 
      });
      
      // Fail-open: allow message through but don't log
      sendResponse({ proceed: true, cleared: false, error: e.message });
    }
  })();
}
