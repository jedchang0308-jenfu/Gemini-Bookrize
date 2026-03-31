# Jed 個人受控專案 (Jed's Managed Project)

> [!IMPORTANT]
> 本專案為 **Jed 個人受控專案**。
> 所有開發行為皆遵循 `compliance_scope` 的個人專案白名單防護規範及相關技術選型準則。

# Gemini Bookrize

This Chrome Extension adds two powerful features to the Google Gemini web interface (`gemini.google.com`):

1.  **Tab Title Sync**: Automatically updates your Chrome tab title to match the current conversation topic, making it easier to find the right tab when you have multiple open.
2.  **Conversation Index Sidebar**: Adds a floating sidebar on the right side of the screen that lists your questions/prompts. Clicking on an item instantly scrolls the chat to that specific message.

## 🚀 快速安裝指引

> [!IMPORTANT]
> 本擴充功能專為 **[gemini.google.com](https://gemini.google.com)** 進行設計。請確保您在此網域下使用。

### 🛠️ 手動安裝步驟

**步驟一：開啟 Chrome 擴充功能設定**
1. 打開您的 Google Chrome 瀏覽器。
2. 在網址列輸入：`chrome://extensions/` 並按 Enter 鍵進入。

**步驟二：開啟開發人員模式**
1. 請看瀏覽器畫面的 **右上角**。
2. 找到「**開發人員模式 (Developer mode)**」的開關，並點擊將其**打開**。

**步驟三：載入擴充功能資料夾**
1. 確定您可以看到包含 `manifest.json` 檔案的這個專案資料夾。
2. 點擊畫面左上角的 **「載入未封裝項目 (Load unpacked)」** 按鈕。
3. 選取本資料夾即可完成載入。

> [!TIP]
> 💡 **超快速秘訣**：當「開發人員模式」開啟後，您可以**直接將整個資料夾用滑鼠「拖放」**到 `chrome://extensions/` 畫面中央，立刻安裝完畢！

**步驟四：完成安裝！**
1. 前往 [Gemini 網頁介面](https://gemini.google.com/)。
2. 重新整理頁面 (F5)。
3. 當開啟對話後，您就可以看見自動化整理與右側的便利選單！

## Troubleshooting

*   **Sidebar not appearing?** Refresh the Gemini page. The extension relies on detecting the chat structure. If the chat is empty, the sidebar might say "Waiting for messages...".
*   **Title not syncing?** Try clicking on the chat in the sidebar to ensure it's "active". The extension scans for the active conversation title.

## Privacy

This extension runs entirely locally in your browser. It scans the page DOM to find your prompts for the navigation feature but *does not* send any data to external servers.
