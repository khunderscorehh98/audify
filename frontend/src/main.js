import { createApp } from 'vue';
import { createPinia } from 'pinia';
import '@fontsource-variable/albert-sans';
import './styles/main.css';
import App from './App.vue';
import { startViewportGap } from './lib/viewportGap.js';
import { router } from './router.js';

startViewportGap();

createApp(App).use(createPinia()).use(router).mount('#app');
