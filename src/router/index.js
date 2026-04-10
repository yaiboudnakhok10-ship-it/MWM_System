import { createRouter, createWebHashHistory } from 'vue-router'
import LoginView from '@/views/LoginView.vue'
import DashboardView from '@/views/DashboardView.vue'
import ItemListView from '@/views/ItemListView.vue'
import InventoryImportsView from '@/views/InventoryImportsView.vue'
import InventoryhistoryLisView from '@/views/InventoryhistoryLisView.vue'
import OrderListView from '@/views/OrderListView.vue'
import TransactionsListView from '@/views/TransactionsListView.vue'
import HistoryListView from '@/views/historyListView.vue'
import EmployeeLisView from '@/views/EmployeeLisView.vue'
import SystemusersLisView from '@/views/SystemusersLisView.vue'
import UserLogsLisView from '@/views/userLogsLisView.vue'
import ImportMoreListView from '@/views/ImportMoreListView.vue'


const routes = [
  { path: '/', component: LoginView, meta: { requiresAuth: false } },
  { path: '/dashboard', component: DashboardView, meta: { requiresAuth: true } },
  { path: '/item-list', component: ItemListView, meta: { requiresAuth: true } },
  { path: '/inventory-imports', component: InventoryImportsView, meta: { requiresAuth: true } },
  { path: '/inventory-history', component: InventoryhistoryLisView, meta: { requiresAuth: true } },
  { path: '/order-list', component: OrderListView, meta: { requiresAuth: true } },
  { path: '/withdraw', component: TransactionsListView, meta: { requiresAuth: true } },
  { path: '/history', component: HistoryListView, meta: { requiresAuth: true } },
  { path: '/employees', component: EmployeeLisView, meta: { requiresAuth: true } },
  { path: '/system-users', component: SystemusersLisView, meta: { requiresAuth: true } },
  { path: '/logs', component: UserLogsLisView, meta: { requiresAuth: true } },
  { path: '/imports', component: ImportMoreListView, meta: { requiresAuth: true } },
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
