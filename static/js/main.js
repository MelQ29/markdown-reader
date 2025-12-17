let currentFile = null;
let rawContent = '';
let isEditing = false;
let beforeSaveSnapshot = '';
let pendingSaveContent = '';

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
    console.error('diff_match_patch не инициализирован, diff-подсветка отключена', e);
}

document.getElementById('fileInput').addEventListener('change', async function(e) {
    const file = e.target.files[0];
    if (!file) return;
    await uploadWithConflictHandling(file);
    e.target.value = '';
});

async function uploadWithConflictHandling(file, newFilename = null) {
    const formData = new FormData();
    formData.append('file', file);
    if (newFilename) {
        formData.append('newFilename', newFilename);
    }
    try {
        const response = await fetch('/api/upload', {
            method: 'POST',
            body: formData
        });
        const data = await response.json();
        if (response.ok) {
            loadFileList();
            loadFile(data.filename);
        } else if (response.status === 409 && data.error === 'file_exists') {
            const newName = prompt(
                `Файл с именем "${data.filename}" уже существует. Введите новое имя:`,
                data.filename.replace('.md', '')
            );
            if (newName && newName.trim() !== '') {
                await uploadWithConflictHandling(file, newName);
            }
        } else {
            alert('Ошибка: ' + data.error);
        }
    } catch (error) {
        alert('Ошибка при загрузке файла: ' + error.message);
    }
}

async function loadFileList() {
    try {
        const response = await fetch('/api/files');
        const files = await response.json();
        const fileList = document.getElementById('fileList');
        if (files.length === 0) {
            fileList.innerHTML = '<div class="empty-state">Нет загруженных файлов</div>';
            return;
        }
        fileList.innerHTML = files.map(file => `
            <div class="file-item ${file.name === currentFile ? 'active' : ''}" data-filename="${file.name}">
                <span class="file-name" onclick="loadFile('${file.name}')">${file.name}</span>
                <div class="file-actions">
                    <button class="rename-btn" onclick="renameFile('${file.name}', event)">✏️</button>
                    <button class="delete-btn" onclick="deleteFile('${file.name}', event)">✕</button>
                </div>
            </div>
        `).join('');
    } catch (error) {
        console.error('Ошибка при загрузке списка файлов:', error);
    }
}

async function renameFile(filename, event) {
    event.stopPropagation();
    const newName = prompt(`Переименовать файл "${filename}":`, filename.replace('.md', ''));
    if (!newName || newName.trim() === '' || newName === filename.replace('.md', '')) {
        return;
    }
    try {
        const response = await fetch(`/api/rename/${filename}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ newName: newName })
        });
        const data = await response.json();
        if (response.ok) {
            if (currentFile === filename) {
                loadFile(data.newName);
            } else {
                loadFileList();
            }
        } else {
            alert('Ошибка: ' + data.error);
        }
    } catch (error) {
        alert('Ошибка при переименовании файла: ' + error.message);
    }
}

async function loadFile(filename) {
    if (isEditing) {
        toggleEditMode(true);
    }
    try {
        const response = await fetch(`/api/file/${filename}`);
        const data = await response.json();
        if (response.ok) {
            currentFile = filename;
            rawContent = data.raw_content;
            document.getElementById('contentTitle').textContent = data.filename;
            const contentBody = document.getElementById('contentBody');

            let viewer = contentBody.querySelector('#mainMarkdownContent');
            if (!viewer) {
                viewer = document.createElement('div');
                viewer.id = 'mainMarkdownContent';
                viewer.className = 'markdown-content';
                contentBody.prepend(viewer);
            }
            viewer.innerHTML = data.html_content;
            const editor = contentBody.querySelector('#markdownEditor');
            editor.value = rawContent;

            document.getElementById('editToggleBtn').style.display = 'block';
            showWelcome(false);
            highlightCode();
            addCopyButtons();
            loadFileList();
        } else {
            alert('Ошибка: ' + data.error);
        }
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

async function deleteFile(filename, event) {
    event.stopPropagation();
    if (!confirm(`Удалить файл "${filename}"?`)) {
        return;
    }
    try {
        const response = await fetch(`/api/delete/${filename}`, {
            method: 'DELETE'
        });
        const data = await response.json();
        if (response.ok) {
            if (currentFile === filename) {
                currentFile = null;
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
            }
            loadFileList();
        } else {
            alert('Ошибка: ' + data.error);
        }
    } catch (error) {
        alert('Ошибка при удалении файла: ' + error.message);
    }
}

async function showSaveDiff(beforeRaw, afterRaw) {
    try {
        const response = await fetch('/api/diff/preview', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                before_content: beforeRaw,
                after_content: afterRaw,
                before_name: `${currentFile} (до)`,
                after_name: `${currentFile} (после)`
            })
        });
        const data = await response.json();
        if (!response.ok) {
            console.error('Ошибка diff:', data.error);
            return;
        }

        document.getElementById('saveDiffRawTable').innerHTML = data.raw_diff_html;
        const beforeRendered = document.getElementById('saveDiffBeforeRendered');
        const afterRendered = document.getElementById('saveDiffAfterRendered');
        beforeRendered.innerHTML = renderDiffSide(data.before.raw_content, data.after.raw_content, 'before');
        afterRendered.innerHTML = renderDiffSide(data.before.raw_content, data.after.raw_content, 'after');
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
    if (!currentFile) return;
    try {
        const response = await fetch(`/api/file/${currentFile}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ content: newContent })
        });
        const data = await response.json();
        if (response.ok) {
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
        } else {
            alert('Ошибка сохранения: ' + data.error);
        }
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

document.getElementById('markdownToolbar').classList.add('hidden');
document.getElementById('cancelEditBtn').classList.add('is-hidden');

loadFileList();

