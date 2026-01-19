# Survsay: Making Forms Accessible for Everyone

## Inspiration

Filling out forms online is tedious and often overwhelming—especially for people with ADHD, dyslexia, or other cognitive differences. Complex legal jargon, tiny fonts, and repetitive data entry create unnecessary barriers. We wanted to leverage Chrome's built-in AI to make forms faster, clearer, and more accessible for everyone.

## What It Does

Survsay is a Chrome extension that transforms how people interact with web forms:

- **Voice-to-Form Filling**: Speak your information naturally, and watch fields auto-fill with visual feedback
- **Simplify Mode**: Rewrites confusing form labels into plain, friendly language with ADHD/dyslexia-friendly styling
- **Smart Text Rewriting**: Improves your written responses with AI-powered tone and clarity adjustments
- **Dropdown Visibility**: Shows dropdown options directly in labels so users know their choices upfront

## How We Built It

We built Survsay using:
- **Chrome's Gemini Nano** (on-device AI) for privacy-first processing
- **Firebase Vertex AI** as a fallback for broader device support
- **Web Speech API** for real-time voice transcription
- **Content scripts** to inject functionality into any webpage

The architecture uses a layered approach: Gemini Nano processes requests locally first, falling back to Firebase only when needed. Visual feedback (pink glow animations) provides clear progress indicators throughout.

## Challenges

1. **CSP Restrictions**: Many sites block external scripts. We solved this by injecting Firebase SDK dynamically into page context.
2. **Form Detection**: Identifying "form-like" divs (not just `<form>` tags) required smart DOM analysis.
3. **Accessibility Balance**: Making labels simpler without losing important information—we added dropdown options inline to maintain context.
4. **API Quota Management**: Implemented intelligent fallbacks between on-device and cloud AI to optimize usage.

## What We Learned

- Chrome's built-in AI (Gemini Nano) is powerful but requires careful eligibility checks
- Accessibility isn't just about compliance—it's about reducing cognitive load
- Visual feedback (like our pink glow animations) dramatically improves user confidence
- Privacy-first AI (on-device processing) is the future of browser extensions

## What's Next

- Multi-language support for global accessibility
- Form field prediction based on user history
- Integration with password managers
- Voice commands for form navigation
- Expanded accessibility features for screen readers
