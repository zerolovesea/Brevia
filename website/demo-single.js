/**
 * Demo Single - Bootstrap a single auto-playing demo animation.
 *
 * Any page that wants to show ONE feature animation only needs to:
 *   1. Provide the DOM the engine expects:
 *        #demo-viewport, #virtual-cursor, #cursor-ripple, #demo-content
 *   2. Load: demo-engine.js, demo-timeline.js,
 *            demo-scenarios-v3-part1.js, demo-scenarios-v3-part2.js, demo-single.js
 *   3. Set which demo to play via one of:
 *        - <body data-demo="transcription|summary|voiceprint">
 *        - window.DEMO_NAME = 'transcription'
 *        - ?demo=transcription in the URL
 *
 * No control buttons required — it loops automatically.
 */

(function () {
  let engine;
  let timeline;
  let scenarios;

  function resolveDemoName() {
    const fromUrl = new URLSearchParams(window.location.search).get('demo');
    const fromBody = document.body && document.body.dataset.demo;
    return fromUrl || window.DEMO_NAME || fromBody || 'transcription';
  }

  function getDemoConfig(name) {
    switch (name) {
      case 'transcription':
        return scenarios.getTranscriptionDemo();
      case 'summary':
        return scenarios.getSummaryDemo();
      case 'voiceprint':
        return scenarios.getVoiceprintDemo();
      case 'model-library':
        return scenarios.getModelLibraryDemo();
      case 'caption-bar':
        return scenarios.getCaptionBarDemo();
      default:
        console.error('Unknown demo:', name);
        return null;
    }
  }

  function calculateScale(viewport) {
    const designWidth = 1200;
    const designHeight = 750;
    const rect = viewport.getBoundingClientRect();
    return Math.min(rect.width / designWidth, rect.height / designHeight, 1);
  }

  function applyScale() {
    const viewport = document.getElementById('demo-viewport');
    const appShell = document.querySelector('#demo-content .app-shell');
    if (viewport && appShell) {
      const scale = calculateScale(viewport);
      appShell.style.transform = `scale(${scale})`;
      appShell.style.transformOrigin = 'top left';
    }
  }

  function init() {
    engine = new DemoEngine();
    const viewport = document.getElementById('demo-viewport');
    const cursor = document.getElementById('virtual-cursor');
    const ripple = document.getElementById('cursor-ripple');

    if (!viewport || !cursor || !ripple) {
      console.error('demo-single: missing required DOM (#demo-viewport / #virtual-cursor / #cursor-ripple)');
      return;
    }

    engine.init(viewport, cursor, ripple);

    timeline = new DemoTimeline(engine);
    timeline.setLoop(true, 2000);

    scenarios = new DemoScenariosV3(engine, timeline);

    const demoConfig = getDemoConfig(resolveDemoName());
    if (!demoConfig) return;

    // Restore the initial UI before each loop so animated segments never
    // accumulate from the previous run.
    const content = document.getElementById('demo-content');
    const renderInitialUI = () => {
      content.innerHTML = demoConfig.setupUI();
      applyScale();
    };
    renderInitialUI();

    timeline.setSteps(demoConfig.steps);
    timeline.onRestart = renderInitialUI;
    engine.reset();
    setTimeout(() => timeline.run(), 400);

    // Pause when tab hidden, resume when visible
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        if (timeline.isRunning) timeline.pause();
      } else if (engine.isPaused) {
        timeline.resume();
      }
    });

    // Re-scale on resize
    let resizeTimer;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(applyScale, 200);
    });

    // Expose for debugging
    window.demoDebug = {
      engine,
      timeline,
      scenarios,
      restart: () => timeline.restart()
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
