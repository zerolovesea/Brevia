const captionContainer = document.getElementById('caption-container');
const captionFinalized = document.getElementById('caption-finalized');
const captionText = document.getElementById('caption-text');
const captionTranslation = document.getElementById('caption-translation');
const closeBtn = document.getElementById('close-btn');

// 状态跟踪
let state = {
  lastFinalized: { segmentId: null, text: '', translation: null },
  current: { segmentId: null, text: '', isRefined: false },
  pendingTranslation: { segmentId: null, text: null },
  translationPending: { segmentId: null },
};

// 关闭按钮处理器
closeBtn.addEventListener('click', () => {
  if (window.brevia?.floatingCaption?.close) {
    window.brevia.floatingCaption.close();
  }
});

// 手动窗口拖拽
let dragState = null;
captionContainer.addEventListener('mousedown', (event) => {
  // 不在关闭按钮上开始拖拽
  if (event.target.closest('.close-btn')) return;

  dragState = {
    startX: event.screenX,
    startY: event.screenY,
  };
});

document.addEventListener('mousemove', (event) => {
  if (!dragState) return;

  const deltaX = event.screenX - dragState.startX;
  const deltaY = event.screenY - dragState.startY;

  if (window.brevia?.floatingCaption?.move) {
    window.brevia.floatingCaption.move({ deltaX, deltaY });
  }

  dragState.startX = event.screenX;
  dragState.startY = event.screenY;
});

document.addEventListener('mouseup', () => {
  dragState = null;
});

// 将当前状态渲染到 UI
function render() {
  // 渲染已定稿的片段（顶行）
  if (state.lastFinalized.text) {
    captionFinalized.textContent = state.lastFinalized.text;
    captionFinalized.classList.remove('hidden');
    // 自动滚动到底部以显示最新内容
    requestAnimationFrame(() => {
      captionFinalized.scrollTop = captionFinalized.scrollHeight;
    });
  } else {
    captionFinalized.classList.add('hidden');
  }

  // 渲染当前片段（底行）
  captionText.textContent = state.current.text || '';

  // 自动滚动到底部以显示最新内容
  requestAnimationFrame(() => {
    captionText.scrollTop = captionText.scrollHeight;
  });

  // 渲染译文
  let translationText = '';
  let isDimmed = false;

  // 优先级：匹配当前片段，否则匹配已定稿片段（变暗），否则待定
  if (state.current.translation) {
    translationText = state.current.translation;
  } else if (state.lastFinalized.translation) {
    translationText = state.lastFinalized.translation;
    isDimmed = true;
  } else if (state.pendingTranslation.text) {
    translationText = state.pendingTranslation.text;
    isDimmed = true;
  }

  // 当显示的片段正在翻译时显示加载点
  const pendingId = state.translationPending?.segmentId;
  const showLoading = !translationText && pendingId
    && (pendingId === state.current.segmentId || pendingId === state.lastFinalized.segmentId);

  if (showLoading) {
    captionTranslation.innerHTML = '<span class="translation-loading"><span></span><span></span><span></span></span>';
    captionTranslation.classList.remove('hidden');
    captionTranslation.classList.add('dimmed');
  } else {
    captionTranslation.textContent = translationText;
    captionTranslation.classList.toggle('hidden', !translationText);
    captionTranslation.classList.toggle('dimmed', isDimmed);
  }
}

// 监听字幕更新 - 等待 brevia 准备就绪
function setupListener() {
  if (window.brevia?.onFloatingCaptionUpdate) {
    window.brevia.onFloatingCaptionUpdate((data) => {
      // 如果我们从主进程接收到完整状态对象（在窗口加载时）
      if (data.lastFinalized !== undefined && data.current !== undefined) {
        state.lastFinalized = data.lastFinalized;
        state.current = data.current;
        state.pendingTranslation = data.pendingTranslation;
        if (data.translationPending !== undefined) state.translationPending = data.translationPending;
        render();
        return;
      }

      // 处理定稿：将当前片段移动到已定稿
      if (data.finalize) {
        state.lastFinalized = {
          segmentId: state.current.segmentId,
          text: state.current.text,
          translation: state.current.translation || null,
        };
        state.current = { segmentId: null, text: '', isRefined: false, translation: null };
        render();
        return;
      }

      // 处理片段文本更新
      if (data.segmentId !== undefined && data.text !== undefined) {
        // 开始新片段
        if (state.current.segmentId !== data.segmentId) {
          state.current = {
            segmentId: data.segmentId,
            text: data.text,
            isRefined: data.isRefined || false,
            translation: null,
          };
        } else {
          // 更新现有片段
          state.current.text = data.text;
          if (data.isRefined !== undefined) {
            state.current.isRefined = data.isRefined;
          }
        }
      }

      // 处理译文更新
      if (data.translation !== undefined && data.segmentId !== undefined) {
        if (data.segmentId === state.current.segmentId) {
          state.current.translation = data.translation;
        } else if (data.segmentId === state.lastFinalized.segmentId) {
          state.lastFinalized.translation = data.translation;
        } else {
          // 如果不匹配当前片段，则存储为待定
          state.pendingTranslation = {
            segmentId: data.segmentId,
            text: data.translation,
          };
        }
      }

      render();
    });
  } else {
    setTimeout(setupListener, 50);
  }
}

// 立即开始设置
setupListener();
