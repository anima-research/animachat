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
// Placement for attached menus: the list sits directly under its field as
// ordinary content of the form. Vuetify's default "connected" strategy keeps
// re-measuring the list against the scroll container's visible box (on
// resize, on visual-viewport events, on content resize) and shifts or flips
// it to stay inside that box, which on iOS showed up as lists that lagged,
// locked under the dialog title, or opened above their field. Below-the-field
// placement needs no measuring at all: the form scrolls and the list comes
// along, clipped like any other content.
const attachedBelowField = (
  data: { contentEl?: { value?: unknown }; target?: { value?: unknown } },
  _props: unknown,
  contentStyles: { value: Record<string, string> },
) => {
  const place = () => {
    // The attached overlay root covers only the field's input slot; widen the
    // list to the whole field (prepend/append icons included).
    const anchor = [data.contentEl?.value, data.target?.value].find((el) => el instanceof Element) as
      | Element
      | undefined;
    const slot = anchor?.closest('.v-field__input') ?? null;
    const field = slot?.closest('.v-field') ?? null;
    let left = '0';
    let width = '100%';
    if (slot && field) {
      const s = slot.getBoundingClientRect();
      const f = field.getBoundingClientRect();
      left = `${Math.round(f.left - s.left)}px`;
      width = `${Math.round(f.width)}px`;
    }
    Object.assign(contentStyles.value, {
      position: 'absolute',
      top: '100%',
      left,
      width,
      minWidth: '0',
      marginTop: '6px',
      transformOrigin: 'top left',
    });
  };
  // On open, scroll the enclosing form just enough that the list is visible
  // below its field (it is ordinary content of the scroller now, so a field
  // near the bottom of the visible area would otherwise show a clipped
  // sliver of the list until the user scrolls). The field itself stays in
  // view: scrolling is capped at the distance from the field to the top.
  const reveal = () => {
    const content = data.contentEl?.value;
    if (!(content instanceof HTMLElement)) return;
    const field = content.closest('.v-field');
    let scroller: HTMLElement | null = content.parentElement;
    while (scroller && !(/(auto|scroll)/.test(getComputedStyle(scroller).overflowY) && scroller.scrollHeight > scroller.clientHeight)) {
      scroller = scroller.parentElement;
    }
    const cr = content.getBoundingClientRect();
    if (!field || !scroller || cr.height === 0) return;
    const fr = field.getBoundingClientRect();
    const sr = scroller.getBoundingClientRect();
    const overflow = cr.bottom - (sr.bottom - 8);
    const slack = fr.top - (sr.top + 8);
    const delta = Math.min(Math.max(overflow, 0), Math.max(slack, 0));
    if (delta > 0) scroller.scrollTop += delta;
  };
  const settle = () => {
    place();
    reveal();
  };
  settle();
  // The lazily rendered list mounts a tick after the strategy is created,
  // and autocomplete items can arrive a little later still.
  setTimeout(settle, 0);
  setTimeout(settle, 50);
  setTimeout(settle, 300);
  return { updateLocation: place };
};
const touchMenuProps = { attach: true, scrollStrategy: 'none', locationStrategy: attachedBelowField };
const touchDefaults = coarsePointer
  ? {
      VSelect: { menuProps: touchMenuProps },
      VAutocomplete: { menuProps: touchMenuProps },
      VCombobox: { menuProps: touchMenuProps },
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
  // Runs as a microtask right after each mutation batch (not rAF, which is
  // paused in background tabs and would leave the class stale). It must only
  // touch the class when it actually changes: setting an attribute to its
  // current value still produces a mutation record, which would re-trigger
  // this observer in an endless microtask loop.
  const syncOpenMenus = () => {
    scheduled = false;
    document.querySelectorAll(`.${OPEN_CLASS}`).forEach((el) => {
      if (!el.querySelector('.v-overlay--absolute.v-overlay--active')) el.classList.remove(OPEN_CLASS);
    });
    document.querySelectorAll('.v-overlay--absolute.v-overlay--active').forEach((el) => {
      const input = el.closest('.v-input');
      if (input && !input.classList.contains(OPEN_CLASS)) input.classList.add(OPEN_CLASS);
    });
  };
  const involvesOverlay = (node: Node) =>
    node instanceof Element &&
    (node.classList.contains('v-overlay--absolute') || node.querySelector('.v-overlay--absolute') !== null);
  new MutationObserver((records) => {
    if (scheduled) return;
    // Streaming text and Vuetify transitions mutate classes constantly; only
    // react when an attached overlay itself changed or was added/removed.
    const relevant = records.some((r) =>
      r.type === 'attributes'
        ? r.target instanceof Element && r.target.classList.contains('v-overlay--absolute')
        : [...r.addedNodes, ...r.removedNodes].some(involvesOverlay),
    );
    if (!relevant) return;
    scheduled = true;
    queueMicrotask(syncOpenMenus);
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
router.beforeEach((to, _from, next) => {
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
