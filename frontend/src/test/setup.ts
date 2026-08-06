import '@testing-library/jest-dom/vitest';

// jsdom doesn't implement scrollIntoView — Chat.tsx/DMChatView.tsx call it
// unconditionally (auto-scroll-to-bottom on new messages) via a layout
// effect, so any test that mounts a channel/DM view with the messages list
// present needs this stubbed or the effect throws.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}
