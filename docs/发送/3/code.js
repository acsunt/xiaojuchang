/* ======================== 核心数据映射 ======================== */
const themeFonts = {
    'minimal': { name: '韩系低饱和苹方黑', url: 'https://file.garden/aGe4CU9X_j-yMpiG/%E9%9F%A9%E7%B3%BB%E4%BD%8E%E9%A5%B1%E5%92%8C%E8%8B%B9%E6%96%B9%E9%BB%91.ttf' },
    'neumorphism': { name: '极简小奶圆', url: 'https://file.garden/aGe4CU9X_j-yMpiG/%E6%9E%81%E7%AE%80%E5%B0%8F%E5%A5%B6%E5%9C%86.ttf' },
    'glass': { name: '亲一口我的小毛咪', url: 'https://file.garden/aGe4CU9X_j-yMpiG/%E4%BA%B2%E4%B8%80%E5%8F%A3%E6%88%91%E7%9A%84%E5%B0%8F%E6%AF%9B%E5%92%AA(1).ttf' },
    'corporate': { name: '方正润黑简约电子风', url: 'https://file.garden/aGe4CU9X_j-yMpiG/%E6%96%B9%E6%AD%A3%E6%B6%A6%E9%BB%91%E7%AE%80%E7%BA%A6%E7%94%B5%E5%AD%90%E9%A3%8E(1).ttf' },
    'gradient': { name: '如何忘记你的记忆', url: 'https://file.garden/aGe4CU9X_j-yMpiG/%E5%A6%82%E4%BD%95%E5%BF%98%E8%AE%B0%E4%BD%A0%E7%9A%84%E8%AE%B0%E5%BF%86.ttf' },
    'memphis': { name: '玫瑰牵绊断线风筝', url: 'https://file.garden/aGe4CU9X_j-yMpiG/%E7%8E%AB%E7%91%B0%E7%89%B5%E7%BB%8A%E6%96%AD%E7%BA%BF%E9%A3%8E%E7%AD%9D(1).ttf' },
    'cyberpunk': { name: '古早聊天室的像素体', url: 'https://file.garden/aGe4CU9X_j-yMpiG/%E5%8F%A4%E6%97%A9%E8%81%8A%E5%A4%A9%E5%AE%A4%E7%9A%84%E5%83%8F%E7%B4%A0%E4%BD%93.ttf' },
    'swiss': { name: '方正筑紫A圆体E', url: 'https://file.garden/aGe4CU9X_j-yMpiG/%E6%96%B9%E6%AD%A3%E7%AD%91%E7%B4%ABA%E5%9C%86%E4%BD%93E%EF%BC%881%EF%BC%89.ttf' },
    'editorial': { name: '春山与观物 明朝体', url: 'https://file.garden/aGe4CU9X_j-yMpiG/%E6%98%A5%E5%B1%B1%E4%B8%8E%E8%A7%82%E7%89%A9%20%E6%98%8E%E6%9C%9D%E4%BD%93.ttf' },
    'illustration': { name: '异次元流浪小猫', url: 'https://file.garden/aGe4CU9X_j-yMpiG/%E5%BC%82%E6%AC%A1%E5%85%83%E6%B5%81%E6%B5%AA%E5%B0%8F%E7%8C%AB(1).ttf' },
    'isometric': { name: '云淡风轻雅隶书', url: 'https://file.garden/aGe4CU9X_j-yMpiG/%E4%BA%91%E6%B7%A1%E9%A3%8E%E8%BD%BB%E9%9B%85%E9%9A%B6%E4%B9%A6(1).ttf' },
    'retro': { name: '古早小兔叽打字机', url: 'https://file.garden/aGe4CU9X_j-yMpiG/%E5%8F%A4%E6%97%A9%E5%B0%8F%E5%85%94%E5%8F%BD%E6%89%93%E5%AD%97%E6%9C%BA(1).ttf' },
    'futuristic': { name: '虚拟的爱正在输入中100', url: 'https://file.garden/aGe4CU9X_j-yMpiG/%E8%99%9A%E6%8B%9F%E7%9A%84%E7%88%B1%E6%AD%A3%E5%9C%A8%E8%BE%93%E5%85%A5%E4%B8%AD100(1).ttf' },
    'pastel': { name: '浮世万千欢喜人间', url: 'https://file.garden/aGe4CU9X_j-yMpiG/%E6%B5%AE%E4%B8%96%E4%B8%87%E5%8D%83%E6%AC%A2%E5%96%9C%E4%BA%BA%E9%97%B4.ttf' },
    'brutalism': { name: '我偏要一条路走到黑', url: 'https://file.garden/aGe4CU9X_j-yMpiG/%E6%88%91%E5%81%8F%E8%A6%81%E4%B8%80%E6%9D%A1%E8%B7%AF%E8%B5%B0%E5%88%B0%E9%BB%91.ttf' }
};

