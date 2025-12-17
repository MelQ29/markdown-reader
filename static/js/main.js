// ------------------------------
// Application State
// ------------------------------
let currentFile = null;
let currentHandle = null;
let rawContent = '';
let isEditing = false;
let beforeSaveSnapshot = '';
let pendingSaveContent = '';
let isRenaming = false;

// Working state for selected files / directory
let directoryHandle = null;
let fileHandles = []; // Array of {name, handle} objects
let currentSourceLabel = 'Источник не выбран';
let lastSavedMode = null;
let lastSavedNames = [];
let restoreNeeded = false;
let isSidebarCollapsed = false;

// ------------------------------
// Markdown / Diff Utilities
// ------------------------------
const md = window.markdownit({
    html: true,
    linkify: true,
    typographer: true,
    highlight: function (str, lang) {
        if (lang && hljs.getLanguage(lang)) {
            try {
                return hljs.highlight(str, { language: lang }).value;
            } catch (__) {}
        }
        return '';
    }
});

let dmp = null;
try {
    dmp = new diff_match_patch();
} catch (e) {
    console.error('diff_match_patch not initialized, diff highlighting disabled', e);
}

// ------------------------------
// IndexedDB Helpers for Persisting Selected Files State
// ------------------------------
const DB_NAME = 'md-reader-state';
const STORE_HANDLES = 'handles';
const STORE_META = 'meta';
const SOURCE_INFO_ID = 'selectedSourceInfo';

/**
 * Update source info display (folder/files status)
 * @param {string} text - Status text to display
 */
function setSourceInfo(text) {
    currentSourceLabel = text;
    const el = document.getElementById(SOURCE_INFO_ID);
    if (el) el.textContent = text;
}

/**
 * Show/hide restore access button
 * @param {boolean} show - Whether to show the button
 * @param {string} label - Button label text
 */
function showRestoreButton(show, label = 'Восстановить доступ') {
    const btn = document.getElementById('restoreAccessBtn');
    if (!btn) return;
    btn.textContent = `🔄 ${label}`;
    if (show) btn.classList.remove('hidden');
    else btn.classList.add('hidden');
}

/**
 * Enable/disable rename functionality visibility
 * @param {boolean} enabled - Whether rename should be available
 */
function setRenameVisible(enabled) {
    const startBtn = document.getElementById('renameStartBtn');
    const form = document.getElementById('renameEditGroup');
    const titleWrap = document.getElementById('titleWithRename');
    if (!startBtn || !form) return;
    if (!enabled) {
        startBtn.classList.add('is-hidden');
        form.classList.add('hidden');
        titleWrap?.classList.remove('editing');
        isRenaming = false;
    } else {
        startBtn.classList.remove('is-hidden');
        if (!isRenaming) {
            form.classList.add('hidden');
            titleWrap?.classList.remove('editing');
        }
    }
}

/**
 * Ensure filename has .md extension
 * @param {string} name - Filename to check
 * @returns {string} Filename with .md extension
 */
function ensureMdExtension(name) {
    if (!name) return '';
    const trimmed = name.trim();
    if (trimmed.toLowerCase().endsWith('.md')) return trimmed;
    return `${trimmed}.md`;
}

/**
 * Check if file exists in current directory
 * @param {string} name - Filename to check
 * @returns {Promise<boolean>} True if file exists
 */
async function fileExistsInDirectory(name) {
    if (!directoryHandle) return false;
    try {
        await directoryHandle.getFileHandle(name, { create: false });
        return true;
    } catch (e) {
        return false;
    }
}

/**
 * Toggle rename UI between edit and view modes
 * @param {boolean} show - True to show edit mode, false for view mode
 */
function toggleRenameUI(show) {
    const form = document.getElementById('renameEditGroup');
    const startBtn = document.getElementById('renameStartBtn');
    const titleWrap = document.getElementById('titleWithRename');
    if (show) {
        form.classList.remove('hidden');
        startBtn.classList.add('hidden');
        titleWrap?.classList.add('editing');
        isRenaming = true;
    } else {
        form.classList.add('hidden');
        startBtn.classList.remove('hidden');
        titleWrap?.classList.remove('editing');
        isRenaming = false;
    }
}

/**
 * Start inline file rename - enter edit mode
 */
function startInlineRename() {
    if (!currentFile) return;
    const input = document.getElementById('renameInput');
    input.value = currentFile.replace(/\.md$/i, '');
    toggleRenameUI(true);
    input.focus();
    input.select();
}

/**
 * Cancel inline rename - exit edit mode
 */
function cancelInlineRename() {
    toggleRenameUI(false);
}

/**
 * Confirm and execute file rename
 * Handles both directory mode (rename in place) and individual files mode (save as new)
 */
