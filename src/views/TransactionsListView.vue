<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import AppLayout from '@/components/layout/AppLayout.vue'
import { supabase, supabaseEmployee } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const loading = ref(true)
const saving = ref(false)
const orders = ref([])
const systemUsers = ref([])
const transactions = ref([])
const searchText = ref('')
const selectedStatus = ref('pending')
const isScanModalOpen = ref(false)
const scanResult = ref(null)
const scanLoading = ref(false)

// Employee Search States
const employeeSearchLoading = ref(false)
const employeeResults = ref([])
const activeSearchField = ref(null) // 'receive_by' or 'inspector_by'
const sharedReceiveBy = ref('')
const sharedInspectorBy = ref('')

async function searchEmployees(query) {
  if (!query || query.length < 2) {
    employeeResults.value = []
    return
  }
  employeeSearchLoading.value = true
  try {
    const { data, error } = await supabaseEmployee
      .from('employees')
      .select('fullname, employee_code')
      .or(`fullname.ilike.%${query}%,employee_code.ilike.%${query}%`)
      .limit(10)
    
    if (error) throw error
    employeeResults.value = data || []
  } catch (err) {
    console.error('Error searching employees:', err)
  } finally {
    employeeSearchLoading.value = false
  }
}

function selectEmployee(emp, field, orderId = null) {
  if (orderId) {
    scanItemForms.value[orderId][field] = emp.fullname
  } else {
    if (field === 'receive_by') sharedReceiveBy.value = emp.fullname
    if (field === 'inspector_by') sharedInspectorBy.value = emp.fullname
  }
  employeeResults.value = []
  activeSearchField.value = null
}

// Group orders by request_id
const groupedOrders = computed(() => {
  const key = searchText.value.trim().toLowerCase()
  const filtered = orders.value.filter((row) => {
    const itemCode = row.items?.item_code?.toLowerCase() || ''
    const itemName = row.items?.item_name?.toLowerCase() || ''
    const note = row.note?.toLowerCase() || ''
    const remark = row.remark?.toLowerCase() || ''
    const matchSearch = !key || itemCode.includes(key) || itemName.includes(key) || note.includes(key) || remark.includes(key)
    const matchStatus = selectedStatus.value === 'all' || row.status === selectedStatus.value
    return matchSearch && matchStatus
  })

  const groups = {}
  filtered.forEach(order => {
    const rid = order.request_id || `single-${order.id}`
    if (!groups[rid]) {
      groups[rid] = {
        requestId: order.request_id,
        items: [],
        createdAt: order.created_at,
        createdBy: order.created_by,
        status: order.status,
        totalItems: 0
      }
    }
    groups[rid].items.push(order)
    groups[rid].totalItems++
    // If any item in group is pending, group shows pending status logic can be applied if needed
  })
  
  return Object.values(groups).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
})

// --- Barcode scanner state ---
let barcodeBuffer = ''
let barcodeTimer = null
const BARCODE_TIMEOUT_MS = 80 // ช่วงเวลา (ms) ระหว่างตัวอักษร ถ้าเกินนี้ถือว่าเป็นการพิมพ์ธรรมดา

function handleKeyDown(e) {
  // ถ้า focus อยู่ที่ input/textarea/select ปกติ ให้ข้ามไป
  const tag = document.activeElement?.tagName?.toLowerCase()
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return

  if (e.key === 'Enter') {
    if (barcodeBuffer.length > 2) {
      processBarcodeInput(barcodeBuffer.trim())
    }
    barcodeBuffer = ''
    clearTimeout(barcodeTimer)
    return
  }

  // เก็บเฉพาะตัวอักษรที่พิมพ์ได้ (printable characters)
  if (e.key.length === 1) {
    barcodeBuffer += e.key
    clearTimeout(barcodeTimer)
    barcodeTimer = setTimeout(() => {
      barcodeBuffer = ''
    }, BARCODE_TIMEOUT_MS)
  }
}

