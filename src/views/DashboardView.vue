<script setup>
import { ref, onMounted, onUnmounted, nextTick } from 'vue'
import { Chart, registerables } from 'chart.js'
import AppLayout from '@/components/layout/AppLayout.vue'
import StatCard from '@/components/ui/StatCard.vue'
import { supabase } from '@/lib/supabase'

Chart.register(...registerables)

const loading = ref(true)

const totalItems = ref(0)
const importsToday = ref(0)
const transactionsToday = ref(0)
const pendingOrders = ref(0)

const trendTotalItems = ref({ text: '—', type: 'neutral' })
const trendImports = ref({ text: '—', type: 'neutral' })
const trendTx = ref({ text: '—', type: 'neutral' })
const trendPending = ref({ text: '—', type: 'neutral' })

const recentTransactions = ref([])
const lowStockItems = ref([])

const lineChartRef = ref(null)
const donutChartRef = ref(null)
let lineChart
let donutChart

function startOfDay(d) {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

function endOfDay(d) {
  const x = new Date(d)
  x.setHours(23, 59, 59, 999)
  return x
}

function dayKeyLocal(d) {
  const x = new Date(d)
  const y = x.getFullYear()
  const m = String(x.getMonth() + 1).padStart(2, '0')
  const day = String(x.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function formatDateShort(iso) {
  const d = new Date(iso)
  return `${d.getDate()}/${d.getMonth() + 1}`
}

function trendDelta(current, previous, labelPrev) {
  const diff = current - previous
  if (previous === 0 && current === 0) return { text: `เทียบ${labelPrev} 0`, type: 'neutral' }
  if (previous === 0) return { text: `+${current} เทียบ${labelPrev}`, type: 'up' }
  const pct = Math.round((diff / previous) * 100)
  if (diff > 0) return { text: `+${diff} (${pct}%) เทียบ${labelPrev}`, type: 'up' }
  if (diff < 0) return { text: `${diff} (${pct}%) เทียบ${labelPrev}`, type: 'down' }
  return { text: `เท่าเดิม เทียบ${labelPrev}`, type: 'neutral' }
}

const lineLabels = ref([])
const lineImportsSeries = ref([])
const lineTxSeries = ref([])

const donutLabels = ref([])
const donutData = ref([])
const donutColors = ['#2563EB', '#16A34A', '#F59E0B', '#EF4444', '#8B5CF6', '#06B6D4', '#EC4899', '#64748B']

async function fetchDashboardData() {
  loading.value = true
  try {
    const now = new Date()
    const todayStart = startOfDay(now)
    const todayEnd = endOfDay(now)
    const yesterdayStart = startOfDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1))
    const yesterdayEnd = endOfDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1))

    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const lastMonthEnd = endOfDay(new Date(now.getFullYear(), now.getMonth(), 0))

    const sevenDaysAgo = startOfDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6))

    const [
      itemsCountRes,
      importsTodayRes,
      importsYesterdayRes,
      txTodayRes,
      txYesterdayRes,
      pendingRes,
      itemsThisMonthRes,
      itemsPrevMonthRes,
      importsRowsRes,
      txRowsRes,
      lowStockRes,
      recentTxRes,
    ] = await Promise.all([
      supabase.from('items').select('*', { count: 'exact', head: true }),
      supabase
        .from('inventory_imports')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', todayStart.toISOString())
        .lte('created_at', todayEnd.toISOString()),
      supabase
        .from('inventory_imports')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', yesterdayStart.toISOString())
        .lte('created_at', yesterdayEnd.toISOString()),
      supabase
        .from('transactions')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', todayStart.toISOString())
        .lte('created_at', todayEnd.toISOString()),
      supabase
        .from('transactions')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', yesterdayStart.toISOString())
        .lte('created_at', yesterdayEnd.toISOString()),
      supabase.from('order_req').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
      supabase.from('items').select('*', { count: 'exact', head: true }).gte('created_at', monthStart.toISOString()),
      supabase
        .from('items')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', lastMonthStart.toISOString())
        .lte('created_at', lastMonthEnd.toISOString()),
      supabase.from('inventory_imports').select('created_at').gte('created_at', sevenDaysAgo.toISOString()),
      supabase.from('transactions').select('created_at').gte('created_at', sevenDaysAgo.toISOString()),
      supabase
        .from('items')
        .select('id, item_name, current_stock, unit')
        .lte('current_stock', 5)
        .order('current_stock', { ascending: true })
        .limit(24),
      supabase
        .from('transactions')
        .select(
          'id, amount, unit, created_at, created_by, items(item_code, item_name), creator:system_users!created_by(fullname, emp_code)'
        )
        .order('created_at', { ascending: false })
        .limit(5),
    ])

    totalItems.value = itemsCountRes.count ?? 0
    importsToday.value = importsTodayRes.count ?? 0
    transactionsToday.value = txTodayRes.count ?? 0
    pendingOrders.value = pendingRes.count ?? 0

    const itemsCreatedThisMonth = itemsThisMonthRes.count ?? 0
    const itemsCreatedPrevMonth = itemsPrevMonthRes.count ?? 0
    trendTotalItems.value = trendDelta(itemsCreatedThisMonth, itemsCreatedPrevMonth, 'เดือนที่แล้ว (รายการใหม่)')
    trendImports.value = trendDelta(importsTodayRes.count ?? 0, importsYesterdayRes.count ?? 0, 'เมื่อวาน')
    trendTx.value = trendDelta(txTodayRes.count ?? 0, txYesterdayRes.count ?? 0, 'เมื่อวาน')
    trendPending.value = { text: 'รอดำเนินการ', type: 'neutral' }

    const impByDay = {}
    const txByDay = {}
    const dayKeysOrdered = []
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i)
      const k = dayKeyLocal(d)
      dayKeysOrdered.push(k)
      impByDay[k] = 0
      txByDay[k] = 0
    }
    for (const row of importsRowsRes.data || []) {
      const k = dayKeyLocal(row.created_at)
      if (impByDay[k] !== undefined) impByDay[k] += 1
    }
    for (const row of txRowsRes.data || []) {
      const k = dayKeyLocal(row.created_at)
      if (txByDay[k] !== undefined) txByDay[k] += 1
    }
    lineLabels.value = dayKeysOrdered.map((k) => {
      const [y, m, day] = k.split('-').map(Number)
      return formatDateShort(new Date(y, m - 1, day))
    })
    lineImportsSeries.value = dayKeysOrdered.map((k) => impByDay[k])
    lineTxSeries.value = dayKeysOrdered.map((k) => txByDay[k])

    const { data: catRows } = await supabase.from('category').select('id, category_name').order('category_name')
    const { data: itemRows } = await supabase.from('items').select('category_id')
    const countByCat = {}
    for (const c of catRows || []) countByCat[c.id] = { name: c.category_name, n: 0 }
    for (const it of itemRows || []) {
      if (it.category_id && countByCat[it.category_id]) countByCat[it.category_id].n += 1
    }
    const sorted = Object.values(countByCat)
      .filter((x) => x.n > 0)
      .sort((a, b) => b.n - a.n)
    donutLabels.value = sorted.map((x) => x.name)
    donutData.value = sorted.map((x) => x.n)

    lowStockItems.value = lowStockRes.data || []

    recentTransactions.value = (recentTxRes.data || []).map((t) => ({
      id: t.id,
      amount: t.amount,
      unit: t.unit,
      created_at: t.created_at,
      item_code: t.items?.item_code || '-',
      item_name: t.items?.item_name || '-',
      created_by_name: t.creator
        ? t.creator.emp_code
          ? `${t.creator.fullname} (${t.creator.emp_code})`
          : t.creator.fullname
        : '-',
    }))
  } catch (err) {
    console.error('Dashboard fetch:', err)
    alert('โหลดข้อมูลแดชบอร์ดไม่สำเร็จ: ' + (err.message || err))
  } finally {
    loading.value = false
  }
}

