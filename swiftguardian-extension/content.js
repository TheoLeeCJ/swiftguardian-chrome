function injectScamBanner(reasoning) {
    // Check if the banner already exists to prevent duplicates
    if (document.getElementById('swiftguardian-scam-overlay')) {
        return;
    }

    const overlay = document.createElement('div');
    overlay.id = 'swiftguardian-scam-overlay';
    overlay.style.position = 'fixed';
    overlay.style.top = '0';
    overlay.style.left = '0';
    overlay.style.width = '100vw';
    overlay.style.height = '100vh';
    overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
    overlay.style.zIndex = '2147483647';
    overlay.style.display = 'flex';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    overlay.style.fontFamily = 'sans-serif';

    overlay.innerHTML = `
        <div style="background-color: white; color: #1e293b; padding: 2rem; border-radius: 8px; max-width: 500px; width: 90%; text-align: center; box-shadow: 0 10px 15px -3px rgba(0,0,0,0.1), 0 4px 6px -2px rgba(0,0,0,0.05);">
            <svg xmlns="http://www.w3.org/2000/svg" height="48px" viewBox="0 0 24 24" width="48px" fill="#ef4444" style="margin: 0 auto 1rem;">
                <path d="M0 0h24v24H0z" fill="none"/>
                <path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/>
            </svg>
            <h1 style="font-size: 1.5rem; font-weight: bold; margin-bottom: 0.5rem;">SwiftGuardian Warning</h1>
            <p style="font-size: 1rem; margin-bottom: 1.5rem;">This page shows signs of a potential scam. If you are unsure, do not proceed or ask a trusted loved one for advice.</p>
            <blockquote style="background-color: #f1f5f9; border-left: 4px solid #e2e8f0; padding: 1rem; margin: 0 0 1.5rem 0; text-align: left; font-style: italic; color: #475569;">
                ${reasoning || 'No specific reason provided.'}
            </blockquote>
            <button id="swiftguardian-dismiss-btn" style="background-color: #3b82f6; color: white; font-weight: bold; padding: 0.75rem 1.5rem; border: none; border-radius: 6px; cursor: pointer; font-size: 1rem;">Dismiss</button>
        </div>
    `;

    document.body.prepend(overlay);

    document.getElementById('swiftguardian-dismiss-btn').addEventListener('click', () => {
        overlay.remove();
    });
}

function extractPreviewData() {
    function getMeta(property) {
        const element = document.querySelector(`meta[property="${property}"], meta[name="${property}"]`);
        return element ? element.getAttribute('content') : null;
    }

    const previewData = {};
    const ogTags = [
        'og:title','og:description','og:image','og:url','og:type','og:site_name','og:locale','og:video','og:audio'
    ];
    ogTags.forEach(tag => {
        const value = getMeta(tag);
        if (value) previewData[tag] = value;
    });

    const twitterTags = [
        'twitter:card','twitter:site','twitter:creator','twitter:title','twitter:description','twitter:image','twitter:image:alt','twitter:player'
    ];
    twitterTags.forEach(tag => {
        const value = getMeta(tag);
        if (value) previewData[tag] = value;
    });

    previewData['page:title'] = getMeta('title') || document.title;
    previewData['page:description'] = getMeta('description') || null;

    const containsMeetAIMode = document.body?.innerText?.includes('Meet AI Mode') || false;

    try { console.table(previewData); } catch (_) {}

    return { previewData, containsMeetAIMode };
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'injectScamBanner') {
        injectScamBanner(request.reasoning);
        sendResponse({ status: 'banner injected' });
        return true;
    }
    if (request.action === 'extractPreviewData') {
        const data = extractPreviewData();
        sendResponse(data);
        return true;
    }
    return true;
});