async function processBarcodeInput(code) {
  // ลอง parse เป็นตัวเลข (request_id)
  const requestId = parseInt(code, 10)
  if (isNaN(requestId)) return

  scanLoading.value = true
  isScanModalOpen.value = true
  scanResult.value = null

  try {
    const { data, error } = await supabase
      .from('order_req')
      .select('*, items(item_code, item_name, current_stock), category(category_name)')
      .eq('request_id', requestId)
      .order('created_at', { ascending: true })

    if (error) throw error

    if (!data || data.length === 0) {
      scanResult.value = { requestId, items: [], notFound: true }
    } else {
      scanResult.value = { requestId, items: data, notFound: false }
    }
  } catch (err) {
    alert('เกิดข้อผิดพลาดในการค้นหา: ' + err.message)
    isScanModalOpen.value = false
  } finally {
    scanLoading.value = false
  }
}

// scan modal form state สำหรับแต่ละรายการ
const scanItemForms = ref({})

function initScanForms(items) {
  const forms = {}
  
  // Set shared fields from first item as default
  if (items.length > 0) {
    const creator = systemUsers.value.find(u => u.id === items[0].created_by)
    sharedReceiveBy.value = items[0].receive_by || (creator ? creator.fullname : '')
    sharedInspectorBy.value = items[0].inspector_by || ''
  }

  items.forEach((order) => {
    // ดึงชื่อผู้ขอจาก systemUsers
    const creator = systemUsers.value.find(u => u.id === order.created_by)
    const creatorName = creator ? creator.fullname : ''

    forms[order.id] = {
      amount: Number(order.amount || 1),
      max_amount: Number(order.amount || 1),
      unit: order.unit || '',
      remark: order.remark || '',
      return_date: '',
      status: order.status === 'completed' || order.status === 'rejected' ? order.status : 'completed',
      mr_number: order.mr_number || '',
      company: order.company || '',
      fixed_bill_number: order.fixed_bill_number || '',
      metter_hour: order.metter_hour || '',
      metter_kilometter: order.metter_kilometter || '',
      withdraw_purpose: order.withdraw_purpose || '',
      receive_by: order.receive_by || creatorName, // ดึงจาก created_by เป็นค่าเริ่มต้น
      inspector_by: order.inspector_by || '',
      note: order.note || '', // ดึงเหตุผลการเบิกเดิมมาแสดง
    }
  })
  scanItemForms.value = forms
}

function openGroupModal(group) {
  scanResult.value = {
    requestId: group.requestId,
    items: group.items,
    notFound: false
  }
  isScanModalOpen.value = true
}

// เมื่อ scanResult เปลี่ยน ให้ init forms
watch(
  () => scanResult.value,
  (val) => {
    if (val && !val.notFound) {
      initScanForms(val.items)
    }
  }
)

function canWithdrawScan(order) {
  return order.status === 'pending' || order.status === 'approved'
}