async function confirmInlineRename() {
    if (!currentFile || !currentHandle) return;
    const input = document.getElementById('renameInput');
    const newBase = (input.value || '').trim();
    if (!newBase) {
        alert('Введите имя файла.');
        return;
    }
    const newName = ensureMdExtension(newBase);
    if (newName === currentFile) {
        cancelInlineRename();
        return;
    }
    try {
        // Read current file content
        const file = await currentHandle.getFile();
        const text = await file.text();

        if (directoryHandle) {
            // Directory mode: create new file, remove old one
            const exists = await fileExistsInDirectory(newName);
            if (exists) {
                alert(`Файл "${newName}" уже существует.`);
                return;
            }
            const canWriteDir = await ensurePermission(directoryHandle, true);
            if (!canWriteDir) {
                alert('Нет прав на запись в эту папку.');
                return;
            }
            const newHandle = await directoryHandle.getFileHandle(newName, { create: true });
            const writable = await newHandle.createWritable();
            await writable.write(text);
            await writable.close();

            await directoryHandle.removeEntry(currentFile);

            fileHandles = fileHandles.map(f => {
                if (f.name === currentFile) {
                    return { name: newName, handle: newHandle };
                }
                return f;
            }).sort((a, b) => a.name.localeCompare(b.name));

            currentFile = newName;
            currentHandle = newHandle;
        } else {
            // Individual files mode: save as new file via dialog
            if (!window.showSaveFilePicker) {
                alert('Браузер не поддерживает сохранение файла (showSaveFilePicker).');
                toggleRenameUI(false);
                return;
            }
            const saveHandle = await window.showSaveFilePicker({
                suggestedName: newName,
                types: [{
                    description: 'Markdown',
                    accept: { 'text/markdown': ['.md'] }
                }]
            });
            const writable = await saveHandle.createWritable();
            await writable.write(text);
            await writable.close();

            // Update list: replace old entry with new handle+name
            fileHandles = fileHandles.map(f => {
                if (f.name === currentFile) {
                    return { name: newName, handle: saveHandle };
                }
                return f;
            }).sort((a, b) => a.name.localeCompare(b.name));

            currentFile = newName;
            currentHandle = saveHandle;
        }

        await saveState();
        renderFileList();
        await loadFile(newName);
        toggleRenameUI(false);
    } catch (error) {
        // User cancelled the save dialog - silently cancel rename
        if (error?.name === 'AbortError') {
            toggleRenameUI(false);
            return;
        }
        console.error('Ошибка переименования', error);
        alert('Не удалось переименовать файл: ' + error.message);
    }
}

function openDb() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(STORE_HANDLES)) {
                db.createObjectStore(STORE_HANDLES, { keyPath: 'id' });
            }
            if (!db.objectStoreNames.contains(STORE_META)) {
                db.createObjectStore(STORE_META, { keyPath: 'id' });
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function saveState() {
    try {
        const db = await openDb();
        const tx = db.transaction([STORE_HANDLES, STORE_META], 'readwrite');
        const handlesStore = tx.objectStore(STORE_HANDLES);
        const metaStore = tx.objectStore(STORE_META);

        // Clear previous entries
        handlesStore.clear();

        // Save directory handle (if selected)
        if (directoryHandle) {
            handlesStore.put({ id: 'directory', handle: directoryHandle });
            metaStore.put({ id: 'mode', value: 'directory' });
        } else {
            metaStore.put({ id: 'mode', value: 'files' });
        }

        // Save selected file handles
        fileHandles.forEach((item, index) => {
            handlesStore.put({ id: `file-${index}`, name: item.name, handle: item.handle });
        });
        metaStore.put({
            id: 'meta',
            names: fileHandles.map(f => f.name),
            mode: directoryHandle ? 'directory' : 'files',
            ts: Date.now()
        });
        metaStore.put({ id: 'ts', value: Date.now() });

        await new Promise((resolve, reject) => {
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error);
        });
    } catch (error) {
        console.warn('Не удалось сохранить состояние выбранных файлов', error);
    }
}

