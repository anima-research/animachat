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
import InviteView from './views/InviteView.vue';
import ModelTestView from './views/ModelTestView.vue';
import ModelPricingView from './views/ModelPricingView.vue';
import AdminView from './views/AdminView.vue';
import PersonasView from './views/PersonasView.vue';
import VerifyEmailView from './views/VerifyEmailView.vue';
import ResetPasswordView from './views/ResetPasswordView.vue';
import ArchiveView from './views/ArchiveView.vue';
import TermsView from './views/TermsView.vue';
import PrivacyView from './views/PrivacyView.vue';

// Touch devices: keep field menus attached to their field instead of
// teleporting them to a fixed full-screen overlay. iOS Safari shifts and pans
// the viewport for the on-screen keyboard while `position: fixed` content is
// positioned against the unshifted layout viewport, so floating dropdowns
// drifted away from (or against) the finger while scrolling. An attached menu
// is ordinary flow content and scrolls with the dialog it lives in. Dialogs
// also skip Vuetify's scroll blocking, which pins <html> with position: fixed
// (another well-known source of iOS keyboard jank); the app shell scrolls
// inside its own containers, so blocking the document buys nothing here.
const coarsePointer =
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(pointer: coarse)').matches
    : false;
const touchDefaults = coarsePointer
  ? {
      VSelect: { menuProps: { attach: true, scrollStrategy: 'none' } },
      VAutocomplete: { menuProps: { attach: true, scrollStrategy: 'none' } },
      VCombobox: { menuProps: { attach: true, scrollStrategy: 'none' } },
      VDialog: { scrollStrategy: 'none' },
    }
  : {};

// While an attached menu is open, lift its input above later siblings (the
// field's `contain: layout` otherwise traps the menu below them). Kept in JS
// because WebKit did not re-evaluate `.v-input:has(.v-overlay--active)` when
// the active class toggled.
if (coarsePointer && typeof MutationObserver !== 'undefined') {
  const OPEN_CLASS = 'v-input--menu-open';
  let scheduled = false;
  const syncOpenMenus = () => {
    scheduled = false;
    document.querySelectorAll(`.${OPEN_CLASS}`).forEach((el) => {
      if (!el.querySelector('.v-overlay--absolute.v-overlay--active')) el.classList.remove(OPEN_CLASS);
    });
    document.querySelectorAll('.v-overlay--absolute.v-overlay--active').forEach((el) => {
      el.closest('.v-input')?.classList.add(OPEN_CLASS);
    });
  };
  new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(syncOpenMenus);
  }).observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['class'],
  });
}

const vuetify = createVuetify({
  components,
  directives,
  defaults: touchDefaults,
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
      path: '/verify-email',
      name: 'verify-email',
      component: VerifyEmailView,
    },
    {
      path: '/reset-password',
      name: 'reset-password',
      component: ResetPasswordView,
    },
    {
      path: '/about',
      name: 'about',
      component: AboutView,
    },
    {
      path: '/terms',
      name: 'terms',
      component: TermsView,
    },
    {
      path: '/privacy',
      name: 'privacy',
      component: PrivacyView,
    },
    {
      path: '/model-test',
      name: 'model-test',
      component: ModelTestView,
      meta: { requiresAuth: true },
    },
    {
      path: '/share/:token',
      name: 'share',
      component: SharedView,
      // No auth required - public route
    },
    {
      path: '/invite/:token',
      name: 'invite',
      component: InviteView,
      // No auth required - handles both logged in and out
    },
    {
      path: '/models',
      name: 'model-pricing',
      component: ModelPricingView,
    },
    {
      path: '/admin',
      name: 'admin',
      component: AdminView,
      meta: { requiresAuth: true },
    },
    {
      path: '/personas',
      name: 'personas',
      component: PersonasView,
      meta: { requiresAuth: true },
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
    {
      path: '/conversation/:conversationId/message/:messageId',
      name: 'message-link',
      component: ConversationView,
      meta: { requiresAuth: true },
    },
    {
      path: '/conversation/:id/archive',
      name: 'archive',
      component: ArchiveView,
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
