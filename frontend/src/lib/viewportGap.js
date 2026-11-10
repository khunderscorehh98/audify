// Installed iPhone apps sometimes get a viewport that's short by exactly the
// status bar's height, and sometimes the full screen. iOS switches between the
// two, so this checks which state it's in now, and again whenever that could
// change. It only corrects a gap that matches the status bar's height.
const TOLERANCE = 4;

/** Pure rule: how much to extend the app by, in px. */
export function decideGap({ standalone, fullHeight, innerHeight, safeTop }) {
  if (!standalone || safeTop <= 0) return 0;
  const missing = fullHeight - innerHeight;
  return Math.abs(missing - safeTop) <= TOLERANCE ? safeTop : 0;
}

let probe = null;

/** The status bar height iOS reports, read from a hidden element. */
function readSafeTop() {
  if (!probe) {
    probe = document.createElement('div');
    probe.style.cssText = 'position:fixed;top:0;left:0;width:0;height:env(safe-area-inset-top,0px);visibility:hidden;pointer-events:none';
    document.body.appendChild(probe);
  }
  return probe.getBoundingClientRect().height;
}

/** What iOS reported last, for the readout in Settings. */
export const lastReading = { fullHeight: 0, innerHeight: 0, safeTop: 0, gap: 0 };

function update() {
  // iOS keeps screen.width and screen.height fixed when the phone rotates.
  const portrait = window.innerHeight >= window.innerWidth;
  const fullHeight = portrait ? Math.max(screen.height, screen.width) : Math.min(screen.height, screen.width);
  const gap = decideGap({
    standalone: navigator.standalone === true, // Only iOS defines this.
    fullHeight,
    innerHeight: window.innerHeight,
    safeTop: readSafeTop(),
  });
  Object.assign(lastReading, { fullHeight, innerHeight: window.innerHeight, safeTop: readSafeTop(), gap });
  document.documentElement.style.setProperty('--viewport-gap', `${gap}px`);
}

/** Checks now, then again after iOS has had time to settle. */
const check = () => {
  update();
  requestAnimationFrame(update);
  setTimeout(update, 300);
  setTimeout(update, 1000);
};

export function startViewportGap() {
  if (navigator.standalone !== true) return;
  check();
  window.addEventListener('resize', update);
  window.addEventListener('orientationchange', check);
  window.addEventListener('pageshow', check);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') check();
  });
}