async function restoreState() {
    try {
        const db = await openDb();
        const tx = db.transaction([STORE_HANDLES, STORE_META], 'readonly');
        const handlesStore = tx.objectStore(STORE_HANDLES);
        const metaStore = tx.objectStore(STORE_META);

        const modeReq = metaStore.get('mode');
        const handlesReq = handlesStore.getAll();
        const metaReq = metaStore.get('meta');

        const [modeEntry, handles, metaEntry] = await Promise.all([
            new Promise((res) => { modeReq.onsuccess = () => res(modeReq.result); modeReq.onerror = () => res(null); }),
            new Promise((res) => { handlesReq.onsuccess = () => res(handlesReq.result || []); handlesReq.onerror = () => res([]); }),
            new Promise((res) => { metaReq.onsuccess = () => res(metaReq.result); metaReq.onerror = () => res(null); })
        ]);

        const mode = modeEntry?.value || 'files';
        lastSavedMode = metaEntry?.mode || mode;
        lastSavedNames = metaEntry?.names || [];

        if (mode === 'directory') {
            const dirEntry = handles.find(h => h.id === 'directory');
            if (dirEntry && (await ensurePermission(dirEntry.handle, false))) {
                directoryHandle = dirEntry.handle;
                await loadDirectoryFiles(directoryHandle);
            }
        } else {
            const fileEntries = handles.filter(h => h.id.startsWith('file-'));
            fileHandles = [];
            for (const entry of fileEntries) {
                if (await ensurePermission(entry.handle, false)) {
                    fileHandles.push({ name: entry.name || entry.handle.name, handle: entry.handle });
                }
            }
        }
        await new Promise((resolve, reject) => {
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error);
        });

        restoreNeeded = (!directoryHandle && fileHandles.length === 0 && lastSavedNames.length > 0);
        showRestoreButton(restoreNeeded, restoreNeeded ? 'Нужно разрешение — выбрать снова' : 'Восстановить доступ');
        setRenameVisible(fileHandles.length > 0);
        if (fileHandles.length === 0) {
            clearViewerState();
        } else if (!currentFile && fileHandles.length > 0) {
            await loadFile(fileHandles[0].name);
        }
    } catch (error) {
        console.warn('Не удалось восстановить состояние выбранных файлов', error);
    }
}

async function ensurePermission(handle, write = false) {
    if (!handle) return false;
    const opts = { mode: write ? 'readwrite' : 'read' };
    if ((await handle.queryPermission(opts)) === 'granted') return true;
    const result = await handle.requestPermission(opts);
    return result === 'granted';
}

// ------------------------------
// File / Directory Selection
// ------------------------------
async function pickDirectory() {
    if (!window.showDirectoryPicker) {
        alert('Ваш браузер не поддерживает выбор директорий (нужен Chromium 86+).');
        return;
    }
    try {
        const dirHandle = await window.showDirectoryPicker();
        directoryHandle = dirHandle;
        fileHandles = [];
        await loadDirectoryFiles(dirHandle);
        await saveState();
        const count = fileHandles.length;
        if (count === 0) {
            clearViewerState();
            setSourceInfo(`Папка: ${dirHandle.name} — .md не найдены`);
            alert('В выбранной папке не найдено файлов .md');
        } else {
            setSourceInfo(`Папка: ${dirHandle.name} — файлов: ${count}`);
            await loadFile(fileHandles[0].name);
        }
        renderFileList();
        showRestoreButton(false);
        restoreNeeded = false;
    } catch (err) {
        if (err?.name === 'AbortError') {
            return;
        }
        // Windows/Edge may block system directories (Downloads, etc.)
        if (err?.name === 'SecurityError') {
            alert('Эта папка защищена системой. Выберите другую папку или откройте отдельные файлы.');
            return;
        }
        console.error('Не удалось открыть директорию', err);
    }
}

async function loadDirectoryFiles(dirHandle) {
    fileHandles = [];
    try {
        for await (const entry of dirHandle.values()) {
            if (entry.kind === 'file' && entry.name.toLowerCase().endsWith('.md')) {
                fileHandles.push({ name: entry.name, handle: entry });
            }
        }
        fileHandles.sort((a, b) => a.name.localeCompare(b.name));
    } catch (error) {
        console.error('Ошибка чтения директории', error);
    }
}

async function pickFiles(append = false) {
    if (!window.showOpenFilePicker) {
        alert('Ваш браузер не поддерживает выбор файлов через File System Access API.');
        return;
    }
    try {
        const handles = await window.showOpenFilePicker({
            multiple: true,
            types: [{
                description: 'Markdown',
                accept: { 'text/markdown': ['.md'] }
            }]
        });
        directoryHandle = null; // Individual files mode
        const newItems = handles.map(h => ({ name: h.name, handle: h }));
        if (!append) {
            fileHandles = newItems;
        } else {
            const existingNames = new Set(fileHandles.map(f => f.name));
            newItems.forEach(item => {
                if (!existingNames.has(item.name)) {
                    fileHandles.push(item);
                }
            });
        }
        fileHandles.sort((a, b) => a.name.localeCompare(b.name));
        await saveState();
        renderFileList();
        const count = fileHandles.length;
        if (count > 0) {
            setSourceInfo(`Файлы: выбрано ${count}`);
            await loadFile(fileHandles[0].name);
        } else {
            setSourceInfo('Источник не выбран');
            clearViewerState();
        }
        showRestoreButton(false);
        restoreNeeded = false;
    } catch (err) {
        if (err?.name !== 'AbortError') {
            console.error('Не удалось выбрать файлы', err);
        }
    }
}

