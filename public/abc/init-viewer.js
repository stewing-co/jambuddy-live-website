// Initialize the ABC viewer once per page DOM instance.
(function() {
  function bootViewer() {
    try {
      const input = document.getElementById('abcInput');
      if (!input || (input.dataset && input.dataset.abcViewerInit === '1')) return;
      if (input.dataset) input.dataset.abcViewerInit = '1';

      if (window && window.ABCViewer && typeof window.ABCViewer.init === 'function') {
        window.ABCViewer.init('abcInput', 'paper');
      }
    } catch (_) {
      // no-op
    }
  }

  window.addEventListener('load', bootViewer);
  // Support Astro client-side transitions without double-initializing.
  document.addEventListener('astro:page-load', bootViewer);
})();