const styles = [
  { key: 'default',      name: '默认' },
  { key: 'minimal',      name: '极简主义' }, { key: 'neumorphism',  name: '新拟态' },
  { key: 'glass',        name: '玻璃拟态' }, { key: 'corporate',    name: '商务简约' },
  { key: 'gradient',     name: '渐变风格' }, { key: 'memphis',      name: '孟菲斯' },
  { key: 'cyberpunk',    name: '赛博朋克' }, { key: 'swiss',        name: '瑞士风格' },
  { key: 'editorial',    name: '杂志排版' }, { key: 'illustration', name: '手绘插画' },
  { key: 'isometric',    name: '等距插画' }, { key: 'retro',        name: '复古怀旧' },
  { key: 'futuristic',   name: '未来科技' }, { key: 'pastel',       name: '温暖治愈' },
  { key: 'brutalism',    name: '粗野主义' }
];

let currentStyle = localStorage.getItem('site-style') || 'default';
let currentMode = localStorage.getItem('site-mode') || 'day';
let currentLayout = localStorage.getItem('site-layout') || 'scroll';
let themeConfig = { bgType: 'none', bgValue: '', lockedImg: true, lockedContent: true, fontSource: 'theme', fontUrl: '', fontName: '' };

/* ======================== 基础主题切换逻辑 ======================== */
function applyState() {
  document.body.setAttribute('data-style', currentStyle); 
  document.body.setAttribute('data-mode', currentMode);
  document.querySelectorAll('.switcher button').forEach(b => b.classList.toggle('active', b.dataset.key === currentStyle));
  const modeIcon = document.getElementById('modeIcon');
  if(modeIcon) modeIcon.className = currentMode === 'day' ? 'fas fa-sun' : 'fas fa-moon';
  localStorage.setItem('site-style', currentStyle); localStorage.setItem('site-mode', currentMode);
  updateFontDOM(); 
}

function applyLayout() {
  const switcher = document.getElementById('switcher');
  if(switcher) switcher.className = `switcher layout-${currentLayout}`;
  const layoutIcon = document.getElementById('layoutIcon');
  if(layoutIcon) layoutIcon.className = currentLayout === 'scroll' ? 'fas fa-arrows-alt-h' : 'fas fa-th-large';
  localStorage.setItem('site-layout', currentLayout);
}

/* ======================== 字体控制核心逻辑 ======================== */
function initFontPanel() {
    const fontRadio = document.querySelector(`input[name="fontSource"][value="${themeConfig.fontSource}"]`);
    if(fontRadio) fontRadio.checked = true;
    const urlInput = document.getElementById('customFontUrl');
    if(urlInput) urlInput.value = themeConfig.fontUrl; 
    const nameInput = document.getElementById('customFontName');
    if(nameInput) nameInput.value = themeConfig.fontName;
    toggleFontInputs();
}

