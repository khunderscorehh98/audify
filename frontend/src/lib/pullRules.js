// Pure rules for pull to refresh, kept separate so they can be unit tested.
export const PULL_THRESHOLD = 70;
const MAX_PULL = 110;

/** Resistance: the indicator moves slower than the finger, up to a limit. */
export const pullDistance = (dragged) => Math.min(Math.max(dragged, 0) * 0.5, MAX_PULL);

// Pulling here would lose work in progress: a swipe deck, or running uploads.
const EXCLUDED_ROUTES = ['/admin/approve', '/upload'];

export const canPullOn = (path) => !EXCLUDED_ROUTES.includes(path);

/** Sideways drags belong to chips, shelves and sliders. */
export const isVerticalPull = (dx, dy) => dy > 0 && dy > Math.abs(dx);
