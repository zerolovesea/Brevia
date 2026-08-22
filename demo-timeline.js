/**
 * Demo Timeline - Declarative timeline controller
 */

class DemoTimeline {
  constructor(engine) {
    this.engine = engine;
    this.steps = [];
    this.currentStep = 0;
    this.isRunning = false;
    this.loopEnabled = true;
    this.loopDelay = 2000;
  }

  /**
   * Define timeline steps
   * Each step: { action, target?, duration?, delay?, state?, data? }
   */
  setSteps(steps) {
    this.steps = steps;
    this.currentStep = 0;
  }

  /**
   * Run the timeline
   */
  async run() {
    if (this.isRunning) return;

    this.isRunning = true;
    this.engine.isPlaying = true;

    try {
      for (let i = this.currentStep; i < this.steps.length; i++) {
        if (!this.isRunning) break;

        this.currentStep = i;
        const step = this.steps[i];

        // Pre-step delay
        if (step.delay) {
          await this.engine.wait(step.delay);
        }

        // Execute step action
        await this.executeStep(step);
      }

      // Loop if enabled
      if (this.isRunning && this.loopEnabled) {
        await this.engine.wait(this.loopDelay);
        await this.restart();
      }
    } catch (error) {
      console.error('Timeline error:', error);
    } finally {
      if (!this.loopEnabled) {
        this.isRunning = false;
        this.engine.isPlaying = false;
      }
    }
  }

  /**
   * Execute a single step
   */
  async executeStep(step) {
    switch (step.action) {
      case 'moveCursor':
        await this.engine.moveCursor(
          step.target,
          step.duration || 800,
          step.easing || 'cubic-bezier(0.4, 0, 0.2, 1)'
        );
        break;

      case 'hover':
        await this.engine.hover(step.duration || 500);
        break;

      case 'click':
        await this.engine.click(step.duration || 300);
        break;

      case 'wait':
        await this.engine.wait(step.duration || 1000);
        break;

      case 'hideCursor':
        this.engine.hideCursor();
        break;

      case 'showCursor':
        this.engine.showCursor();
        break;

      case 'setState':
        if (step.handler) {
          await step.handler(step.data);
        }
        break;

      case 'typeText':
        if (step.target && step.text) {
          const element = this.resolveElement(step.target);
          if (element) {
            await this.engine.typeText(
              element,
              step.text,
              step.charsPerFrame || 2,
              step.frameDelay || 50
            );
          }
        }
        break;

      case 'appendSegment':
        if (step.target && step.html) {
          const container = this.resolveElement(step.target);
          if (container) {
            await this.engine.appendSegment(
              container,
              step.html,
              step.duration || 300
            );
          }
        }
        break;

      case 'scrollToBottom':
        if (step.target) {
          const element = this.resolveElement(step.target);
          if (element) {
            await this.engine.scrollToBottom(element, step.duration || 400);
          }
        }
        break;

      case 'updateElement':
        if (step.target) {
          const element = this.resolveElement(step.target);
          if (element && step.handler) {
            await step.handler(element, step.data);
          }
        }
        break;

      case 'custom':
        if (step.handler) {
          await step.handler(step.data);
        }
        break;

      default:
        console.warn('Unknown action:', step.action);
    }
  }

  /**
   * Resolve element from selector or element
   */
  resolveElement(target) {
    if (typeof target === 'string') {
      return this.engine.viewport.querySelector(target);
    }
    return target;
  }

  /**
   * Stop timeline
   */
  stop() {
    this.isRunning = false;
    this.engine.stop();
  }

  /**
   * Pause timeline
   */
  pause() {
    this.engine.pause();
  }

  /**
   * Resume timeline
   */
  resume() {
    this.engine.resume();
  }

  /**
   * Restart timeline from beginning
   */
  async restart() {
    this.stop();
    this.currentStep = 0;
    if (this.onRestart) await this.onRestart();
    this.engine.reset();
    await this.engine.wait(100);
    await this.run();
  }

  /**
   * Jump to a specific step index
   */
  async jumpTo(stepIndex) {
    const wasRunning = this.isRunning;
    this.stop();

    if (stepIndex >= 0 && stepIndex < this.steps.length) {
      this.currentStep = stepIndex;

      // Execute the step immediately to show the target state
      await this.executeStep(this.steps[stepIndex]);
    } else {
      console.warn('Invalid step index:', stepIndex);
    }

    // Don't auto-resume, let the caller control playback
  }

  /**
   * Start timeline from current position
   */
  async start() {
    await this.run();
  }

  /**
   * Enable/disable looping
   */
  setLoop(enabled, delay = 2000) {
    this.loopEnabled = enabled;
    this.loopDelay = delay;
  }
}

// Export
window.DemoTimeline = DemoTimeline;
