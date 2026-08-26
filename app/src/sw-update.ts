/**
 * Make a deploy actually reach the person looking at the page.
 *
 * The service worker precaches the whole app, which is what makes it work
 * offline — and also what makes a new build invisible: a returning visitor is
 * served the previous one from cache while the new worker installs behind it.
 * Workbox is configured to take over as soon as it is ready (`skipWaiting` and
 * `clientsClaim`), but taking over does not re-render a page that has already
 * been built from the old cache, so without this the new interface only shows
 * up on some later visit.
 *
 * So: when a new worker takes control of this page, reload once.
 *
 * `hadController` is the guard that keeps the very first visit from reloading.
 * On a first-ever load there is no controller, the worker claims the page a
 * moment later, and `controllerchange` fires for a build that is already the
 * one on screen — reloading there would be a pointless flash.
 */
export function reloadOnNewServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return;

  const hadController = navigator.serviceWorker.controller !== null;
  let reloading = false;

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    reloading = true;
    window.location.reload();
  });

  // An installed app can stay open for days without a navigation, which is the
  // browser's usual cue to check for a new worker. Coming back to the tab is a
  // good moment to ask.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    void navigator.serviceWorker.getRegistration().then((registration) => {
      void registration?.update();
    });
  });
}
