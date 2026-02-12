/*
 * Gemini Bookrize - Pure Bookmark Version
 * ------------------------------------------------
 * 功能：
 * 1. 框選文字即時存為標籤（書籤）。
 * 2. 側邊欄顯示當前對話的所有標籤。
 * 3. 點擊標籤精準捲動至內容及視覺提示。
 * 4. 嚴格隔離機制：一個對話即一本書，書籤互不干涉。
 */

// ---------------------------------------------------------
// 工具函式：防抖動 (Debounce)，避免短時間內頻繁觸發
// ---------------------------------------------------------
function debounce(func, wait) {
    let timeout;
    return function (...args) {
        const context = this;
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(context, args), wait);
    };
}

let currentBookmarks = {}; // 格式: { convoId: { promptText: { customName, timestamp } } }
let lastConvoId = "";      // 用於追蹤對話 ID 是否變動

// ---------------------------------------------------------
// 輔助函式：從 URL 獲取對話 ID (Conversation ID)
// ---------------------------------------------------------
function getConversationId() {
    const path = window.location.pathname;
    // 1. 處理一般對話: /app/c/xxxxxxxxxxxx
    // 2. 處理 Gem 對話: /app/gems/abc/c/xxxxxxxxxxxx
    // 邏輯：抓取路徑中最後一段符合 ID 格式 (字母、數字、底線、減號) 的部分
    const parts = path.split('/');
    const lastPart = parts[parts.length - 1];

    // 如果路徑最後一段看起來像 ID (長度通常較長且包含特定字元)，則回傳它
    if (lastPart && /^[a-zA-Z0-9_-]{10,}$/.test(lastPart)) {
        return lastPart;
    }

    // 如果沒匹配到，再嘗試找包含 /c/ 的部分
    const cMatch = path.match(/\/c\/([a-zA-Z0-9_-]+)/);
    if (cMatch) return cMatch[1];

    return "new_chat"; // 如果是新對話，標記為 new_chat
}

// ---------------------------------------------------------
// 輔助函式：書籤儲存與讀取 (LocalStorage)
// ---------------------------------------------------------
function loadBookmarks() {
    try {
        const saved = localStorage.getItem('gemini_nav_bookmarks');
        if (saved) {
            currentBookmarks = JSON.parse(saved);
        }
    } catch (e) {
        console.error("無法載入書籤數據", e);
    }
}

function saveBookmarks() {
    localStorage.setItem('gemini_nav_bookmarks', JSON.stringify(currentBookmarks));
}

// ---------------------------------------------------------
// 核心功能：更新側邊欄 UI
// ---------------------------------------------------------
function updateSidebar() {
    const sidebarId = 'gemini-bookrize-sidebar';
    let sidebar = document.getElementById(sidebarId);

    // 如果側邊欄不存在，建立它
    if (!sidebar) {
        sidebar = document.createElement('div');
        sidebar.id = sidebarId;
        sidebar.className = 'collapsed';
        sidebar.innerHTML = `
            <h3>
                <span>🔖 本書標籤</span>
                <button id="gemini-nav-toggle" title="收起">❯</button>
            </h3>
            <div id="gemini-collapsed-icon" title="展開標籤">❮</div>
            <div id="gemini-bookmarks-list-container">
                <div id="gemini-bookmarks-list"></div>
            </div>
        `;
        document.body.appendChild(sidebar);

        const toggleBtn = sidebar.querySelector('#gemini-nav-toggle');
        const collapsedIcon = sidebar.querySelector('#gemini-collapsed-icon');

        const toggleSidebar = (e) => {
            e.stopPropagation();
            const isCollapsing = !sidebar.classList.contains('collapsed');
            sidebar.classList.toggle('collapsed');

            // 調整 Gemini 主畫面邊界，避免遮擋
            const main = document.querySelector('main') || document.querySelector('[role="main"]');
            if (main) {
                main.style.transition = 'margin-right 0.3s ease';
                main.style.marginRight = isCollapsing ? '50px' : '280px';
            }
        };

        toggleBtn.onclick = toggleSidebar;
        collapsedIcon.onclick = toggleSidebar;
    }

    renderBookmarks();
}

