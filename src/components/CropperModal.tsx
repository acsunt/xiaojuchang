export interface CropperModalProps {
  open: boolean;
  imageSrc: string;
  cropperReady?: boolean;
  onClose?: () => void;
  onReset?: () => void;
  onConfirm?: () => void;
}

/**
 * 裁剪模态框（无损移植 docs/参考代码/2/code.html 中 #cropperModal）。
 *
 * 1. 始终挂载 DOM,仅切换 display:none/flex 切换可见性,这样 useThemeController
 *    可以随时通过 document.getElementById('cropperImage') 拿到待裁剪图片节点,
 *    也能保留挂载期间 Cropper.js 内部状态。
 * 2. 实际剪裁 / 重置 / 取消由父组件 useThemeController 提供的 onConfirm / onReset / onClose 接管。
 * 3. Cropper.js 通过 window.Cropper 全局对象初始化（在 index.html 中 defer 加载）。
 *    在脚本尚未就绪时,展示「正在加载」提示以避免误操作。
 */
export function CropperModal({
  open,
  imageSrc,
  cropperReady = false,
  onClose,
  onReset,
  onConfirm,
}: CropperModalProps) {
  return (
    <div
      id="cropperModal"
      className="modal"
      style={{ display: open ? 'flex' : 'none' }}
      role="dialog"
      aria-modal="true"
    >
      <div className="modal-content">
        <div className="modal-header">
          <span>
            <i className="fas fa-crop" /> 剪裁图片
          </span>
          <i
            className="fas fa-times close-modal-btn"
            title="关闭"
            role="button"
            aria-label="关闭裁剪"
            onClick={onClose}
          />
        </div>
        <div className="cropper-container-wrapper">
          <img
            id="cropperImage"
            src={imageSrc}
            alt="待剪裁图片"
            style={{ maxWidth: '100%', display: 'block' }}
          />
        </div>
        {!cropperReady ? (
          <div
            style={{
              marginTop: 10,
              fontSize: 12,
              color: 'var(--sp-text-secondary)',
              textAlign: 'center',
            }}
          >
            <i className="fas fa-spinner fa-spin" /> 正在加载 Cropper.js…
          </div>
        ) : null}
        <div
          style={{
            textAlign: 'right',
            marginTop: 15,
            display: 'flex',
            justifyContent: 'space-between',
          }}
        >
          <button type="button" className="sp-btn" onClick={onReset} disabled={!cropperReady}>
            <i className="fas fa-sync" /> 重置
          </button>
          <div>
            <button type="button" className="sp-btn" onClick={onClose}>
              取消
            </button>
            <button
              type="button"
              className="sp-btn primary"
              onClick={onConfirm}
              disabled={!cropperReady}
            >
              <i className="fas fa-check" /> 确定应用
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
