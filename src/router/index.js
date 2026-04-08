import { createRouter, createWebHashHistory } from 'vue-router'
import LoginView from '@/views/LoginView.vue'
import DashboardView from '@/views/DashboardView.vue'
import ItemListView from '@/views/ItemListView.vue'
import InventoryImportsView from '@/views/InventoryImportsView.vue'



const routes = [
  { path: '/', component: LoginView, meta: { requiresAuth: false } },
  { path: '/dashboard', component: DashboardView, meta: { requiresAuth: true } },
  { path: '/item-list', component: ItemListView, meta: { requiresAuth: true } },
  { path: '/inventory-imports', component: InventoryImportsView, meta: { requiresAuth: true } },
]

const router = createRouter({
  history: createWebHashHistory(),
  routes,
})

router.beforeEach((to) => {
  const session = localStorage.getItem('mwm_session')
  if (to.meta.requiresAuth && !session) return '/'
  if (to.path === '/' && session) return '/dashboard'
})

export default router
