const captionContainer = document.getElementById('caption-container');
const captionFinalized = document.getElementById('caption-finalized');
const captionText = document.getElementById('caption-text');
const captionTranslation = document.getElementById('caption-translation');
const closeBtn = document.getElementById('close-btn');
let renderedCaptionText = '';
let renderedFinalizedText = '';
let renderedTranslationText = '';
let showingTranslationLoading = false;
let followLiveCaption = true;
let autoScrolling = false;

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

captionContainer.addEventListener('scroll', () => {
  if (autoScrolling) return;
  followLiveCaption = captionContainer.scrollHeight - captionContainer.clientHeight - captionContainer.scrollTop <= 24;
});

function restartAnimation(element, className) {
  element.classList.remove(className);
  void element.offsetWidth;
  element.classList.add(className);
}

function renderCaptionText(text, streaming) {
  if (text === renderedCaptionText) return;
  if (streaming && renderedCaptionText && text.startsWith(renderedCaptionText)) {
    captionText.append(document.createTextNode(text.slice(renderedCaptionText.length)));
  } else {
    captionText.textContent = text;
    if (!streaming) restartAnimation(captionText, 'caption-fade');
  }
  renderedCaptionText = text;
}

function renderTranslationText(text) {
  if (text === renderedTranslationText) return;
  captionTranslation.textContent = text;
  if (text) restartAnimation(captionTranslation, 'caption-fade');
  renderedTranslationText = text;
}

function renderFinalizedText(text) {
  if (text === renderedFinalizedText) return;
  captionFinalized.textContent = text;
  if (text) restartAnimation(captionFinalized, 'caption-fade');
  renderedFinalizedText = text;
}

// 将当前状态渲染到 UI
function render() {
  const shouldFollow = followLiveCaption;
  // 渲染已定稿的片段（顶行）
  if (state.lastFinalized.text) {
    renderFinalizedText(state.lastFinalized.text);
    captionFinalized.classList.remove('hidden');
  } else {
    renderedFinalizedText = '';
    captionFinalized.classList.add('hidden');
  }

  // 渲染当前片段（底行）
  renderCaptionText(state.current.text || '', !state.current.isRefined);

  // 译文始终与上一段定稿原文配对；回放只有当前段时，才显示当前段译文。
  let translationText = '';
  const hasFinalized = Boolean(state.lastFinalized.text);
  if (hasFinalized) {
    translationText = state.lastFinalized.translation;
    if (captionTranslation.previousElementSibling !== captionFinalized) captionFinalized.after(captionTranslation);
  } else if (state.current.isRefined) {
    translationText = state.current.translation;
    if (captionTranslation.previousElementSibling !== captionText) captionText.after(captionTranslation);
  }

  // 仅为上一段定稿字幕显示翻译中的状态。
  const pendingId = state.translationPending?.segmentId;
  const showLoading = hasFinalized && !translationText && pendingId === state.lastFinalized.segmentId;

  if (showLoading) {
    if (!showingTranslationLoading) {
      captionTranslation.innerHTML = '<span class="translation-loading"><span></span><span></span><span></span></span>';
      renderedTranslationText = '';
      captionTranslation.classList.remove('hidden');
      captionTranslation.classList.add('dimmed');
      showingTranslationLoading = true;
    }
  } else {
    showingTranslationLoading = false;
    renderTranslationText(translationText);
    captionTranslation.classList.toggle('hidden', !translationText);
    captionTranslation.classList.toggle('dimmed', false);
  }

  requestAnimationFrame(() => {
    if (shouldFollow) {
      autoScrolling = true;
      captionContainer.scrollTop = captionContainer.scrollHeight;
      requestAnimationFrame(() => { autoScrolling = false; });
    }
  });
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
        if (!state.lastFinalized.text && !state.current.text) followLiveCaption = true;
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
