let cropper = null, isSettingsOpen = false;

/* ======================== 界面初始化与事件绑定 ======================== */
window.addEventListener('DOMContentLoaded', function() {
    initUIControls();
    loadSettings(); 
    applyLayout(); 
    initLocks(); 
    updateBgAdjustment(); 
    updateTextScale(); 
    updateUiScale(); 
    updateBgPreviewUI();
    applyState(); 
    initFontPanel(); 
    initSliderHideEffect();
});

// 动态生成主题按钮并绑定核心点击事件
function initUIControls() {
    const switcher = document.getElementById('switcher');
    if(switcher) {
        switcher.innerHTML = ''; 
        styles.forEach(s => {
          const btn = document.createElement('button'); 
          btn.textContent = s.name; 
          btn.dataset.key = s.key;
          btn.onclick = () => { currentStyle = s.key; applyState(); }; 
          switcher.appendChild(btn);
        });
    }

    const modeBtn = document.getElementById('modeBtn');
    if(modeBtn) modeBtn.onclick = () => { currentMode = currentMode === 'day' ? 'night' : 'day'; applyState(); };
    
    const layoutBtn = document.getElementById('layoutBtn');
    if(layoutBtn) layoutBtn.onclick = () => { currentLayout = currentLayout === 'scroll' ? 'wrap' : 'scroll'; applyLayout(); };

    const settingsWrapper = document.getElementById('settingsWrapper');
    if(settingsWrapper) {
        settingsWrapper.addEventListener('click', function(e) { 
            if (window.innerWidth < 1000 && e.target === this && !this.classList.contains('is-dragging')) {
                toggleSettings(); 
            }
        });
    }
}

/* ======================== 本地存储与恢复管理 ======================== */
function loadSettings() {
    const saved = JSON.parse(localStorage.getItem('sp-settings'));
    if (saved) {
        if(document.getElementById('textScaleRange')) document.getElementById('textScaleRange').value = saved.textScale || 100; 
        if(document.getElementById('uiScaleRange')) document.getElementById('uiScaleRange').value = saved.uiScale || 100;
        if(document.getElementById('themeAlphaRange')) document.getElementById('themeAlphaRange').value = saved.themeAlpha || 0; 
        if(document.getElementById('textMaskRange')) document.getElementById('textMaskRange').value = saved.textMask || 0;
        if(document.getElementById('bgBlurRange')) document.getElementById('bgBlurRange').value = saved.bgBlur || 0; 
        if(document.getElementById('bgOpacityRange')) document.getElementById('bgOpacityRange').value = saved.bgOpacity || 1; 
        if(document.getElementById('bgOverlayRange')) document.getElementById('bgOverlayRange').value = saved.bgOverlay || 0;
    }
    themeConfig.lockedImg = localStorage.getItem('sp-locked-img') === 'true' || localStorage.getItem('sp-locked-img') === null;
    themeConfig.lockedContent = localStorage.getItem('sp-locked-content') === 'true' || localStorage.getItem('sp-locked-content') === null;
    themeConfig.bgType = localStorage.getItem('sp-bg-type') || 'none'; 
    themeConfig.bgValue = localStorage.getItem('sp-bg-value') || '';
    themeConfig.fontSource = localStorage.getItem('sp-font-source') || 'theme';
    themeConfig.fontUrl = localStorage.getItem('sp-font-url') || ''; 
    themeConfig.fontName = localStorage.getItem('sp-font-name') || '';
}

function saveSettings() {
    localStorage.setItem('sp-settings', JSON.stringify({
        textScale: document.getElementById('textScaleRange') ? document.getElementById('textScaleRange').value : 100, 
        uiScale: document.getElementById('uiScaleRange') ? document.getElementById('uiScaleRange').value : 100,
        themeAlpha: document.getElementById('themeAlphaRange') ? document.getElementById('themeAlphaRange').value : 0, 
        textMask: document.getElementById('textMaskRange') ? document.getElementById('textMaskRange').value : 0,
        bgBlur: document.getElementById('bgBlurRange') ? document.getElementById('bgBlurRange').value : 0, 
        bgOpacity: document.getElementById('bgOpacityRange') ? document.getElementById('bgOpacityRange').value : 1, 
        bgOverlay: document.getElementById('bgOverlayRange') ? document.getElementById('bgOverlayRange').value : 0,
    }));
    localStorage.setItem('sp-locked-img', themeConfig.lockedImg); 
    localStorage.setItem('sp-locked-content', themeConfig.lockedContent);
    localStorage.setItem('sp-bg-type', themeConfig.bgType); 
    localStorage.setItem('sp-bg-value', themeConfig.bgValue);
    localStorage.setItem('sp-font-source', themeConfig.fontSource); 
    localStorage.setItem('sp-font-url', themeConfig.fontUrl); 
    localStorage.setItem('sp-font-name', themeConfig.fontName);
}

