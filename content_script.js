// Survsay - content_script.js
// Voice-to-form filling powered by ElevenLabs Scribe v2 + Firebase Gemini

// --- Helper Functions & State ---

function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result.split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

let recordingState = {
    isRecording: false,
    isInitializing: false,
    isStopping: false,
    mediaRecorder: null,
    chunks: [],
    audioContext: null,
    analyser: null,
    sourceNode: null,
    rafId: null,
    currentStream: null,
    recognizer: null,
    fallbackTranscript: '',
    activeForm: null,
};

// --- Busy Overlay (uses brand palette) ---
const SURVSAY_PALETTE = ['#696FC7', '#A7AAE1', '#F5D3C4', '#F2AEBB'];

function ensureBusyUI() {
    return new Promise((resolve) => {
        if (document.getElementById('survsay-busy')) {
            resolve();
            return;
        }

        chrome.storage.sync.get({ busyPosition: 'top-right' }, (settings) => {
            const pos = settings.busyPosition || 'top-right';
            let positionStyles = '';
            if (pos === 'top-right') positionStyles = 'top:16px;right:16px;';
            else if (pos === 'top-left') positionStyles = 'top:16px;left:16px;';
            else if (pos === 'bottom-right') positionStyles = 'bottom:16px;right:16px;';
            else if (pos === 'bottom-left') positionStyles = 'bottom:16px;left:16px;';

            const style = document.createElement('style');
            style.id = 'survsay-busy-style';
            style.textContent = `
            .survsay-hidden{display:none !important}
            #survsay-busy{position:fixed;${positionStyles}z-index:2147483647;display:flex;align-items:center;gap:12px;padding:10px 14px;border-radius:14px;background:rgba(255,255,255,0.9);backdrop-filter:saturate(120%) blur(6px);border:1px solid #e8e7f5;box-shadow:0 10px 25px rgba(0,0,0,.08)}
            #survsay-busy .spinner{width:22px;height:22px;border-radius:50%;position:relative;overflow:hidden;animation:survsay-rotate 1.1s linear infinite}
            #survsay-busy .spinner::before{content:'';position:absolute;inset:0;border-radius:50%;padding:2px;background:conic-gradient(${SURVSAY_PALETTE.join(',')});-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask-composite:exclude;}
            #survsay-busy .dot{position:absolute;inset:4px;border-radius:50%;background:linear-gradient(135deg, ${SURVSAY_PALETTE[1]}, #fff)}
            #survsay-busy .label{font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,Cantarell,'Noto Sans',sans-serif;font-size:13px;font-weight:600;color:#3b3b55}
            #survsay-busy .progress{height:3px;border-radius:999px;background:#f2f2f8;overflow:hidden;margin-top:6px}
            #survsay-busy .bar{width:35%;height:100%;background:linear-gradient(90deg, ${SURVSAY_PALETTE.join(',')});border-radius:999px;animation:survsay-indet 1.4s ease-in-out infinite}
            @keyframes survsay-rotate{to{transform:rotate(360deg)}}
            @keyframes survsay-indet{0%{margin-left:-40%}50%{margin-left:60%}100%{margin-left:120%}}
        `;
            document.head.appendChild(style);

            const box = document.createElement('div');
            box.id = 'survsay-busy';
            box.className = 'survsay-hidden';
            box.innerHTML = `
            <div class="spinner"><div class="dot"></div></div>
            <div style="display:flex;flex-direction:column;gap:2px;min-width:160px">
                <div class="label">Survsay is filling your form…</div>
                <div class="progress"><div class="bar"></div></div>
            </div>
        `;
            document.body.appendChild(box);
            resolve();
        });
    });
}

async function showBusy(message) {
    await ensureBusyUI();
    const box = document.getElementById('survsay-busy');
    const label = box.querySelector('.label');
    label.textContent = message || 'Survsay is filling your form…';
    box.classList.remove('survsay-hidden');
}

function hideBusy() {
    const box = document.getElementById('survsay-busy');
    if (box) box.classList.add('survsay-hidden');
}

function init() {
    return new Promise((resolve) => {
        chrome.storage.sync.get({ micEnabled: true }, (settings) => {
            if (settings.micEnabled) {
                attachMicsToForms();
            }
            resolve();
        });
    });
}

