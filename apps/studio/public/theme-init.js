// Sets <html data-theme> and the browser chrome colour (<meta name="theme-color">) before the first paint, so the
// Regie never flashes the wrong theme. Mirrors ThemeService (src/app/core/ui/theme.service.ts): `studioflow.theme` is
// 'dark' (default), 'light' or 'system'; the chrome colour is the Panel token of the theme (styles/_tokens.scss). A
// classic script in the head, because the CSP of the product allows no inline scripts.
(function () {
  var theme = 'dark';
  try {
    var stored = localStorage.getItem('studioflow.theme');
    if (
      stored === 'light' ||
      (stored === 'system' && matchMedia('(prefers-color-scheme: light)').matches)
    ) {
      theme = 'light';
    }
  } catch (error) {
    // Blocked site data: the default theme stays.
  }
  document.documentElement.dataset.theme = theme;
  var chrome = document.querySelector('meta[name="theme-color"]');
  if (chrome) {
    chrome.setAttribute('content', theme === 'light' ? '#f7f7f9' : '#1e1e21');
  }
})();