async function addMoreFiles() {
    return pickFiles(true);
}

async function clearAllFiles() {
    directoryHandle = null;
    fileHandles = [];
    currentFile = null;
    currentHandle = null;
    rawContent = '';
    await saveState();
    renderFileList();
    clearViewerState();
    setSourceInfo('Источник не выбран');
    setRenameVisible(false);
    showRestoreButton(false);
}

function clearViewerState() {
    document.getElementById('contentTitle').textContent = 'Выберите файл для просмотра';
    const viewer = getMainViewer();
    if (viewer) viewer.innerHTML = '';
    showWelcome(true);
    document.getElementById('editToggleBtn').style.display = 'none';
    const split = document.getElementById('editSplit');
    const toolbar = document.getElementById('markdownToolbar');
    split.classList.remove('visible');
    toolbar.classList.add('hidden');
    isEditing = false;
    setRenameVisible(false);
}

function renderFileList() {
    const fileList = document.getElementById('fileList');
    if (!fileHandles || fileHandles.length === 0) {
        fileList.innerHTML = '<div class="empty-state">Нет выбранных файлов</div>';
        return;
    }
    fileList.innerHTML = fileHandles.map(file => `
        <div class="file-item ${file.name === currentFile ? 'active' : ''}" data-filename="${file.name}">
            <span class="file-name" onclick="loadFile('${file.name}')">${file.name}</span>
            <div class="file-actions">
                <button class="delete-btn" onclick="removeFromList('${file.name}', event)">✕</button>
            </div>
        </div>
    `).join('');
}

function findHandleByName(name) {
    return fileHandles.find(f => f.name === name)?.handle || null;
}

async function loadFile(filename) {
    if (isEditing) {
        toggleEditMode(true);
    }
    if (isRenaming) {
        cancelInlineRename();
    }
    const handle = findHandleByName(filename);
    if (!handle) {
        alert('Файл не найден в списке выбранных');
        return;
    }
    const hasPerm = await ensurePermission(handle, false);
    if (!hasPerm) {
        alert('Нет доступа к файлу. Разрешите чтение.');
        return;
    }
    try {
        const file = await handle.getFile();
        const text = await file.text();
        currentFile = filename;
        currentHandle = handle;
        rawContent = text;
        document.getElementById('contentTitle').textContent = filename;
        const contentBody = document.getElementById('contentBody');

        let viewer = contentBody.querySelector('#mainMarkdownContent');
        if (!viewer) {
            viewer = document.createElement('div');
            viewer.id = 'mainMarkdownContent';
            viewer.className = 'markdown-content';
            contentBody.prepend(viewer);
        }
        viewer.innerHTML = md.render(text);
        const editor = contentBody.querySelector('#markdownEditor');
        editor.value = rawContent;

        document.getElementById('editToggleBtn').style.display = 'block';
        showWelcome(false);
        highlightCode();
        addCopyButtons();
        renderFileList();
        setSourceInfo(directoryHandle ? `Папка: ${directoryHandle.name} — файлов: ${fileHandles.length}` : `Файлы: выбрано ${fileHandles.length}`);
        setRenameVisible(true);
    } catch (error) {
        alert('Ошибка при загрузке файла: ' + error.message);
    }
}

function toggleEditMode(forceExit = false) {
    const editor = document.getElementById('markdownEditor');
    const viewer = getMainViewer();
    const toggleBtn = document.getElementById('editToggleBtn');
    const toolbar = document.getElementById('markdownToolbar');
    const split = document.getElementById('editSplit');
    const livePreview = document.getElementById('livePreview');
    const cancelBtn = document.getElementById('cancelEditBtn');
    if (!currentFile) return;

    if (forceExit) {
        isEditing = false;
        split.classList.remove('visible');
        viewer.style.display = 'block';
        toolbar.classList.add('hidden');
        toggleBtn.textContent = 'Редактировать';
        toggleBtn.classList.remove('editing');
        cancelBtn.classList.add('is-hidden');
        pendingSaveContent = '';
        return;
    }

    if (!isEditing) {
        isEditing = true;
        beforeSaveSnapshot = rawContent;
        split.classList.add('visible');
        viewer.style.display = 'none';
        editor.value = rawContent;
        renderLivePreview(editor.value, livePreview);
        toolbar.classList.remove('hidden');
        editor.focus();
        toggleBtn.textContent = 'Сохранить';
        toggleBtn.classList.add('editing');
        cancelBtn.classList.remove('is-hidden');
        return;
    }

    openSaveDiffPreview();
}

