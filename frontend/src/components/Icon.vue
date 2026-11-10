<script setup>
defineProps({ name: { type: String, required: true }, size: { type: Number, default: 24 } });

const FILLED = new Set(['play', 'pause', 'prev', 'next', 'heart-fill']);
const PATHS = {
  library: 'M5 4v16M10 4v16M19 4l-4 16',
  playlists: 'M4 7h14M4 12h14M4 17h9M17 19v-6l4 2',
  offline: 'M12 4v11M7 11l5 5 5-5M5 20h14',
  upload: 'M5 4h14M12 20V9M7 13l5-5 5 5',
  admin: 'M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6z',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-5-5',
  heart: 'M12 20s-8-5-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 9c0 6-8 11-8 11z',
  'heart-fill': 'M12 21s-9-5.6-9-12a5 5 0 0 1 9-3 5 5 0 0 1 9 3c0 6.4-9 12-9 12z',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2',
  settings: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM19 12l2-1-1-3-2 .5-1.5-1.5.5-2-3-1-1 2h-2l-1-2-3 1 .5 2L6 8l-2-.5-1 3 2 1v2l-2 1 1 3 2-.5L7.500 17.500 7 19.500l3 1 1-2h2l1 2 3-1-.5-2 1.500-1.500 2 .5 1-3-2-1z',
  play: 'M7 4.500v15a1 1 0 0 0 1.500.8l12-7.500a1 1 0 0 0 0-1.700l-12-7.500A1 1 0 0 0 7 4.500z',
  pause: 'M7 4h3.500v16H7zM13.500 4H17v16h-3.500z',
  prev: 'M6 4h2.500v16H6zM20 4.500v15L9.500 12z',
  next: 'M15.500 4H18v16h-2.500zM4 4.500v15L14.500 12z',
  shuffle: 'M3 7h4l10 10h4M3 17h4l3-3M14 10l3-3h4M18 4l3 3-3 3M18 14l3 3-3 3',
  repeat: 'M4 11V9a3 3 0 0 1 3-3h13M17 3l3 3-3 3M20 13v2a3 3 0 0 1-3 3H4M7 21l-3-3 3-3',
  'repeat-one': 'M4 11V9a3 3 0 0 1 3-3h13M17 3l3 3-3 3M20 13v2a3 3 0 0 1-3 3H4M7 21l-3-3 3-3M11 10.500l1.500-1v5',
  back: 'M15 5l-7 7 7 7',
  forward: 'M9 5l7 7-7 7',
  down: 'M5 9l7 7 7-7',
  dots: 'M12 5v.01M12 12v.01M12 19v.01',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  plus: 'M12 5v14M5 12h14',
  close: 'M6 6l12 12M18 6L6 18',
  check: 'M5 13l5 5 10-11',
  queue: 'M4 6h16M4 12h16M4 18h10',
  renew: 'M20 12a8 8 0 1 1-2.500-5.800M20 4v5h-5',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6',
  archive: 'M4 5h16v4H4zM5 9v10h14V9M10 13h4',
  edit: 'M4 20l1-4L16 5a2 2 0 0 1 3 3L8 19zM14 7l3 3',
  warning: 'M12 4L2.500 20h19zM12 10v5M12 18v.01',
  block: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM6 6l12 12',
  music: 'M9 18V6l10-2v12M9 18a2.500 2.500 0 1 1-5 0 2.500 2.500 0 0 1 5 0zM19 16a2.500 2.500 0 1 1-5 0 2.500 2.500 0 0 1 5 0z',
  user: 'M12 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM4 21c1-4 4-6 8-6s7 2 8 6',
  users: 'M9 5a3.500 3.500 0 1 0 0 7 3.500 3.500 0 0 0 0-7zM2 20c.8-3.500 3.500-5 7-5s6.200 1.500 7 5M16 5a3.500 3.500 0 0 1 0 7M18 15c2 .6 3.400 2.200 4 5',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  mail: 'M3 6h18v13H3zM3 7l9 7 9-7',
  volume: 'M4 9h4l5-4v14l-5-4H4zM16 9a4 4 0 0 1 0 6M19 6a8 8 0 0 1 0 12',
  'volume-off': 'M4 9h4l5-4v14l-5-4H4zM17 9l5 6M22 9l-5 6',
  signout: 'M10 4H5v16h5M15 8l4 4-4 4M19 12H9',
};
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    aria-hidden="true"
    :fill="FILLED.has(name) ? 'currentColor' : 'none'"
    :stroke="FILLED.has(name) ? 'none' : 'currentColor'"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <path :d="PATHS[name]" />
  </svg>
</template>
