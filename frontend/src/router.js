import { createRouter, createWebHistory } from 'vue-router';

const view = (name) => () => import(`./views/${name}.vue`);
const admin = (name) => () => import(`./views/admin/${name}.vue`);

const RELOAD_KEY = 'audify.chunkReload';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/library' },
    { path: '/library', component: view('LibraryView') },
    { path: '/search', component: view('SearchView') },
    { path: '/artists/:id', component: view('ArtistView'), props: true },
    { path: '/albums/:id', component: view('AlbumView'), props: true },
    { path: '/playlists', component: view('PlaylistsView') },
    { path: '/playlists/:id', component: view('PlaylistView'), props: true },
    { path: '/liked', component: view('LikedView') },
    { path: '/recent', component: view('RecentView') },
    { path: '/offline', component: view('OfflineView') },
    { path: '/upload', component: view('UploadView') },
    { path: '/settings', component: view('SettingsView') },
    {
      path: '/admin',
      meta: { admin: true },
      children: [
        { path: '', component: admin('AdminHome') },
        { path: 'approve', component: admin('ApproveView') },
        { path: 'problems', component: admin('ProblemsView') },
        { path: 'tracks', component: admin('TracksAdmin') },
        { path: 'artists', component: admin('ArtistsAdmin') },
        { path: 'genres', component: admin('GenresAdmin') },
        { path: 'users', component: admin('UsersAdmin') },
      ],
    },
    { path: '/:pathMatch(.*)*', redirect: '/library' },
  ],
});

// After an update or a dev server restart, old page files can vanish. Without
// this, clicking a link does nothing. One reload picks up the new files.
router.onError((error, to) => {
  if (!/dynamically imported module|Importing a module script failed/i.test(error.message)) return;
  if (sessionStorage.getItem(RELOAD_KEY)) return;
  sessionStorage.setItem(RELOAD_KEY, '1');
  location.assign(to.fullPath);
});
router.afterEach(() => sessionStorage.removeItem(RELOAD_KEY));
