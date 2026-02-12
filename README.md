# Gemini Bookrize

This Chrome Extension adds two powerful features to the Google Gemini web interface (`gemini.google.com`):

1.  **Tab Title Sync**: Automatically updates your Chrome tab title to match the current conversation topic, making it easier to find the right tab when you have multiple open.
2.  **Conversation Index Sidebar**: Adds a floating sidebar on the right side of the screen that lists your questions/prompts. Clicking on an item instantly scrolls the chat to that specific message.

## How to Install

1.  **Download/Locate Folder**: Ensure you have the folder containing `manifest.json`, `content.js`, and `styles.css`.
    *   Location: `c:\Users\user\Documents\OneDrive\桌面\Vibe_Coding_Test\Gemini Bookrize`
2.  **Open Chrome Extensions**:
    *   Open Google Chrome.
    *   Navigate to `chrome://extensions/` in the address bar.
3.  **Enable Developer Mode**:
    *   Toggle the "Developer mode" switch in the top right corner of the Extensions page.
4.  **Load Extension**:
    *   Click the **"Load unpacked"** button (top left).
    *   Select the folder `Gemini Bookrize` from your computer.
5.  **Use It**:
    *   Go to [gemini.google.com](https://gemini.google.com).
    *   Open a chat. You should see the sidebar appear on the right, and the tab title should update.

## Troubleshooting

*   **Sidebar not appearing?** Refresh the Gemini page. The extension relies on detecting the chat structure. If the chat is empty, the sidebar might say "Waiting for messages...".
*   **Title not syncing?** Try clicking on the chat in the sidebar to ensure it's "active". The extension scans for the active conversation title.

## Privacy

This extension runs entirely locally in your browser. It scans the page DOM to find your prompts for the navigation feature but *does not* send any data to external servers.
