const captionContainer = document.getElementById('caption-container');
const captionFinalized = document.getElementById('caption-finalized');
const captionText = document.getElementById('caption-text');
const captionTranslation = document.getElementById('caption-translation');
const closeBtn = document.getElementById('close-btn');

// State tracking
let state = {
  lastFinalized: { segmentId: null, text: '', translation: null },
  current: { segmentId: null, text: '', isRefined: false },
  pendingTranslation: { segmentId: null, text: null },
};

// Close button handler
closeBtn.addEventListener('click', () => {
  if (window.brevia?.floatingCaption?.close) {
    window.brevia.floatingCaption.close();
  }
});

// Manual window dragging
let dragState = null;
captionContainer.addEventListener('mousedown', (event) => {
  // Don't start drag on close button
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

// Render current state to UI
function render() {
  // Render finalized segment (top line)
  if (state.lastFinalized.text) {
    captionFinalized.textContent = state.lastFinalized.text;
    captionFinalized.classList.remove('hidden');
    // Auto-scroll to bottom to show latest content
    requestAnimationFrame(() => {
      captionFinalized.scrollTop = captionFinalized.scrollHeight;
    });
  } else {
    captionFinalized.classList.add('hidden');
  }

  // Render current segment (bottom line)
  captionText.textContent = state.current.text || '';

  // Auto-scroll to bottom to show latest content
  requestAnimationFrame(() => {
    captionText.scrollTop = captionText.scrollHeight;
  });

  // Render translation
  let translationText = '';
  let isDimmed = false;

  // Priority: match current segment, else match finalized segment (dimmed), else pending
  if (state.current.translation) {
    translationText = state.current.translation;
  } else if (state.lastFinalized.translation) {
    translationText = state.lastFinalized.translation;
    isDimmed = true;
  } else if (state.pendingTranslation.text) {
    translationText = state.pendingTranslation.text;
    isDimmed = true;
  }

  captionTranslation.textContent = translationText;
  captionTranslation.classList.toggle('hidden', !translationText);
  captionTranslation.classList.toggle('dimmed', isDimmed);
}

// Listen for caption updates - wait for brevia to be ready
function setupListener() {
  if (window.brevia?.onFloatingCaptionUpdate) {
    window.brevia.onFloatingCaptionUpdate((data) => {
      // If we receive a full state object from the main process (on window load)
      if (data.lastFinalized !== undefined && data.current !== undefined) {
        state.lastFinalized = data.lastFinalized;
        state.current = data.current;
        state.pendingTranslation = data.pendingTranslation;
        render();
        return;
      }

      // Handle finalize: move current → lastFinalized
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

      // Handle segment text update
      if (data.segmentId !== undefined && data.text !== undefined) {
        // Starting a new segment
        if (state.current.segmentId !== data.segmentId) {
          state.current = {
            segmentId: data.segmentId,
            text: data.text,
            isRefined: data.isRefined || false,
            translation: null,
          };
        } else {
          // Updating existing segment
          state.current.text = data.text;
          if (data.isRefined !== undefined) {
            state.current.isRefined = data.isRefined;
          }
        }
      }

      // Handle translation update
      if (data.translation !== undefined && data.segmentId !== undefined) {
        if (data.segmentId === state.current.segmentId) {
          state.current.translation = data.translation;
        } else if (data.segmentId === state.lastFinalized.segmentId) {
          state.lastFinalized.translation = data.translation;
        } else {
          // Store as pending if doesn't match current segments
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

// Start setup immediately
setupListener();