function buildCharts() {
  lineChart?.destroy()
  donutChart?.destroy()

  if (lineChartRef.value) {
    lineChart = new Chart(lineChartRef.value, {
      type: 'line',
      data: {
        labels: lineLabels.value.length ? lineLabels.value : ['—'],
        datasets: [
          {
            label: 'นำเข้า',
            data: lineImportsSeries.value.length ? lineImportsSeries.value : [0],
            borderColor: '#2563EB',
            backgroundColor: 'transparent',
            tension: 0.4,
            pointRadius: 3,
          },
          {
            label: 'เบิกจ่าย',
            data: lineTxSeries.value.length ? lineTxSeries.value : [0],
            borderColor: '#F59E0B',
            backgroundColor: 'transparent',
            tension: 0.4,
            pointRadius: 3,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: 'top' } },
        scales: { y: { grid: { color: 'rgba(0,0,0,0.05)' } }, x: { grid: { display: false } } },
      },
    })
  }

  if (donutChartRef.value) {
    const labels = donutLabels.value.length ? donutLabels.value : ['ไม่มีข้อมูล']
    const data = donutData.value.length ? donutData.value : [1]
    const bg = donutData.value.length
      ? donutData.value.map((_, i) => donutColors[i % donutColors.length])
      : ['#E5E7EB']

    donutChart = new Chart(donutChartRef.value, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{ data, backgroundColor: bg, borderWidth: 0 }],
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } },
    })
  }
}