function resetSettings() {
    if (!confirm('确定要恢复所有默认设置吗？')) return;
    localStorage.clear(); 
    currentStyle = 'default'; currentMode = 'day'; currentLayout = 'scroll';
    themeConfig = { bgType: 'none', bgValue: '', lockedImg: true, lockedContent: true, fontSource: 'theme', fontUrl: '', fontName: '' };
    
    if(document.getElementById('textScaleRange')) document.getElementById('textScaleRange').value = 100; 
    if(document.getElementById('uiScaleRange')) document.getElementById('uiScaleRange').value = 100;
    if(document.getElementById('themeAlphaRange')) document.getElementById('themeAlphaRange').value = 0; 
    if(document.getElementById('textMaskRange')) document.getElementById('textMaskRange').value = 0;
    if(document.getElementById('bgBlurRange')) document.getElementById('bgBlurRange').value = 0; 
    if(document.getElementById('bgOpacityRange')) document.getElementById('bgOpacityRange').value = 1; 
    if(document.getElementById('bgOverlayRange')) document.getElementById('bgOverlayRange').value = 0;
    
    const sysCheck = document.getElementById('systemTextScaleCheck'); 
    if(sysCheck) { 
        sysCheck.checked = false; 
        document.getElementById('textScaleRange').disabled = false; 
        document.getElementById('uiScaleRange').disabled = false; 
    }
    
    applyLayout(); initLocks(); updateBgAdjustment(); updateTextScale(); updateUiScale(); updateBgPreviewUI(); initFontPanel(); applyState(); saveSettings(); 
}

/* ======================== 滑块拖拽沉浸式特效与参数调节 ======================== */
function initSliderHideEffect() {
    const ranges = document.querySelectorAll('input[type="range"]');
    const wrapper = document.getElementById('settingsWrapper');
    const panel = document.querySelector('.settings-panel');
    if(!wrapper || !panel) return;

    function onDragStart(e) { if(e.target.disabled) return; wrapper.classList.add('is-dragging'); panel.classList.add('is-dragging'); const rg = e.target.closest('.range-group'); if(rg) rg.classList.add('active-range'); const ct = e.target.closest('.adjust-container'); if(ct) ct.classList.add('active-container'); }
    function onDragEnd() { wrapper.classList.remove('is-dragging'); panel.classList.remove('is-dragging'); document.querySelectorAll('.active-range').forEach(el=>el.classList.remove('active-range')); document.querySelectorAll('.active-container').forEach(el=>el.classList.remove('active-container')); }
    ranges.forEach(r => { r.addEventListener('mousedown', onDragStart); r.addEventListener('touchstart', onDragStart, {passive: true}); });
    window.addEventListener('mouseup', onDragEnd); window.addEventListener('touchend', onDragEnd);
}

function toggleSettings() {
    const wrapper = document.getElementById('settingsWrapper'); 
    if(!wrapper) return;
    isSettingsOpen = !isSettingsOpen;
    isSettingsOpen ? wrapper.classList.add('show') : wrapper.classList.remove('show');
}

function applyLockState(type) {
    if (type === 'img') {
        let d = themeConfig.lockedImg; 
        if(document.getElementById('bgBlurRange')) document.getElementById('bgBlurRange').disabled = d; 
        if(document.getElementById('bgOpacityRange')) document.getElementById('bgOpacityRange').disabled = d; 
        if(document.getElementById('bgOverlayRange')) document.getElementById('bgOverlayRange').disabled = d;
        const b = document.getElementById('lockImgBtn'); 
        if(b) { b.innerHTML = d ? '<i class="fas fa-lock"></i>' : '<i class="fas fa-lock-open"></i>'; d ? b.classList.add('locked') : b.classList.remove('locked'); }
    } else {
        let d = themeConfig.lockedContent; 
        if(document.getElementById('themeAlphaRange')) document.getElementById('themeAlphaRange').disabled = d; 
        if(document.getElementById('textMaskRange')) document.getElementById('textMaskRange').disabled = d;
        const b = document.getElementById('lockContentBtn'); 
        if(b) { b.innerHTML = d ? '<i class="fas fa-lock"></i>' : '<i class="fas fa-lock-open"></i>'; d ? b.classList.add('locked') : b.classList.remove('locked'); }
    }
}

function initLocks() { applyLockState('img'); applyLockState('content'); }
function toggleThemeLock(type) { if (type === 'img') themeConfig.lockedImg = !themeConfig.lockedImg; else themeConfig.lockedContent = !themeConfig.lockedContent; applyLockState(type); saveSettings(); }

function toggleSystemTextScale() {
    const isChecked = document.getElementById('systemTextScaleCheck').checked;
    if(document.getElementById('textScaleRange')) document.getElementById('textScaleRange').disabled = isChecked; 
    if(document.getElementById('uiScaleRange')) document.getElementById('uiScaleRange').disabled = isChecked;
    if (isChecked) { 
        if(document.getElementById('textScaleRange')) document.getElementById('textScaleRange').value = 100; 
        if(document.getElementById('uiScaleRange')) document.getElementById('uiScaleRange').value = 100; 
        updateTextScale(); updateUiScale(); 
    }
}

