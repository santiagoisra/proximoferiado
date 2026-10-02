// Registers the service worker after the page has loaded. Failures are swallowed on purpose: the site
// works fine without it (it only adds offline support).
if ('serviceWorker' in navigator) {
  const register = () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  };
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}