onMounted(async () => {
  await fetchDashboardData()
  await nextTick()
  buildCharts()
})

onUnmounted(() => {
  lineChart?.destroy()
  donutChart?.destroy()
})
</script>

<template>
  <AppLayout>
    <div class="mb-6">
      <h1 class="text-[20px] font-semibold" style="color: var(--color-text-primary)">แดชบอร์ด</h1>
      <p class="text-[13px] mt-0.5" style="color: var(--color-text-muted)">ภาพรวมระบบคลังสินค้า</p>
    </div>

    <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
      <StatCard
        title="สินค้าทั้งหมด"
        :value="totalItems"
        unit="รายการ"
        icon="fa-boxes-stacked"
        :trend="trendTotalItems.text"
        :trend-type="trendTotalItems.type"
        accent-color="#2563EB"
      />
      <StatCard
        title="นำเข้าวันนี้"
        :value="importsToday"
        unit="รายการ"
        icon="fa-arrow-down-to-bracket"
        :trend="trendImports.text"
        :trend-type="trendImports.type"
        accent-color="#16A34A"
      />
      <StatCard
        title="เบิกจ่ายวันนี้"
        :value="transactionsToday"
        unit="รายการ"
        icon="fa-arrow-up-from-bracket"
        :trend="trendTx.text"
        :trend-type="trendTx.type"
        accent-color="#DC2626"
      />
      <StatCard
        title="คำขอรออนุมัติ"
        :value="pendingOrders"
        unit="รายการ"
        icon="fa-clock"
        :trend="trendPending.text"
        :trend-type="trendPending.type"
        accent-color="#D97706"
      />
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-5 gap-4 mb-6">
      <div class="lg:col-span-3 rounded-xl border p-4" style="background: var(--color-bg-card); border-color: var(--color-border)">
        <p class="text-[14px] font-medium mb-4" style="color: var(--color-text-primary)">ประวัติการนำเข้า/เบิกจ่าย 7 วันล่าสุด</p>
        <div class="h-56"><canvas ref="lineChartRef"></canvas></div>
      </div>
      <div class="lg:col-span-2 rounded-xl border p-4" style="background: var(--color-bg-card); border-color: var(--color-border)">
        <p class="text-[14px] font-medium mb-4" style="color: var(--color-text-primary)">สัดส่วนตามประเภทสินค้า</p>
        <div class="h-56"><canvas ref="donutChartRef"></canvas></div>
      </div>
    </div>

    <div class="rounded-xl border mb-6" style="background: var(--color-bg-card); border-color: var(--color-border)">
      <div class="px-4 py-3 border-b" style="border-color: var(--color-border)">
        <p class="text-[14px] font-medium" style="color: var(--color-text-primary)">รายการเบิกจ่ายล่าสุด</p>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full text-[13px]">
          <thead>
            <tr style="border-bottom: 1px solid var(--color-border)">
              <th class="text-left px-4 py-2.5 font-medium hidden sm:table-cell" style="color: var(--color-text-muted)">รหัสสินค้า</th>
              <th class="text-left px-4 py-2.5 font-medium" style="color: var(--color-text-muted)">ชื่อสินค้า</th>
              <th class="text-right px-4 py-2.5 font-medium" style="color: var(--color-text-muted)">จำนวน</th>
              <th class="text-left px-4 py-2.5 font-medium hidden sm:table-cell" style="color: var(--color-text-muted)">หน่วย</th>
              <th class="text-left px-4 py-2.5 font-medium hidden md:table-cell" style="color: var(--color-text-muted)">ผู้เบิก</th>
              <th class="text-left px-4 py-2.5 font-medium" style="color: var(--color-text-muted)">วันที่</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="loading">
              <td colspan="6" class="px-4 py-8 text-center" style="color: var(--color-text-muted)">กำลังโหลด...</td>
            </tr>
            <tr v-else-if="recentTransactions.length === 0">
              <td colspan="6" class="px-4 py-8 text-center" style="color: var(--color-text-muted)">ไม่มีรายการเบิกจ่าย</td>
            </tr>
            <template v-else>
              <tr
                v-for="t in recentTransactions"
                :key="t.id"
                class="border-b last:border-b-0 hover:bg-gray-50 dark:hover:bg-slate-700/30"
                style="border-color: var(--color-border)"
              >
                <td class="px-4 py-2.5 hidden sm:table-cell font-mono" style="color: var(--color-text-muted)">{{ t.item_code }}</td>
                <td class="px-4 py-2.5" style="color: var(--color-text-primary)">{{ t.item_name }}</td>
                <td class="px-4 py-2.5 text-right font-medium" style="color: var(--color-text-primary)">{{ t.amount }}</td>
                <td class="px-4 py-2.5 hidden sm:table-cell" style="color: var(--color-text-muted)">{{ t.unit }}</td>
                <td class="px-4 py-2.5 hidden md:table-cell" style="color: var(--color-text-secondary)">{{ t.created_by_name }}</td>
                <td class="px-4 py-2.5 text-[12px]" style="color: var(--color-text-muted)">{{ new Date(t.created_at).toLocaleDateString('th-TH') }}</td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
    </div>

    <div class="rounded-xl border p-4" style="background: var(--color-bg-card); border-color: var(--color-border)">
      <div class="flex items-center gap-2 mb-3">
        <i class="fa-solid fa-triangle-exclamation" style="color: var(--color-warning)"></i>
        <p class="text-[14px] font-medium" style="color: var(--color-text-primary)">สินค้าใกล้หมด</p>
      </div>
      <div v-if="loading" class="text-[13px] py-4" style="color: var(--color-text-muted)">กำลังโหลด...</div>
      <div v-else-if="lowStockItems.length === 0" class="text-[13px] py-2" style="color: var(--color-text-muted)">ไม่มีสินค้าที่สต็อกต่ำ (≤ 5)</div>
      <div v-else class="flex gap-3 overflow-x-auto pb-1">
        <div
          v-for="item in lowStockItems"
          :key="item.id"
          class="min-w-[140px] rounded-xl border p-3 shrink-0"
          style="border-color: var(--color-border)"
        >
          <p class="text-[12px] leading-tight mb-1" style="color: var(--color-text-secondary)">{{ item.item_name }}</p>
          <p
            class="text-[28px] font-bold leading-none"
            :style="item.current_stock <= 2 ? 'color: var(--color-danger)' : 'color: var(--color-warning)'"
          >
            {{ item.current_stock }}
          </p>
          <p class="text-[11px] mt-0.5" style="color: var(--color-text-muted)">{{ item.unit }}</p>
          <span
            class="inline-block mt-2 px-2 py-0.5 rounded text-[10px] font-medium"
            :style="
              item.current_stock <= 2 ? 'background:#FEE2E2; color:#DC2626' : 'background:#FEF3C7; color:#D97706'
            "
          >
            {{ item.current_stock <= 2 ? 'วิกฤต' : 'ใกล้หมด' }}
          </span>
        </div>
      </div>
    </div>
  </AppLayout>
</template>