function attachMicsToForms() {
    const forms = document.querySelectorAll('form');
    const divForms = findDivForms();
    const allForms = [...forms, ...divForms];

    allForms.forEach((form, index) => {
        const micId = `survsay-floating-mic-${index}`;
        if (document.getElementById(micId)) return;

        const el = document.createElement('button');
        el.id = micId;
        el.classList.add('survsay-floating-mic');
        el.style.position = 'absolute';
        el.style.background = 'white';
        el.style.color = 'black';
        el.style.border = '1px solid #696FC7';
        el.style.borderRadius = '8px';
        el.style.padding = '8px 16px';
        el.style.boxShadow = '0 4px 14px rgba(0,0,0,0.15)';
        el.style.display = 'flex';
        el.style.alignItems = 'center';
        el.style.gap = '8px';
        el.style.cursor = 'pointer';
        el.style.zIndex = 2147483646;
        el.style.fontFamily = 'sans-serif';
        el.style.fontSize = '12px';
        el.style.fontWeight = 'normal';
        el.style.transition = 'all 0.2s ease-in-out';
        el.style.opacity = '0';
        el.style.transform = 'translateY(5px)';

        const isSearchForm = (
            form.matches('[role="search"]') ||
            form.closest('[role="search"]') ||
            !!form.querySelector('input[type="search"], input[placeholder*="search" i], input[aria-label*="search" i], input[name="q" i], input[name*="search" i]')
        );
        el.dataset.survsayContext = isSearchForm ? 'search' : 'form';
        el.title = isSearchForm ? 'Search with Survsay' : 'Fill this form with Survsay';

        const logoImg = `<img src="${chrome.runtime.getURL('logo.PNG')}" alt="Survsay" style="width:30px;height:30px;object-fit:contain;border-radius:3px;" />`;
        el.innerHTML = `${logoImg}`;

        document.body.appendChild(el);

        const setPosition = () => {
            const formRect = form.getBoundingClientRect();
            chrome.storage.sync.get({ micPosition: 'top-right' }, (settings) => {
                let pos = settings.micPosition;
                el.style.position = 'fixed';

                let topPos = 0;
                if (pos.includes('top')) {
                    topPos = formRect.top - el.offsetHeight - 5;
                } else {
                    topPos = formRect.bottom + 5;
                }

                if (topPos < 0) {
                    el.style.top = `${formRect.top + 10}px`;
                    el.style.left = `${formRect.right - el.offsetWidth - 10}px`;
                    return;
                }

                if (pos.includes('bottom')) {
                    const buttonBottom = formRect.bottom + el.offsetHeight + 5;
                    if (buttonBottom > window.innerHeight) {
                        pos = pos.replace('bottom', 'top');
                    }
                }

                if (pos.includes('top')) {
                    el.style.top = `${formRect.top - el.offsetHeight - 5}px`;
                } else {
                    el.style.top = `${formRect.bottom + 5}px`;
                }

                if (pos.includes('left')) {
                    el.style.left = `${formRect.left}px`;
                } else {
                    el.style.left = `${formRect.right - el.offsetWidth}px`;
                }
            });
        };

        el.__survsay_reposition = setPosition;
        setTimeout(setPosition, 100);
        window.addEventListener('resize', setPosition);

        let hideTimeout;
        const show = () => {
            clearTimeout(hideTimeout);
            el.style.opacity = '1';
            el.style.transform = 'translateY(0)';
        };
        const hide = () => {
            if (recordingState.isRecording && el.classList.contains('survsay-recording')) return;
            hideTimeout = setTimeout(() => {
                el.style.opacity = '0';
                el.style.transform = 'translateY(5px)';
            }, 300);
        };

        form.addEventListener('mouseenter', show);
        form.addEventListener('mouseleave', hide);
        el.addEventListener('mouseenter', show);
        el.addEventListener('mouseleave', hide);

        el.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (recordingState.isInitializing || recordingState.isStopping) return;
            if (!recordingState.isRecording) { await handleStartRecording(el, form); } else { await handleStopRecording(el); }
        });
    });
}

function removeAllMics() {
    const mics = document.querySelectorAll('.survsay-floating-mic');
    mics.forEach(mic => {
        window.removeEventListener('resize', mic.__survsay_reposition);
        mic.remove();
    });
}

async function handleStartRecording(el, form) {
    recordingState.isInitializing = true;
    recordingState.activeForm = form;
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        recordingState.currentStream = stream;

        recordingState.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        recordingState.sourceNode = recordingState.audioContext.createMediaStreamSource(stream);
        recordingState.analyser = recordingState.audioContext.createAnalyser();
        recordingState.analyser.fftSize = 2048;
        recordingState.sourceNode.connect(recordingState.analyser);

        recordingState.mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
        recordingState.chunks = [];
        recordingState.mediaRecorder.ondataavailable = e => e.data.size && recordingState.chunks.push(e.data);
        recordingState.mediaRecorder.onstop = async () => {
            const blob = new Blob(recordingState.chunks, { type: 'audio/webm' });
            await processRecording(blob, recordingState.fallbackTranscript);
            cleanupAudioResources();
        };
        recordingState.mediaRecorder.start(100);

        // Start Web Speech API as fallback
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (SpeechRecognition) {
            recordingState.recognizer = new SpeechRecognition();
            recordingState.recognizer.lang = 'en-US';
            recordingState.recognizer.interimResults = true;
            recordingState.recognizer.continuous = true;
            recordingState.fallbackTranscript = '';
            recordingState.recognizer.onresult = (ev) => {
                let transcript = '';
                for (let i = 0; i < ev.results.length; i++) {
                    transcript += ev.results[i][0].transcript + ' ';
                }
                if (transcript.trim()) recordingState.fallbackTranscript = transcript.trim();
            };
            recordingState.recognizer.start();
        }

        recordingState.isRecording = true;
        el.classList.add('survsay-recording');
        el.classList.add('survsay-recording-pulse');
        el.style.background = '#DC2626';
        el.style.color = 'white';
        el.title = 'Survsay - Click to stop recording';
    } catch (err) {
        console.error('Survsay: Failed to start recording:', err);
        cleanupAudioResources();
    }
    recordingState.isInitializing = false;
}

async function handleStopRecording(el) {
    recordingState.isStopping = true;
    if (recordingState.recognizer) recordingState.recognizer.stop();
    if (recordingState.mediaRecorder && recordingState.mediaRecorder.state !== 'inactive') recordingState.mediaRecorder.stop();
    else cleanupAudioResources();
    el.classList.remove('survsay-recording');
    el.classList.remove('survsay-recording-pulse');
    el.style.background = 'white';
    el.style.color = 'black';
    el.title = (el.dataset && el.dataset.survsayContext === 'search') ? 'Search with Survsay' : 'Fill this form with Survsay';
    const logoImg = `<img src="${chrome.runtime.getURL('logo.PNG')}" alt="Survsay" style="width:14px;height:14px;object-fit:contain;border-radius:3px;" />`;
    el.innerHTML = `${logoImg}`;
    recordingState.isStopping = false;
}