function toggleMarkdownFormatting(prefix, suffix, placeholder, isBlock = false) {
    const editor = document.getElementById('markdownEditor');
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    let originalSelection = editor.value.substring(start, end);

    if (isBlock) {
        const lineStart = editor.value.lastIndexOf('\n', start - 1) + 1;
        let lineEnd = editor.value.indexOf('\n', start);
        if (lineEnd === -1) {
            lineEnd = editor.value.length;
        }
        const originalLine = editor.value.substring(lineStart, lineEnd);

        if (originalLine.trim().startsWith(prefix)) {
            const firstCharIndex = originalLine.search(/\S/);
            const newLine = originalLine.substring(0, firstCharIndex) + originalLine.substring(firstCharIndex + prefix.length);
            editor.setRangeText(newLine, lineStart, lineEnd);
            editor.setSelectionRange(lineStart, lineStart + newLine.length);
        } else {
            editor.setRangeText(prefix, lineStart, lineStart);
            editor.setSelectionRange(lineStart + prefix.length, lineStart + prefix.length + originalLine.length);
        }
        editor.focus();
        return;
    }

    const beforeSelection = editor.value.substring(start - prefix.length, start);
    const afterSelection = editor.value.substring(end, end + suffix.length);
    if (beforeSelection === prefix && afterSelection === suffix) {
        const unwrappedText = editor.value.substring(start, end);
        editor.setRangeText(unwrappedText, start - prefix.length, end + suffix.length);
        const newCursorPos = start - prefix.length;
        editor.setSelectionRange(newCursorPos, newCursorPos + unwrappedText.length);
    } else {
        const textToWrap = originalSelection.length > 0 ? originalSelection : placeholder;
        const newText = prefix + textToWrap + suffix;
        editor.setRangeText(newText, start, end);
        const newStart = start + prefix.length;
        const newEnd = newStart + textToWrap.length;
        editor.setSelectionRange(newStart, newEnd);
    }
    editor.focus();
}

function highlightCode() {
    const codeBlocks = document.querySelectorAll('.markdown-content pre code');
    codeBlocks.forEach((block) => {
        hljs.highlightElement(block);
    });
}

function highlightCodeIn(container) {
    const codeBlocks = container.querySelectorAll('pre code');
    codeBlocks.forEach((block) => {
        hljs.highlightElement(block);
    });
}

function getMainViewer() {
    return document.getElementById('mainMarkdownContent');
}

function showWelcome(visible) {
    const welcome = document.querySelector('.welcome-message');
    if (!welcome) return;
    welcome.style.display = visible ? 'block' : 'none';
}

function renderLivePreview(text = '', target = null) {
    const preview = target || document.getElementById('livePreview');
    if (!preview) return;
    preview.innerHTML = md.render(text);
    highlightCodeIn(preview);
}

function addCopyButtons() {
    const codeBlocks = document.querySelectorAll('.markdown-content pre code');
    codeBlocks.forEach((codeBlock) => {
        if (codeBlock.parentElement.querySelector('.copy-button')) {
            return;
        }
        const pre = codeBlock.parentElement;
        const wrapper = document.createElement('div');
        wrapper.className = 'code-block-wrapper';
        const copyButton = document.createElement('button');
        copyButton.className = 'copy-button';
        copyButton.textContent = 'Копировать';
        copyButton.setAttribute('aria-label', 'Копировать код');
        pre.parentNode.insertBefore(wrapper, pre);
        wrapper.appendChild(pre);
        wrapper.appendChild(copyButton);
        copyButton.addEventListener('click', async () => {
            const codeText = codeBlock.textContent || codeBlock.innerText;
            try {
                await navigator.clipboard.writeText(codeText);
                copyButton.classList.add('copied');
                copyButton.textContent = 'Скопировано';
                setTimeout(() => {
                    copyButton.classList.remove('copied');
                    copyButton.textContent = 'Копировать';
                }, 2000);
            } catch (err) {
                const textArea = document.createElement('textarea');
                textArea.value = codeText;
                textArea.style.position = 'fixed';
                textArea.style.opacity = '0';
                document.body.appendChild(textArea);
                textArea.select();
                try {
                    document.execCommand('copy');
                    copyButton.classList.add('copied');
                    copyButton.textContent = 'Скопировано';
                    setTimeout(() => {
                        copyButton.classList.remove('copied');
                        copyButton.textContent = 'Копировать';
                    }, 2000);
                } catch (err) {
                    alert('Не удалось скопировать код');
                }
                document.body.removeChild(textArea);
            }
        });
    });
}

