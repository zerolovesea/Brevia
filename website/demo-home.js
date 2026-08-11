(function () {
  function render() {
    const content = document.getElementById('demo-content');
    if (!content) return;
    content.innerHTML = new DemoScenariosV3().setupHomeUI();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', render);
  } else {
    render();
  }
})();
