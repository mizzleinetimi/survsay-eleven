// Survsay - service_worker.js
// Handles Gemini API calls from extension context (bypasses page CSP)

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

async function getGeminiApiKey() {
  return new Promise((resolve) => {
    chrome.storage.sync.get({ geminiApiKey: '' }, (settings) => {
      resolve(settings.geminiApiKey);
    });
  });
}

// Handle messages from content scripts
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  console.log('Survsay [SW]: Received message:', msg.type);
  
  if (msg.type === 'PING') {
    sendResponse({ ok: true });
    return;
  }

  if (msg.type === 'EXTRACT_FORM_DATA') {
    console.log('Survsay [SW]: Processing extraction request...');
    handleExtraction(msg.text, msg.schema, msg.context)
      .then(result => {
        console.log('Survsay [SW]: Extraction successful');
        sendResponse({ success: true, result });
      })
      .catch(error => {
        console.error('Survsay [SW]: Extraction failed:', error);
        sendResponse({ success: false, error: error.message });
      });
    return true; // Keep channel open for async response
  }

  if (msg.type === 'REWRITE_TEXT') {
    console.log('Survsay [SW]: Processing rewrite request...');
    handleRewrite(msg.text, msg.tone, msg.length, msg.context)
      .then(result => {
        console.log('Survsay [SW]: Rewrite successful');
        sendResponse({ success: true, result });
      })
      .catch(error => {
        console.error('Survsay [SW]: Rewrite failed:', error);
        sendResponse({ success: false, error: error.message });
      });
    return true;
  }
});

async function callGemini(prompt) {
  const apiKey = await getGeminiApiKey();
  if (!apiKey) {
    throw new Error('Gemini API key not configured. Add it in extension settings.');
  }

  const response = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      contents: [{
        parts: [{ text: prompt }]
      }]
    })
  });

  if (!response.ok) {
    const error = await response.text();
    console.error('Survsay [Gemini]: API error:', error);
    throw new Error(`Gemini API error: ${response.status}`);
  }

  const data = await response.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

async function handleExtraction(text, schema, context) {
  // Build a list of field labels for the prompt
  const fieldLabels = schema.fields.map(f => f.label).filter(Boolean);
  
  const prompt = `You are a highly precise assistant that fills out web forms based ONLY on the information a user provides.
Your task is to analyze the user's speech (transcription) and extract values for the form fields listed below.

**FORM FIELDS (use these EXACT labels as keys in your response):**
${fieldLabels.map(label => `- "${label}"`).join('\n')}

**CRITICAL INSTRUCTIONS:**
1. **Use the EXACT field label as the key** in your response JSON. Do not modify or abbreviate the labels.
2. **Be very strict.** Only fill in fields for which the user has explicitly provided a value in their speech.
3. **If no value is given for a field, you MUST omit it entirely from your response.** Do not include the key for that field.
4. **Do not guess or infer values.** Do not use the field's label as its value.
5. **Match user's spoken information to the most appropriate field label.**

Your response MUST be a JSON object with a single key: "structured", where the value is an object with field labels as keys and extracted values as values.

Example response format:
{"structured": {"Full Name": "John Smith", "Email Address": "john@example.com"}}

---
Surrounding Context: ${context || 'No context provided.'}
---
Transcription: "${text}"`;

  const result = await callGemini(prompt);
  
  // Clean markdown formatting
  let jsonString = result;
  if (jsonString.includes('```json')) {
    const match = jsonString.match(/```json\s*([\s\S]*?)\s*```/);
    if (match) jsonString = match[1].trim();
  } else if (jsonString.includes('```')) {
    const match = jsonString.match(/```\s*([\s\S]*?)\s*```/);
    if (match) jsonString = match[1].trim();
  }

  console.log('Survsay [Gemini]: Extraction result:', jsonString.substring(0, 100));
  return JSON.parse(jsonString);
}

async function handleRewrite(text, tone, length, context) {
  let lengthInstruction = '';
  if (length === 'shorter') lengthInstruction = ' Make the text shorter.';
  else if (length === 'longer') lengthInstruction = ' Make the text longer.';

  let contextHint = '';
  if (context && context.instructions) {
    contextHint = ' IMPORTANT: ' + context.instructions;
  }

  const prompt = `Rewrite the following text in a ${tone} tone.${lengthInstruction}${contextHint} Return only the rewritten text, and nothing else.

Text: "${text}"`;

  const result = await callGemini(prompt);
  console.log('Survsay [Gemini]: Rewrite complete');
  return result;
}

console.log('Survsay service worker loaded');