function removeFromList(filename, event) {
    if (event) event.stopPropagation();
    fileHandles = fileHandles.filter(f => f.name !== filename);
    if (currentFile === filename) {
        currentFile = null;
        currentHandle = null;
        clearViewerState();
    }
    saveState();
    renderFileList();
}

async function showSaveDiff(beforeRaw, afterRaw) {
    try {
        // Generate diff locally
        const payload = buildLocalDiffPayload(beforeRaw, afterRaw, `${currentFile} (до)`, `${currentFile} (после)`);
        const rawContainer = document.getElementById('saveDiffRawTable');
        const rawBefore = renderRawDiffSide(payload.before.raw_content, payload.after.raw_content, 'before');
        const rawAfter = renderRawDiffSide(payload.before.raw_content, payload.after.raw_content, 'after');
        rawContainer.innerHTML = `
            <div class="diff-grid diff-grid--raw">
                <div class="diff-column">
                    <h3>До</h3>
                    <div class="diff-raw-text">${withLineNumbers(rawBefore)}</div>
                </div>
                <div class="diff-column">
                    <h3>После</h3>
                    <div class="diff-raw-text">${withLineNumbers(rawAfter)}</div>
                </div>
            </div>
        `;
        const beforeRendered = document.getElementById('saveDiffBeforeRendered');
        const afterRendered = document.getElementById('saveDiffAfterRendered');
        beforeRendered.innerHTML = renderDiffSide(payload.before.raw_content, payload.after.raw_content, 'before');
        afterRendered.innerHTML = renderDiffSide(payload.before.raw_content, payload.after.raw_content, 'after');
        highlightCodeIn(beforeRendered);
        highlightCodeIn(afterRendered);
        cleanDiffTable(document.getElementById('saveDiffRawTable'));

        setDiffView('raw');
        document.getElementById('saveDiffModal').classList.add('visible');
        setupRenderedDiffScrollSync();
    } catch (error) {
        console.error('Ошибка при формировании diff:', error);
    }
}

function setDiffView(view) {
    const rawBlock = document.getElementById('rawDiffBlock');
    const renderedBlock = document.getElementById('renderedDiffBlock');
    const rawBtn = document.getElementById('toggleRawDiff');
    const rendBtn = document.getElementById('toggleRenderedDiff');
    if (view === 'raw') {
        rawBlock.classList.remove('is-hidden');
        renderedBlock.classList.add('is-hidden');
        rawBtn.classList.add('active');
        rendBtn.classList.remove('active');
    } else {
        rawBlock.classList.add('is-hidden');
        renderedBlock.classList.remove('is-hidden');
        rawBtn.classList.remove('active');
        rendBtn.classList.add('active');
    }
}

function closeSaveDiffModal() {
    document.getElementById('saveDiffModal').classList.remove('visible');
}

async function openSaveDiffPreview() {
    const editor = document.getElementById('markdownEditor');
    const newContent = editor.value;
    pendingSaveContent = newContent;
    await showSaveDiff(beforeSaveSnapshot, newContent);
}

async function confirmSaveDiff() {
    await persistSave(pendingSaveContent);
    closeSaveDiffModal();
}

function cancelSaveDiff() {
    closeSaveDiffModal();
    pendingSaveContent = '';
}

function cancelEdit() {
    if (!isEditing) return;
    const viewer = getMainViewer();
    const split = document.getElementById('editSplit');
    const toolbar = document.getElementById('markdownToolbar');
    const toggleBtn = document.getElementById('editToggleBtn');
    const editor = document.getElementById('markdownEditor');
    const cancelBtn = document.getElementById('cancelEditBtn');
    editor.value = beforeSaveSnapshot;
    renderLivePreview(editor.value);
    isEditing = false;
    split.classList.remove('visible');
    viewer.style.display = 'block';
    toolbar.classList.add('hidden');
    toggleBtn.textContent = 'Редактировать';
    toggleBtn.classList.remove('editing');
    cancelBtn.classList.add('is-hidden');
    pendingSaveContent = '';
}

async function persistSave(newContent) {
    if (!currentFile || !currentHandle) return;
    const hasPerm = await ensurePermission(currentHandle, true);
    if (!hasPerm) {
        alert('Нет прав на запись. Разрешите доступ к файлу.');
        return;
    }
    try {
        const writable = await currentHandle.createWritable();
        await writable.write(newContent);
        await writable.close();

        rawContent = newContent;
        isEditing = false;
        const viewer = getMainViewer();
        const split = document.getElementById('editSplit');
        const toolbar = document.getElementById('markdownToolbar');
        const toggleBtn = document.getElementById('editToggleBtn');
        const cancelBtn = document.getElementById('cancelEditBtn');
        split.classList.remove('visible');
        viewer.style.display = 'block';
        toolbar.classList.add('hidden');
        toggleBtn.textContent = 'Редактировать';
        toggleBtn.classList.remove('editing');
        cancelBtn.classList.add('is-hidden');
        pendingSaveContent = '';
        await loadFile(currentFile);
    } catch (error) {
        alert('Ошибка при сохранении файла: ' + error.message);
    }
}