function cleanupAudioResources() {
    if (recordingState.rafId) cancelAnimationFrame(recordingState.rafId);
    if (recordingState.currentStream) recordingState.currentStream.getTracks().forEach(t => t.stop());
    if (recordingState.analyser) recordingState.analyser.disconnect();
    if (recordingState.sourceNode) recordingState.sourceNode.disconnect();
    if (recordingState.audioContext) recordingState.audioContext.close();
    Object.assign(recordingState, {
        isRecording: false, isInitializing: false, isStopping: false,
        mediaRecorder: null, chunks: [], audioContext: null, analyser: null,
        sourceNode: null, rafId: null, currentStream: null, recognizer: null,
        fallbackTranscript: '', activeForm: null
    });
}

function findDivForms() {
    const candidateDivs = [];
    document.querySelectorAll('div').forEach(div => {
        if (div.closest('form') || div.querySelector('form')) {
            return;
        }
        const inputs = div.querySelectorAll('input, textarea, select');
        if (inputs.length >= 2) {
            candidateDivs.push(div);
        }
    });

    const divForms = candidateDivs.filter(d1 => {
        return !candidateDivs.some(d2 => d1 !== d2 && d2.contains(d1));
    });

    divForms.forEach(div => div.classList.add('survsay-div-form'));
    return divForms;
}

// --- ElevenLabs Transcription ---

async function transcribeWithElevenLabs(audioBlob) {
    const settings = await new Promise(resolve => {
        chrome.storage.sync.get({ elevenlabsApiKey: '', language: 'en-US' }, resolve);
    });

    const apiKey = settings.elevenlabsApiKey;
    if (!apiKey) {
        console.warn('Survsay: No ElevenLabs API key configured');
        return null;
    }

    // Map language setting to ElevenLabs language code
    const langMap = {
        'en-US': 'eng',
        'en-GB': 'eng',
        'es-ES': 'spa'
    };
    const languageCode = langMap[settings.language] || null;

    console.log('Survsay [ElevenLabs]: Starting transcription...');

    try {
        const formData = new FormData();
        formData.append('file', audioBlob, 'recording.webm');
        formData.append('model_id', 'scribe_v2');
        
        if (languageCode) {
            formData.append('language_code', languageCode);
        }

        const response = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
            method: 'POST',
            headers: {
                'xi-api-key': apiKey
            },
            body: formData
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('Survsay [ElevenLabs]: API error:', response.status, errorText);
            return null;
        }

        const result = await response.json();
        console.log('Survsay [ElevenLabs]: Transcription complete:', result.text?.substring(0, 100) + '...');
        
        return result.text || null;
    } catch (error) {
        console.error('Survsay [ElevenLabs]: Transcription failed:', error);
        return null;
    }
}

// --- Main Processing Pipeline ---

async function processRecording(blob, fallbackTranscript) {
    showBusy('Transcribing your voice...');

    // Add processing glow to all form fields
    if (recordingState.activeForm) {
        const fields = recordingState.activeForm.querySelectorAll('input, textarea, select');
        fields.forEach(field => {
            if (field.type !== 'hidden' && field.type !== 'submit' && field.type !== 'button') {
                addFieldGlow(field, true);
            }
        });
    }

    let transcription = null;

    // Layer 1: Try ElevenLabs Scribe v2
    transcription = await transcribeWithElevenLabs(blob);

    // Layer 2: Fall back to Web Speech API
    if (!transcription && fallbackTranscript) {
        console.log('Survsay: Using Web Speech API fallback');
        transcription = fallbackTranscript;
    }

    // Process the transcription with Firebase LLM
    if (transcription) {
        showBusy('Filling your form...');
        await processTextWithFirebase(transcription);
    } else {
        console.error("Survsay: All transcription methods failed.");
        hideBusy();
    }
}

async function processTextWithFirebase(transcription) {
    if (!transcription) {
        console.warn("Survsay: Cannot process empty transcription.");
        hideBusy();
        return;
    }

    const schema = analyzeForm(recordingState.activeForm);
    const context = getSurroundingText(recordingState.activeForm);

    try {
        // Call service worker directly (bypasses page CSP)
        console.log('Survsay: Sending extraction request to service worker...');
        const response = await chrome.runtime.sendMessage({
            type: 'EXTRACT_FORM_DATA',
            text: transcription,
            schema,
            context
        });
        
        console.log('Survsay: Service worker response:', response);
        
        if (response && response.success) {
            console.log('Survsay: Extracted data:', JSON.stringify(response.result, null, 2));
            fillForm(response.result, recordingState.activeForm);
        } else {
            throw new Error(response?.error || 'Extraction failed');
        }
        hideBusy();
    } catch (error) {
        console.error("Survsay: Firebase text processing failed:", error);
        hideBusy();
    }
}

