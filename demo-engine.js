/**
 * Demo Engine - Core animation and cursor control
 */

class DemoEngine {
  constructor() {
    this.cursor = null;
    this.cursorRipple = null;
    this.viewport = null;
    this.isPlaying = false;
    this.isPaused = false;
    this.currentAnimation = null;
    this.animationQueue = [];
  }

  init(viewportElement, cursorElement, rippleElement) {
    this.viewport = viewportElement;
    this.cursor = cursorElement;
    this.cursorRipple = rippleElement;
    this.hideCursor();
  }

  /**
   * Move cursor to target with smooth easing
   * @param {Object} target - {x, y} or DOM element or selector
   * @param {Number} duration - milliseconds
   * @param {String} easing - cubic-bezier easing
   */
  async moveCursor(target, duration = 800, easing = 'cubic-bezier(0.4, 0, 0.2, 1)') {
    const targetPos = this.resolvePosition(target);
    if (!targetPos) return;

    this.showCursor();

    return new Promise((resolve) => {
      const startPos = {
        x: parseFloat(this.cursor.style.left) || 0,
        y: parseFloat(this.cursor.style.top) || 0
      };

      const startTime = performance.now();

      const animate = (currentTime) => {
        if (this.isPaused) {
          requestAnimationFrame(animate);
          return;
        }

        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);

        // Apply easing
        const easedProgress = this.applyEasing(progress, easing);

        const currentX = startPos.x + (targetPos.x - startPos.x) * easedProgress;
        const currentY = startPos.y + (targetPos.y - startPos.y) * easedProgress;

        this.cursor.style.left = `${currentX}px`;
        this.cursor.style.top = `${currentY}px`;

        if (progress < 1) {
          this.currentAnimation = requestAnimationFrame(animate);
        } else {
          this.currentAnimation = null;
          resolve();
        }
      };

      this.currentAnimation = requestAnimationFrame(animate);
    });
  }

  /**
   * Click animation at current cursor position
   */
  async click(duration = 300) {
    this.cursorRipple.classList.add('active');

    // Scale down cursor slightly
    this.cursor.style.transform = 'translate(-50%, -50%) scale(0.9)';

    await this.wait(150);

    this.cursor.style.transform = 'translate(-50%, -50%) scale(1)';

    await this.wait(duration - 150);

    this.cursorRipple.classList.remove('active');
  }

  /**
   * Hover effect at current position
   */
  async hover(duration = 500) {
    this.cursor.style.transform = 'translate(-50%, -50%) scale(1.1)';
    await this.wait(duration);
    this.cursor.style.transform = 'translate(-50%, -50%) scale(1)';
  }

  /**
   * Resolve position from various input types
   */
  resolvePosition(target) {
    if (typeof target === 'string') {
      const element = this.viewport.querySelector(target);
      if (element) {
        return this.getElementCenter(element);
      }
    } else if (target instanceof HTMLElement) {
      return this.getElementCenter(target);
    } else if (target && typeof target.x === 'number' && typeof target.y === 'number') {
      return target;
    }
    return null;
  }

  /**
   * Get center position of element relative to viewport
   */
  getElementCenter(element) {
    const viewportRect = this.viewport.getBoundingClientRect();
    const elementRect = element.getBoundingClientRect();

    return {
      x: elementRect.left - viewportRect.left + elementRect.width / 2,
      y: elementRect.top - viewportRect.top + elementRect.height / 2
    };
  }

  /**
   * Apply cubic-bezier easing
   */
  applyEasing(t, easing) {
    if (easing === 'linear') return t;

    // Parse cubic-bezier values
    const match = easing.match(/cubic-bezier\(([\d.]+),\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)\)/);
    if (!match) return t;

    const [, x1, y1, x2, y2] = match.map(Number);

    // Simplified bezier calculation
    return this.cubicBezier(t, x1, y1, x2, y2);
  }

  /**
   * Cubic bezier calculation
   */
  cubicBezier(t, p1x, p1y, p2x, p2y) {
    const cx = 3 * p1x;
    const bx = 3 * (p2x - p1x) - cx;
    const ax = 1 - cx - bx;

    const cy = 3 * p1y;
    const by = 3 * (p2y - p1y) - cy;
    const ay = 1 - cy - by;

    const tSquared = t * t;
    const tCubed = tSquared * t;

    return ay * tCubed + by * tSquared + cy * t;
  }

  /**
   * Wait for specified duration
   */
  wait(ms) {
    return new Promise((resolve) => {
      const startTime = Date.now();
      const check = () => {
        if (this.isPaused) {
          setTimeout(check, 100);
          return;
        }
        const elapsed = Date.now() - startTime;
        if (elapsed >= ms) {
          resolve();
        } else {
          setTimeout(check, Math.min(50, ms - elapsed));
        }
      };
      check();
    });
  }

  /**
   * Show/hide cursor
   */
  showCursor() {
    this.cursor.style.opacity = '1';
  }

  hideCursor() {
    this.cursor.style.opacity = '0';
  }

  /**
   * Stop all animations
   */
  stop() {
    this.isPlaying = false;
    if (this.currentAnimation) {
      cancelAnimationFrame(this.currentAnimation);
      this.currentAnimation = null;
    }
  }

  /**
   * Pause animations
   */
  pause() {
    this.isPaused = true;
  }

  /**
   * Resume animations
   */
  resume() {
    this.isPaused = false;
  }

  /**
   * Reset cursor position
   */
  reset() {
    this.cursor.style.left = '0px';
    this.cursor.style.top = '0px';
    this.cursor.style.opacity = '0';
    this.cursor.style.transform = 'translate(-50%, -50%) scale(1)';
  }

  /**
   * Type text with animation
   */
  async typeText(element, text, charsPerFrame = 2, frameDelay = 50) {
    element.textContent = '';
    const chars = text.split('');

    for (let i = 0; i < chars.length; i += charsPerFrame) {
      if (this.isPaused) {
        await this.wait(100);
        i -= charsPerFrame;
        continue;
      }

      const chunk = chars.slice(i, i + charsPerFrame).join('');
      element.textContent += chunk;

      if (i + charsPerFrame < chars.length) {
        await this.wait(frameDelay);
      }
    }
  }

  /**
   * Append text segment with animation
   */
  async appendSegment(container, segmentHTML, delay = 300) {
    const temp = document.createElement('div');
    temp.innerHTML = segmentHTML;
    const segment = temp.firstElementChild;

    segment.style.opacity = '0';
    container.appendChild(segment);

    await this.wait(50);

    segment.classList.add('text-appearing');
    segment.style.opacity = '1';

    await this.wait(delay);
  }

  /**
   * Scroll element to bottom smoothly
   */
  async scrollToBottom(element, duration = 400) {
    const start = element.scrollTop;
    const end = element.scrollHeight - element.clientHeight;
    const distance = end - start;

    if (distance <= 0) return;

    const startTime = performance.now();

    return new Promise((resolve) => {
      const animate = (currentTime) => {
        if (this.isPaused) {
          requestAnimationFrame(animate);
          return;
        }

        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const easedProgress = this.applyEasing(progress, 'cubic-bezier(0.4, 0, 0.2, 1)');

        element.scrollTop = start + distance * easedProgress;

        if (progress < 1) {
          requestAnimationFrame(animate);
        } else {
          resolve();
        }
      };

      requestAnimationFrame(animate);
    });
  }
}

// Export for use in other scripts
window.DemoEngine = DemoEngine;
