<script setup>
import { computed, onMounted, ref } from 'vue'
import AppLayout from '@/components/layout/AppLayout.vue'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const loading = ref(true)
const saving = ref(false)
const orders = ref([])
const systemUsers = ref([])
const transactions = ref([])
const searchText = ref('')
const selectedStatus = ref('all')
const isWithdrawModalOpen = ref(false)

const withdrawForm = ref({
  order_id: '',
  item_id: '',
  item_name: '',
  amount: 1,
  max_amount: 1,
  unit: '',
  category_id: '',
  document_url: '',
  image_url: '',
  return_date: '',
  note: '',
  remark: '',
  status: 'completed'
})

async function fetchData() {
  loading.value = true
  try {
    const [{ data: ordersData, error: ordersError }, { data: usersData, error: usersError }, { data: txData, error: txError }] = await Promise.all([
      supabase.from('order_req').select('*, items(item_code,item_name,current_stock), category(category_name)').order('created_at', { ascending: false }),
      supabase.from('system_users').select('id, fullname, emp_code'),
      supabase.from('transactions').select('order_id, return_date, created_at').order('created_at', { ascending: false })
    ])
    if (ordersError) throw ordersError
    if (usersError) throw usersError
    if (txError) throw txError
    orders.value = ordersData || []
    systemUsers.value = usersData || []
    transactions.value = txData || []
  } catch (err) {
    alert('โหลดข้อมูลไม่สำเร็จ: ' + err.message)
  } finally {
    loading.value = false
  }
}

onMounted(fetchData)

const filteredOrders = computed(() => {
  const key = searchText.value.trim().toLowerCase()
  return orders.value.filter((row) => {
    const itemCode = row.items?.item_code?.toLowerCase() || ''
    const itemName = row.items?.item_name?.toLowerCase() || ''
    const note = row.note?.toLowerCase() || ''
    const remark = row.remark?.toLowerCase() || ''
    const matchSearch = !key || itemCode.includes(key) || itemName.includes(key) || note.includes(key) || remark.includes(key)
    const matchStatus = selectedStatus.value === 'all' || row.status === selectedStatus.value
    return matchSearch && matchStatus
  })
})

function getStatusClass(status) {
  if (status === 'approved') return 'bg-green-50 text-green-600 border-green-100'
  if (status === 'rejected') return 'bg-red-50 text-red-600 border-red-100'
  if (status === 'completed') return 'bg-blue-50 text-blue-600 border-blue-100'
  return 'bg-amber-50 text-amber-600 border-amber-100'
}

function getStatusText(status) {
  if (status === 'approved') return 'อนุมัติ'
  if (status === 'rejected') return 'ไม่อนุมัติ'
  if (status === 'completed') return 'เบิกแล้ว'
  return 'รออนุมัติ'
}

function userLabel(userId) {
  const user = systemUsers.value.find((row) => row.id === userId)
  if (!user) return '-'
  return user.emp_code ? `${user.fullname} (${user.emp_code})` : user.fullname
}

function formatDateTime(value) {
  if (!value) return '-'
  return new Date(value).toLocaleString('th-TH')
}

function getReturnDate(orderId) {
  const tx = transactions.value.find((row) => row.order_id === orderId && row.return_date)
  if (!tx?.return_date) return '-'
  return new Date(tx.return_date).toLocaleDateString('th-TH')
}

function canWithdraw(order) {
  // ให้กดได้ทั้ง "รออนุมัติ" และ "อนุมัติ" เพื่อเข้ามาอัปเดตสถานะได้
  // แต่ถ้า "เบิกแล้ว" หรือ "ไม่อนุมัติ" ถือว่าเสร็จสิ้น/ปิดงาน ไม่ให้กดซ้ำ
  return order.status === 'pending' || order.status === 'approved'
}

function openWithdrawModal(order) {
  withdrawForm.value = {
    order_id: order.id,
    item_id: order.item_id,
    item_name: order.items?.item_name || '-',
    amount: Number(order.amount || 1),
    max_amount: Number(order.amount || 1),
    unit: order.unit || '',
    category_id: order.category_id || '',
    document_url: order.document_url || '',
    image_url: order.image_url || '',
    return_date: '',
    note: order.note || '',
    remark: order.remark || '',
    status: 'completed'
  }
  isWithdrawModalOpen.value = true
}

