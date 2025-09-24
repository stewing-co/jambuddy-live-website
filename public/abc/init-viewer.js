// Initialize the ABC viewer after page load. Kept external to avoid inline parsing issues in Astro.
window.addEventListener('load', () => {
  try {
    if (window && window.ABCViewer && typeof window.ABCViewer.init === 'function') {
      window.ABCViewer.init('abcInput', 'paper');
    }
  } catch (e) {
    // no-op
  }
});
