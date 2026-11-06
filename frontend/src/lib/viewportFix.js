// Installed iPhone apps can report a viewport shorter than the screen, by about
// the height of the status bar, which leaves a gap under everything at the
// bottom. This measures the gap so the CSS can extend past it.
const MAX_GAP = 80; // A larger difference is something else, such as the keyboard.

export function viewportGap({ standalone, screenHeight, screenWidth, innerHeight, innerWidth }) {
  if (!standalone) return 0;
  // iOS keeps screen.width and screen.height fixed when the phone rotates.
  const portrait = innerHeight >= innerWidth;
  const full = portrait ? Math.max(screenHeight, screenWidth) : Math.min(screenHeight, screenWidth);
  const gap = full - innerHeight;
  return gap > 0 && gap <= MAX_GAP ? gap : 0;
}

export function startViewportFix() {
  const update = () => {
    const gap = viewportGap({
      standalone: navigator.standalone === true, // Only iOS defines this.
      screenHeight: screen.height,
      screenWidth: screen.width,
      innerHeight: window.innerHeight,
      innerWidth: window.innerWidth,
    });
    document.documentElement.style.setProperty('--viewport-gap', `${gap}px`);
  };
  update();
  window.addEventListener('resize', update);
  window.addEventListener('orientationchange', () => setTimeout(update, 300));
}