// ---------------------------------------------------------
// 核心功能：渲染書籤列表 (執行隔離邏輯)
// ---------------------------------------------------------
function renderBookmarks() {
    const sidebar = document.getElementById('gemini-bookrize-sidebar');
    if (!sidebar) return;

    const list = sidebar.querySelector('#gemini-bookmarks-list');

    // 如果使用者正在編輯書籤標題，跳過重新渲染，避免 DOM 重建導致焦點丟失
    if (document.activeElement &&
        document.activeElement.classList.contains('bookmark-label') &&
        list.contains(document.activeElement)) {
        return;
    }

    const convoId = getConversationId();

    // 嚴格隔離：只抓取目前對話 ID 下的書籤
    const convoBookmarks = currentBookmarks[convoId] || {};

    // 根據 order 排序，如果沒有 order 則用 timestamp
    const sortedKeys = Object.keys(convoBookmarks).sort((a, b) => {
        const orderA = convoBookmarks[a].order !== undefined ? convoBookmarks[a].order : convoBookmarks[a].timestamp || 0;
        const orderB = convoBookmarks[b].order !== undefined ? convoBookmarks[b].order : convoBookmarks[b].timestamp || 0;
        return orderB - orderA; // 降序排列 (新的在前)
    });

    // 如果沒有任何書籤，顯示提示文字
    if (sortedKeys.length === 0) {
        list.innerHTML = `
            <div style="padding:20px; text-align:center; opacity:0.5; font-size:12px;">
                目前「這本書」尚無標籤<br>
                框選任何文字即可加入
            </div>`;
        return;
    }

    list.innerHTML = '';
    sortedKeys.forEach((text, index) => {
        const data = convoBookmarks[text];
        const item = document.createElement('div');
        item.className = 'gemini-bookmark-item';
        item.setAttribute('draggable', 'true');
        item.dataset.text = text;

        // --- 1. 左側：導航圖標 (模式: 移動到位) ---
        const navIcon = document.createElement('div');
        navIcon.className = 'bookmark-nav-trigger';
        navIcon.innerHTML = '🔖';
        navIcon.title = '點擊捲動至此位置';
        navIcon.onclick = (e) => {
            e.stopPropagation();
            scrollToText(text);
        };

        // --- 2. 中央：標題文字 (模式: 修改名稱) ---
        const label = document.createElement('div');
        label.className = 'bookmark-label';
        label.innerText = data.customName || (text.length > 30 ? text.substring(0, 30) + '...' : text);
        label.title = '原始文字: ' + text;
        label.contentEditable = 'true'; // 直接支援編輯

        label.onblur = () => {
            const newName = label.innerText.trim();
            if (newName && newName !== (data.customName || text)) {
                currentBookmarks[convoId][text].customName = newName;
                saveBookmarks();
            }
        };
        label.onkeydown = (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                label.blur();
            }
        };

        // --- 3. 右側組件：拖拽手柄 + 刪除按鈕 (模式: 抓取移動) ---
        const rightContainer = document.createElement('div');
        rightContainer.style.display = 'flex';
        rightContainer.style.alignItems = 'center';

        const actions = document.createElement('div');
        actions.className = 'bookmark-actions';
        const delBtn = document.createElement('button');
        delBtn.innerHTML = '🗑️';
        delBtn.title = '刪除書籤';
        delBtn.onclick = (e) => {
            e.stopPropagation();
            if (confirm("確定要刪除此標籤嗎？")) {
                delete currentBookmarks[convoId][text];
                saveBookmarks();
                renderBookmarks();
            }
        };
        actions.appendChild(delBtn);

        const dragHandle = document.createElement('div');
        dragHandle.className = 'bookmark-drag-handle';
        dragHandle.innerHTML = '⠿';
        dragHandle.title = '按住拖拽以排序';

        rightContainer.appendChild(actions);
        rightContainer.appendChild(dragHandle);

        item.appendChild(navIcon);
        item.appendChild(label);
        item.appendChild(rightContainer);

        // --- 拖拽事件處理 ---
        item.ondragstart = (e) => {
            e.dataTransfer.setData('text/plain', text);
            item.classList.add('dragging');
        };

        item.ondragend = () => {
            item.classList.remove('dragging');
            const allItems = list.querySelectorAll('.gemini-bookmark-item');
            allItems.forEach(i => i.classList.remove('drag-over'));
        };

        item.ondragover = (e) => {
            e.preventDefault();
            const draggingItem = list.querySelector('.dragging');
            if (draggingItem !== item) {
                item.classList.add('drag-over');
            }
        };

        item.ondragleave = () => {
            item.classList.remove('drag-over');
        };

        item.ondrop = (e) => {
            e.preventDefault();
            const draggedText = e.dataTransfer.getData('text/plain');
            if (draggedText === text) return;

            // 重新計算所有書籤的 order
            const allItems = Array.from(list.querySelectorAll('.gemini-bookmark-item'));
            const draggedIndex = allItems.findIndex(i => i.dataset.text === draggedText);
            const targetIndex = allItems.findIndex(i => i.dataset.text === text);

            // 在記憶體中重新排序
            const convoData = currentBookmarks[convoId];
            const keys = sortedKeys.filter(k => k !== draggedText);
            keys.splice(targetIndex, 0, draggedText);

            // 更新 order 權重 (大到小)
            keys.reverse().forEach((k, i) => {
                convoData[k].order = i;
            });

            saveBookmarks();
            renderBookmarks();
        };

        list.appendChild(item);
    });
}

