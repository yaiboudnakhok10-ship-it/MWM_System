<script setup>
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { Chart, registerables } from 'chart.js'
import AppLayout from '@/components/layout/AppLayout.vue'
import StatCard from '@/components/ui/StatCard.vue'
import { mockItems, mockTransactions, mockUsers, mockCategories, mockChartData } from '@/lib/mockData'

Chart.register(...registerables)

const lowStockItems = computed(() => mockItems.filter(i => i.current_stock <= 5))

const recentTransactions = computed(() =>
  mockTransactions.slice(0, 5).map(t => ({
    ...t,
    item_name: mockItems.find(i => i.id === t.item_id)?.item_name || '-',
    item_code: mockItems.find(i => i.id === t.item_id)?.item_code || '-',
    created_by_name: mockUsers.find(u => u.id === t.created_by)?.fullname || '-',
  }))
)

const lineChartRef = ref(null)
const donutChartRef = ref(null)
let lineChart, donutChart

function formatDate(iso) {
  const d = new Date(iso)
  return `${d.getDate()}/${d.getMonth() + 1}`
}

onMounted(() => {
  lineChart = new Chart(lineChartRef.value, {
    type: 'line',
    data: {
      labels: mockChartData.labels.map(formatDate),
      datasets: [
        { label: 'นำเข้า', data: mockChartData.imports, borderColor: '#2563EB', backgroundColor: 'transparent', tension: 0.4, pointRadius: 3 },
        { label: 'เบิกจ่าย', data: mockChartData.transactions, borderColor: '#F59E0B', backgroundColor: 'transparent', tension: 0.4, pointRadius: 3 },
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'top' } },
      scales: { y: { grid: { color: 'rgba(0,0,0,0.05)' } }, x: { grid: { display: false } } }
    }
  })

  donutChart = new Chart(donutChartRef.value, {
    type: 'doughnut',
    data: {
      labels: mockCategories.map(c => c.category_name),
      datasets: [{ data: [35, 20, 18, 15, 12], backgroundColor: ['#2563EB','#16A34A','#F59E0B','#EF4444','#8B5CF6'], borderWidth: 0 }]
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } }
  })
})

onUnmounted(() => { lineChart?.destroy(); donutChart?.destroy() })
</script>

<template>
  <AppLayout>
    <div class="mb-6">
      <h1 class="text-[20px] font-semibold" style="color: var(--color-text-primary)">แดชบอร์ด</h1>
      <p class="text-[13px] mt-0.5" style="color: var(--color-text-muted)">ภาพรวมระบบคลังสินค้า</p>
    </div>

    <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
      <StatCard title="สินค้าทั้งหมด" :value="248" unit="รายการ" icon="fa-boxes-stacked" trend="+12 จากเดือนที่แล้ว" trend-type="up" accent-color="#2563EB" />
      <StatCard title="นำเข้าวันนี้" :value="15" unit="รายการ" icon="fa-arrow-down-to-bracket" trend="+3 จากวานนี้" trend-type="up" accent-color="#16A34A" />
      <StatCard title="เบิกจ่ายวันนี้" :value="8" unit="รายการ" icon="fa-arrow-up-from-bracket" trend="-2 จากวานนี้" trend-type="down" accent-color="#DC2626" />
      <StatCard title="คำขอรออนุมัติ" :value="5" unit="รายการ" icon="fa-clock" trend="2 รายการใหม่" trend-type="neutral" accent-color="#D97706" />
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
            <tr v-for="t in recentTransactions" :key="t.id"
                class="border-b last:border-b-0 hover:bg-gray-50 dark:hover:bg-slate-700/30"
                style="border-color: var(--color-border)">
              <td class="px-4 py-2.5 hidden sm:table-cell font-mono" style="color: var(--color-text-muted)">{{ t.item_code }}</td>
              <td class="px-4 py-2.5" style="color: var(--color-text-primary)">{{ t.item_name }}</td>
              <td class="px-4 py-2.5 text-right font-medium" style="color: var(--color-text-primary)">{{ t.amount }}</td>
              <td class="px-4 py-2.5 hidden sm:table-cell" style="color: var(--color-text-muted)">{{ t.unit }}</td>
              <td class="px-4 py-2.5 hidden md:table-cell" style="color: var(--color-text-secondary)">{{ t.created_by_name }}</td>
              <td class="px-4 py-2.5 text-[12px]" style="color: var(--color-text-muted)">{{ new Date(t.created_at).toLocaleDateString('th-TH') }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="rounded-xl border p-4" style="background: var(--color-bg-card); border-color: var(--color-border)">
      <div class="flex items-center gap-2 mb-3">
        <i class="fa-solid fa-triangle-exclamation" style="color: var(--color-warning)"></i>
        <p class="text-[14px] font-medium" style="color: var(--color-text-primary)">สินค้าใกล้หมด</p>
      </div>
      <div class="flex gap-3 overflow-x-auto pb-1">
        <div v-for="item in lowStockItems" :key="item.id"
             class="min-w-[140px] rounded-xl border p-3 shrink-0"
             style="border-color: var(--color-border)">
          <p class="text-[12px] leading-tight mb-1" style="color: var(--color-text-secondary)">{{ item.item_name }}</p>
          <p class="text-[28px] font-bold leading-none"
             :style="item.current_stock <= 2 ? 'color: var(--color-danger)' : 'color: var(--color-warning)'">
            {{ item.current_stock }}
          </p>
          <p class="text-[11px] mt-0.5" style="color: var(--color-text-muted)">{{ item.unit }}</p>
          <span class="inline-block mt-2 px-2 py-0.5 rounded text-[10px] font-medium"
                :style="item.current_stock <= 2
                  ? 'background:#FEE2E2; color:#DC2626'
                  : 'background:#FEF3C7; color:#D97706'">
            {{ item.current_stock <= 2 ? 'วิกฤต' : 'ใกล้หมด' }}
          </span>
        </div>
      </div>
    </div>
  </AppLayout>
</template>
