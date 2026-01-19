# Survsay — Chrome Extension

Survsay is a privacy-conscious Chrome Extension that helps users fill web forms using their voice. It uses ElevenLabs Scribe v2 for fast, accurate transcription and Google Gemini for intelligent form field extraction.

## Features

- **Voice-to-Form Filling**: Click the mic, speak your information naturally, and watch fields auto-fill
- **Google Forms Support**: Works seamlessly with Google Forms and standard HTML forms
- **Simplify Mode**: Rewrites confusing form labels into plain, friendly language (accessibility feature)
- **Smart Text Rewriting**: Improves your written responses with AI-powered tone and clarity adjustments
- **90+ Language Support**: ElevenLabs Scribe v2 supports transcription in over 90 languages

## Requirements

- Chrome browser (any recent version)
- ElevenLabs API key (get one free at [elevenlabs.io](https://elevenlabs.io))
- Google Gemini API key (get one free at [Google AI Studio](https://aistudio.google.com/apikey))

## How It Works

1. **ElevenLabs Scribe v2** — Transcribes your voice recording with state-of-the-art accuracy
2. **Google Gemini 2.0 Flash** — Extracts structured data from the transcription and maps it to form fields
3. **Smart Field Matching** — Uses form labels to accurately fill fields (works with Google Forms and standard forms)

## Installation

1. Clone or download this repository
2. Go to `chrome://extensions` in Chrome
3. Enable "Developer Mode" (top right)
4. Click "Load unpacked" and select this folder
5. Click the Survsay icon and enter your API keys (ElevenLabs + Gemini)

## Usage

1. Navigate to any page with a form (including Google Forms)
2. Hover over the form to reveal the Survsay mic button
3. Click the mic and speak your information (e.g., "My name is John Smith, email john@example.com")
4. Click again to stop recording
5. Watch as fields auto-fill with a satisfying glow animation

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    TRANSCRIPTION                            │
│  Layer 1: ElevenLabs Scribe v2 (fast, accurate STT)        │
│  Layer 2: Web Speech API (offline fallback)                 │
└─────────────────────────────────────────────────────────────┘
                            ↓
                      [transcript text]
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                    LLM PROCESSING                           │
│  Google Gemini 2.0 Flash (via Service Worker)              │
│  • Form data extraction (transcript → JSON)                 │
│  • Text rewriting (tone/length adjustment)                  │
│  • Label simplification (accessibility)                     │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                    FORM FILLING                             │
│  Label-based field matching for universal compatibility     │
│  • Google Forms (custom DOM structure)                      │
│  • Standard HTML forms (name/id attributes)                 │
│  • Accessible forms (aria-label, placeholder)               │
└─────────────────────────────────────────────────────────────┘
```

## Files

- `manifest.json` — Extension manifest (MV3)
- `content_script.js` — Main logic: mic buttons, recording, form analysis, form filling, rewriter
- `service_worker.js` — Handles Gemini API calls (bypasses page CSP restrictions)
- `popup.html/js` — Settings UI (API keys, mic position, language, etc.)
- `util.css` — Shared styles

## Settings

- **ElevenLabs API Key**: Required for voice transcription
- **Gemini API Key**: Required for form extraction and text processing
- **Mic Position**: Where the floating mic appears relative to forms
- **Busy Indicator Position**: Where the processing indicator appears
- **Language**: Transcription language (English, Spanish, etc.)
- **Simplify Mode**: Makes form labels easier to read
- **Rewriter Tone/Length**: Customize how text gets rewritten

## Privacy

- Audio is sent to ElevenLabs for transcription (not stored)
- Transcribed text is processed by Google Gemini for form extraction
- All API calls happen in the extension's service worker (secure context)
- No data is stored on external servers beyond processing
- Web Speech API fallback works entirely offline

## License

MIT