function cleanDiffTable(container) {
    if (!container) return;
    const anchors = container.querySelectorAll('a');
    anchors.forEach(a => {
        const span = document.createElement('span');
        span.textContent = a.textContent;
        a.replaceWith(span);
    });
}

function renderDiffSide(rawA, rawB, mode) {
    if (!dmp) {
        return md.render(mode === 'before' ? rawA : rawB);
    }
    const diffs = dmp.diff_main(rawA, rawB);
    dmp.diff_cleanupSemantic(diffs);

    const normalized = [];
    for (let i = 0; i < diffs.length; i++) {
        const [op, text] = diffs[i];
        const next = diffs[i + 1];
        if (op === -1 && next && next[0] === 1) {
            normalized.push(['chgBefore', text]);
            normalized.push(['chgAfter', next[1]]);
            i++;
            continue;
        }
        if (op === 1 && next && next[0] === -1) {
            normalized.push(['chgBefore', next[1]]);
            normalized.push(['chgAfter', text]);
            i++;
            continue;
        }
        if (op === 0) normalized.push(['eq', text]);
        else if (op === -1) normalized.push(['del', text]);
        else if (op === 1) normalized.push(['add', text]);
    }

    function wrapTokens(text, cls) {
        if (!cls) return md.utils.escapeHtml(text);
        const trimmed = text.trimStart();
        if (trimmed.startsWith('```') || trimmed.startsWith('`')) {
            return md.utils.escapeHtml(text);
        }
        return `<mark class="${cls}">${md.utils.escapeHtml(text)}</mark>`;
    }

    const parts = normalized.map(([op, text]) => {
        let cls = '';
        if (mode === 'before') {
            if (op === 'del') cls = 'diff-mark-sub';
            else if (op === 'chgBefore') cls = 'diff-mark-chg';
        } else {
            if (op === 'add') cls = 'diff-mark-add';
            else if (op === 'chgAfter') cls = 'diff-mark-chg';
        }
        if (cls === '' && (op === 'add' || op === 'del' || op === 'chgBefore' || op === 'chgAfter')) {
            return '';
        }
        return wrapTokens(text, cls);
    }).join('');

    return md.render(parts);
}

function buildLineDiffs(beforeRaw, afterRaw) {
    // Line-based diff for per-line highlighting
    if (!dmp) {
        const lines = beforeRaw.split('\n').map((l) => [0, l]);
        return lines;
    }
    const a = beforeRaw.split('\n');
    const b = afterRaw.split('\n');
    // Use diff_linesToChars_ for line-based diff
    const aText = a.join('\n');
    const bText = b.join('\n');
    const chars = dmp.diff_linesToChars_(aText, bText);
    let diffs = dmp.diff_main(chars.chars1, chars.chars2, false);
    dmp.diff_charsToLines_(diffs, chars.lineArray);
    dmp.diff_cleanupSemantic(diffs);
    // Expand diff to individual lines
    const lineDiffs = [];
    diffs.forEach(([op, text]) => {
        const rows = text.split('\n');
        // Remove possible trailing empty line from split
        if (rows.length > 0 && rows[rows.length - 1] === '') {
            rows.pop();
        }
        rows.forEach((line) => lineDiffs.push([op, line]));
    });
    return lineDiffs;
}

function renderRawDiffSide(rawA, rawB, mode) {
    const diffs = buildLineDiffs(rawA, rawB);
    const parts = diffs.map(([op, line]) => {
        let cls = '';
        if (mode === 'before') {
            if (op === -1) cls = 'diff-mark-sub';
            else if (op === 0) cls = '';
            else if (op === 1) return ''; // Added in after, don't show in before
        } else {
            if (op === 1) cls = 'diff-mark-add';
            else if (op === 0) cls = '';
            else if (op === -1) return ''; // Deleted in before, don't show in after
        }
        const escaped = md.utils.escapeHtml(line);
        if (!cls) return escaped;
        return `<mark class="${cls}">${escaped}</mark>`;
    }).join('\n');
    return parts;
}

