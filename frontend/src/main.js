import { createApp } from 'vue';
import { createPinia } from 'pinia';
import '@fontsource-variable/albert-sans';
import './styles/main.css';
import App from './App.vue';
import { router } from './router.js';

createApp(App).use(createPinia()).use(router).mount('#app');
