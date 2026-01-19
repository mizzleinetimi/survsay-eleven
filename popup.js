// popup.js - Settings management for Survsay
document.addEventListener('DOMContentLoaded', () => {
    const micToggle = document.getElementById('floating-mic-toggle');
    const simplifyToggle = document.getElementById('simplify-mode-toggle');
    const micPositionDD = document.getElementById('mic-position');
    const languageDD = document.getElementById('transcription-language');
    const rewriteToneDD = document.getElementById('rewrite-tone');
    const rewriteLengthDD = document.getElementById('rewrite-length');
    const resetButton = document.getElementById('reset-settings');
    const apiKeyInput = document.getElementById('elevenlabs-api-key');
    const apiKeyStatus = document.getElementById('api-key-status');
    const geminiKeyInput = document.getElementById('gemini-api-key');
    const geminiKeyStatus = document.getElementById('gemini-key-status');

    const DEFAULTS = {
        micEnabled: true,
        micPosition: 'top-right',
        busyPosition: 'top-right',
        language: 'en-US',
        rewriteTone: 'original',
        rewriteLength: 'original',
        simplifyMode: false,
        elevenlabsApiKey: '',
        geminiApiKey: ''
    };

    // --- Dropdown helpers ---
    function getDropdownValue(id) {
        const el = document.getElementById(id);
        return el?.dataset.value || '';
    }

    function setDropdownValue(id, value) {
        const el = document.getElementById(id);
        if (!el) return;
        const items = el.querySelectorAll('.dropdown-item');
        let labelText = '';
        items.forEach(it => {
            const isSelected = it.getAttribute('data-value') === value;
            it.classList.toggle('selected', isSelected);
            if (isSelected) labelText = it.textContent.trim();
        });
        if (labelText) {
            el.dataset.value = value;
            const label = el.querySelector('.dropdown-label');
            if (label) label.textContent = labelText;
        }
    }

    function wireDropdown(id) {
        const el = document.getElementById(id);
        if (!el) return;
        const trigger = el.querySelector('.dropdown-trigger');
        const menu = el.querySelector('.dropdown-menu');
        if (!trigger || !menu) return;

        trigger.addEventListener('click', (e) => {
            e.stopPropagation();
            const isOpen = el.classList.toggle('open');
            trigger.setAttribute('aria-expanded', String(isOpen));
        });

        el.querySelectorAll('.dropdown-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                const value = item.getAttribute('data-value');
                setDropdownValue(id, value);
                el.classList.remove('open');
                trigger.setAttribute('aria-expanded', 'false');
                el.dispatchEvent(new Event('change', { bubbles: true }));
            });
        });
    }

    function closeAllDropdowns() {
        document.querySelectorAll('.dropdown.open').forEach(dd => {
            dd.classList.remove('open');
            const trg = dd.querySelector('.dropdown-trigger');
            if (trg) trg.setAttribute('aria-expanded', 'false');
        });
    }

    document.addEventListener('click', closeAllDropdowns);

    // Update API key status display
    function updateApiKeyStatus(key, statusEl) {
        if (!key) {
            statusEl.textContent = 'Required';
            statusEl.className = 'api-key-status';
        } else if (key.length < 20) {
            statusEl.textContent = 'Key looks too short';
            statusEl.className = 'api-key-status invalid';
        } else {
            statusEl.textContent = 'Key saved ✓';
            statusEl.className = 'api-key-status valid';
        }
    }

    // Load settings from storage and update the UI
    function loadSettings() {
        chrome.storage.sync.get(DEFAULTS, (settings) => {
            micToggle.checked = settings.micEnabled;
            simplifyToggle.checked = settings.simplifyMode;
            setDropdownValue('mic-position', settings.micPosition);
            setDropdownValue('busy-position', settings.busyPosition);
            setDropdownValue('transcription-language', settings.language);
            setDropdownValue('rewrite-tone', settings.rewriteTone);
            setDropdownValue('rewrite-length', settings.rewriteLength);
            
            // Load API keys
            if (apiKeyInput) {
                apiKeyInput.value = settings.elevenlabsApiKey || '';
                updateApiKeyStatus(settings.elevenlabsApiKey, apiKeyStatus);
            }
            if (geminiKeyInput) {
                geminiKeyInput.value = settings.geminiApiKey || '';
                updateApiKeyStatus(settings.geminiApiKey, geminiKeyStatus);
            }
        });
    }

    // Save settings to storage
    function saveSettings() {
        const settings = {
            micEnabled: micToggle.checked,
            simplifyMode: simplifyToggle.checked,
            micPosition: getDropdownValue('mic-position'),
            busyPosition: getDropdownValue('busy-position'),
            language: getDropdownValue('transcription-language'),
            rewriteTone: getDropdownValue('rewrite-tone'),
            rewriteLength: getDropdownValue('rewrite-length')
        };
        chrome.storage.sync.set(settings, () => {
            console.log('Survsay: Settings saved.');
            // Notify content scripts of the changes
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                if (tabs[0]) {
                    chrome.tabs.sendMessage(tabs[0].id, { type: 'SETTINGS_UPDATED', settings });
                }
            });
        });
    }

    // Save API key separately (with debounce)
    let apiKeySaveTimeout = null;
    function saveApiKey(inputEl, storageKey, statusEl) {
        clearTimeout(apiKeySaveTimeout);
        apiKeySaveTimeout = setTimeout(() => {
            const key = inputEl.value.trim();
            chrome.storage.sync.set({ [storageKey]: key }, () => {
                console.log('Survsay: API key saved:', storageKey);
                updateApiKeyStatus(key, statusEl);
            });
        }, 500);
    }

    // Reset settings to default values
    function resetSettings() {
        chrome.storage.sync.set(DEFAULTS, () => {
            loadSettings();
            console.log('Survsay: Settings reset to defaults.');
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                if (tabs[0]) {
                    chrome.tabs.sendMessage(tabs[0].id, { type: 'SETTINGS_UPDATED', settings: DEFAULTS });
                }
            });
        });
    }

    // Add event listeners
    micToggle.addEventListener('change', saveSettings);
    simplifyToggle.addEventListener('change', saveSettings);
    wireDropdown('mic-position');
    wireDropdown('busy-position');
    wireDropdown('transcription-language');
    wireDropdown('rewrite-tone');
    wireDropdown('rewrite-length');
    micPositionDD.addEventListener('change', saveSettings);
    const busyPositionDD = document.getElementById('busy-position');
    if (busyPositionDD) busyPositionDD.addEventListener('change', saveSettings);
    languageDD.addEventListener('change', saveSettings);
    rewriteToneDD.addEventListener('change', saveSettings);
    rewriteLengthDD.addEventListener('change', saveSettings);
    resetButton.addEventListener('click', resetSettings);
    
    // API key input listeners
    if (apiKeyInput) {
        apiKeyInput.addEventListener('input', () => saveApiKey(apiKeyInput, 'elevenlabsApiKey', apiKeyStatus));
    }
    if (geminiKeyInput) {
        geminiKeyInput.addEventListener('input', () => saveApiKey(geminiKeyInput, 'geminiApiKey', geminiKeyStatus));
    }

    // Listen for CSP block messages from the content script
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
        if (msg.type === 'CSP_BLOCKED') {
            document.querySelector('.settings-group').style.display = 'none';
            document.querySelector('.footer').style.display = 'none';
            document.getElementById('csp-warning').style.display = 'block';
        }
    });

    // Check for content script availability (CSP check)
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
            chrome.tabs.sendMessage(tabs[0].id, { type: 'PING' }, (response) => {
                if (chrome.runtime.lastError || !response || !response.ok) {
                    // Content script is not available or didn't respond
                    document.querySelector('.settings-group').style.display = 'none';
                    document.querySelector('.footer').style.display = 'none';
                    document.getElementById('csp-warning').style.display = 'block';
                } else {
                    // Content script is available, load settings
                    loadSettings();
                }
            });
        } else {
            // No active tab, just load settings
            loadSettings();
        }
    });
});
