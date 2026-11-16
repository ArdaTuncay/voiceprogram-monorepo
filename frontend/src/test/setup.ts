import '@testing-library/jest-dom/vitest';
import { beforeEach } from 'vitest';
import { useLanguageStore } from '../i18n';

// The UI language follows the browser (jsdom says en-US); the existing
// tests assert the Turkish source text, so they run in Turkish. Tests for
// English set the language themselves.
beforeEach(() => {
  useLanguageStore.setState({ language: 'tr' });
});

// jsdom doesn't implement scrollIntoView — Chat.tsx/DMChatView.tsx call it
// unconditionally (auto-scroll-to-bottom on new messages) via a layout
// effect, so any test that mounts a channel/DM view with the messages list
// present needs this stubbed or the effect throws.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}