function withLineNumbers(htmlString) {
    const lines = htmlString.split('\n');
    const numbered = lines.map((line, idx) => {
        const safeLine = line === '' ? '&nbsp;' : line;
        return `<div class="diff-line"><span class="diff-line-num">${idx + 1}</span><span class="diff-line-text">${safeLine}</span></div>`;
    }).join('');
    return numbered;
}

function buildLocalDiffPayload(beforeRaw, afterRaw, beforeName, afterName) {
    // Use diff_match_patch for HTML diff table
    let rawDiffHtml = '';
    if (dmp) {
        const diffs = dmp.diff_main(beforeRaw, afterRaw);
        dmp.diff_cleanupSemantic(diffs);
        rawDiffHtml = dmp.diff_prettyHtml(diffs);
    } else {
        rawDiffHtml = '<div>diff недоступен</div>';
    }
    return {
        raw_diff_html: rawDiffHtml,
        before: { filename: beforeName, raw_content: beforeRaw },
        after: { filename: afterName, raw_content: afterRaw }
    };
}

const editorEl = document.getElementById('markdownEditor');
const livePreviewEl = document.getElementById('livePreview');

document.getElementById('markdownEditor').addEventListener('input', (e) => {
    renderLivePreview(e.target.value);
});

let editSyncLock = false;
function syncEditScroll(source, target) {
    if (editSyncLock) return;
    editSyncLock = true;
    const ratio = source.scrollTop / Math.max(1, source.scrollHeight - source.clientHeight);
    target.scrollTop = ratio * Math.max(1, target.scrollHeight - target.clientHeight);
    editSyncLock = false;
}

editorEl.addEventListener('scroll', () => syncEditScroll(editorEl, livePreviewEl));
livePreviewEl.addEventListener('scroll', () => syncEditScroll(livePreviewEl, editorEl));

let renderedDiffSyncLock = false;
function setupRenderedDiffScrollSync() {
    const before = document.getElementById('saveDiffBeforeRendered');
    const after = document.getElementById('saveDiffAfterRendered');
    if (!before || !after) return;
    before.addEventListener('scroll', () => syncRenderedDiff(before, after));
    after.addEventListener('scroll', () => syncRenderedDiff(after, before));
}

function syncRenderedDiff(source, target) {
    if (renderedDiffSyncLock) return;
    renderedDiffSyncLock = true;
    const ratio = source.scrollTop / Math.max(1, source.scrollHeight - source.clientHeight);
    target.scrollTop = ratio * Math.max(1, target.scrollHeight - target.clientHeight);
    renderedDiffSyncLock = false;
}

// Selection Button Event Handlers
document.getElementById('chooseFolderBtn').addEventListener('click', pickDirectory);
document.getElementById('chooseFilesBtn').addEventListener('click', () => pickFiles(false));
document.getElementById('addFilesBtn').addEventListener('click', addMoreFiles);
document.getElementById('clearFilesBtn').addEventListener('click', clearAllFiles);
document.getElementById('renameStartBtn').addEventListener('click', startInlineRename);
document.getElementById('renameCancelBtn').addEventListener('click', cancelInlineRename);
document.getElementById('renameConfirmBtn').addEventListener('click', confirmInlineRename);
document.getElementById('restoreAccessBtn').addEventListener('click', () => {
    if (lastSavedMode === 'directory') {
        pickDirectory();
    } else {
        pickFiles(false);
    }
});
document.getElementById('sidebarToggleBtn').addEventListener('click', toggleSidebar);

document.getElementById('markdownToolbar').classList.add('hidden');
document.getElementById('cancelEditBtn').classList.add('is-hidden');

// Warn before closing/refreshing page if files are selected
window.addEventListener('beforeunload', (event) => {
    if (fileHandles.length === 0 && !directoryHandle) return;
    const message = 'Выбранные файлы могут быть утрачены. Обновить страницу?';
    event.preventDefault();
    event.returnValue = message;
    return message;
});

function toggleSidebar() {
    const sidebar = document.querySelector('.sidebar');
    const toggleBtn = document.getElementById('sidebarToggleBtn');
    if (!sidebar || !toggleBtn) return;
    isSidebarCollapsed = !isSidebarCollapsed;
    sidebar.classList.toggle('collapsed', isSidebarCollapsed);
    toggleBtn.textContent = isSidebarCollapsed ? '⏵' : '⏴';
    toggleBtn.setAttribute('aria-label', isSidebarCollapsed ? 'Развернуть' : 'Свернуть');
}

// Restore previous state of selected files/directories
(async () => {
    await restoreState();
    renderFileList();
    if (fileHandles.length > 0) {
        await loadFile(fileHandles[0].name);
    } else {
        setSourceInfo('Источник не выбран');
        setRenameVisible(false);
    }
})();