async function submitWithdraw() {
  if (!auth.user?.id) return alert('ไม่พบข้อมูลผู้ใช้ กรุณาเข้าสู่ระบบใหม่')
  if (!withdrawForm.value.item_id || !withdrawForm.value.order_id) return alert('ไม่พบข้อมูลคำขอ')
  if (!withdrawForm.value.amount || withdrawForm.value.amount <= 0) return alert('จำนวนที่เบิกต้องมากกว่า 0')
  if (withdrawForm.value.amount > withdrawForm.value.max_amount) return alert('จำนวนที่เบิกมากกว่าจำนวนที่ขอ')

  saving.value = true
  try {
    const nextStatus = withdrawForm.value.status

    // กันการ "เบิกซ้ำ": ถ้ามีธุรกรรมของ order นี้แล้ว ห้ามบันทึกตัดสต็อกซ้ำ
    const alreadyWithdrawn = transactions.value.some((row) => row.order_id === withdrawForm.value.order_id)
    if (nextStatus === 'completed' && alreadyWithdrawn) {
      alert('รายการนี้ถูกเบิกแล้ว ไม่สามารถเบิกซ้ำได้')
      return
    }

    // สร้างรายการตัดสต็อกเฉพาะตอนสถานะ "เบิกแล้ว" เท่านั้น
    if (nextStatus === 'completed') {
      const { error: txError } = await supabase.from('transactions').insert({
        item_id: withdrawForm.value.item_id,
        amount: Number(withdrawForm.value.amount),
        unit: withdrawForm.value.unit,
        category_id: withdrawForm.value.category_id || null,
        document_url: withdrawForm.value.document_url || null,
        image_url: withdrawForm.value.image_url || null,
        return_date: withdrawForm.value.return_date || null,
        note: withdrawForm.value.note || null,
        remark: withdrawForm.value.remark || null,
        order_id: withdrawForm.value.order_id,
        created_by: auth.user.id,
        updated_by: auth.user.id
      })
      if (txError) throw txError
    }

    const { error: orderError } = await supabase
      .from('order_req')
      .update({
        status: nextStatus,
        updated_by: auth.user.id,
        updated_at: new Date().toISOString(),
        remark: withdrawForm.value.remark || null
      })
      .eq('id', withdrawForm.value.order_id)
    if (orderError) throw orderError

    await supabase.from('user_logs').insert({
      system_user_id: auth.user.id,
      action: 'withdraw_from_order_req',
      user_agent: navigator.userAgent,
      old_value: { order_id: withdrawForm.value.order_id, amount: withdrawForm.value.amount, status: withdrawForm.value.status }
    })

    isWithdrawModalOpen.value = false
    await fetchData()
    alert('บันทึกการเบิกสำเร็จ')
  } catch (err) {
    if ((err.message || '').includes('stock_insufficient')) {
      alert('สต็อกสินค้าไม่พอสำหรับการเบิกตามจำนวนที่ระบุ')
    } else {
      alert('บันทึกการเบิกไม่สำเร็จ: ' + err.message)
    }
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <AppLayout>
    <div class="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
      <div>
        <h1 class="text-[20px] font-semibold" style="color: var(--color-text-primary)">อนุมัติ/เบิกสินค้า</h1>
        <p class="text-[13px] mt-0.5" style="color: var(--color-text-muted)">แสดงข้อมูลคำขอทั้งหมดจาก order_req และอนุมัติเบิกจากหน้านี้</p>
      </div>
    </div>

    <div class="flex flex-col md:flex-row gap-4 mb-6 p-4 rounded-xl border" style="background: var(--color-bg-card); border-color: var(--color-border)">
      <div class="flex-1 relative">
        <i class="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-[14px]" style="color: var(--color-text-muted)"></i>
        <input v-model="searchText" type="text" placeholder="ค้นหารหัส, ชื่อสินค้า, หมายเหตุ..." class="w-full pl-9 pr-4 py-2 bg-transparent border rounded-lg text-[13px] focus:outline-none focus:ring-1 transition-all" style="border-color: var(--color-border); color: var(--color-text-primary)" />
      </div>
      <div class="w-full md:w-48">
        <select v-model="selectedStatus" class="w-full px-3 py-2 bg-transparent border rounded-lg text-[13px] focus:outline-none focus:ring-1 transition-all" style="border-color: var(--color-border); color: var(--color-text-primary)">
          <option value="all">ทุกสถานะ</option>
          <option value="pending">รออนุมัติ</option>
          <option value="approved">อนุมัติ</option>
          <option value="completed">เบิกแล้ว</option>
          <option value="rejected">ไม่อนุมัติ</option>
        </select>
      </div>
    </div>

    <div class="rounded-xl border overflow-hidden" style="background: var(--color-bg-card); border-color: var(--color-border)">
      <div class="overflow-x-auto">
        <table class="w-full text-[13px]">
          <thead>
            <tr style="border-bottom: 1px solid var(--color-border)">
              <th class="text-left px-4 py-3 font-medium" style="color: var(--color-text-muted)">สินค้า</th>
              <th class="text-left px-4 py-3 font-medium" style="color: var(--color-text-muted)">จำนวน/หน่วย</th>
              <th class="text-right px-4 py-3 font-medium" style="color: var(--color-text-muted)">จำนวนคงเหลือ</th>
              <th class="text-left px-4 py-3 font-medium" style="color: var(--color-text-muted)">ประเภท</th>
              <th class="text-left px-4 py-3 font-medium" style="color: var(--color-text-muted)">สถานะ</th>
              <th class="text-left px-4 py-3 font-medium" style="color: var(--color-text-muted)">รายละเอียด/หมายเหตุ</th>
              <th class="text-left px-4 py-3 font-medium" style="color: var(--color-text-muted)">เอกสาร/รูป</th>
              <th class="text-left px-4 py-3 font-medium" style="color: var(--color-text-muted)">ผู้ขอ/วันที่ขอ</th>
              <th class="text-center px-4 py-3 font-medium" style="color: var(--color-text-muted)">จัดการ</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="order in filteredOrders" :key="order.id" class="border-b last:border-b-0 hover:bg-gray-50 dark:hover:bg-slate-700/30 transition-colors" style="border-color: var(--color-border)">
              <td class="px-4 py-3">
                <p class="font-medium" style="color: var(--color-text-primary)">{{ order.items?.item_name || '-' }}</p>
                <p class="text-[11px]" style="color: var(--color-text-muted)">{{ order.items?.item_code || '-' }}</p>
              </td>
              <td class="px-4 py-3 font-medium" style="color: var(--color-text-primary)">{{ order.amount }} / {{ order.unit }}</td>
              <td class="px-4 py-3 text-right">
                <span :class="(order.items?.current_stock ?? 0) < order.amount ? 'text-red-500 font-semibold' : 'text-green-600 font-semibold'">
                  {{ order.items?.current_stock ?? 0 }}
                </span>
                <p class="text-[11px]" :class="(order.items?.current_stock ?? 0) < order.amount ? 'text-red-500' : 'text-emerald-600'">
                  {{ (order.items?.current_stock ?? 0) < order.amount ? 'ไม่เพียงพอ' : 'เพียงพอ' }}
                </p>
              </td>
              <td class="px-4 py-3" style="color: var(--color-text-secondary)">{{ order.category?.category_name || '-' }}</td>
              <td class="px-4 py-3">
                <span class="px-2 py-0.5 rounded-full text-[11px] border" :class="getStatusClass(order.status)">{{ getStatusText(order.status) }}</span>
              </td>
              <td class="px-4 py-3" style="color: var(--color-text-muted)">
                <p>{{ order.note || '-' }}</p>
                <p class="text-[11px] mt-0.5">{{ order.remark || '' }}</p>
              </td>
              <td class="px-4 py-3" style="color: var(--color-text-muted)">
                <div class="flex flex-col gap-1">
                  <a v-if="order.document_url" :href="order.document_url" target="_blank" class="text-blue-600 hover:underline">เอกสาร</a>
                  <a v-if="order.image_url" :href="order.image_url" target="_blank" class="text-emerald-600 hover:underline">รูปภาพ</a>
                  <span v-if="!order.document_url && !order.image_url">-</span>
                </div>
              </td>
              <td class="px-4 py-3 text-[12px]" style="color: var(--color-text-muted)">
                <p>{{ userLabel(order.created_by) }}</p>
                <p class="mt-0.5">{{ formatDateTime(order.created_at) }}</p>
              </td>
              <td class="px-4 py-3 text-center">
                <button v-if="canWithdraw(order)" @click="openWithdrawModal(order)" class="px-3 py-1 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 text-[11px] font-medium hover:bg-emerald-100 transition-colors">
                  <i class="fa-solid fa-check mr-1"></i>
                  อนุมัติ/เบิก
                </button>
                <span v-else class="text-[11px]" style="color: var(--color-text-muted)">เสร็จสิ้นแล้ว</span>
              </td>
            </tr>
            <tr v-if="loading">
              <td colspan="9" class="px-4 py-8 text-center" style="color: var(--color-text-muted)">กำลังโหลดข้อมูล...</td>
            </tr>
            <tr v-else-if="filteredOrders.length === 0">
              <td colspan="9" class="px-4 py-8 text-center" style="color: var(--color-text-muted)">ไม่พบข้อมูลคำขอเบิก</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <Transition name="slide-right">
      <div v-if="isWithdrawModalOpen" class="fixed inset-0 z-50 flex justify-end">
        <div class="absolute inset-0 bg-black/30 backdrop-blur-sm" @click="isWithdrawModalOpen = false"></div>
        <div class="relative w-full max-w-md h-full shadow-2xl flex flex-col" style="background: var(--color-bg-card)">
          <div class="px-6 py-4 border-b flex items-center justify-between" style="border-color: var(--color-border)">
            <h2 class="text-[16px] font-semibold" style="color: var(--color-text-primary)">ฟอร์มอนุมัติ / เบิกสินค้า</h2>
            <button @click="isWithdrawModalOpen = false" class="p-2 hover:bg-gray-100 rounded-lg transition-colors">
              <i class="fa-solid fa-xmark" style="color: var(--color-text-muted)"></i>
            </button>
          </div>
          <div class="flex-1 overflow-y-auto p-6 space-y-4">
            <div class="p-3 rounded-lg bg-emerald-50 border border-emerald-100">
              <p class="text-[12px] text-emerald-700 font-medium">รายการที่กำลังดำเนินการ:</p>
              <p class="text-[15px] text-emerald-900 font-bold">{{ withdrawForm.item_name }}</p>
            </div>
            <div class="grid grid-cols-2 gap-4">
              <div class="space-y-1">
                <label class="text-[13px] font-medium" style="color: var(--color-text-primary)">จำนวนที่ขอ</label>
                <input :value="withdrawForm.max_amount" disabled type="number" class="w-full px-3 py-2 border rounded-lg text-[13px] bg-gray-50" style="border-color: var(--color-border)" />
              </div>
              <div class="space-y-1">
                <label class="text-[13px] font-medium" style="color: var(--color-text-primary)">จำนวนที่เบิกจริง</label>
                <input v-model.number="withdrawForm.amount" type="number" min="1" class="w-full px-3 py-2 border rounded-lg text-[13px] focus:outline-none focus:ring-1" style="border-color: var(--color-border); background: var(--color-bg-body)" />
              </div>
            </div>
            <div class="grid grid-cols-2 gap-4">
              <div class="space-y-1">
                <label class="text-[13px] font-medium" style="color: var(--color-text-primary)">หน่วย</label>
                <input v-model="withdrawForm.unit" type="text" class="w-full px-3 py-2 border rounded-lg text-[13px] focus:outline-none focus:ring-1" style="border-color: var(--color-border); background: var(--color-bg-body)" />
              </div>
              <div class="space-y-1">
                <label class="text-[13px] font-medium" style="color: var(--color-text-primary)">สถานะคำขอ</label>
                <select v-model="withdrawForm.status" class="w-full px-3 py-2 border rounded-lg text-[13px] focus:outline-none focus:ring-1" style="border-color: var(--color-border); background: var(--color-bg-body)">
                  <option value="approved">อนุมัติ</option>
                  <option value="completed">เบิกแล้ว</option>
                  <option value="rejected">ไม่อนุมัติ</option>
                </select>
              </div>
            </div>
            <div class="space-y-1">
              <label class="text-[13px] font-medium" style="color: var(--color-text-primary)">กำหนดส่งคืน (ถ้ามี)</label>
              <input v-model="withdrawForm.return_date" type="date" class="w-full px-3 py-2 border rounded-lg text-[13px] focus:outline-none focus:ring-1" style="border-color: var(--color-border); background: var(--color-bg-body)" />
            </div>
            <div class="space-y-1">
              <label class="text-[13px] font-medium" style="color: var(--color-text-primary)">หมายเหตุ</label>
              <textarea v-model="withdrawForm.remark" rows="2" class="w-full px-3 py-2 border rounded-lg text-[13px] focus:outline-none focus:ring-1" style="border-color: var(--color-border); background: var(--color-bg-body)"></textarea>
            </div>
          </div>
          <div class="p-6 border-t flex gap-3" style="border-color: var(--color-border)">
            <button @click="isWithdrawModalOpen = false" class="flex-1 py-2 rounded-lg text-[14px] font-medium border hover:bg-gray-50 transition-all" style="border-color: var(--color-border); color: var(--color-text-secondary)">
              ยกเลิก
            </button>
            <button @click="submitWithdraw" :disabled="saving" class="flex-1 py-2 rounded-lg text-[14px] font-medium text-white transition-all hover:opacity-90 disabled:opacity-50" style="background: var(--color-primary)">
              {{ saving ? 'กำลังบันทึก...' : 'บันทึกการเบิก' }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </AppLayout>
</template>

<style scoped>
.slide-right-enter-active,
.slide-right-leave-active {
  transition: all 0.3s ease;
}

.slide-right-enter-from,
.slide-right-leave-to {
  transform: translateX(100%);
  opacity: 0;
}

input:focus,
select:focus,
textarea:focus {
  border-color: var(--color-primary) !important;
  box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.1);
}
</style>