function changeFontSource() { themeConfig.fontSource = document.querySelector('input[name="fontSource"]:checked').value; toggleFontInputs(); updateFontDOM(); saveSettings(); }
function toggleFontInputs() { const cfg = document.getElementById('customFontConfig'); if(cfg) cfg.style.display = themeConfig.fontSource === 'custom' ? 'block' : 'none'; }
function applyCurrentThemeFontAsCustom() {
    const themeFontInfo = themeFonts[currentStyle];
    if(themeFontInfo) { document.getElementById('customFontUrl').value = themeFontInfo.url; document.getElementById('customFontName').value = themeFontInfo.name; applyCustomFont(); } 
    else { alert("当前主题未配置专属字体"); }
}
function applyCustomFont() {
    let url = document.getElementById('customFontUrl').value.trim();
    if(!url) { alert("请输入有效的字体链接"); return; }
    let name = document.getElementById('customFontName').value.trim();
    if (!name) {
        try { let pathname = decodeURIComponent(new URL(url).pathname); name = pathname.split('/').pop().split('.')[0] || 'MyCustomFont'; } 
        catch (e) { let decoded = decodeURIComponent(url); name = decoded.split('/').pop().split('.')[0] || 'MyCustomFont'; }
        document.getElementById('customFontName').value = name;
    }
    themeConfig.fontUrl = url; themeConfig.fontName = name; updateFontDOM(); saveSettings();
}

async function updateFontDOM(forceReload = false) {
    const source = themeConfig.fontSource;
    let styleTag = document.getElementById('dynamic-font-style');
    if(!styleTag) { styleTag = document.createElement('style'); styleTag.id = 'dynamic-font-style'; document.head.appendChild(styleTag); }
    const preview = document.getElementById('fontPreviewText');

    if (source === 'system') {
        const sysFont = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
        styleTag.innerHTML = `body { font-family: ${sysFont} !important; }`; 
        if(preview) preview.style.fontFamily = sysFont;
    } else if (source === 'custom' && themeConfig.fontUrl) {
        const url = themeConfig.fontUrl; const name = themeConfig.fontName || 'MyCustomFont';
        await loadAndApplyFont(name, url, forceReload);
        if(url.includes('.css') || url.includes('fonts.googleapis')) {
            let link = document.getElementById('dynamic-font-link');
            if(link) link.remove();
            link = document.createElement('link'); link.id = 'dynamic-font-link'; link.rel = 'stylesheet'; link.href = url; document.head.appendChild(link);
        }
        styleTag.innerHTML = `body { font-family: '${name}', sans-serif !important; }`; 
        if(preview) preview.style.fontFamily = `'${name}', sans-serif`;
    } else {
        styleTag.innerHTML = ''; 
        if(preview) preview.style.fontFamily = 'var(--font-family)';
        const themeFontInfo = themeFonts[currentStyle];
        if(themeFontInfo) await loadAndApplyFont(themeFontInfo.name, themeFontInfo.url, forceReload);
    }
}

async function loadAndApplyFont(fontName, fontUrl, forceReload = false) {
    if(!fontName || !fontUrl) return;
    const loadingOverlay = document.getElementById('fontLoadingOverlay');
    const loadingName = document.getElementById('fontLoadingName');
    
    if (forceReload) { Array.from(document.fonts).forEach(f => { if (f.family === fontName) document.fonts.delete(f); }); }
    let isLoaded = false;
    document.fonts.forEach(f => { if (f.family === fontName && f.status === 'loaded') isLoaded = true; });

    if (!isLoaded) {
        try {
            if(loadingName) loadingName.innerText = fontName; 
            if(loadingOverlay) loadingOverlay.classList.add('show');
            const font = new FontFace(fontName, `url("${fontUrl}")`);
            await font.load(); document.fonts.add(font);
        } catch (err) { console.error("字体加载失败:", err); } 
        finally { if(loadingOverlay) setTimeout(() => { loadingOverlay.classList.remove('show'); }, 300); }
    }
}
function refreshCurrentFont() { updateFontDOM(true); }