async function submitScanWithdraw() {
  if (!auth.user?.id) return alert('ไม่พบข้อมูลผู้ใช้ กรุณาเข้าสู่ระบบใหม่')

  const items = scanResult.value?.items || []
  const withdrawableItems = items.filter((o) => canWithdrawScan(o))
  if (withdrawableItems.length === 0) return alert('ไม่มีรายการที่สามารถดำเนินการได้')

  saving.value = true
  try {
    for (const order of withdrawableItems) {
      const form = scanItemForms.value[order.id]
      if (!form) continue

      const nextStatus = form.status

      // กันเบิกซ้ำ
      const alreadyWithdrawn = transactions.value.some((row) => row.order_id === order.id)
      if (nextStatus === 'completed' && alreadyWithdrawn) continue

      if (nextStatus === 'completed') {
        const { error: txError } = await supabase.from('transactions').insert({
          item_id: order.item_id,
          amount: Number(form.amount),
          unit: form.unit,
          category_id: order.category_id || null,
          document_url: order.document_url || null,
          image_url: order.image_url || null,
          return_date: form.return_date || null,
          note: form.note || null,
          remark: form.remark || null,
          order_id: order.id,
          created_by: auth.user.id,
          updated_by: auth.user.id,
        })
        if (txError) throw txError
      }

      const { error: orderError } = await supabase
        .from('order_req')
        .update({
          status: nextStatus,
          updated_by: auth.user.id, // ระบบจะนำข้อมูลผู้ใช้งานที่ทำการอนุมัติบันทึกเข้าไป (ผู้จ่าย)
          updated_at: new Date().toISOString(),
          remark: form.remark || null,
          mr_number: form.mr_number || null,
          company: form.company || null,
          fixed_bill_number: form.fixed_bill_number || null,
          metter_hour: form.metter_hour || null,
          metter_kilometter: form.metter_kilometter || null,
          withdraw_purpose: form.withdraw_purpose || null,
          receive_by: sharedReceiveBy.value || null,
          inspector_by: sharedInspectorBy.value || null,
          note: form.note || null,
        })
        .eq('id', order.id)
      if (orderError) throw orderError
    }

    await supabase.from('user_logs').insert({
      system_user_id: auth.user.id,
      action: 'scan_withdraw_bulk',
      user_agent: navigator.userAgent,
      old_value: { request_id: scanResult.value?.requestId, count: withdrawableItems.length },
    })

    isScanModalOpen.value = false
    await fetchData()
    alert(`บันทึกสำเร็จ ${withdrawableItems.length} รายการ`)
  } catch (err) {
    if ((err.message || '').includes('stock_insufficient')) {
      alert('สต็อกสินค้าไม่พอสำหรับการเบิกตามจำนวนที่ระบุ')
    } else {
      alert('บันทึกไม่สำเร็จ: ' + err.message)
    }
  } finally {
    saving.value = false
  }
}