function analyzeForm(form) {
    if (!form) return null;
    const fields = [];
    const seenLabels = new Set();
    
    // Detect if this is a Google Form
    const isGoogleForm = window.location.hostname.includes('google.com') && 
                         (window.location.pathname.includes('/forms/') || 
                          document.querySelector('[data-params]'));
    
    form.querySelectorAll('input, textarea, select').forEach((input, index) => {
        if (input.type === 'hidden' || input.type === 'submit' || input.type === 'button') return;
        
        // Get label text - this is the primary identifier for matching
        let labelText = '';
        
        // Method 1: Standard label association
        if (input.id) {
            const label = document.querySelector(`label[for="${input.id}"]`);
            if (label) labelText = label.textContent.trim();
        }
        
        // Method 2: Parent label
        if (!labelText) {
            const parentLabel = input.closest('label');
            if (parentLabel) {
                // Get text content excluding the input itself
                const clone = parentLabel.cloneNode(true);
                clone.querySelectorAll('input, textarea, select').forEach(el => el.remove());
                labelText = clone.textContent.trim();
            }
        }
        
        // Method 3: Google Forms specific - look for question title
        if (!labelText && isGoogleForm) {
            // Try multiple Google Forms selectors
            const questionContainer = input.closest('[data-params]') || 
                                     input.closest('.freebirdFormviewerComponentsQuestionBaseRoot') ||
                                     input.closest('.Qr7Oae');
            if (questionContainer) {
                const questionText = questionContainer.querySelector(
                    '[role="heading"], ' +
                    '.freebirdFormviewerComponentsQuestionBaseTitle, ' +
                    '.M7eMe, ' +  // Question title class
                    '.z12JJ'      // Another question title class
                );
                if (questionText) {
                    labelText = questionText.textContent.trim();
                }
            }
        }
        
        // Method 4: aria-label or placeholder
        if (!labelText) {
            labelText = input.getAttribute('aria-label') || input.placeholder || '';
        }
        
        // Method 5: Previous sibling text
        if (!labelText && input.previousElementSibling) {
            const prev = input.previousElementSibling;
            if (prev.tagName === 'LABEL' || prev.tagName === 'SPAN' || prev.tagName === 'DIV') {
                labelText = prev.textContent.trim();
            }
        }
        
        // Clean up label text
        labelText = labelText.replace(/\s+/g, ' ').trim();
        // Remove asterisks (required field markers)
        labelText = labelText.replace(/\s*\*\s*$/, '').trim();
        
        // Skip if we've already seen this label (avoid duplicates)
        if (labelText && seenLabels.has(labelText.toLowerCase())) {
            return;
        }
        
        if (labelText) {
            seenLabels.add(labelText.toLowerCase());
            
            // Store element reference for later matching
            input.dataset.survsayLabel = labelText;
            
            fields.push({ 
                label: labelText,
                type: input.tagName.toLowerCase(), 
                inputType: input.type || 'text'
            });
        }
    });
    
    console.log('Survsay: Analyzed form schema:', fields);
    return { fields, isGoogleForm };
}

function addFieldGlow(element, isProcessing = true) {
    if (!element) return;

    if (!document.getElementById('survsay-glow-styles')) {
        const style = document.createElement('style');
        style.id = 'survsay-glow-styles';
        style.textContent = `
            @keyframes survsay-glow-pulse {
                0%, 100% { box-shadow: 0 0 5px rgba(242, 174, 187, 0.5), 0 0 10px rgba(242, 174, 187, 0.3); }
                50% { box-shadow: 0 0 15px rgba(242, 174, 187, 0.8), 0 0 25px rgba(242, 174, 187, 0.5); }
            }
            @keyframes survsay-glow-climax {
                0% { box-shadow: 0 0 15px rgba(242, 174, 187, 0.8), 0 0 25px rgba(242, 174, 187, 0.5); }
                50% { box-shadow: 0 0 30px rgba(242, 174, 187, 1), 0 0 50px rgba(242, 174, 187, 0.8), 0 0 70px rgba(242, 174, 187, 0.6); }
                100% { box-shadow: none; }
            }
            .survsay-field-processing {
                animation: survsay-glow-pulse 1.5s ease-in-out infinite !important;
                transition: box-shadow 0.3s ease-in-out !important;
            }
            .survsay-field-filled {
                animation: survsay-glow-climax 1s ease-out forwards !important;
            }
        `;
        document.head.appendChild(style);
    }

    if (!element.dataset.survsayOriginalShadow) {
        element.dataset.survsayOriginalShadow = element.style.boxShadow || 'none';
    }

    if (isProcessing) {
        element.classList.add('survsay-field-processing');
        element.classList.remove('survsay-field-filled');
    } else {
        element.classList.remove('survsay-field-processing');
        element.classList.add('survsay-field-filled');

        setTimeout(() => {
            element.classList.remove('survsay-field-filled');
            if (element.dataset.survsayOriginalShadow) {
                element.style.boxShadow = element.dataset.survsayOriginalShadow;
                delete element.dataset.survsayOriginalShadow;
            }
        }, 1000);
    }
}

