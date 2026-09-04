import type { ChangeEvent } from 'react';

export interface AdvancedSettingsPanelProps {
  open: boolean;
  textScale: number;
  uiScale: number;
  bgBlur: number;
  bgOpacity: number;
  bgOverlay: number;
  bgPreviewUrl: string;
  systemTextScale: boolean;
  lockedImg: boolean;
  fontSource: 'theme' | 'system' | 'custom';
  customFontUrl: string;
  customFontName: string;
  onClose?: () => void;
  onTextScaleChange?: (value: number) => void;
  onUiScaleChange?: (value: number) => void;
  onBgBlurChange?: (value: number) => void;
  onBgOpacityChange?: (value: number) => void;
  onBgOverlayChange?: (value: number) => void;
  onToggleSystemTextScale?: (value: boolean) => void;
  /* 只保留 'img'。'content' 曾用于锁定主题透明度/文字遮罩滑块,现整个功能已移除。 */
  onToggleThemeLock?: (target: 'img') => void;
  onUploadBackground?: (file: File) => void;
  onClearBackground?: () => void;
  onDownloadBackground?: () => void;
  onApplyBgUrl?: (url: string) => void;
  onRefreshCurrentFont?: () => void;
  onChangeFontSource?: (value: 'theme' | 'system' | 'custom') => void;
  onApplyCurrentThemeFontAsCustom?: () => void;
  onApplyCustomFont?: (url: string, name: string) => void;
  onResetSettings?: () => void;
}

const numberInputProps = {
  type: 'range' as const,
  style: { width: '100%' },
};

const LOCK_OPEN_ICON = '<i class="fas fa-lock-open"></i>';
const LOCK_CLOSED_ICON = '<i class="fas fa-lock"></i>';

/**
 * 高级主题设置面板（无损移植 docs/参考代码/2/code.html 中 #settingsWrapper）。
 *
 * 与参考实现保持 1:1 行为契约：
 *  - 滑块全部受控：值取自 themeConfig,变更通过 onXxxChange 回写 controller,
 *    controller 负责把值写回 CSS 变量 / DOM 预览 / localStorage。
 *  - 锁定按钮的图标由 controller 在 useEffect 中通过 lockImgBtn 的 innerHTML
 *    直接控制；这里仅渲染 <button className="param-lock-btn"> 容器。
 *  - 系统文字缩放 checkbox 一旦勾选,controller 会同时把 textScale / uiScale
 *    重置为 100 并禁用滑块；面板只需在 disabled / checked 上跟随。
 */
