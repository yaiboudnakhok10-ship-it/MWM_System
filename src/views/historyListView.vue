<script setup>
import { computed, onMounted, ref } from 'vue'
import AppLayout from '@/components/layout/AppLayout.vue'
import { supabase } from '@/lib/supabase'

const loading = ref(true)
const orders = ref([])
const transactions = ref([])
const systemUsers = ref([])
const searchText = ref('')

async function fetchData() {
  loading.value = true
  try {
    const [
      { data: ordersData, error: ordersError },
      { data: txData, error: txError },
      { data: usersData, error: usersError }
    ] = await Promise.all([
      supabase
        .from('order_req')
        .select('id, amount, unit, note, remark, status, updated_at, updated_by, items(item_code,item_name), category(category_name)')
        .eq('status', 'completed')
        .order('updated_at', { ascending: false }),
      supabase.from('transactions').select('order_id, amount, unit, return_date, created_at, created_by').order('created_at', { ascending: false }),
      supabase.from('system_users').select('id, fullname, emp_code')
    ])

    if (ordersError) throw ordersError
    if (txError) throw txError
    if (usersError) throw usersError

    orders.value = ordersData || []
    transactions.value = txData || []
    systemUsers.value = usersData || []
  } catch (err) {
    alert('โหลดประวัติการเบิกไม่สำเร็จ: ' + err.message)
  } finally {
    loading.value = false
  }
}

onMounted(fetchData)

function userLabel(userId) {
  const user = systemUsers.value.find((row) => row.id === userId)
  if (!user) return '-'
  return user.emp_code ? `${user.fullname} (${user.emp_code})` : user.fullname
}

function formatDateTime(value) {
  if (!value) return '-'
  return new Date(value).toLocaleString('th-TH')
}

function formatDate(value) {
  if (!value) return '-'
  return new Date(value).toLocaleDateString('th-TH')
}

function txByOrderId(orderId) {
  return transactions.value.find((row) => row.order_id === orderId) || null
}

const filteredOrders = computed(() => {
  const key = searchText.value.trim().toLowerCase()
  if (!key) return orders.value
  return orders.value.filter((row) => {
    const itemCode = row.items?.item_code?.toLowerCase() || ''
    const itemName = row.items?.item_name?.toLowerCase() || ''
    const note = row.note?.toLowerCase() || ''
    const remark = row.remark?.toLowerCase() || ''
    return itemCode.includes(key) || itemName.includes(key) || note.includes(key) || remark.includes(key)
  })
})
</script>

<template>
  <AppLayout>
    <div class="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
      <div>
        <h1 class="text-[20px] font-semibold" style="color: var(--color-text-primary)">ประวัติการเบิก</h1>
        <p class="text-[13px] mt-0.5" style="color: var(--color-text-muted)">แสดงเฉพาะรายการที่ “เบิกแล้ว” (completed)</p>
      </div>
    </div>

    <div class="flex flex-col md:flex-row gap-4 mb-6 p-4 rounded-xl border" style="background: var(--color-bg-card); border-color: var(--color-border)">
      <div class="flex-1 relative">
        <i class="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-[14px]" style="color: var(--color-text-muted)"></i>
        <input
          v-model="searchText"
          type="text"
          placeholder="ค้นหารหัส/ชื่อสินค้า/รายละเอียด..."
          class="w-full pl-9 pr-4 py-2 bg-transparent border rounded-lg text-[13px] focus:outline-none focus:ring-1 transition-all"
          style="border-color: var(--color-border); color: var(--color-text-primary)"
        />
      </div>
    </div>

    <div class="rounded-xl border overflow-hidden" style="background: var(--color-bg-card); border-color: var(--color-border)">
      <div class="overflow-x-auto">
        <table class="w-full text-[13px]">
          <thead>
            <tr style="border-bottom: 1px solid var(--color-border)">
              <th class="text-left px-4 py-3 font-medium" style="color: var(--color-text-muted)">วันที่เบิก (เวลาอนุมัติ)</th>
              <th class="text-left px-4 py-3 font-medium" style="color: var(--color-text-muted)">สินค้า</th>
              <th class="text-left px-4 py-3 font-medium" style="color: var(--color-text-muted)">จำนวน/หน่วย</th>
              <th class="text-left px-4 py-3 font-medium" style="color: var(--color-text-muted)">ประเภทข้อมูล</th>
              <th class="text-left px-4 py-3 font-medium" style="color: var(--color-text-muted)">รายละเอียด</th>
              <th class="text-left px-4 py-3 font-medium" style="color: var(--color-text-muted)">กำหนดส่งคืน</th>
              <th class="text-left px-4 py-3 font-medium" style="color: var(--color-text-muted)">ผู้อนุมัติ/ผู้เบิก</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="order in filteredOrders"
              :key="order.id"
              class="border-b last:border-b-0 hover:bg-gray-50 dark:hover:bg-slate-700/30 transition-colors"
              style="border-color: var(--color-border)"
            >
              <td class="px-4 py-3 text-[12px]" style="color: var(--color-text-muted)">
                {{ formatDateTime(order.updated_at) }}
              </td>
              <td class="px-4 py-3">
                <p class="font-medium" style="color: var(--color-text-primary)">{{ order.items?.item_name || '-' }}</p>
                <p class="text-[11px]" style="color: var(--color-text-muted)">{{ order.items?.item_code || '-' }}</p>
              </td>
              <td class="px-4 py-3 font-medium" style="color: var(--color-text-primary)">
                <span v-if="txByOrderId(order.id)">{{ txByOrderId(order.id).amount }} / {{ txByOrderId(order.id).unit || order.unit }}</span>
                <span v-else>{{ order.amount }} / {{ order.unit }}</span>
              </td>
              <td class="px-4 py-3">
                <span class="px-2 py-0.5 rounded-full text-[11px] border bg-blue-50 text-blue-600 border-blue-100 font-medium">
                  เบิกแล้ว
                </span>
              </td>
              <td class="px-4 py-3" style="color: var(--color-text-muted)">
                <p>{{ order.note || '-' }}</p>
                <p class="text-[11px] mt-0.5">{{ order.remark || '' }}</p>
              </td>
              <td class="px-4 py-3 text-[12px]" style="color: var(--color-text-muted)">
                <span v-if="txByOrderId(order.id)?.return_date">{{ formatDate(txByOrderId(order.id).return_date) }}</span>
                <span v-else>-</span>
              </td>
              <td class="px-4 py-3 text-[12px]" style="color: var(--color-text-muted)">
                {{ userLabel(order.updated_by) }}
              </td>
            </tr>

            <tr v-if="loading">
              <td colspan="7" class="px-4 py-8 text-center" style="color: var(--color-text-muted)">กำลังโหลดข้อมูล...</td>
            </tr>
            <tr v-else-if="filteredOrders.length === 0">
              <td colspan="7" class="px-4 py-8 text-center" style="color: var(--color-text-muted)">ไม่พบประวัติการเบิก</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </AppLayout>
</template>

<style scoped>
input:focus,
select:focus,
textarea:focus {
  border-color: var(--color-primary) !important;
  box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.1);
}
</style>
