import { createApp } from 'vue';
import { createRouter, createWebHistory } from 'vue-router';
import App from './App.vue';

// Vuetify
import 'vuetify/styles';
import { createVuetify } from 'vuetify';
import * as components from 'vuetify/components';
import * as directives from 'vuetify/directives';
import '@mdi/font/css/materialdesignicons.css';

// Global styles
import './styles/global.scss';

// Store
import { createStore } from './store';

// Routes
import ConversationView from './views/ConversationView.vue';
import LoginView from './views/LoginView.vue';
import AboutView from './views/AboutView.vue';
import SharedView from './views/SharedView.vue';

const vuetify = createVuetify({
  components,
  directives,
  theme: {
    defaultTheme: 'dark',
    themes: {
      dark: {
        dark: true,
        colors: {
          primary: '#BB86FC',
          secondary: '#03DAC6',
          error: '#CF6679',
          background: '#121212',
          surface: '#1E1E1E',
        },
      },
      light: {
        dark: false,
        colors: {
          primary: '#6200EE',
          secondary: '#03DAC6',
          error: '#B00020',
          background: '#FFFFFF',
          surface: '#F5F5F5',
        },
      },
    },
  },
});

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/login',
      name: 'login',
      component: LoginView,
    },
    {
      path: '/about',
      name: 'about',
      component: AboutView,
    },
    {
      path: '/share/:token',
      name: 'share',
      component: SharedView,
      // No auth required - public route
    },
    {
      path: '/',
      redirect: '/conversation',
    },
    {
      path: '/conversation/:id?',
      name: 'conversation',
      component: ConversationView,
      meta: { requiresAuth: true },
    },
  ],
});

// Navigation guard
router.beforeEach((to, from, next) => {
  const token = localStorage.getItem('token');
  
  if (to.meta.requiresAuth && !token) {
    next('/login');
  } else if (to.path === '/login' && token) {
    next('/conversation');
  } else {
    next();
  }
});

const app = createApp(App);
const store = createStore();

app.use(vuetify);
app.use(router);
app.use(store);

app.mount('#app');
