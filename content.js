/*
 * Gemini Bookrize - Pure Bookmark Version
 * ------------------------------------------------
 * 功能：
 * 1. 框選文字即時存為標籤（書籤）。
 * 2. 側邊欄顯示當前對話的所有標籤。
 * 3. 點擊標籤精準捲動至內容及視覺提示。
 * 4. 嚴格隔離機制：一個對話即一本書，書籤互不干涉。
 *
 * 資料結構 (v2)：
 * currentBookmarks = {
 *   [convoId]: {
 *     [uniqueId]: { id, text, customName, timestamp, order }
 *   }
 * }
 * 改用唯一 ID 作為 key，避免相同文字的書籤互相覆蓋，支援 20 個以上。
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
let currentViewMode = 'current'; // 'current' | 'all'

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
// 輔助函式：書籤儲存與讀取 (Chrome Storage API - 非同步)
// ---------------------------------------------------------
async function loadBookmarks() {
    try {
        // 1. 先嘗試從 chrome.storage.local 讀取
        const result = await chrome.storage.local.get(['gemini_nav_bookmarks', 'migration_done']);

        if (result.gemini_nav_bookmarks) {
            currentBookmarks = result.gemini_nav_bookmarks;
            console.log("從 chrome.storage 載入書籤成功");
        } else if (!result.migration_done) {
            // 2. 如果新儲存區沒資料且尚未遷移，嘗試從舊的 localStorage 遷移
            const oldData = localStorage.getItem('gemini_nav_bookmarks');
            if (oldData) {
                try {
                    currentBookmarks = JSON.parse(oldData);
                    // 立即遷移至新儲存區
                    await chrome.storage.local.set({
                        'gemini_nav_bookmarks': currentBookmarks,
                        'migration_done': true
                    });
                    console.log("已成功將舊資料從 localStorage 遷移至 chrome.storage");
                } catch (e) {
                    console.error("遷移資料失敗", e);
                }
            } else {
                // 如果連舊資料都沒有，確保初始化為空物件
                currentBookmarks = {};
                await chrome.storage.local.set({ 'migration_done': true });
            }
        } else {
            // 已搬遷過但目前無資料
            currentBookmarks = {};
        }
    } catch (e) {
        console.error("無法載入書籤數據 (Storage API)", e);
        currentBookmarks = {}; // 確保失敗時不會崩潰
    }
}

async function saveBookmarks() {
    try {
        await chrome.storage.local.set({ 'gemini_nav_bookmarks': currentBookmarks });
    } catch (e) {
        console.error("儲存書籤失敗", e);
    }
}

// ---------------------------------------------------------
// 輔助函式：產生唯一書籤 ID (timestamp + 隨機數)
// 設計意圖：確保每筆書籤都有獨立的 key，避免相同選取文字互相覆蓋
// ---------------------------------------------------------
function generateBookmarkId() {
    return `bm_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

// ---------------------------------------------------------
// 輔助函式：取得智慧定位資訊 (Anchor + Index)
// 設計意圖：Gemini 的對話是動態生成的，我們找尋最近的「訊息區塊」作為相對起點。
// ---------------------------------------------------------
function getSmartAnchorInfo(element) {
    if (!element) return { selector: '', index: -1 };
    if (element.nodeType === Node.TEXT_NODE) element = element.parentElement;

    // 1. 尋找最近的訊息區塊容器 (Gemini 的對話區塊通常有 role="article" 或特定 class)
    // 經觀察，對話內容多位於 <div role="article"> 或包含 .message-content 的容器中
    const messageContainer = element.closest('[role="article"]') || element.closest('.conversation-container');
    
    if (messageContainer) {
        // 取得頁面中所有的訊息區塊，標記這是第幾個
        const allMessages = Array.from(document.querySelectorAll('[role="article"]'));
        const msgIndex = allMessages.indexOf(messageContainer);
        return { type: 'anchor', index: msgIndex, textPreview: messageContainer.innerText.substring(0, 50) };
    }

    return { type: 'global', index: -1 };
}

// ---------------------------------------------------------
// 輔助函式：取得選取文字的上下文指紋 (Context Fingerprint)
// 設計意圖：解決相同文字出現在同一個訊息區塊內的情況。
// ---------------------------------------------------------
function getContextFingerprint(range) {
    try {
        const fullText = range.startContainer.ownerDocument.body.innerText;
        const selectedText = range.toString();
        
        // 取得 startContainer 的完整文字內容與偏移量
        const containerText = range.startContainer.textContent;
        const offset = range.startOffset;

        // 擷取前後各 25 個字元作為「指紋」
        const prefix = containerText.substring(Math.max(0, offset - 25), offset);
        const suffix = containerText.substring(range.endOffset, Math.min(containerText.length, range.endOffset + 25));

        return { prefix, suffix };
    } catch (e) {
        return { prefix: '', suffix: '' };
    }
}

// ---------------------------------------------------------
function exportBookmarks() {
    if (!currentBookmarks || Object.keys(currentBookmarks).length === 0) {
        alert("目前書櫃沒有任何書籤可以匯出！");
        return;
    }

    // 建立 JSON 內容 (全書櫃格式)
    const exportData = {
        exportVersion: 2,
        exportedAt: new Date().toISOString(),
        bookshelf: currentBookmarks
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    // 建立虛擬連結觸發下載
    const a = document.createElement('a');
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    a.href = url;
    a.download = `Gemini_Bookshelf_Backup_${dateStr}.json`;
    document.body.appendChild(a);
    a.click();

    // 清理資源
    setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, 0);
}

// ---------------------------------------------------------
// 實作功能：匯入書籤備份 (JSON) - 改進版：自動分派與過濾
// ---------------------------------------------------------
function importBookmarks(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const data = JSON.parse(e.target.result);
            let importedCount = 0;
            let homelessCount = 0;

            // 1. 偵測格式：是否為全書櫃格式 (bookshelf)
            if (data.bookshelf && typeof data.bookshelf === 'object') {
                for (const convoId in data.bookshelf) {
                    const bookmarks = data.bookshelf[convoId];
                    // 檢查對話 ID 是否有效 (非空且為物件)
                    if (convoId && convoId !== 'undefined' && typeof bookmarks === 'object') {
                        if (!currentBookmarks[convoId]) {
                            currentBookmarks[convoId] = {};
                        }
                        for (const bmId in bookmarks) {
                            currentBookmarks[convoId][bmId] = bookmarks[bmId];
                            importedCount++;
                        }
                    } else {
                        homelessCount++;
                    }
                }
            } 
            // 2. 向下相容：偵測是否為單一對話格式 (由之前的版本匯出)
            else if (data.convoId && data.bookmarks) {
                const targetConvoId = data.convoId;
                if (!currentBookmarks[targetConvoId]) {
                    currentBookmarks[targetConvoId] = {};
                }
                for (const bmId in data.bookmarks) {
                    currentBookmarks[targetConvoId][bmId] = data.bookmarks[bmId];
                    importedCount++;
                }
            } 
            else {
                alert("無法辨識的備份檔案格式！");
                return;
            }
            
            await saveBookmarks();
            renderBookmarks();
            
            let resultMsg = `成功匯入 ${importedCount} 個標籤！`;
            if (homelessCount > 0) {
                resultMsg += `\n注意：有 ${homelessCount} 組資料因找不到所屬對話而被跳過。`;
            }
            alert(resultMsg);
            
        } catch (err) {
            console.error(err);
            alert("讀取檔案時發生錯誤！請確認格式是否正確。");
        }
    };
    reader.readAsText(file);
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
            <div id="gemini-export-container" style="padding: 0 15px 10px 15px; display: flex; gap: 8px;">
                <button id="gemini-export-btn" class="gemini-action-btn" title="匯出整個書櫃的所有書籤" style="flex: 1;">📤 匯出</button>
                <button id="gemini-import-btn" class="gemini-action-btn" title="從備份檔還原書籤(自動分派至所屬對話)" style="flex: 1; background: linear-gradient(135deg, #34a853, #188038);">📥 匯入</button>
                <input type="file" id="gemini-import-input" accept=".json" style="display: none;" />
            </div>
            <div id="gemini-search-container" class="gemini-search-box">
                <input type="text" id="gemini-search-input" placeholder="🔍 搜尋對話內容..." title="輸入關鍵字後按 Enter 搜尋" />
                <div class="gemini-search-actions">
                    <button id="gemini-search-prev" title="找上一個">ᐱ</button>
                    <button id="gemini-search-next" title="找下一個">ᐯ</button>
                </div>
            </div>
            <div id="gemini-tabs-container" class="gemini-tabs">
                <button id="gemini-tab-current" class="gemini-tab active">📍 本書專屬</button>
                <button id="gemini-tab-all" class="gemini-tab">🌐 整個書櫃</button>
            </div>
            <div id="gemini-collapsed-icon" title="展開標籤">❮</div>
            <div id="gemini-bookmarks-list-container">
                <div id="gemini-bookmarks-list"></div>
            </div>
        `;
        document.body.appendChild(sidebar);

        const toggleBtn = sidebar.querySelector('#gemini-nav-toggle');
        const collapsedIcon = sidebar.querySelector('#gemini-collapsed-icon');
        const exportBtn = sidebar.querySelector('#gemini-export-btn');
        const importBtn = sidebar.querySelector('#gemini-import-btn');
        const importInput = sidebar.querySelector('#gemini-import-input');
        const tabCurrent = sidebar.querySelector('#gemini-tab-current');
        const tabAll = sidebar.querySelector('#gemini-tab-all');

        const toggleSidebar = (e) => {
            e.stopPropagation();
            const isCollapsing = !sidebar.classList.contains('collapsed');
            sidebar.classList.toggle('collapsed');

            // 調整 Gemini 主畫面邊界，避免遮擋
            const main = document.querySelector('main') || document.querySelector('[role="main"]');
            if (main) {
                main.style.transition = 'margin-right 0.3s ease';
                main.style.marginRight = isCollapsing ? '38px' : '280px';
            }
        };

        toggleBtn.onclick = toggleSidebar;
        collapsedIcon.onclick = toggleSidebar;
        exportBtn.onclick = (e) => {
            e.stopPropagation();
            exportBookmarks();
        };

        importBtn.onclick = (e) => {
            e.stopPropagation();
            importInput.click();
        };

        importInput.onchange = (e) => {
            const file = e.target.files[0];
            if (file) {
                importBookmarks(file);
            }
            // 清空 value 允許重複選擇同一檔案
            e.target.value = '';
        };

        const searchInput = sidebar.querySelector('#gemini-search-input');
        const searchPrev = sidebar.querySelector('#gemini-search-prev');
        const searchNext = sidebar.querySelector('#gemini-search-next');

        const doSearch = (backward = false) => {
            const query = searchInput.value;
            if (!query) return;
            // aString, aCaseSensitive, aBackwards, aWrapAround, aWholeWord, aSearchInFrames, aShowDialog
            const found = window.find(query, false, backward, true, false, false, false);
            if (!found) {
                searchInput.classList.add('not-found');
                setTimeout(() => searchInput.classList.remove('not-found'), 400);
            } else {
                // 強制捲動到該選取區，解決某些 SPA (如 Gemini) 特定 overflow 容器無法原生跳轉的問題
                try {
                    const selection = window.getSelection();
                    if (selection.rangeCount > 0) {
                        const range = selection.getRangeAt(0);
                        let targetNode = range.startContainer;
                        if (targetNode.nodeType === Node.TEXT_NODE) targetNode = targetNode.parentElement;
                        if (targetNode && typeof targetNode.scrollIntoView === 'function') {
                            targetNode.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        }
                    }
                } catch (e) {
                    console.warn("無法平滑捲動到搜尋結果", e);
                }
            }
        };

        searchInput.addEventListener('keydown', (e) => {
            // 使用 Capture phase 避免干擾，並同時防堵其他元件攔截事件
            e.stopPropagation();
            if (e.key === 'Enter' || e.keyCode === 13) {
                e.preventDefault();
                doSearch(e.shiftKey); // Shift+Enter 往回找
            }
        }, true);

        searchPrev.onclick = (e) => { e.stopPropagation(); doSearch(true); };
        searchNext.onclick = (e) => { e.stopPropagation(); doSearch(false); };

        tabCurrent.onclick = (e) => {
            e.stopPropagation();
            if (currentViewMode !== 'current') {
                currentViewMode = 'current';
                tabCurrent.classList.add('active');
                tabAll.classList.remove('active');
                renderBookmarks();
            }
        };

        tabAll.onclick = (e) => {
            e.stopPropagation();
            if (currentViewMode !== 'all') {
                currentViewMode = 'all';
                tabAll.classList.add('active');
                tabCurrent.classList.remove('active');
                renderBookmarks();
            }
        };
    }

    renderBookmarks();
}

// ---------------------------------------------------------
// 核心功能：渲染書籤列表 (執行隔離邏輯)
// 設計意圖：以唯一 ID (bmId) 為 key 迭代，每筆書籤的 text 欄位存放原始文字
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
    let sortedItems = [];

    if (currentViewMode === 'current') {
        const convoBookmarks = currentBookmarks[convoId] || {};
        const sortedIds = Object.keys(convoBookmarks).sort((a, b) => {
            const bmA = convoBookmarks[a];
            const bmB = convoBookmarks[b];
            const orderA = bmA.order !== undefined ? bmA.order : bmA.timestamp || 0;
            const orderB = bmB.order !== undefined ? bmB.order : bmB.timestamp || 0;
            return orderB - orderA;
        });
        sortedIds.forEach(bmId => {
            sortedItems.push({ itemConvoId: convoId, bmId, data: convoBookmarks[bmId] });
        });
    } else {
        // 'all' mode
        for (const cid in currentBookmarks) {
            const cBookmarks = currentBookmarks[cid];
            for (const bmId in cBookmarks) {
                 sortedItems.push({ itemConvoId: cid, bmId, data: cBookmarks[bmId] });
            }
        }
        // 按 timestamp 降序
        sortedItems.sort((a, b) => {
            const tA = a.data.timestamp || 0;
            const tB = b.data.timestamp || 0;
            return tB - tA;
        });
    }

    // 顯示書籤數量提示
    let countEl = sidebar.querySelector('#gemini-bookmark-count');
    if (!countEl) {
        countEl = document.createElement('div');
        countEl.id = 'gemini-bookmark-count';
        countEl.style.cssText = 'padding:0 15px 6px 15px; font-size:11px; opacity:0.5; text-align:right;';
        const tabsContainer = sidebar.querySelector('#gemini-tabs-container');
        if (tabsContainer) tabsContainer.after(countEl);
    }
    countEl.textContent = sortedItems.length > 0 ? `共 ${sortedItems.length} 個書籤` : '';

    list.innerHTML = '';

    // --- 建立「移到最新對話」常駐按鈕 ---
    const scrollBottomItem = document.createElement('div');
    scrollBottomItem.className = 'gemini-bookmark-item gemini-scroll-bottom-item';
    
    // 預防該項目被拖放邏輯影響 (移除 draggable)
    scrollBottomItem.removeAttribute('draggable');
    
    const sbIcon = document.createElement('div');
    sbIcon.className = 'bookmark-nav-trigger';
    sbIcon.innerHTML = '⬇️';
    sbIcon.title = '點擊捲動至對話最底部';
    
    const sbLabel = document.createElement('div');
    sbLabel.className = 'bookmark-label';
    sbLabel.innerText = '移到最新對話';
    // 移除可編輯屬性
    sbLabel.contentEditable = 'false';
    
    scrollBottomItem.appendChild(sbIcon);
    scrollBottomItem.appendChild(sbLabel);
    
    // 點擊事件：移至對話最下方
    scrollBottomItem.onclick = (e) => {
        e.stopPropagation();
        // 嘗試尋找訊息區塊，優先捲動最後一個訊息區塊
        const messages = document.querySelectorAll('message-content, [role="article"], .conversation-container');
        if (messages.length > 0) {
            const lastMessage = messages[messages.length - 1];
            lastMessage.scrollIntoView({ behavior: 'smooth', block: 'end' });
        } else {
            // 備用：捲動到底部
            window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
        }
    };
    
    list.appendChild(scrollBottomItem);

    // 如果沒有任何書籤，顯示提示文字
    if (sortedItems.length === 0) {
        let emptyMsg = currentViewMode === 'current' 
            ? '目前「這本書」尚無標籤<br>框選任何文字即可加入'
            : '您的書櫃目前空空如也<br>在任何對話中框選文字即可加入標籤';
        const emptyDiv = document.createElement('div');
        emptyDiv.style.padding = '20px';
        emptyDiv.style.textAlign = 'center';
        emptyDiv.style.opacity = '0.5';
        emptyDiv.style.fontSize = '12px';
        emptyDiv.innerHTML = emptyMsg;
        list.appendChild(emptyDiv);
        return;
    }
    sortedItems.forEach(({ itemConvoId, bmId, data }) => {
        // 每筆書籤物件：{ id, text, customName, timestamp, order }
        const originalText = data.text || bmId; // 向下相容舊格式

        const item = document.createElement('div');
        item.className = 'gemini-bookmark-item';
        
        // 只有 current 模式可以拖曳排序
        if (currentViewMode === 'current') {
            item.setAttribute('draggable', 'true');
        }
        item.dataset.bmId = bmId; // 以唯一 ID 識別，非文字

        // --- 1. 左側：導航圖標 (模式: 移動到位) ---
        const navIcon = document.createElement('div');
        navIcon.className = 'bookmark-nav-trigger';
        // 如果來源對話與現在不同，圖示改為另開視窗
        navIcon.innerHTML = itemConvoId === convoId ? '🔖' : '🗗';
        navIcon.title = itemConvoId === convoId ? '點擊捲動至此位置' : '點擊在新分頁開啟該對話';
        
        navIcon.onclick = (e) => {
            e.stopPropagation();
            if (itemConvoId === convoId) {
                // Same conversation
                scrollToBookmark(originalText, data.anchorInfo || { type: 'global', index: data.msgIndex }, data.fingerprint);
            } else {
                // 不同對話，優先使用儲存的路徑，否則回退至最新的 /app/id 格式 (避免舊版 /app/c/ 導致的 404)
                const targetPath = data.path || `/app/${itemConvoId}`;
                // 處理 new_chat 特殊情況
                const finalUrl = itemConvoId === 'new_chat' ? 'https://gemini.google.com/app' : `https://gemini.google.com${targetPath}`;
                window.open(finalUrl, '_blank');
            }
        };

        // --- 2. 中央：標題文字 (模式: 修改名稱) ---
        const label = document.createElement('div');
        label.className = 'bookmark-label';
        
        // 如果在 All 模式下，不是當下這本，顯示外部圖示提示
        let displayText = data.customName || (originalText.length > 30 ? originalText.substring(0, 30) + '...' : originalText);
        let prefix = (currentViewMode === 'all' && itemConvoId !== convoId) ? '[其他對話] ' : '';
        label.innerText = prefix + displayText;
        
        label.title = '原始文字: ' + originalText;
        label.contentEditable = 'true'; // 直接在列表內編輯

        label.onblur = () => {
            let newName = label.innerText.trim();
            // 在儲存時，要移除掉我們加上的 prefix
            if (currentViewMode === 'all' && itemConvoId !== convoId && newName.startsWith('[其他對話] ')) {
                newName = newName.substring('[其他對話] '.length).trim();
            }
            // 只要有變動即儲存，允許自訂名稱與原始文字相同
            if (newName && currentBookmarks[itemConvoId] && currentBookmarks[itemConvoId][bmId]) {
                currentBookmarks[itemConvoId][bmId].customName = newName;
                saveBookmarks();
            }
        };
        label.onkeydown = (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                label.blur();
            }
        };

        // --- 3. 右側組件：拖拽手柄 + 刪除按鈕 ---
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
                // 以所在 convoId 刪除
                delete currentBookmarks[itemConvoId][bmId];
                saveBookmarks().then(() => renderBookmarks());
            }
        };
        actions.appendChild(delBtn);

        const dragHandle = document.createElement('div');
        dragHandle.className = 'bookmark-drag-handle';
        // 只有 current 模式顯示拖曳手柄
        if (currentViewMode === 'current') {
            dragHandle.innerHTML = '⠿';
            dragHandle.title = '按住拖拽以排序';
        }

        rightContainer.appendChild(actions);
        if (currentViewMode === 'current') {
            rightContainer.appendChild(dragHandle);
        }

        item.appendChild(navIcon);
        item.appendChild(label);
        item.appendChild(rightContainer);

        // --- 拖拽事件處理 (僅限 current 模式) ---
        if (currentViewMode === 'current') {
            item.ondragstart = (e) => {
                e.dataTransfer.setData('text/plain', bmId);
                item.classList.add('dragging');
            };

            item.ondragend = () => {
                item.classList.remove('dragging');
                list.querySelectorAll('.gemini-bookmark-item').forEach(i => i.classList.remove('drag-over'));
            };

            item.ondragover = (e) => {
                e.preventDefault();
                const draggingItem = list.querySelector('.dragging');
                if (draggingItem !== item) item.classList.add('drag-over');
            };

            item.ondragleave = () => {
                item.classList.remove('drag-over');
            };

            item.ondrop = (e) => {
                e.preventDefault();
                const draggedId = e.dataTransfer.getData('text/plain');
                if (draggedId === bmId) return;

                // 在記憶體中重新排序：把拖曳的 ID 插到目標 ID 的位置
                const convoData = currentBookmarks[convoId];
                // 抓取 sortedItems 的 ID 清單以尋找位置
                const sIds = sortedItems.map(si => si.bmId);
                const targetIndex = sIds.findIndex(id => id === bmId);
                const reordered = sIds.filter(id => id !== draggedId);
                reordered.splice(targetIndex, 0, draggedId);

                // 從小到大重新賦值 order 權重 (倒序讓新的 order 大 = 排前面)
                reordered.reverse().forEach((id, i) => {
                    if (convoData[id]) convoData[id].order = i;
                });

                saveBookmarks().then(() => renderBookmarks());
            };
        }

        list.appendChild(item);
    });
}

// ---------------------------------------------------------
// 輔助函式：視覺高亮指定元素（捲動後閃爍提示）
// ---------------------------------------------------------
function highlightElement(el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const originalBg = el.style.backgroundColor;
    el.style.transition = 'background-color 0.5s';
    el.style.backgroundColor = 'rgba(26, 115, 232, 0.2)';
    setTimeout(() => { el.style.backgroundColor = originalBg; }, 2000);
}

// ---------------------------------------------------------
// 核心函式：捲動至書籤位置
// 設計意圖：
//   1. 優先使用儲存的 XPath 精確定位元素，解決相同文字定位錯誤的 BUG
//   2. XPath 失敗（元素已移除或結構改變）時，退回文字搜尋作為備援
// ---------------------------------------------------------
// ---------------------------------------------------------
// 核心函式：捲動至書籤位置 (複合定位版)
// 設計意圖：三級降級定位策略
//   1. Anchor 級：先定位到正確的訊息區塊索引，再於內部尋找。
//   2. Fingerprint 級：若 Anchor 失敗，嘗試匹配上下文文字。
//   3. 全局級：最後退回通用的文字搜尋。
// ---------------------------------------------------------
function scrollToBookmark(text, anchorInfo, fingerprint) {
    // 統一的高亮工具
    const doHighlight = (el) => {
        if (!el) return false;
        highlightElement(el);
        return true;
    };

    // --- 策略 1：Anchor 訊息區塊定位 ---
    if (anchorInfo && anchorInfo.type === 'anchor' && anchorInfo.index !== -1) {
        const allMessages = document.querySelectorAll('[role="article"]');
        const targetMsg = allMessages[anchorInfo.index];
        if (targetMsg) {
            // 在該訊息區塊內尋找文字
            const walker = document.createTreeWalker(targetMsg, NodeFilter.SHOW_TEXT, null, false);
            let node;
            while (node = walker.nextNode()) {
                if (node.textContent.includes(text)) {
                    // 如果有指紋資訊，進一步比對上下文
                    if (fingerprint && fingerprint.prefix) {
                        if (node.textContent.includes(fingerprint.prefix) || node.parentElement.innerText.includes(fingerprint.prefix)) {
                            if (doHighlight(node.parentElement)) return;
                        }
                    } else {
                        if (doHighlight(node.parentElement)) return;
                    }
                }
            }
        }
    }

    // --- 策略 2：Context Fingerprint 全局模糊匹配 ---
    if (fingerprint && (fingerprint.prefix || fingerprint.suffix)) {
        const allTextNodes = [];
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
        let node;
        while (node = walker.nextNode()) {
            if (node.textContent.includes(text)) {
                // 計算匹配得分
                let score = 0;
                if (fingerprint.prefix && node.parentElement.innerText.includes(fingerprint.prefix)) score += 2;
                if (fingerprint.suffix && node.parentElement.innerText.includes(fingerprint.suffix)) score += 2;
                
                if (score >= 2) {
                    if (doHighlight(node.parentElement)) return;
                }
            }
        }
    }

    // --- 策略 3：傳統文字搜尋 (備援) ---
    const globalWalker = document.createTreeWalker(
        document.querySelector('main') || document.body,
        NodeFilter.SHOW_TEXT,
        null,
        false
    );
    let gNode;
    while (gNode = globalWalker.nextNode()) {
        if (gNode.textContent.includes(text)) {
            if (doHighlight(gNode.parentElement)) return;
        }
    }

    alert('找不到該段文字，可能內容已更新或被刪除。');
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

            // 以唯一 ID 為 key 寫入書籤，允許相同文字存多筆，無數量上限
            const bmId = generateBookmarkId();
            const now = Date.now();

            // 捕捉複合定位資訊
            let anchorInfo = { type: 'global', index: -1 };
            let fingerprint = { prefix: '', suffix: '' };
            try {
                const range = window.getSelection().getRangeAt(0);
                anchorInfo = getSmartAnchorInfo(range.startContainer);
                fingerprint = getContextFingerprint(range);
            } catch (ex) {
                console.warn('捕捉定位資訊失敗', ex);
            }

            currentBookmarks[convoId][bmId] = {
                id: bmId,
                text: selectedText,      // 原始選取文字
                path: window.location.pathname, // 儲存完整路徑，用於跨對話導航 (解決 Gem 404 問題)
                anchorInfo: anchorInfo,  // 訊息區塊索引
                fingerprint: fingerprint, // 上下文指紋
                customName: "",
                timestamp: now,
                order: now
            };

            saveBookmarks().then(() => renderBookmarks());

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
// 初始化與監控邏輯 (改為非同步初始化)
// ---------------------------------------------------------
const init = async () => {
    await loadBookmarks();
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
