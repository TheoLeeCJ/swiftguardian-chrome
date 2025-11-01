import { initializeApp } from "./lib/firebase/firebase-app.js";
import { getAuth, signInAnonymously } from "./lib/firebase/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, serverTimestamp } from "./lib/firebase/firebase-firestore.js";

// Firebase configuration
const firebaseConfig = {
  // FILL IN YOUR CONFIG
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const lang = document.getElementById('lang');
const monitoringMode = document.getElementById('monitoringMode');
const debugBtn = document.getElementById('debugBtn');
const debugLLMBtn = document.getElementById('debugLLMBtn');
const clearHistoryBtn = document.getElementById('clearHistoryBtn');
const debugDisplay = document.getElementById('debugDisplay');
const debugContent = document.getElementById('debugContent');
const closeDebugBtn = document.getElementById('closeDebugBtn');
const debugFamilyCenterBtn = document.getElementById('debugFamilyCenterBtn');
// New: scam summary toggle
const summarizeScamDetections = document.getElementById('summarizeScamDetections');

// Family Center elements
const familyNotJoined = document.getElementById('familyNotJoined');
const familyJoined = document.getElementById('familyJoined');
const joinFamilyBtn = document.getElementById('joinFamilyBtn');
const familyNameDisplay = document.getElementById('familyNameDisplay');

// Debug buttons
const clearFamilyBtn = document.getElementById('clearFamilyBtn');
// New: inference mode element
const inferenceMode = document.getElementById('inferenceMode');

// Load saved settings
chrome.storage.local.get(['lang', 'monitoringMode', 'familyId', 'familyName', 'summarizeScamDetections', 'inferenceMode'], (result) => {
  if (result.lang) {
    lang.value = result.lang;
  }
  if (result.monitoringMode) {
    monitoringMode.value = result.monitoringMode;
  } else {
    monitoringMode.value = 'promptguard';
  }

  // New: apply scam summary toggle (default off)
  if (summarizeScamDetections) {
    summarizeScamDetections.checked = !!result.summarizeScamDetections;
  }

  // New: apply inference mode (default on-device)
  if (inferenceMode) {
    inferenceMode.value = result.inferenceMode || 'on-device';
  }

  // Update Family Center UI
  updateFamilyUI(result.familyId, result.familyName);
});

function updateFamilyUI(familyId, familyName) {
  if (familyId && familyName) {
    familyNotJoined.classList.add('hidden');
    familyJoined.classList.remove('hidden');
    familyNameDisplay.textContent = familyName;
  } else {
    familyNotJoined.classList.remove('hidden');
    familyJoined.classList.add('hidden');
  }
}

// Join Family by Pairing Code
joinFamilyBtn.addEventListener('click', async () => {
  const pairingCode = prompt('Enter 8-digit pairing code:');
  if (!pairingCode || pairingCode.length !== 8) {
    alert('Invalid pairing code. Please enter an 8-digit code.');
    return;
  }

  // Check if user is already authenticated, if not sign in anonymously
  let userId;
  if (auth.currentUser) {
    userId = auth.currentUser.uid;
    console.log('[FamilyCenter] Using existing auth:', userId);
  } else {
    console.log('[FamilyCenter] No user found, signing in anonymously...');
    const userCredential = await signInAnonymously(auth);
    userId = userCredential.user.uid;
    console.log('[FamilyCenter] Signed in anonymously:', userId);
  }

  try {
    // Get pairing code document directly by ID (the code itself is the document ID)
    const pairingDocRef = doc(db, 'pairingCodes', pairingCode);
    const pairingDoc = await getDoc(pairingDocRef);

    if (!pairingDoc.exists()) {
      alert('Invalid or expired pairing code. Please check and try again.');
      return;
    }

    const pairingData = pairingDoc.data();
    console.log('[FamilyCenter] Found pairing code:', pairingData);

    // Verify the pairing code hasn't expired (10 minutes = 600000 ms)
    const now = Date.now();
    const codeAge = now - pairingData.createdTime;
    
    if (codeAge > 600000) {
      alert('Pairing code has expired. Please request a new one from the family owner.');
      return;
    }

    // Prompt for member name
    const memberName = prompt('Enter your name:');
    if (!memberName || !memberName.trim()) {
      alert('Name is required to join the family.');
      return;
    }
    
    console.log('[FamilyCenter] Auth will remain active for Firestore writes');

    // Add member to the family's members subcollection
    const memberRef = doc(db, 'families', pairingData.familyId, 'members', userId);
    await setDoc(memberRef, {
      role: 'member',
      name: memberName.trim(),
      joinedAt: serverTimestamp()
    });

    console.log('[FamilyCenter] Successfully joined family');

    // Get family name from the pairing data
    const familyName = pairingData.familyName || 'Family';

    // Save to local storage
    await chrome.storage.local.set({
      familyId: pairingData.familyId,
      familyName: familyName,
      familyUserId: userId
    });

    // Update UI
    updateFamilyUI(pairingData.familyId, familyName);
    alert(`Successfully joined ${familyName}!`);

  } catch (error) {
    console.error('[FamilyCenter] Error joining family:', error);
    alert(`Failed to join family: ${error.message}`);
  }
});

// Save language setting
lang.addEventListener('change', async () => {
  await chrome.storage.local.set({ lang: lang.value });
  console.log('Language preference saved:', lang.value);
});

// Save monitoring mode setting
monitoringMode.addEventListener('change', async () => {
  await chrome.storage.local.set({ monitoringMode: monitoringMode.value });
  console.log('Monitoring mode saved:', monitoringMode.value);
  chrome.runtime.sendMessage({ action: 'monitoring-mode-updated', mode: monitoringMode.value }, (res) => {
    if (!res || res.ok !== true) {
      console.warn('Failed to apply monitoring mode immediately:', res?.error);
    }
  });
});

// New: Save inference mode setting
if (inferenceMode) {
  inferenceMode.addEventListener('change', async () => {
    await chrome.storage.local.set({ inferenceMode: inferenceMode.value });
    console.log('Inference mode saved:', inferenceMode.value);
  });
}

// New: Save scam summary toggle
if (summarizeScamDetections) {
  summarizeScamDetections.addEventListener('change', async () => {
    await chrome.storage.local.set({ summarizeScamDetections: summarizeScamDetections.checked });
    console.log('Summarise scam detections:', summarizeScamDetections.checked);
  });
}

// Debug Info
debugBtn.addEventListener('click', async () => {
  debugDisplay.classList.remove('hidden');
  debugContent.textContent = 'Loading debug info...';

  const { processedUrls } = await chrome.storage.local.get(['processedUrls']);
  console.log(processedUrls);

  if (processedUrls) {
    const recentJobs = Object.entries(processedUrls)
      .sort(([, a], [, b]) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, 10); // Show more entries on settings page

    if (recentJobs.length > 0) {
      debugContent.innerHTML = recentJobs.map(([url, data]) =>
        `<div class="mb-3 pb-3 border-b border-slate-300">
          <div class="font-bold mb-1">Key:</div>
          <div class="text-slate-600 mb-2 break-all">${url}</div>
          <pre class="whitespace-pre-wrap">${JSON.stringify(data, null, 2)}</pre>
        </div>`
      ).join('');
    } else {
      debugContent.textContent = 'No jobs found in storage.';
    }
  } else {
    debugContent.textContent = 'No job data found in storage.';
  }
});

// LLM Logs
debugLLMBtn.addEventListener('click', async () => {
  debugDisplay.classList.remove('hidden');
  debugContent.textContent = 'Loading LLM logs...';

  const { llmLogs } = await chrome.storage.local.get(['llmLogs']);

  if (Array.isArray(llmLogs) && llmLogs.length) {
    const items = llmLogs.slice().reverse().map(log => {
      const urlShort = (log.url || '').slice(0, 150);
      const textShort = (log.text || '').slice(0, 2000);
      return `<div class="mb-3 pb-3 border-b border-slate-300">
        <div class="font-bold">${log.pipeline}</div>
        <div class="text-slate-500 text-[10px]">${new Date(log.timestamp).toLocaleString()}</div>
        ${urlShort ? `<div class="text-slate-600 text-[10px] break-all mt-1">${urlShort}</div>` : ''}
        <pre class="mt-2 whitespace-pre-wrap bg-white p-2 rounded">${textShort}</pre>
      </div>`;
    }).join('');
    debugContent.innerHTML = items;
  } else {
    debugContent.textContent = 'No LLM logs yet.';
  }
});

// Family Center Logs
debugFamilyCenterBtn.addEventListener('click', async () => {
  debugDisplay.classList.remove('hidden');
  debugContent.textContent = 'Loading Family Center logs...';

  const { familyCenterLogs } = await chrome.storage.local.get(['familyCenterLogs']);

  if (Array.isArray(familyCenterLogs) && familyCenterLogs.length) {
    const items = familyCenterLogs.slice().reverse().map(log => {
      const flaggedClass = log.flagged ? 'border-amber-500 bg-amber-50' : 'border-green-500 bg-green-50';
      const flaggedIcon = log.flagged ? '⚠️' : '✅';
      const messagePreview = (log.message || '').slice(0, 150);
      const analysis = (log.analysis || '').slice(0, 500);
      
      return `<div class="mb-3 pb-3 border-b-2 ${flaggedClass} p-3 rounded">
        <div class="flex items-center gap-2 mb-2">
          <span class="text-2xl">${flaggedIcon}</span>
          <div>
            <div class="font-bold">${log.platform || 'Unknown'} - ${log.flagged ? 'Flagged' : 'Cleared'}</div>
            <div class="text-slate-500 text-[10px]">${new Date(log.timestamp).toLocaleString()}</div>
          </div>
        </div>
        <div class="bg-white p-2 rounded mb-2">
          <div class="text-xs font-semibold mb-1">Message:</div>
          <div class="text-sm text-slate-700">${messagePreview}${messagePreview.length >= 150 ? '...' : ''}</div>
        </div>
        <div class="bg-white p-2 rounded">
          <div class="text-xs font-semibold mb-1">Analysis:</div>
          <pre class="text-xs text-slate-700 whitespace-pre-wrap">${analysis}</pre>
        </div>
      </div>`;
    }).join('');
    debugContent.innerHTML = items || '<p>No logs to display.</p>';
  } else {
    debugContent.textContent = 'No Family Center logs yet.';
  }
});

// Clear History
clearHistoryBtn.addEventListener('click', async () => {
  if (confirm('Are you sure you want to clear all history and logs?')) {
    await chrome.storage.local.set({ processedUrls: {}, llmLogs: [], familyCenterLogs: [] });
    debugContent.textContent = 'History and logs cleared.';
    console.log('All history and logs cleared.');
  }
});

// Clear Family Data
clearFamilyBtn.addEventListener('click', async () => {
  if (confirm('Are you sure you want to clear family data? This will remove you from the family and reset the Family Center.')) {
    try {
      // Sign out to clear Firebase auth state
      const { getAuth, signOut } = await import("./lib/firebase/firebase-auth.js");
      const auth = getAuth();
      if (auth.currentUser) {
        await signOut(auth);
        console.log('[FamilyCenter] Signed out from Firebase');
      }

      // Clear family-related data from local storage
      await chrome.storage.local.remove(['familyId', 'familyName', 'familyUserId']);
      
      // Update UI
      updateFamilyUI(null, null);
      
      console.log('[FamilyCenter] Family data cleared');
      alert('Family data cleared successfully. You can now join a different family.');
    } catch (error) {
      console.error('[FamilyCenter] Error clearing family data:', error);
      alert(`Failed to clear family data: ${error.message}`);
    }
  }
});

// Close Debug Display
closeDebugBtn.addEventListener('click', () => {
  debugDisplay.classList.add('hidden');
});