function fillForm(data, form) {
    console.log('Survsay: fillForm called with:', data);
    if (!data || !data.structured || !form) {
        console.log('Survsay: fillForm - missing data or form', { hasData: !!data, hasStructured: !!data?.structured, hasForm: !!form });
        return;
    }

    console.log('Survsay: Filling fields:', Object.keys(data.structured));
    
    // Build a map of label -> element for quick lookup
    const labelToElement = new Map();
    form.querySelectorAll('input, textarea, select').forEach(input => {
        if (input.type === 'hidden' || input.type === 'submit' || input.type === 'button') return;
        
        // Check if we stored the label during analysis
        if (input.dataset.survsayLabel) {
            labelToElement.set(input.dataset.survsayLabel.toLowerCase(), input);
        }
    });

    for (const [label, value] of Object.entries(data.structured)) {
        if (!label || value === undefined || value === null) continue;
        
        let el = null;
        
        // Method 1: Direct label match from our stored data
        el = labelToElement.get(label.toLowerCase());
        
        // Method 2: Try partial label match
        if (!el) {
            for (const [storedLabel, element] of labelToElement) {
                if (storedLabel.includes(label.toLowerCase()) || label.toLowerCase().includes(storedLabel)) {
                    el = element;
                    break;
                }
            }
        }
        
        // Method 3: Traditional selectors as fallback
        if (!el) {
            const selectors = [
                `[name="${label}"]`,
                `#${CSS.escape(label)}`,
                `[aria-label="${label}" i]`,
                `[placeholder="${label}" i]`
            ];
            for (const selector of selectors) {
                try {
                    el = form.querySelector(selector);
                    if (el) break;
                } catch (e) { /* invalid selector */ }
            }
        }

        console.log(`Survsay: Field "${label}" = "${value}", found element:`, !!el);
        
        if (!el) continue;

        // Fill the field based on type
        if (el.tagName === 'SELECT') {
            const option = Array.from(el.options).find(o => 
                o.text.toLowerCase() === String(value).toLowerCase() ||
                o.value.toLowerCase() === String(value).toLowerCase()
            );
            if (option) {
                el.value = option.value;
                el.dispatchEvent(new Event('change', { bubbles: true }));
                addFieldGlow(el, false);
            }
        } else if (el.type === 'radio') {
            // Find all radios with same name and select matching one
            const radios = form.querySelectorAll(`input[type="radio"][name="${el.name}"]`);
            const radioToSelect = Array.from(radios).find(r => 
                r.value.toLowerCase() === String(value).toLowerCase()
            );
            if (radioToSelect) {
                radioToSelect.checked = true;
                radioToSelect.dispatchEvent(new Event('change', { bubbles: true }));
                addFieldGlow(radioToSelect, false);
            }
        } else if (el.type === 'checkbox') {
            el.checked = Boolean(value);
            el.dispatchEvent(new Event('change', { bubbles: true }));
            addFieldGlow(el, false);
        } else {
            // Text input, textarea, etc.
            el.value = value;
            // Dispatch events to trigger any listeners (important for Google Forms)
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            addFieldGlow(el, false);
        }
    }

    // Remove processing glow from unfilled fields
    const allFields = form.querySelectorAll('input, textarea, select');
    allFields.forEach(field => {
        if (field.classList.contains('survsay-field-processing')) {
            field.classList.remove('survsay-field-processing');
            if (field.dataset.survsayOriginalShadow) {
                field.style.boxShadow = field.dataset.survsayOriginalShadow;
                delete field.dataset.survsayOriginalShadow;
            }
        }
    });
}

function getSurroundingText(form) {
    let contextText = '';
    if (!form || typeof form.previousElementSibling === 'undefined') {
        return contextText;
    }

    let sibling = form.previousElementSibling;
    while (sibling && contextText.length < 500) {
        contextText = (sibling.textContent || '') + '\n' + contextText;
        sibling = sibling.previousElementSibling;
    }
    return contextText.trim();
}


// --- Text Rewriter Feature ---

function attachRewriterButtons() {
    const fields = document.querySelectorAll('input[type="text"], textarea');

    fields.forEach((field, index) => {
        const buttonId = `survsay-rewriter-button-${index}`;
        if (document.getElementById(buttonId)) return;

        const button = document.createElement('button');
        button.id = buttonId;
        button.classList.add('survsay-rewriter-button');
        button.style.position = 'absolute';
        button.style.background = 'white';
        button.style.border = '1px solid #696FC7';
        button.style.borderRadius = '6px';
        button.style.padding = '2px';
        button.style.cursor = 'pointer';
        button.style.zIndex = '2147483645';
        button.style.opacity = '0';
        button.style.transition = 'opacity 0.2s ease-in-out';
        button.style.lineHeight = '0';
        button.title = 'Rewrite this text with Survsay';

        const rewriterIconSvg = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#696FC7" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/></svg>`;
        button.innerHTML = rewriterIconSvg;

        document.body.appendChild(button);

        const setPosition = () => {
            const fieldRect = field.getBoundingClientRect();
            const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
            const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;

            if (field.tagName.toLowerCase() === 'textarea') {
                button.style.top = `${fieldRect.bottom + scrollTop - button.offsetHeight - 8}px`;
                button.style.left = `${fieldRect.right + scrollLeft - button.offsetWidth - 8}px`;
            } else {
                button.style.top = `${fieldRect.top + scrollTop + (field.offsetHeight - button.offsetHeight) / 2}px`;
                button.style.left = `${fieldRect.right + scrollLeft + 5}px`;
            }
        };

        button.__survsay_reposition = setPosition;
        setPosition();
        window.addEventListener('resize', setPosition);
        window.addEventListener('scroll', setPosition, true);

        const updateVisibility = () => {
            const hasValue = (field.value || '').trim().length > 0;
            if (!hasValue) {
                button.style.opacity = '0';
                button.style.display = 'none';
            } else {
                button.style.display = 'block';
            }
        };
        updateVisibility();
        field.addEventListener('input', () => { updateVisibility(); setPosition(); });
        field.addEventListener('change', () => { updateVisibility(); setPosition(); });

        let hideTimeout;
        const show = () => {
            clearTimeout(hideTimeout);
            if ((field.value || '').trim().length === 0) return;
            button.style.display = 'block';
            button.style.opacity = '1';
        };
        const hide = () => {
            hideTimeout = setTimeout(() => {
                button.style.opacity = '0';
                if ((field.value || '').trim().length === 0) button.style.display = 'none';
            }, 300);
        };

        field.addEventListener('mouseenter', show);
        field.addEventListener('mouseleave', hide);
        button.addEventListener('mouseenter', show);
        button.addEventListener('mouseleave', hide);

        button.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            handleRewrite(field, button);
        });
    });
}

