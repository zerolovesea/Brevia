/**
 * Demo Main - Initialize and control demos
 */

(function() {
  let engine;
  let timeline;
  let scenarios;
  let currentDemo = null;

  // Initialize on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  function init() {
    // Initialize engine
    engine = new DemoEngine();
    const viewport = document.getElementById('demo-viewport');
    const cursor = document.getElementById('virtual-cursor');
    const ripple = document.getElementById('cursor-ripple');

    engine.init(viewport, cursor, ripple);

    // Initialize timeline
    timeline = new DemoTimeline(engine);
    timeline.setLoop(true, 2000);

    // Initialize scenarios (use V3 if available, fallback to V2, then V1)
    if (window.DemoScenariosV3) {
      scenarios = new DemoScenariosV3(engine, timeline);
    } else if (window.DemoScenariosV2) {
      scenarios = new DemoScenariosV2(engine, timeline);
    } else {
      scenarios = new DemoScenarios(engine, timeline);
    }

    // Setup controls
    setupControls();

    // Handle visibility change (pause when not visible)
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Handle prefers-reduced-motion
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      console.log('Reduced motion detected - animations will be simplified');
    }

    // Auto-start first demo
    setTimeout(() => {
      loadDemo('transcription');
    }, 500);
  }

  function setupControls() {
    // Demo selection buttons
    document.getElementById('demo-1').addEventListener('click', () => {
      loadDemo('transcription');
    });

    document.getElementById('demo-2').addEventListener('click', () => {
      loadDemo('summary');
    });

    document.getElementById('demo-3').addEventListener('click', () => {
      loadDemo('voiceprint');
    });

    // Control buttons
    document.getElementById('demo-restart').addEventListener('click', () => {
      if (timeline) {
        timeline.restart();
      }
    });

    document.getElementById('demo-pause').addEventListener('click', (e) => {
      if (!timeline) return;

      const btn = e.target;
      if (engine.isPaused) {
        timeline.resume();
        btn.textContent = '暂停';
      } else {
        timeline.pause();
        btn.textContent = '继续';
      }
    });
  }

  function loadDemo(demoName) {
    // Stop current demo
    if (timeline.isRunning) {
      timeline.stop();
    }

    // Update button states
    document.querySelectorAll('[data-demo]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.demo === demoName);
    });

    // Reset pause button
    document.getElementById('demo-pause').textContent = '暂停';

    // Get demo configuration
    let demoConfig;
    switch (demoName) {
      case 'transcription':
        demoConfig = scenarios.getTranscriptionDemo();
        break;
      case 'summary':
        demoConfig = scenarios.getSummaryDemo();
        break;
      case 'voiceprint':
        demoConfig = scenarios.getVoiceprintDemo();
        break;
      default:
        console.error('Unknown demo:', demoName);
        return;
    }

    currentDemo = demoConfig.name;

    const content = document.getElementById('demo-content');
    const viewport = document.getElementById('demo-viewport');

    // Fade out → swap content → fade in
    content.classList.add('fading-out');

    setTimeout(() => {
      content.innerHTML = demoConfig.setupUI();

      // Scale to fit
      const appShell = content.querySelector('.app-shell');
      if (appShell) {
        const scale = calculateScale(viewport, appShell);
        appShell.style.transform = `scale(${scale})`;
        appShell.style.transformOrigin = 'top left';
      }

      content.classList.remove('fading-out');
      content.classList.add('fading-in');

      // Trigger fade-in on next frame
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          content.classList.add('visible');
        });
      });

      // Clean up classes after transition
      setTimeout(() => {
        content.classList.remove('fading-in', 'visible');
      }, 350);

      // Load timeline steps and start
      timeline.setSteps(demoConfig.steps);
      engine.reset();
      setTimeout(() => {
        timeline.run();
      }, 300);
    }, 250);
  }

  function calculateScale(viewport, content) {
    // Assuming the design is based on 1440px width
    const designWidth = 1440;
    const designHeight = 900;

    const viewportRect = viewport.getBoundingClientRect();
    const scaleX = viewportRect.width / designWidth;
    const scaleY = viewportRect.height / designHeight;

    // Use the smaller scale to fit both dimensions
    return Math.min(scaleX, scaleY, 1);
  }

  function handleVisibilityChange() {
    if (document.hidden) {
      if (timeline && timeline.isRunning) {
        timeline.pause();
        console.log('Demo paused (page hidden)');
      }
    } else {
      if (timeline && engine.isPaused) {
        timeline.resume();
        console.log('Demo resumed (page visible)');
      }
    }
  }

  // Responsive handling
  let resizeTimeout;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
      const viewport = document.getElementById('demo-viewport');
      const content = document.getElementById('demo-content');
      const appShell = content.querySelector('.app-shell');

      if (appShell) {
        const scale = calculateScale(viewport, appShell);
        appShell.style.transform = `scale(${scale})`;
      }
    }, 250);
  });

  // Listen for stage control messages from parent (landing page)
  window.addEventListener('message', (event) => {
    if (event.data.type === 'demo-stage') {
      const stage = event.data.stage;

      // Map stages to demo states
      switch(stage) {
        case 'home':
          loadDemo('transcription');
          timeline.pause();
          break;
        case 'prepare':
          loadDemo('transcription');
          timeline.pause();
          // Jump to prepare view (approximately step 5)
          setTimeout(() => {
            timeline.jumpTo(5);
          }, 100);
          break;
        case 'live-1':
          loadDemo('transcription');
          timeline.pause();
          setTimeout(() => {
            timeline.jumpTo(15);
          }, 100);
          break;
        case 'live-2':
          loadDemo('voiceprint');
          timeline.pause();
          setTimeout(() => {
            timeline.jumpTo(10);
          }, 100);
          break;
        case 'live-3':
          loadDemo('transcription');
          timeline.pause();
          setTimeout(() => {
            timeline.jumpTo(25);
          }, 100);
          break;
        case 'summary':
          loadDemo('summary');
          timeline.pause();
          setTimeout(() => {
            timeline.jumpTo(5);
          }, 100);
          break;
      }
    }
  });

  // Auto-start only if not embedded in iframe
  if (window.self === window.top) {
    // Not embedded, auto-play
    // Already handled by loadDemo('transcription') in init()
  }

  // Expose for debugging
  window.demoDebug = {
    engine,
    timeline,
    scenarios,
    getCurrentDemo: () => currentDemo,
    pauseDemo: () => timeline.pause(),
    resumeDemo: () => timeline.resume(),
    stopDemo: () => timeline.stop(),
    restartDemo: () => timeline.restart(),
    loadDemo: (name) => loadDemo(name)
  };
})();
