if (typeof window !== 'undefined' && window.top !== window.self) {
  var isCap = Boolean(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  if (!isCap) {
    try {
      window.top.location = window.location.href;
    } catch (e) {}
  }
}
try {
  var v = localStorage.getItem('color-scheme');
  if (v === 'light' || v === 'dark') {
    var m = document.querySelector('meta[name="color-scheme"]');
    if (m) m.setAttribute('content', v);
  }
} catch (e) {}