export function AdvancedSettingsPanel(props: AdvancedSettingsPanelProps) {
  const {
    open,
    textScale,
    uiScale,
    bgBlur,
    bgOpacity,
    bgOverlay,
    bgPreviewUrl,
    systemTextScale,
    lockedImg,
    fontSource,
    customFontUrl,
    customFontName,
    onClose,
    onTextScaleChange,
    onUiScaleChange,
    onBgBlurChange,
    onBgOpacityChange,
    onBgOverlayChange,
    onToggleSystemTextScale,
    onToggleThemeLock,
    onUploadBackground,
    onClearBackground,
    onDownloadBackground,
    onApplyBgUrl,
    onRefreshCurrentFont,
    onChangeFontSource,
    onApplyCurrentThemeFontAsCustom,
    onApplyCustomFont,
    onResetSettings,
  } = props;

  const handleBgUpload = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      onUploadBackground?.(file);
    }
    /* 允许连续上传同一文件 */
    event.target.value = '';
  };

  const handleApplyCustomFont = () => {
    onApplyCustomFont?.(
      (document.getElementById('customFontUrl') as HTMLInputElement | null)?.value.trim() ??
        customFontUrl,
      (document.getElementById('customFontName') as HTMLInputElement | null)?.value.trim() ??
        customFontName,
    );
  };

  const handleApplyBgUrl = () => {
    const url = (document.getElementById('bgUrlInput') as HTMLInputElement | null)?.value.trim();
    if (url !== undefined && url !== null) {
      onApplyBgUrl?.(url);
    }
  };

  return (
    <div className={`settings-wrapper${open ? ' show' : ''}`} id="settingsWrapper">
      <div className="settings-panel">
        <h2>
          <span>
            <i className="fas fa-sliders-h" /> 高级主题设置
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <i
              className="fas fa-undo"
              title="恢复默认设置"
              role="button"
              aria-label="恢复默认设置"
              style={{ cursor: 'pointer' }}
              onClick={onResetSettings}
            />
            <i
              className="fas fa-times close-modal-btn d-lg-none"
              title="关闭面板"
              role="button"
              aria-label="关闭面板"
              onClick={onClose}
            />
          </div>
        </h2>

        {/* 缩放比例调节 */}
        <div className="adjust-container">
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 10,
            }}
          >
            <span className="section-label">
              <i className="fas fa-expand" /> 缩放比例调节
            </span>
            <label
              style={{
                fontSize: 'calc(12px * var(--text-scale))',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                cursor: 'pointer',
                color: 'var(--sp-text-secondary)',
                /* 防止父级 justify-content: space-between 把整段 label 压缩导致文字换行 */
                flexShrink: 0,
                whiteSpace: 'nowrap',
              }}
            >
              <input
                type="checkbox"
                id="systemTextScaleCheck"
                checked={systemTextScale}
                onChange={(event) => onToggleSystemTextScale?.(event.target.checked)}
              />
              跟随系统
            </label>
          </div>
          <div className="range-group">
            <div className="range-header">
              <span>全局文字缩宽</span>
              <span id="textScaleDisplay">{textScale}%</span>
            </div>
            <input
              {...numberInputProps}
              id="textScaleRange"
              min={50}
              max={200}
              step={1}
              value={textScale}
              disabled={systemTextScale}
              onInput={(event) =>
                onTextScaleChange?.(Number((event.target as HTMLInputElement).value))
              }
            />
          </div>
          <div className="range-group">
            <div className="range-header">
              <span>界面UI缩放</span>
              <span id="uiScaleDisplay">{uiScale}%</span>
            </div>
            <input
              {...numberInputProps}
              id="uiScaleRange"
              min={50}
              max={150}
              step={1}
              value={uiScale}
              disabled={systemTextScale}
              onInput={(event) =>
                onUiScaleChange?.(Number((event.target as HTMLInputElement).value))
              }
            />
          </div>
        </div>

        {/* 背景图片微调 */}
        <div className="adjust-container">
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 10,
            }}
          >
            <span className="section-label">
              <i className="fas fa-image" /> 背景图片微调
            </span>
            <button
              type="button"
              className={`param-lock-btn${lockedImg ? ' locked' : ''}`}
              id="lockImgBtn"
              onClick={() => onToggleThemeLock?.('img')}
              dangerouslySetInnerHTML={{ __html: lockedImg ? LOCK_CLOSED_ICON : LOCK_OPEN_ICON }}
            />
          </div>
          <div className="range-group">
            <div className="range-header">
              <span>底层模糊度</span>
              <span id="blurValDisplay">{bgBlur}px</span>
            </div>
            <input
              {...numberInputProps}
              id="bgBlurRange"
              min={0}
              max={20}
              step={1}
              value={bgBlur}
              disabled={lockedImg}
              onInput={(event) =>
                onBgBlurChange?.(Number((event.target as HTMLInputElement).value))
              }
            />
          </div>
          <div className="range-group">
            <div className="range-header">
              <span>底层透明度</span>
              <span id="opacityValDisplay">{Math.round(bgOpacity * 100)}%</span>
            </div>
            <input
              {...numberInputProps}
              id="bgOpacityRange"
              min={0}
              max={1}
              step={0.01}
              value={bgOpacity}
              disabled={lockedImg}
              onInput={(event) =>
                onBgOpacityChange?.(Number((event.target as HTMLInputElement).value))
              }
            />
          </div>
          <div className="range-group">
            <div className="range-header">
              <span>底层遮罩加深</span>
              <span id="overlayValDisplay">{Math.round(bgOverlay * 100)}%</span>
            </div>
            <input
              {...numberInputProps}
              id="bgOverlayRange"
              min={0}
              max={0.95}
              step={0.01}
              value={bgOverlay}
              disabled={lockedImg}
              onInput={(event) =>
                onBgOverlayChange?.(Number((event.target as HTMLInputElement).value))
              }
            />
          </div>

          <label
            style={{
              display: 'block',
              margin: '15px 0 6px 0',
              fontWeight: 600,
              fontSize: 'calc(13px * var(--text-scale))',
              color: 'var(--sp-text)',
            }}
          >
            自定义背景图
          </label>
          <div className="bg-preview-wrapper" id="bgPreviewBox">
            <div
              id="bgPreviewImage"
              style={bgPreviewUrl ? { backgroundImage: `url("${bgPreviewUrl}")` } : undefined}
            />
            <div id="bgPreviewOverlay" />
            <span className="bg-preview-text">
              {bgPreviewUrl ? '已设置自定义背景图' : '无自定义背景图'}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <label
              className="sp-btn advanced-bg-upload-button"
              style={{
                flex: 1,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                cursor: 'pointer',
              }}
            >
              <i className="fas fa-upload" /> 上传图片
              {/* 绝对定位 + 0 透明度而不是 display:none:
               *  - display:none 会让部分 Android/iOS 浏览器拒绝弹出图片选择器。
               *  - 0 透明度 + 绝对定位 1x1 既保留交互又不占布局。 */}
              <input
                type="file"
                accept="image/*"
                capture={undefined}
                style={{
                  position: 'absolute',
                  width: 1,
                  height: 1,
                  padding: 0,
                  margin: -1,
                  overflow: 'hidden',
                  clip: 'rect(0,0,0,0)',
                  whiteSpace: 'nowrap',
                  border: 0,
                  opacity: 0,
                }}
                onChange={handleBgUpload}
              />
            </label>
            {/* 下载按钮:仅在有自定义背景图(image 或 url)时可用。
             * image 类型从 IndexedDB 读 Blob 触发下载,url 类型提示用户走浏览器右键另存为。*/}
            <button
              type="button"
              className="sp-btn"
              style={{ flex: 1 }}
              onClick={onDownloadBackground}
              title="把当前自定义背景图下载到本地"
            >
              <i className="fas fa-download" /> 下载
            </button>
            <button type="button" className="sp-btn danger" onClick={onClearBackground}>
              <i className="fas fa-broom" /> 清空背景图缓存
            </button>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <input
              type="text"
              id="bgUrlInput"
              className="form-control"
              placeholder="输入图片 URL 图床链接..."
              defaultValue={bgPreviewUrl}
            />
            <button type="button" className="sp-btn primary" onClick={handleApplyBgUrl}>
              <i className="fas fa-check" />
            </button>
          </div>
        </div>

        {/* 自定义字体设置区 */}
        <div className="adjust-container">
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 10,
            }}
          >
            <span className="section-label">
              <i className="fas fa-font" /> 自定义字体设置
            </span>
            <button
              type="button"
              className="sp-btn"
              style={{ padding: '4px 8px', fontSize: 12 }}
              onClick={onRefreshCurrentFont}
            >
              <i className="fas fa-sync-alt" /> 刷新字体
            </button>
          </div>
          <div
            style={{
              display: 'flex',
              gap: 10,
              marginBottom: 12,
              fontSize: 'calc(13px * var(--text-scale))',
              color: 'var(--sp-text)',
            }}
          >
            <label style={{ cursor: 'pointer' }}>
              <input
                type="radio"
                name="fontSource"
                value="theme"
                checked={fontSource === 'theme'}
                onChange={() => onChangeFontSource?.('theme')}
              />{' '}
              主题默认
            </label>
            <label style={{ cursor: 'pointer' }}>
              <input
                type="radio"
                name="fontSource"
                value="system"
                checked={fontSource === 'system'}
                onChange={() => onChangeFontSource?.('system')}
              />{' '}
              系统默认
            </label>
            <label style={{ cursor: 'pointer' }}>
              <input
                type="radio"
                name="fontSource"
                value="custom"
                checked={fontSource === 'custom'}
                onChange={() => onChangeFontSource?.('custom')}
              />{' '}
              自定义链接
            </label>
          </div>

          <div
            id="customFontConfig"
            style={{ display: fontSource === 'custom' ? 'block' : 'none', marginBottom: 10 }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 8,
              }}
            >
              <span style={{ fontSize: 12, color: 'var(--sp-text-secondary)' }}>外链资源配置</span>
              <button
                type="button"
                className="sp-btn"
                style={{ padding: '4px 8px', fontSize: 12 }}
                onClick={onApplyCurrentThemeFontAsCustom}
              >
                <i className="fas fa-globe" /> 所选主题全局
              </button>
            </div>
            <div style={{ position: 'relative', marginBottom: 8 }}>
              <input
                type="text"
                id="customFontUrl"
                className="form-control"
                placeholder="字体URL (支持 .ttf直链 / CSS)"
                defaultValue={customFontUrl}
                style={{ paddingRight: 30, width: '100%' }}
              />
              <i
                className="fas fa-times"
                style={{
                  position: 'absolute',
                  right: 10,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  color: 'var(--sp-text-secondary)',
                  cursor: 'pointer',
                }}
                onClick={() => {
                  const input = document.getElementById('customFontUrl') as HTMLInputElement | null;
                  if (input) {
                    input.value = '';
                  }
                }}
              />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{ position: 'relative', flex: 1 }}>
                <input
                  type="text"
                  id="customFontName"
                  className="form-control"
                  placeholder="字体名称 (不填自动提取)"
                  defaultValue={customFontName}
                  style={{ width: '100%', paddingRight: 30 }}
                />
                <i
                  className="fas fa-times"
                  style={{
                    position: 'absolute',
                    right: 10,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    color: 'var(--sp-text-secondary)',
                    cursor: 'pointer',
                  }}
                  onClick={() => {
                    const input = document.getElementById(
                      'customFontName',
                    ) as HTMLInputElement | null;
                    if (input) {
                      input.value = '';
                    }
                  }}
                />
              </div>
              <button type="button" className="sp-btn primary" onClick={handleApplyCustomFont}>
                <i className="fas fa-check" />
              </button>
            </div>
          </div>

          <div
            style={{
              padding: 12,
              border: '1px dashed var(--sp-border)',
              borderRadius: 6,
              background: 'var(--sp-bg)',
              textAlign: 'center',
              transition: 'background 0.3s, border-color 0.3s',
            }}
          >
            <div id="fontPreviewText" style={{ fontSize: 16, color: 'var(--sp-text)' }}>
              The quick brown fox jumps.
              <br />
              自定义网页字体实时预览区。
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
