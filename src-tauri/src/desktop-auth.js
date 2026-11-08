// Native-only bootstrap, re-run on reload. Never inject credentials into a report.
(() => {
  if (window !== window.top || location.origin !== __JUPITER_SERVICE_ORIGIN__ || location.pathname !== '/') return;
  Object.defineProperty(window, '__JUPITER_BOOTSTRAP_TOKEN__', { value: __JUPITER_SERVICE_TOKEN__, configurable: true });
})();