function getFieldContext(field) {
    const context = {
        label: '',
        placeholder: field.placeholder || '',
        type: field.type || 'text',
        name: field.name || '',
        id: field.id || '',
        hasNumbers: /\d/.test(field.value),
        hasProperNouns: false,
        isNameField: false,
        isEmailField: false,
        isPhoneField: false,
        isIdField: false,
        isUrlField: false,
        isDateField: false,
        isAddressField: false,
        instructions: ''
    };

    if (field.id) {
        const label = document.querySelector(`label[for="${field.id}"]`);
        if (label) context.label = label.textContent.trim();
    }
    if (!context.label) {
        const parent = field.closest('label');
        if (parent) context.label = parent.textContent.replace(field.value, '').trim();
    }
    if (!context.label) {
        const prevLabel = field.previousElementSibling;
        if (prevLabel && (prevLabel.tagName === 'LABEL' || prevLabel.classList.contains('label'))) {
            context.label = prevLabel.textContent.trim();
        }
    }

    const meta = `${context.label} ${context.placeholder} ${context.name} ${context.id}`.toLowerCase();

    const namePatterns = /(\bname\b|\bfirst\b|\blast\b|\bsurname\b|\bgiven\b|full\s*-?\s*name|user\s*-?\s*name|username)/i;
    context.isNameField = namePatterns.test(meta);

    const emailPatterns = /(e[-\s]?mail|\bemail\b)/i;
    context.isEmailField = emailPatterns.test(meta) || context.type === 'email';

    const phonePatterns = /(phone|mobile|telephone|tel\b|cell\b|whatsapp|contact\s*number|phone\s*number)/i;
    context.isPhoneField = phonePatterns.test(meta) || context.type === 'tel';

    const idPatterns = /(employee|student|tax|account|national|passport|driver|applicant|customer|user)\s*(id|number|no\.?|#)\b|\b(id\s*number|id#|id no\.?|ssn|nin|nid|pan|aadhaar|aadhar|dni|cedula|rfc|curp|nif)\b/i;
    context.isIdField = idPatterns.test(meta);

    const urlPatterns = /(url|website|web\s*site|link|homepage|home\s*page|portfolio)/i;
    context.isUrlField = urlPatterns.test(meta) || context.type === 'url';

    const datePatterns = /(date|dob|birth\s*date|birthday|start\s*date|end\s*date|expiry|expiration|exp\s*date|mm\/?yy(?:yy)?|yy(?:yy)?)/i;
    const dateTypes = ['date', 'datetime-local', 'month', 'time', 'week'];
    context.isDateField = datePatterns.test(meta) || dateTypes.includes(context.type);

    const addressPatterns = /(address|street|st\.?\b|avenue|ave\.?\b|road|rd\.?\b|boulevard|blvd\.?\b|lane|ln\.?\b|drive|dr\.?\b|court|ct\.?\b|place|pl\.?\b|square|sq\.?\b|trail|trl\.?\b|parkway|pkwy\.?\b|circle|cir\.?\b|city|state|province|region|county|zip|postal|postcode|country|apt|apartment|suite|ste\.?\b|unit|building|bldg)/i;
    context.isAddressField = addressPatterns.test(meta);

    const words = field.value.split(/\s+/);
    context.hasProperNouns = words.some(word =>
        word.length > 1 && word[0] === word[0].toUpperCase() && word.slice(1) === word.slice(1).toLowerCase()
    );

    const hints = [];
    if (context.isNameField || context.hasProperNouns) hints.push("Do NOT change any names or proper nouns");
    if (context.hasNumbers) hints.push("Do NOT change any numbers");
    if (context.isEmailField) hints.push("Do NOT change any email addresses");
    if (context.isPhoneField) hints.push("Do NOT change any phone numbers");
    if (context.isIdField) hints.push("Do NOT change any IDs or identification numbers");
    if (context.isUrlField) hints.push("Do NOT change any URLs or links");
    if (context.isDateField) hints.push("Do NOT change any dates or date formats");
    if (/[€£¥₹$]|\b(?:USD|EUR|GBP|JPY|INR|CAD|AUD)\b/.test(field.value)) hints.push("Do NOT change any currency amounts");
    if (/\d+\s*%|\bpercent\b/i.test(field.value)) hints.push("Do NOT change any percentages");
    if (context.isAddressField) hints.push("Do NOT change any postal addresses");
    if (context.label) hints.push(`This is for: "${context.label}"`);
    else if (context.placeholder) hints.push(`Placeholder: "${context.placeholder}"`);

    context.instructions = hints.length > 0 ? hints.join('. ') + '.' : '';
    return context;
}

function maskSensitiveSubstrings(text) {
    let tokens = [];
    let idxEmail = 0, idxPhone = 0, idxId = 0, idxUrl = 0, idxDate = 0, idxCurr = 0, idxPct = 0, idxAddr = 0;
    let out = text;

    const urlRe = /(https?:\/\/[^\s)]+|www\.[^\s)]+|\b[a-z0-9.-]+\.[a-z]{2,}(?:\/[\w#?&=+%\-.]*)?)/gi;
    out = out.replace(urlRe, (m) => {
        const ph = `__SURVSAY_URL_${++idxUrl}__`;
        tokens.push({ placeholder: ph, value: m });
        return ph;
    });

    const emailRe = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
    out = out.replace(emailRe, (m) => {
        const ph = `__SURVSAY_EMAIL_${++idxEmail}__`;
        tokens.push({ placeholder: ph, value: m });
        return ph;
    });

    const phoneRe = /\+?\d[\d\s().-]{5,}\d/g;
    out = out.replace(phoneRe, (m) => {
        const digits = (m.match(/\d/g) || []).length;
        if (digits < 7 || digits > 15) return m;
        const ph = `__SURVSAY_PHONE_${++idxPhone}__`;
        tokens.push({ placeholder: ph, value: m });
        return ph;
    });

    const datePatterns = [
        /\b\d{4}-\d{2}-\d{2}\b/g,
        /\b\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})\b/g,
        /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\s+\d{1,2}(?:,\s*\d{4})?\b/gi,
        /\b\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\s+\d{4}\b/gi
    ];
    datePatterns.forEach(re => {
        out = out.replace(re, (m) => {
            const ph = `__SURVSAY_DATE_${++idxDate}__`;
            tokens.push({ placeholder: ph, value: m });
            return ph;
        });
    });

    const currBefore = /(?<!\w)(?:[$€£¥₹]|\b(?:USD|EUR|GBP|JPY|INR|CAD|AUD)\b)\s?\d{1,3}(?:[.,\s]\d{3})*(?:[.,]\d{2})?/gi;
    out = out.replace(currBefore, (m) => {
        const ph = `__SURVSAY_CURR_${++idxCurr}__`;
        tokens.push({ placeholder: ph, value: m });
        return ph;
    });

    const pctRe1 = /\b\d+(?:[.,]\d+)?\s*%\b/g;
    out = out.replace(pctRe1, (m) => {
        const ph = `__SURVSAY_PCT_${++idxPct}__`;
        tokens.push({ placeholder: ph, value: m });
        return ph;
    });

    return { sanitizedText: out, tokens };
}