// ---------------------------------------------------------
// 輔助函式：捲動至指定文字
// ---------------------------------------------------------
function scrollToText(text) {
    try {
        const walker = document.createTreeWalker(
            document.querySelector('main') || document.body,
            NodeFilter.SHOW_TEXT,
            null,
            false
        );

        let node;
        let found = false;
        while (node = walker.nextNode()) {
            if (node.textContent.includes(text)) {
                node.parentElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
                const originalBg = node.parentElement.style.backgroundColor;
                node.parentElement.style.transition = 'background-color 0.5s';
                node.parentElement.style.backgroundColor = 'rgba(26, 115, 232, 0.2)';
                setTimeout(() => {
                    node.parentElement.style.backgroundColor = originalBg;
                }, 2000);
                found = true;
                break;
            }
        }
        if (!found) alert("找不到該段文字，可能已被編輯或刪除。");
    } catch (e) {
        console.error("導航失敗", e);
    }
}

// ---------------------------------------------------------
// 核心功能：選取文字與浮動按鈕
// ---------------------------------------------------------
function handleTextSelection() {
    const selection = window.getSelection();
    const selectedText = selection.toString().trim();
    const btnId = 'gemini-selection-bookmark-btn';
    let btn = document.getElementById(btnId);

    // 文字太短或未選取時移除按鈕
    if (selectedText.length < 2 || selection.rangeCount === 0) {
        if (btn) btn.remove();
        return;
    }

    if (!btn) {
        btn = document.createElement('button');
        btn.id = btnId;
        btn.innerHTML = '🔖 存為標籤';
        document.body.appendChild(btn);
    }

    try {
        const range = selection.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;

        // 定位按鈕在選取文字上方
        btn.style.top = `${window.scrollY + rect.top - 45}px`;
        btn.style.left = `${window.scrollX + rect.left + (rect.width / 2) - 45}px`;

        btn.onclick = (e) => {
            e.stopPropagation();
            const convoId = getConversationId();

            // 確保該對話的儲存結構存在
            if (!currentBookmarks[convoId]) {
                currentBookmarks[convoId] = {};
            }

            // 寫入書籤數據
            currentBookmarks[convoId][selectedText] = {
                customName: "",
                timestamp: new Date().getTime(),
                order: Date.now() // 使用當前時間戳作為初始排序權重
            };

            saveBookmarks();
            renderBookmarks();

            btn.innerHTML = '✅ 已加入';
            setTimeout(() => {
                if (btn.parentNode) btn.remove();
                selection.removeAllRanges();
            }, 800);
        };
    } catch (e) {
        if (btn) btn.remove();
    }
}

// ---------------------------------------------------------
// 初始化與監控邏輯
// ---------------------------------------------------------
const init = () => {
    loadBookmarks();
    updateSidebar();
    lastConvoId = getConversationId();

    // 1. 監控 DOM 變動（Gemini 動態載入內容時更新）
    const observer = new MutationObserver(debounce(() => {
        updateSidebar();
    }, 1000));
    observer.observe(document.body, { childList: true, subtree: true });

    // 2. 監控 URL 變動（切換「書本」即對話時立即切換書籤）
    setInterval(() => {
        const currentId = getConversationId();
        if (currentId !== lastConvoId) {
            lastConvoId = currentId;
            console.log("偵測到對話切換，更新書籤列表...");
            renderBookmarks();
        }
    }, 1000);

    // 3. 處理滑鼠事件
    document.addEventListener('mousedown', (e) => {
        const btn = document.getElementById('gemini-selection-bookmark-btn');
        if (btn && e.target !== btn) btn.remove();
    });

    document.addEventListener('mouseup', debounce(handleTextSelection, 200));
};

// 啟動插件
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
