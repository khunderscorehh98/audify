import { createApp } from 'vue';
import { createPinia } from 'pinia';
import '@fontsource-variable/albert-sans';
import './styles/main.css';
import App from './App.vue';
import { startViewportFix } from './lib/viewportFix.js';
import { router } from './router.js';

startViewportFix();

createApp(App).use(createPinia()).use(router).mount('#app');