function updateTextScale() { 
    const el = document.getElementById('textScaleRange'); if(!el) return;
    const val = el.value; 
    if(document.getElementById('textScaleDisplay')) document.getElementById('textScaleDisplay').innerText = val + '%'; 
    document.documentElement.style.setProperty('--text-scale', val / 100); saveSettings(); 
}
function updateUiScale() { 
    const el = document.getElementById('uiScaleRange'); if(!el) return;
    const val = el.value; 
    if(document.getElementById('uiScaleDisplay')) document.getElementById('uiScaleDisplay').innerText = val + '%'; 
    document.documentElement.style.setProperty('--ui-scale', val / 100); saveSettings(); 
}
function updateBgAdjustment() {
    const blurEl = document.getElementById('bgBlurRange'), opaEl = document.getElementById('bgOpacityRange'), overEl = document.getElementById('bgOverlayRange'), alphaEl = document.getElementById('themeAlphaRange'), maskEl = document.getElementById('textMaskRange');
    if(!blurEl) return;
    const blur = blurEl.value, opa = opaEl.value, over = overEl.value, alpha = alphaEl.value, mask = maskEl.value;
    
    if(document.getElementById('blurValDisplay')) document.getElementById('blurValDisplay').innerText = blur + 'px'; 
    if(document.getElementById('opacityValDisplay')) document.getElementById('opacityValDisplay').innerText = Math.round(opa * 100) + '%';
    if(document.getElementById('overlayValDisplay')) document.getElementById('overlayValDisplay').innerText = Math.round(over * 100) + '%'; 
    if(document.getElementById('themeAlphaDisplay')) document.getElementById('themeAlphaDisplay').innerText = alpha + '%'; 
    if(document.getElementById('textMaskDisplay')) document.getElementById('textMaskDisplay').innerText = mask + '%';
    
    document.documentElement.style.setProperty('--bg-blur', blur + 'px'); document.documentElement.style.setProperty('--bg-opacity', opa);
    document.documentElement.style.setProperty('--bg-overlay', over); document.documentElement.style.setProperty('--theme-alpha', alpha / 100); document.documentElement.style.setProperty('--text-mask', mask / 100);
    
    const previewImg = document.getElementById('bgPreviewImage'), previewOverlay = document.getElementById('bgPreviewOverlay');
    if(previewImg) { previewImg.style.filter = `blur(${blur}px)`; previewImg.style.opacity = opa; }
    if(previewOverlay) { previewOverlay.style.backgroundColor = `rgba(0, 0, 0, ${over})`; }
    saveSettings();
}

/* ======================== 裁剪模态框与自定义图床背景 ======================== */
function handleBgUpload(input) { if (input.files && input.files[0]) { const reader = new FileReader(); reader.onload = function(e) { openCropperModal(e.target.result); input.value = ''; }; reader.readAsDataURL(input.files[0]); } }
function openCropperModal(src) { document.getElementById('cropperImage').src = src; document.getElementById('cropperModal').style.display = 'flex'; if (cropper) cropper.destroy(); cropper = new Cropper(document.getElementById('cropperImage'), { viewMode: 1, dragMode: 'move', autoCropArea: 1, aspectRatio: NaN }); }
function confirmCrop() { if (!cropper) return; themeConfig.bgType = 'image'; themeConfig.bgValue = cropper.getCroppedCanvas({ maxWidth: 2000, maxHeight: 2000 }).toDataURL('image/jpeg', 0.85); updateBgPreviewUI(); closeModal('cropperModal'); saveSettings(); }
function applyBgUrl() { const url = document.getElementById('bgUrlInput').value.trim(); if (url) { themeConfig.bgType = 'url'; themeConfig.bgValue = url; updateBgPreviewUI(); saveSettings(); } }
function clearBackground() { themeConfig.bgType = 'none'; themeConfig.bgValue = ''; updateBgPreviewUI(); saveSettings(); }

function updateBgPreviewUI() {
    const previewImg = document.getElementById('bgPreviewImage'), previewText = document.querySelector('.bg-preview-text'), urlInput = document.getElementById('bgUrlInput'), globalBg = document.getElementById('custom-bg-layer');
    if(!previewImg || !globalBg) return;
    if (themeConfig.bgType === 'none' || !themeConfig.bgValue) { 
        previewImg.style.backgroundImage = 'none'; globalBg.style.backgroundImage = 'none'; 
        if(previewText) previewText.style.display = 'block'; 
        if(urlInput) urlInput.value = ''; 
    } else { 
        const imgUrl = `url("${themeConfig.bgValue}")`; previewImg.style.backgroundImage = imgUrl; globalBg.style.backgroundImage = imgUrl; 
        if(previewText) previewText.style.display = 'none'; 
        if(urlInput) urlInput.value = (themeConfig.bgType === 'url') ? themeConfig.bgValue : ''; 
    }
}
function closeModal(id) { document.getElementById(id).style.display = 'none'; }