function unmaskSensitiveSubstrings(text, tokens) {
    let out = text;
    tokens.forEach(t => {
        out = out.replaceAll(t.placeholder, t.value);
    });
    return out;
}

async function handleRewrite(field, button) {
    const text = field.value;
    if (!text) return;

    const fieldContext = getFieldContext(field);

    // Skip protected fields
    if (
        fieldContext.isNameField ||
        fieldContext.isEmailField ||
        fieldContext.isPhoneField ||
        fieldContext.isIdField ||
        fieldContext.isDateField ||
        field.type === 'url'
    ) {
        button.style.transform = 'rotate(0deg)';
        return;
    }

    showBusy('Rewriting text...');
    addFieldGlow(field, true);
    button.style.transform = 'rotate(360deg)';
    button.style.transition = 'transform 0.5s';

    const settings = await new Promise(resolve => {
        chrome.storage.sync.get({ rewriteTone: 'original', rewriteLength: 'original' }, resolve);
    });
    const { rewriteTone, rewriteLength } = settings;

    const { sanitizedText, tokens } = maskSensitiveSubstrings(text);

    let rewrittenText = null;

    try {
        // Call service worker directly (bypasses page CSP)
        const response = await chrome.runtime.sendMessage({
            type: 'REWRITE_TEXT',
            text: sanitizedText,
            tone: rewriteTone,
            length: rewriteLength,
            context: fieldContext
        });
        
        if (response && response.success) {
            rewrittenText = response.result;
        }
    } catch (error) {
        console.error("Survsay: Rewrite failed:", error);
    }

    button.style.transform = 'rotate(0deg)';
    if (rewrittenText) {
        const restored = unmaskSensitiveSubstrings(rewrittenText, tokens);
        field.value = restored;
        addFieldGlow(field, false);
    }
    hideBusy();
}

function removeAllRewriterButtons() {
    const buttons = document.querySelectorAll('.survsay-rewriter-button');
    buttons.forEach(button => {
        window.removeEventListener('resize', button.__survsay_reposition);
        window.removeEventListener('scroll', button.__survsay_reposition, true);
        button.remove();
    });
}


// --- Simplify Mode for Accessibility ---

let simplifyModeActive = false;
const simplifiedElements = new Map();