onMounted(() => {
  fetchData()
  window.addEventListener('keydown', handleKeyDown)
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeyDown)
  clearTimeout(barcodeTimer)
})

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
  if (status === 'approved') return 'bg-green-50 text-green-600 border-green-100 dark:bg-green-800/20 dark:border-green-800/20 dark:text-green-400'
  if (status === 'rejected') return 'bg-red-50 text-red-600 border-red-100 dark:bg-red-800/20 dark:border-red-800/20 dark:text-red-400'
  if (status === 'completed') return 'bg-blue-50 text-blue-600 border-blue-100 dark:bg-blue-800/20 dark:border-blue-800/20 dark:text-blue-400'
  return 'bg-amber-50 text-amber-600 border-amber-100 dark:bg-amber-800/20 dark:border-amber-800/20 dark:text-amber-400'
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
    const alreadyWithdrawn = transactions.value.some((row) => row.order_id === withdrawForm.value.order_id)
    if (nextStatus === 'completed' && alreadyWithdrawn) {
      alert('รายการนี้ถูกเบิกแล้ว ไม่สามารถเบิกซ้ำได้')
      return
    }

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
        <p class="text-[13px] mt-0.5" style="color: var(--color-text-muted)">ข้อมูลคำขอที่ส่งมาจากผู้ใช้งาน</p>
      </div>
      <!-- indicator แสดงว่า barcode listener ทำงานอยู่ -->
      <div class="flex items-center gap-2 px-3 py-1.5 rounded-full border text-[12px]" style="border-color: var(--color-border); color: var(--color-text-muted)">
        <span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
        พร้อมรับบาร์โค้ด
      </div>
    </div>

    <!-- filter bar -->
    <div class="flex flex-col md:flex-row gap-4 mb-6 p-4 rounded-xl border" style="background: var(--color-bg-card); border-color: var(--color-border)">
      <div class="flex-1 relative">
        <i class="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-[14px]" style="color: var(--color-text-muted)"></i>
        <input v-model="searchText" type="text" placeholder="ค้นหารหัส, ชื่อสินค้า, หมายเหตุ..." class="w-full pl-9 pr-4 py-2 bg-transparent border rounded-lg text-[13px] focus:outline-none focus:ring-1 transition-all" style="border-color: var(--color-border); color: var(--color-text-primary)" />
      </div>
      <div class="w-full md:w-48">
        <select v-model="selectedStatus" class="w-full px-3 py-2 bg-transparent border rounded-lg text-[13px] focus:outline-none focus:ring-1 transition-all" style="border-color: var(--color-border); color: var(--color-text-primary)">
          <option value="all" style="background-color: var(--color-bg-card)">ทุกสถานะ</option>
          <option value="pending" style="background-color: var(--color-bg-card)">รออนุมัติ</option>
          <option value="approved" style="background-color: var(--color-bg-card)">อนุมัติ</option>
          <option value="completed" style="background-color: var(--color-bg-card)">เบิกแล้ว</option>
          <option value="rejected" style="background-color: var(--color-bg-card)">ไม่อนุมัติ</option>
        </select>
      </div>
    </div>

    <!-- main table (Grouped by request_id) -->
    <div class="rounded-xl border overflow-hidden" style="background: var(--color-bg-card); border-color: var(--color-border)">
      <div class="overflow-x-auto">
        <table class="w-full text-[13px]">
          <thead>
            <tr style="border-bottom: 1px solid var(--color-border)">
              <th class="text-left px-4 py-3 font-medium" style="color: var(--color-text-muted)">รหัสคำขอเบิกพัสดุ</th>
              <th class="text-left px-4 py-3 font-medium" style="color: var(--color-text-muted)">จำนวนรายการ</th>
              <th class="text-left px-4 py-3 font-medium" style="color: var(--color-text-muted)">ผู้ขอเบิก</th>
              <th class="text-left px-4 py-3 font-medium" style="color: var(--color-text-muted)">วันที่ขอ</th>
              <th class="text-left px-4 py-3 font-medium" style="color: var(--color-text-muted)">สถานะกลุ่ม</th>
              <th class="text-center px-4 py-3 font-medium" style="color: var(--color-text-muted)">จัดการ</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="group in groupedOrders" :key="group.requestId" class="border-b last:border-b-0 hover:bg-gray-50 dark:hover:bg-slate-700/30 transition-colors" style="border-color: var(--color-border)">
              <td class="px-4 py-3">
                <span class="font-bold text-blue-600">#{{ group.requestId || 'N/A' }}</span>
              </td>
              <td class="px-4 py-3">
                <div class="flex flex-col">
                  <span class="font-medium" style="color: var(--color-text-primary)">{{ group.totalItems }} รายการ</span>
                  <div class="flex flex-wrap gap-1 mt-1">
                    <span v-for="item in group.items.slice(0, 3)" :key="item.id" class="text-[10px] px-1.5 py-0.5 bg-gray-100 dark:bg-slate-700 rounded text-gray-600 dark:text-gray-300">
                      {{ item.items?.item_name }}
                    </span>
                    <span v-if="group.items.length > 3" class="text-[10px] text-gray-400">...</span>
                  </div>
                </div>
              </td>
              <td class="px-4 py-3">
                <p style="color: var(--color-text-primary)">{{ userLabel(group.createdBy) }}</p>
              </td>
              <td class="px-4 py-3" style="color: var(--color-text-muted)">
                {{ formatDateTime(group.createdAt) }}
              </td>
              <td class="px-4 py-3">
                <span class="px-2 py-0.5 rounded-full dark:bg-transparent dark:border-transparent text-[11px] border" :class="getStatusClass(group.items[0].status)">
                  {{ getStatusText(group.items[0].status) }}
                </span>
              </td>
              <td class="px-4 py-3 text-center">
                <button v-if="group.items.some(canWithdrawScan)" @click="openGroupModal(group)" class="px-3 py-1 rounded bg-emerald-50 dark:bg-emerald-700/30 dark:border-emerald-700/30 dark:text-emerald-500 text-emerald-700 border border-emerald-200 text-[11px] font-medium hover:bg-emerald-100 transition-colors">
                  <i class="fa-solid fa-check-double mr-1"></i>อนุมัติคำขอ
                </button>
                <span v-else class="text-[11px]" style="color: var(--color-text-muted)">ดำเนินการแล้ว</span>
              </td>
            </tr>
            <tr v-if="loading">
              <td colspan="6" class="px-4 py-8 text-center" style="color: var(--color-text-muted)">กำลังโหลดข้อมูล...</td>
            </tr>
            <tr v-else-if="groupedOrders.length === 0">
              <td colspan="6" class="px-4 py-8 text-center" style="color: var(--color-text-muted)">ไม่พบข้อมูลคำขอเบิก</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- ====== SCAN MODAL ====== -->
    <Transition name="slide-right">
      <div v-if="isScanModalOpen" class="fixed inset-0 z-50 flex justify-end">
        <div class="absolute inset-0 bg-black/30 backdrop-blur-sm" @click="isScanModalOpen = false"></div>
        <div class="relative w-full max-w-2xl h-full shadow-2xl flex flex-col" style="background: var(--color-bg-card)">

          <!-- header -->
          <div class="px-6 py-4 border-b flex items-center justify-between" style="border-color: var(--color-border)">
            <div>
              <div class="flex items-center gap-2">
                <i class="fa-solid fa-barcode text-[16px]" style="color: var(--color-text-muted)"></i>
                <h2 class="text-[16px] font-semibold" style="color: var(--color-text-primary)">ใบเบิกพัสดุ</h2>
                <span v-if="scanResult" class="px-2 py-0.5 rounded-full text-[11px] bg-blue-50 text-blue-700 dark:bg-blue-800/20 dark:border-blue-800/20 dark:text-blue-500 border border-blue-100">
                  Request #{{ scanResult.requestId }}
                </span>
              </div>
              <p v-if="scanResult && !scanResult.notFound" class="text-[12px] mt-0.5" style="color: var(--color-text-muted)">
                {{ scanResult.items.length }} รายการ
              </p>
            </div>
            <button @click="isScanModalOpen = false" class="p-2 hover:bg-gray-100 rounded-lg transition-colors">
              <i class="fa-solid fa-xmark" style="color: var(--color-text-muted)"></i>
            </button>
          </div>

          <!-- body -->
          <div class="flex-1 overflow-y-auto p-6">

            <!-- loading -->
            <div v-if="scanLoading" class="flex items-center justify-center py-16">
              <div class="flex flex-col items-center gap-3">
                <div class="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                <p class="text-[13px]" style="color: var(--color-text-muted)">กำลังค้นหา...</p>
              </div>
            </div>

            <!-- not found -->
            <div v-else-if="scanResult?.notFound" class="flex flex-col items-center justify-center py-16 gap-3">
              <i class="fa-solid fa-circle-xmark text-[40px] text-red-400"></i>
              <p class="text-[14px] font-medium" style="color: var(--color-text-primary)">ไม่พบใบเบิกเลขที่ {{ scanResult.requestId }}</p>
              <p class="text-[13px]" style="color: var(--color-text-muted)">กรุณาตรวจสอบบาร์โค้ดและลองใหม่อีกครั้ง</p>
            </div>

            <!-- items list -->
            <div v-else-if="scanResult" class="space-y-4">
              <!-- Shared Info Section (Signature) -->
              <div class="p-4 rounded-xl border bg-blue-50/50 dark:bg-blue-900/10 border-blue-100 dark:border-blue-900/30 space-y-3">
                <div class="flex items-center gap-2 mb-1">
                  <i class="fa-solid fa-signature text-blue-600"></i>
                  <span class="text-[13px] font-bold text-blue-700 dark:text-blue-400">ข้อมูลผู้รับและผู้ตรวจรับ (ใช้ร่วมกันทุกรายการ)</span>
                </div>
                <div class="grid grid-cols-2 gap-3">
                  <div class="space-y-1 relative">
                    <label class="text-[11px] font-medium" style="color: var(--color-text-muted)">ผู้รับของ (ค้นหาชื่อ/รหัส)</label>
                    <input 
                      v-model="sharedReceiveBy" 
                      @input="activeSearchField = 'receive_by'; searchEmployees($event.target.value)"
                      type="text" 
                      class="w-full px-2 py-1.5 border rounded-lg text-[12px] focus:outline-none bg-white dark:bg-slate-900" 
                      style="border-color: var(--color-border)" 
                      placeholder="พิมพ์เพื่อค้นหา..."
                    />
                    <!-- Search Results Dropdown -->
                    <div v-if="activeSearchField === 'receive_by' && employeeResults.length > 0" class="absolute left-0 right-0 top-full mt-1 bg-white dark:bg-slate-800 border rounded-lg shadow-xl z-30 max-h-48 overflow-y-auto">
                      <button 
                        v-for="emp in employeeResults" :key="emp.employee_code"
                        @click="selectEmployee(emp, 'receive_by')"
                        class="w-full text-left px-3 py-2 text-[12px] hover:bg-blue-50 dark:hover:bg-slate-700 border-b last:border-0"
                      >
                        <span class="font-medium">{{ emp.fullname }}</span>
                        <span class="text-[10px] text-gray-500 ml-2">({{ emp.employee_code }})</span>
                      </button>
                    </div>
                  </div>
                  <div class="space-y-1 relative">
                    <label class="text-[11px] font-medium" style="color: var(--color-text-muted)">ผู้ตรวจรับ (ค้นหาชื่อ/รหัส)</label>
                    <input 
                      v-model="sharedInspectorBy" 
                      @input="activeSearchField = 'inspector_by'; searchEmployees($event.target.value)"
                      type="text" 
                      class="w-full px-2 py-1.5 border rounded-lg text-[12px] focus:outline-none bg-white dark:bg-slate-900" 
                      style="border-color: var(--color-border)" 
                      placeholder="พิมพ์เพื่อค้นหา..."
                    />
                    <!-- Search Results Dropdown -->
                    <div v-if="activeSearchField === 'inspector_by' && employeeResults.length > 0" class="absolute left-0 right-0 top-full mt-1 bg-white dark:bg-slate-800 border rounded-lg shadow-xl z-30 max-h-48 overflow-y-auto">
                      <button 
                        v-for="emp in employeeResults" :key="emp.employee_code"
                        @click="selectEmployee(emp, 'inspector_by')"
                        class="w-full text-left px-3 py-2 text-[12px] hover:bg-blue-50 dark:hover:bg-slate-700 border-b last:border-0"
                      >
                        <span class="font-medium">{{ emp.fullname }}</span>
                        <span class="text-[10px] text-gray-500 ml-2">({{ emp.employee_code }})</span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <div
                v-for="order in scanResult.items"
                :key="order.id"
                class="rounded-xl border overflow-hidden"
                :style="canWithdrawScan(order) ? 'border-color: var(--color-border)' : 'border-color: var(--color-border); opacity: 0.6'"
                style="background: var(--color-bg-body)"
              >
                <!-- item header -->
                <div class="px-4 py-3 flex items-center justify-between border-b" style="border-color: var(--color-border); background: var(--color-bg-card)">
                  <div>
                    <p class="font-medium text-[13px]" style="color: var(--color-text-primary)">{{ order.items?.item_name || '-' }}</p>
                    <p class="text-[11px]" style="color: var(--color-text-muted)">{{ order.items?.item_code || '-' }} · {{ order.category?.category_name || '-' }}</p>
                  </div>
                  <div class="flex items-center gap-2">
                    <span class="text-[11px]" :class="(order.items?.current_stock ?? 0) < order.amount ? 'text-red-500 dark:text-red-300' : 'text-emerald-600 dark:text-emerald-400'">
                      คงเหลือ {{ order.items?.current_stock ?? 0 }}
                    </span>
                    <span class="px-2 py-0.5 rounded-full text-[11px] border" :class="getStatusClass(order.status)">
                      {{ getStatusText(order.status) }}
                    </span>
                  </div>
                </div>

                <!-- item form (เฉพาะรายการที่ยังทำได้) -->
                <div v-if="canWithdrawScan(order) && scanItemForms[order.id]" class="p-4 space-y-3">
                  <div class="grid grid-cols-3 gap-3">
                    <div class="space-y-1">
                      <label class="text-[11px] font-medium" style="color: var(--color-text-muted)">จำนวนที่ขอ</label>
                      <input :value="scanItemForms[order.id].max_amount" disabled type="number" class="w-full px-2 py-1.5 border rounded-lg text-[12px] bg-gray-50 dark:bg-gray-700" style="border-color: var(--color-border)" />
                    </div>
                    <div class="space-y-1">
                      <label class="text-[11px] font-medium" style="color: var(--color-text-muted)">จำนวนที่เบิกจริง</label>
                      <input v-model.number="scanItemForms[order.id].amount" type="number" min="1" class="w-full px-2 py-1.5 border rounded-lg text-[12px] focus:outline-none" style="border-color: var(--color-border); background: var(--color-bg-body)" />
                    </div>
                    <div class="space-y-1">
                      <label class="text-[11px] font-medium" style="color: var(--color-text-muted)">หน่วย</label>
                      <input v-model="scanItemForms[order.id].unit" readonly type="text" class="w-full px-2 py-1.5 border rounded-lg text-[12px] bg-gray-50 dark:bg-gray-800/50" style="border-color: var(--color-border)" />
                    </div>
                  </div>

                  <div class="grid grid-cols-2 gap-3">
                    <div class="space-y-1">
                      <label class="text-[11px] font-medium" style="color: var(--color-text-muted)">สถานะ</label>
                      <select v-model="scanItemForms[order.id].status" class="w-full px-2 py-1.5 border rounded-lg text-[12px] focus:outline-none" style="border-color: var(--color-border); background: var(--color-bg-body)">
                        <option value="approved">อนุมัติ</option>
                        <option value="completed">เบิกแล้ว</option>
                        <option value="rejected">ไม่อนุมัติ</option>
                      </select>
                    </div>
                    <div class="space-y-1">
                      <label class="text-[11px] font-medium" style="color: var(--color-text-muted)">กำหนดส่งคืน</label>
                      <input v-model="scanItemForms[order.id].return_date" type="date" class="w-full px-2 py-1.5 border rounded-lg text-[12px] focus:outline-none" style="border-color: var(--color-border); background: var(--color-bg-body)" />
                    </div>
                  </div>

                  <div class="grid grid-cols-2 gap-3">
                    <div class="space-y-1">
                      <label class="text-[11px] font-medium" style="color: var(--color-text-muted)">เลข MR</label>
                      <input v-model="scanItemForms[order.id].mr_number" readonly type="text" class="w-full px-2 py-1.5 border rounded-lg text-[12px] bg-gray-50 dark:bg-gray-800/50" style="border-color: var(--color-border)" />
                    </div>
                    <div class="space-y-1">
                      <label class="text-[11px] font-medium" style="color: var(--color-text-muted)">บริษัท/แผนก</label>
                      <input v-model="scanItemForms[order.id].company" readonly type="text" class="w-full px-2 py-1.5 border rounded-lg text-[12px] bg-gray-50 dark:bg-gray-800/50" style="border-color: var(--color-border)" />
                    </div>
                  </div>

                  <div class="grid grid-cols-2 gap-3">
                    <div class="space-y-1">
                      <label class="text-[11px] font-medium" style="color: var(--color-text-muted)">เลขที่ใบเสร็จ</label>
                      <input v-model="scanItemForms[order.id].fixed_bill_number" readonly type="text" class="w-full px-2 py-1.5 border rounded-lg text-[12px] bg-gray-50 dark:bg-gray-800/50" style="border-color: var(--color-border)" />
                    </div>
                    <div class="space-y-1">
                      <label class="text-[11px] font-medium" style="color: var(--color-text-muted)">วัตถุประสงค์การเบิก</label>
                      <input v-model="scanItemForms[order.id].withdraw_purpose" readonly type="text" class="w-full px-2 py-1.5 border rounded-lg text-[12px] bg-gray-50 dark:bg-gray-800/50" style="border-color: var(--color-border)" />
                    </div>
                  </div>

                  <div class="grid grid-cols-2 gap-3">
                    <div class="space-y-1">
                      <label class="text-[11px] font-medium" style="color: var(--color-text-muted)">เลขมิเตอร์ชั่วโมง</label>
                      <input v-model="scanItemForms[order.id].metter_hour" readonly type="text" class="w-full px-2 py-1.5 border rounded-lg text-[12px] bg-gray-50 dark:bg-gray-800/50" style="border-color: var(--color-border)" />
                    </div>
                    <div class="space-y-1">
                      <label class="text-[11px] font-medium" style="color: var(--color-text-muted)">เลขไมล์/กิโลเมตร</label>
                      <input v-model="scanItemForms[order.id].metter_kilometter" readonly type="text" class="w-full px-2 py-1.5 border rounded-lg text-[12px] bg-gray-50 dark:bg-gray-800/50" style="border-color: var(--color-border)" />
                    </div>
                  </div>

                  <div class="space-y-1">
                    <label class="text-[11px] font-medium" style="color: var(--color-text-muted)">เหตุผลการเบิก / หมายเหตุ</label>
                    <textarea v-model="scanItemForms[order.id].note" readonly rows="2" class="w-full px-2 py-1.5 border rounded-lg text-[12px] bg-gray-50 dark:bg-gray-800/50" style="border-color: var(--color-border)" placeholder="ระบุเหตุผลการเบิก..."></textarea>
                  </div>
                </div>

                <!-- done badge -->
                <div v-else class="px-4 py-3 text-[12px]" style="color: var(--color-text-muted)">
                  รายการนี้ดำเนินการเสร็จสิ้นแล้ว
                </div>
              </div>
            </div>
          </div>

          <!-- footer -->
          <div v-if="scanResult && !scanResult.notFound && !scanLoading" class="p-6 border-t flex gap-3" style="border-color: var(--color-border)">
            <button @click="isScanModalOpen = false" class="flex-1 py-2 rounded-lg text-[14px] font-medium border hover:bg-gray-50 transition-all" style="border-color: var(--color-border); color: var(--color-text-secondary)">
              ยกเลิก
            </button>
            <button
              @click="submitScanWithdraw"
              :disabled="saving || !scanResult.items.some(canWithdrawScan)"
              class="flex-1 py-2 rounded-lg text-[14px] font-medium text-slate-800 dark:text-white transition-all hover:opacity-90 disabled:opacity-50"
              style="background: var(--color-primary)"
            >
              {{ saving ? 'กำลังบันทึก...' : `ดำเนินการ (${scanResult.items.filter(canWithdrawScan).length} รายการ)` }}
            </button>
          </div>
          <div v-else-if="scanResult?.notFound" class="p-6 border-t" style="border-color: var(--color-border)">
            <button @click="isScanModalOpen = false" class="w-full py-2 rounded-lg text-[14px] font-medium border hover:bg-gray-50 transition-all" style="border-color: var(--color-border); color: var(--color-text-secondary)">
              ปิด
            </button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- withdraw modal เดิม (ไม่เปลี่ยน) -->
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
            <button @click="isWithdrawModalOpen = false" class="flex-1 py-2 rounded-lg text-[14px] font-medium border hover:bg-gray-50 transition-all" style="border-color: var(--color-border); color: var(--color-text-secondary)">ยกเลิก</button>
            <button @click="submitWithdraw" :disabled="saving" class="flex-1 py-2 rounded-lg text-[14px] font-medium text-slate-800 dark:text-white transition-all hover:opacity-90 disabled:opacity-50" style="background: var(--color-primary)">
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
