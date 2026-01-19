# Survsay Testing Instructions

## Setup

1. **Install the Extension**
   - Open Chrome and go to `chrome://extensions`
   - Enable "Developer mode" (top right)
   - Click "Load unpacked"
   - Select the `googlechromeai` folder

2. **Enable Gemini Nano (Optional but Recommended)**
   - Go to `chrome://flags`
   - Search for "Prompt API for Gemini Nano"
   - Enable it and restart Chrome

## Test 1: Voice Form Filling

1. Open any website with a form (e.g., contact form, signup form)
2. Look for the floating microphone button near the form
3. Click the microphone and allow microphone access
4. Speak your information (e.g., "My name is John Doe, email john@example.com")
5. Click the microphone again to stop recording
6. **Expected:** Pink glow appears on fields → Form fills automatically → Glow climaxes when done

## Test 2: Text Rewriter

1. Fill in a text field or textarea with some text
2. Hover over the field to see the retry arrow icon (top right of field)
3. Click the retry arrow
4. **Expected:** Pink glow while processing → Text rewrites in a better tone → Glow climaxes

## Test 3: Simplify Mode

1. Click the Survsay extension icon in Chrome toolbar
2. Toggle "Simplify Mode" ON in the Accessibility section
3. Refresh the page with a form
4. **Expected:** 
   - Labels glow pink while processing
   - Labels rewrite to simpler, friendlier language
   - Dropdown options appear in labels
   - Larger fonts and better spacing applied
   - Glow climaxes when each label is done

## Test 4: Settings

1. Click the extension icon
2. Try changing:
   - Mic Position (top-right, bottom-left, etc.)
   - Rewrite Tone (professional, casual, friendly)
   - Rewrite Length (shorter, longer)
3. Test that changes apply immediately

## Common Test Sites

- Google Forms
- Typeform
- Contact forms on any website
- Survey pages
- Registration forms

## Troubleshooting

- **No microphone button?** Check that the page has a form with 2+ fields
- **Not working?** Check browser console (F12) for errors
- **Quota errors?** You may have hit the free API limit, wait or use your own API key