async function simplifyFormLabel(labelElement) {
    const originalText = labelElement.textContent.trim();
    if (!originalText || originalText.length < 5) return;

    if (simplifiedElements.has(labelElement)) return;

    let dropdownOptions = '';
    const forAttr = labelElement.getAttribute('for');
    let associatedSelect = null;

    if (forAttr) {
        associatedSelect = document.getElementById(forAttr);
    } else {
        associatedSelect = labelElement.querySelector('select');
    }

    if (!associatedSelect) {
        const nextElement = labelElement.nextElementSibling;
        if (nextElement && nextElement.tagName === 'SELECT') {
            associatedSelect = nextElement;
        }
    }

    if (associatedSelect && associatedSelect.tagName === 'SELECT') {
        const options = Array.from(associatedSelect.options)
            .filter((opt) => opt.value && opt.text.trim())
            .map((opt) => opt.text.trim());

        if (options.length > 0) {
            if (options.length <= 5) {
                dropdownOptions = ` (Options: ${options.join(', ')})`;
            } else {
                dropdownOptions = ` (Options include: ${options.slice(0, 3).join(', ')}, and ${options.length - 3} more)`;
            }
        }
    }

    addFieldGlow(labelElement, true);

    simplifiedElements.set(labelElement, {
        text: originalText,
        styles: {
            fontSize: labelElement.style.fontSize,
            lineHeight: labelElement.style.lineHeight,
            fontWeight: labelElement.style.fontWeight,
            color: labelElement.style.color,
            backgroundColor: labelElement.style.backgroundColor,
            padding: labelElement.style.padding,
            letterSpacing: labelElement.style.letterSpacing
        }
    });

    let simplifiedText = null;

    try {
        // Call service worker directly (bypasses page CSP)
        const response = await chrome.runtime.sendMessage({
            type: 'REWRITE_TEXT',
            text: originalText,
            tone: 'friendly',
            length: 'shorter',
            context: { instructions: 'Make this very simple and clear for people with ADHD and dyslexia' }
        });
        
        if (response && response.success) {
            simplifiedText = response.result;
        }
    } catch (error) {
        console.error('Survsay: Simplification failed:', error);
    }

    if (simplifiedText) {
        labelElement.textContent = simplifiedText + dropdownOptions;
    } else {
        labelElement.textContent = originalText + dropdownOptions;
    }

    labelElement.style.fontSize = '16px';
    labelElement.style.lineHeight = '1.6';
    labelElement.style.fontWeight = '600';
    labelElement.style.color = '#1a1a1a';
    labelElement.style.backgroundColor = '#f9f9f9';
    labelElement.style.padding = '8px 12px';
    labelElement.style.letterSpacing = '0.02em';
    labelElement.style.borderRadius = '6px';
    labelElement.style.display = 'block';
    labelElement.style.marginBottom = '8px';

    addFieldGlow(labelElement, false);
}

async function applySimplifyMode() {
    if (simplifyModeActive) return;
    simplifyModeActive = true;

    const labels = document.querySelectorAll('label, .form-label, [class*="label"]');
    const legendElements = document.querySelectorAll('legend');
    const allLabelElements = [...labels, ...legendElements];

    for (const label of allLabelElements) {
        await simplifyFormLabel(label);
    }

    const forms = document.querySelectorAll('form, .survsay-div-form');
    forms.forEach(form => {
        form.style.maxWidth = '800px';
        form.style.margin = '0 auto';
    });

    const inputs = document.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]), textarea, select');
    inputs.forEach(input => {
        input.style.fontSize = '16px';
        input.style.padding = '12px';
        input.style.border = '2px solid #d1d5db';
        input.style.borderRadius = '8px';
        input.style.marginBottom = '16px';
    });
}

function removeSimplifyMode() {
    if (!simplifyModeActive) return;
    simplifyModeActive = false;

    simplifiedElements.forEach((original, element) => {
        element.textContent = original.text;
        Object.assign(element.style, original.styles);
    });
    simplifiedElements.clear();

    const forms = document.querySelectorAll('form, .survsay-div-form');
    forms.forEach(form => {
        form.style.maxWidth = '';
        form.style.margin = '';
    });

    const inputs = document.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]), textarea, select');
    inputs.forEach(input => {
        input.style.fontSize = '';
        input.style.padding = '';
        input.style.border = '';
        input.style.borderRadius = '';
        input.style.marginBottom = '';
    });
}

// --- Main Execution ---

function injectAnimationStyles() {
    const style = document.createElement('style');
    style.textContent = `
        @keyframes survsay-pulse-red {
            0% { box-shadow: 0 0 0 0 rgba(220, 38, 38, 0.4); }
            70% { box-shadow: 0 0 0 10px rgba(220, 38, 38, 0); }
            100% { box-shadow: 0 0 0 0 rgba(220, 38, 38, 0); }
        }
        .survsay-recording-pulse {
            animation: survsay-pulse-red 2s infinite;
        }
    `;
    document.head.appendChild(style);
}

function main() {
    if (window.__survsay_installed) return;
    window.__survsay_installed = true;

    injectAnimationStyles();
    attachRewriterButtons();

    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
        if (msg.type === 'SETTINGS_UPDATED') {
            removeAllMics();
            if (msg.settings.micEnabled) {
                attachMicsToForms();
            }
            removeAllRewriterButtons();
            attachRewriterButtons();
            
            if (msg.settings.simplifyMode && !simplifyModeActive) {
                applySimplifyMode();
            } else if (!msg.settings.simplifyMode && simplifyModeActive) {
                removeSimplifyMode();
            }
        } else if (msg.type === 'PING') {
            sendResponse({ ok: true });
        }
    });

    init();
}

if (typeof process === 'undefined' || process.env.NODE_ENV !== 'test') {
    // No need to inject firebase-injector anymore - service worker handles LLM calls
    setTimeout(() => {
        main();
    }, 100);
}

// Check simplify mode on load
chrome.storage.sync.get({ simplifyMode: false }, (settings) => {
    if (settings.simplifyMode) {
        applySimplifyMode();
    }
});

// --- Exports for Testing ---

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        attachMicsToForms,
        removeAllMics,
        getSurroundingText,
        handleStartRecording,
        handleStopRecording,
        recordingState,
        analyzeForm,
        fillForm,
        init,
    };
}
