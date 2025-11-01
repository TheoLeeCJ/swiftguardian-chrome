(function() {
  'use strict';

  // Prevent duplicate installations
  if (window.__swiftguardian_promptguard_installed) {
    console.log('[PromptGuard] Already installed, skipping');
    return;
  }
  window.__swiftguardian_promptguard_installed = true;

  let isHandlerActive = false;
  let currentPlatform = null;
  let monitoringMode = 'promptguard'; // default

  // Memory for pass-through (PromptGuard only)
  window.__sg_lastBlockedPrompt = null;

  // Detect platform based on hostname
  const hostname = window.location.hostname;
  if (hostname.includes('chatgpt.com')) {
    currentPlatform = 'chatgpt';
  } else if (hostname.includes('google.com') && document.body?.innerText?.includes('Meet AI Mode')) {
    currentPlatform = 'google-ai';
  }

  if (!currentPlatform) {
    console.log('[SwiftGuardian] No supported chatbot platform detected');
    return;
  }

  // Get monitoring mode from storage
  chrome.storage.local.get(['monitoringMode'], (result) => {
    monitoringMode = result.monitoringMode || 'promptguard';
    console.log(`[SwiftGuardian] Monitoring mode: ${monitoringMode}`);
  });

  console.log(`[SwiftGuardian] Initializing for ${currentPlatform}`);

  // Extract message based on platform
  function extractMessage() {
    try {
      if (currentPlatform === 'chatgpt') {
        const textarea = document.getElementById('prompt-textarea');
        return textarea ? textarea.innerText : '';
      } else if (currentPlatform === 'google-ai') {
        const input = document.querySelector('[aria-label="Ask anything"]');
        return input ? input.value : '';
      }
    } catch (e) {
      console.warn('[SwiftGuardian] Failed to extract message:', e);
    }
    return '';
  }

  // Monitor input changes to clear blocked prompt memory when user edits
  function setupInputMonitor() {
    if (currentPlatform === 'chatgpt') {
      const textarea = document.getElementById('prompt-textarea');
      if (textarea) {
        textarea.addEventListener('input', () => {
          const currentMessage = extractMessage();
          if (monitoringMode === 'promptguard' && window.__sg_lastBlockedPrompt && currentMessage !== window.__sg_lastBlockedPrompt) {
            console.log('[PromptGuard] Message changed, clearing blocked prompt memory');
            window.__sg_lastBlockedPrompt = null;
          }
        });
      }
    } else if (currentPlatform === 'google-ai') {
      const input = document.querySelector('[aria-label="Ask anything"]');
      if (input) {
        input.addEventListener('input', () => {
          const currentMessage = extractMessage();
          if (monitoringMode === 'promptguard' && window.__sg_lastBlockedPrompt && currentMessage !== window.__sg_lastBlockedPrompt) {
            console.log('[PromptGuard] Message changed, clearing blocked prompt memory');
            window.__sg_lastBlockedPrompt = null;
          }
        });
      }
    }
  }

  // Request analysis from background (routes to correct handler)
  async function analyzeMessage(message) {
    return new Promise((resolve) => {
      const action = monitoringMode === 'familycenter' ? 'analyze-family-center' : 'analyze-prompt';
      chrome.runtime.sendMessage(
        { action, message, platform: currentPlatform },
        (response) => resolve(response)
      );
    });
  }

  function passthroughClick(sendButton, originalEvent) {
    isHandlerActive = true;
    sendButton.dispatchEvent(new MouseEvent('click', {
      bubbles: originalEvent.bubbles,
      cancelable: originalEvent.cancelable,
      composed: originalEvent.composed,
      view: originalEvent.view,
      detail: originalEvent.detail,
      screenX: originalEvent.screenX,
      screenY: originalEvent.screenY,
      clientX: originalEvent.clientX,
      clientY: originalEvent.clientY,
      ctrlKey: originalEvent.ctrlKey,
      altKey: originalEvent.altKey,
      shiftKey: originalEvent.shiftKey,
      metaKey: originalEvent.metaKey,
      button: originalEvent.button,
      buttons: originalEvent.buttons,
      relatedTarget: originalEvent.relatedTarget,
    }));
    isHandlerActive = false;
  }

  function passthroughEnter(target, originalEvent) {
    isHandlerActive = true;
    target.dispatchEvent(new KeyboardEvent('keydown', {
      key: originalEvent.key,
      code: originalEvent.code,
      bubbles: originalEvent.bubbles,
      cancelable: originalEvent.cancelable,
      composed: originalEvent.composed,
      keyCode: originalEvent.keyCode,
      which: originalEvent.which,
      shiftKey: originalEvent.shiftKey,
      ctrlKey: originalEvent.ctrlKey,
      altKey: originalEvent.altKey,
      metaKey: originalEvent.metaKey,
      repeat: originalEvent.repeat
    }));
    isHandlerActive = false;
  }

  // Intercept Send button clicks
  function interceptSendButton() {
    const selector = currentPlatform === 'chatgpt' 
      ? 'button[aria-label="Send prompt"]' 
      : 'button[aria-label="Send"]';
    
    const checkForButton = () => {
      const sendButton = document.querySelector(selector);
      if (!sendButton) {
        console.log(`[SwiftGuardian] Send button not yet found, retrying...`);
        setTimeout(checkForButton, 500);
        return;
      }

      sendButton.addEventListener('click', async function(originalEvent) {
        if (isHandlerActive) {
          return;
        }

        originalEvent.stopPropagation();
        originalEvent.preventDefault();

        console.log(`[SwiftGuardian] Intercepted send button click (${monitoringMode})`);

        const message = extractMessage();
        
        // Pass-through logic only for PromptGuard mode
        if (monitoringMode === 'promptguard' && window.__sg_lastBlockedPrompt && message === window.__sg_lastBlockedPrompt) {
          window.__sg_lastBlockedPrompt = null;
          console.log('[PromptGuard] Same blocked prompt detected. Passing through.');
          passthroughClick(sendButton, originalEvent);
          return;
        }

        if (!message) {
          console.log('[SwiftGuardian] No message to analyze, allowing through');
          passthroughClick(sendButton, originalEvent);
          return;
        }

        const result = await analyzeMessage(message);

        if (result && result.proceed) {
          console.log(`[SwiftGuardian] Message ${result.cleared ? 'cleared' : 'logged'}, dispatching`);
          passthroughClick(sendButton, originalEvent);
        } else {
          // Only PromptGuard blocks
          console.log('[PromptGuard] Message blocked. Click Send again to proceed anyway.');
          window.__sg_lastBlockedPrompt = message;
        }
      }, true);

      console.log('[SwiftGuardian] Send button interceptor installed');
    };

    checkForButton();
  }

  // Intercept Enter key
  function interceptEnterKey() {
    document.addEventListener('keydown', async (originalEvent) => {
      if (originalEvent.key === 'Enter' && !originalEvent.shiftKey && !isHandlerActive) {
        const target = originalEvent.target;
        
        const isRelevantInput = 
          (currentPlatform === 'chatgpt' && target.id === 'prompt-textarea') ||
          (currentPlatform === 'google-ai' && target.getAttribute('aria-label') === 'Ask anything');

        if (!isRelevantInput) {
          return;
        }

        originalEvent.preventDefault();
        originalEvent.stopPropagation();

        console.log(`[SwiftGuardian] Intercepted Enter key (${monitoringMode})`);

        const message = extractMessage();
        
        // Pass-through logic only for PromptGuard mode
        if (monitoringMode === 'promptguard' && window.__sg_lastBlockedPrompt && message === window.__sg_lastBlockedPrompt) {
          window.__sg_lastBlockedPrompt = null;
          console.log('[PromptGuard] Same blocked prompt detected. Passing through (Enter).');
          passthroughEnter(target, originalEvent);
          return;
        }

        if (!message) {
          console.log('[SwiftGuardian] No message to analyze, allowing through');
          passthroughEnter(target, originalEvent);
          return;
        }

        const result = await analyzeMessage(message);

        if (result && result.proceed) {
          console.log(`[SwiftGuardian] Message ${result.cleared ? 'cleared' : 'logged'}, dispatching`);
          passthroughEnter(target, originalEvent);
        } else {
          // Only PromptGuard blocks
          console.log('[PromptGuard] Message blocked. Press Enter again to proceed anyway.');
          window.__sg_lastBlockedPrompt = message;
        }
      }
    }, true);

    console.log('[SwiftGuardian] Enter key interceptor installed');
  }

  // Initialize interceptors after a short delay
  setTimeout(() => {
    interceptSendButton();
    interceptEnterKey();
    setupInputMonitor();
  }, 1000);

})();
