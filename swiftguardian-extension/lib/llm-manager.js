let availabilityState = null;
let downloadProgress = 0;
const listeners = new Set();

// Check availability and cache result
export async function checkAvailability() {
  try {
    if (!self.LanguageModel) {
      availabilityState = 'unavailable';
      return availabilityState;
    }
    availabilityState = await self.LanguageModel.availability();
    console.log("a2", availabilityState);
    await chrome.storage.local.set({ llmAvailability: availabilityState });
    notifyListeners();
    return availabilityState;
  } catch (e) {
    console.error('[LLM] Availability check failed:', e);
    availabilityState = 'unavailable';
    return availabilityState;
  }
}

// Subscribe to availability changes
export function onAvailabilityChange(callback) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

function notifyListeners() {
  listeners.forEach(cb => cb(availabilityState, downloadProgress));
}

// Wrapper for creating sessions with availability check
export async function createSession(options = {}) {
  // Check availability if not cached
  await checkAvailability();

  console.log(availabilityState);

  if (availabilityState === 'unavailable') {
    throw new Error('Gemini Nano is unavailable on this device');
  }

  if (availabilityState === 'downloadable') {
    // Auto-trigger download on first session request
    console.log('[LLM] Model downloadable, initiating download...');
    const session = await self.LanguageModel.create({
      ...options,
      monitor(m) {
        m.addEventListener('downloadprogress', (e) => {
          downloadProgress = Math.round(e.loaded * 100);
          console.log(`[LLM] Downloaded ${downloadProgress}%`);
          chrome.storage.local.set({ llmDownloadProgress: downloadProgress });
          notifyListeners();
        });
        if (options.monitor) options.monitor(m);
      }
    });
    // After first create, availability should become 'available'
    await checkAvailability();
    return session;
  }

  if (availabilityState === 'downloading') {
    throw new Error('Model is currently downloading. Please wait.');
  }

  // Available - create normally
  return await self.LanguageModel.create(options);
}

// Wrapper for Translator with availability check
export async function createTranslator(options = {}) {
  if (!self.Translator) {
    throw new Error('Translator API is unavailable');
  }

  try {
    const availability = await self.Translator.availability(options);
    if (availability === 'unavailable') {
      throw new Error('Translator is unavailable on this device');
    }
    return await self.Translator.create(options);
  } catch (e) {
    console.error('[LLM] Translator creation failed:', e);
    throw e;
  }
}

// Get current state
export function getState() {
  return { availability: availabilityState, downloadProgress };
}

// Initialize on load
checkAvailability();
