<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import AppLayout from '@/components/layout/AppLayout.vue'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'
import { supabase, supabaseEmployee } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'
import { useUiStore } from '@/stores/ui'
import logoThaiDrill from '@/assets/thaidrill_company.png'
import logoThaiDrillLao from '@/assets/thaidrillLao_company.png'
import logoTDL_MVDC from '@/assets/tdl&mvdc_company.jpg'
import logoSunny from '@/assets/sunnycompany.png'

const auth = useAuthStore()
const ui = useUiStore()
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
const isBillPreviewOpen = ref(false)
const billPreviewResult = ref(null)
const isApproveBillConfirmOpen = ref(false)
const companyOptions = ['รถเจาะไทย', 'ซั่นนี่ เฟอติไลเซอร์', 'ปู่รากหญ้า', 'ที่ดี พึกษ์', 'ที่ดี คอนแทรคเตอร์', 'ไทดริว ลาว', 'อื่นๆ แมชชีน']
const purposeOptions = [
  { key: 'broken', label: 'ขาดไม่ได้ระดับ' },
  { key: 'pm', label: 'ทำ PM วาระ' },
  { key: 'rust', label: 'มีอาการรั่วซึม' },
  { key: 'colorFade', label: 'สึกหรอตามอายุการใช้งาน' },
  { key: 'colorMismatch', label: 'เชื่อมพอกกันสึกหรอ' },
  { key: 'cracked', label: 'มีการแตกร้าว' },
  { key: 'reserve', label: 'เป็นอะไหล่สำรอง' },
  { key: 'damageLoss', label: 'อาไหล่สูญหาย' },
  { key: 'fromAccident', label: 'จากอุบัติเหตุ' },
  { key: 'changeOther', label: 'แก้ไข/ดัดแปลง' },
  { key: 'preventAccident', label: 'ป้องกันเกิดอุบัติเหตุ' },
  { key: 'clean', label: 'ทำความสะอาด' },
  { key: 'officeTool', label: 'อุปกรณ์สำนักงาน' },
  { key: 'other1', label: 'อื่นๆ' },
  { key: 'other2', label: 'อื่นๆ' }
]

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
    if (row.status !== 'pending') return false
    if (!key) return true
    const itemCode = row.items?.item_code?.toLowerCase() || ''
    const itemName = row.items?.item_name?.toLowerCase() || ''
    const note = row.note?.toLowerCase() || ''
    const remark = row.remark?.toLowerCase() || ''
    return itemCode.includes(key) || itemName.includes(key) || note.includes(key) || remark.includes(key)
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
  isBillPreviewOpen.value = true
  scanResult.value = null
  billPreviewResult.value = { requestId, items: [] }
  let shouldRenderBarcode = false

  try {
    const { data, error } = await supabase
      .from('order_req')
      .select('*, items(item_code, item_name, current_stock), category(category_name)')
      .eq('request_id', requestId)
      .order('created_at', { ascending: true })

    if (error) throw error

    if (!data || data.length === 0) {
      scanResult.value = { requestId, items: [], notFound: true }
      billPreviewResult.value = { requestId, items: [] }
    } else {
      scanResult.value = { requestId, items: data, notFound: false }
      billPreviewResult.value = { requestId, items: data }
      shouldRenderBarcode = true
    }
  } catch (err) {
    alert('เกิดข้อผิดพลาดในการค้นหา: ' + err.message)
    closeBillPreview()
  } finally {
    scanLoading.value = false
    if (shouldRenderBarcode && isBillPreviewOpen.value) {
      await nextTick()
      await renderBillPreviewBarcode(requestId)
    }
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
    const tx = getTransactionByOrderId(order.id)
    // ดึงชื่อผู้ขอจาก systemUsers
    const creator = systemUsers.value.find(u => u.id === order.created_by)
    const creatorName = creator ? creator.fullname : ''
    const persistedReturn = order.is_return
    const isEditable = order.status === 'pending' || order.status === 'approved'
    const persistedReturnSelected = persistedReturn === true || persistedReturn === false
    const persistedReturnDate = tx?.return_date ? tx.return_date.split('T')[0] : ''
    const derivedIsReturnFromDate = persistedReturnDate ? true : null

    const initialIsReturn = persistedReturnSelected
      ? persistedReturn
      : derivedIsReturnFromDate

    const returnSelected = persistedReturnSelected || Boolean(persistedReturnDate)

    forms[order.id] = {
      amount: Number(tx?.amount ?? order.amount ?? 1),
      max_amount: Number(order.amount || 1),
      unit: tx?.unit || order.unit || '',
      remark: order.remark || '',
      return_date: persistedReturnDate,
      is_return: initialIsReturn,
      return_choice_locked: isEditable ? returnSelected : true,
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
async function openBillPreview(group) {
  scanResult.value = {
    requestId: group.requestId,
    items: group.items,
    notFound: false
  }
  billPreviewResult.value = {
    requestId: group.requestId,
    items: group.items
  }
  isBillPreviewOpen.value = true
  await nextTick()
  await renderBillPreviewBarcode(group.requestId)
}

function closeBillPreview() {
  isBillPreviewOpen.value = false
  billPreviewResult.value = null
}

function setReturnMode(orderId, shouldReturn) {
  const form = scanItemForms.value[orderId]
  if (!form) return
  form.is_return = shouldReturn
  if (!shouldReturn) {
    form.return_date = ''
  }
}

const isReturnDateModalOpen = ref(false)
const returnDateOrderId = ref(null)
const returnDateDraft = ref('')
const returnDateReadOnly = ref(false)
const returnDateModalTitle = computed(() => (returnDateReadOnly.value ? 'ดูวันที่ส่งคืน' : 'กำหนดวันที่ส่งคืน'))

function isReturnChoiceLocked(orderId) {
  return scanItemForms.value[orderId]?.return_choice_locked === true
}

function closeReturnDateModal() {
  isReturnDateModalOpen.value = false
  returnDateOrderId.value = null
  returnDateDraft.value = ''
  returnDateReadOnly.value = false
}

function openReturnDateModal(orderId, opts = {}) {
  const form = scanItemForms.value[orderId]
  if (!form) return
  returnDateOrderId.value = orderId
  returnDateDraft.value = form.return_date || new Date().toISOString().slice(0, 10)
  returnDateReadOnly.value = opts.readOnly === true
  isReturnDateModalOpen.value = true
}

function confirmReturnDate() {
  if (returnDateReadOnly.value) {
    closeReturnDateModal()
    return
  }
  const orderId = returnDateOrderId.value
  const form = scanItemForms.value[orderId]
  if (!form) {
    closeReturnDateModal()
    return
  }
  form.is_return = true
  form.return_date = returnDateDraft.value || null
  form.return_choice_locked = true
  closeReturnDateModal()
}

function onReturnClick(order) {
  const form = scanItemForms.value[order.id]
  if (!form) return
  if (!canWithdrawScan(order)) return
  if (form.return_choice_locked) {
    if (form.is_return !== true) return
    openReturnDateModal(order.id, { readOnly: true })
    return
  }
  openReturnDateModal(order.id, { readOnly: false })
}

function onNotReturnClick(order) {
  const form = scanItemForms.value[order.id]
  if (!form) return
  if (!canWithdrawScan(order)) return
  if (form.return_choice_locked) return
  form.is_return = false
  form.return_date = ''
  form.return_choice_locked = true
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

const isBillPreviewCompleted = computed(() => {
  const items = billPreviewResult.value?.items || []
  return items.length > 0 && items.every((row) => row.status === 'completed')
})

const approveConfirmMessage = computed(() => {
  const items = billPreviewResult.value?.items || []
  const count = items.filter((row) => row.status === 'pending' || row.status === 'approved').length
  return count > 0 ? `ยืนยันการอนุมัติใบเบิกนี้ (${count} รายการ)?` : 'ยืนยันการอนุมัติใบเบิกนี้?'
})

function openApproveBillConfirm() {
  isApproveBillConfirmOpen.value = true
}

function closeApproveBillConfirm() {
  isApproveBillConfirmOpen.value = false
}

async function confirmApproveBill() {
  isApproveBillConfirmOpen.value = false
  await submitBillPreviewWithdraw()
}

async function submitScanWithdraw() {
  return submitGroupWithdraw({ closeScanModal: true, closeBillPreviewModal: false })
}

async function submitBillPreviewWithdraw() {
  return submitGroupWithdraw({ closeScanModal: false, closeBillPreviewModal: true })
}

async function submitGroupWithdraw({ closeScanModal, closeBillPreviewModal }) {
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
          return_date: form.is_return ? form.return_date || null : null,
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
          is_return: form.is_return,
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

    if (closeScanModal) {
      isScanModalOpen.value = false
    }
    if (closeBillPreviewModal) {
      closeBillPreview()
    }
    await fetchData()
    ui.showToast(`บันทึกสำเร็จ ${withdrawableItems.length} รายการ`, 'success')
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
      supabase.from('transactions').select('order_id, amount, unit, return_date, created_at').order('created_at', { ascending: false })
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

function formatDateOnly(value) {
  if (!value) return '-'
  return new Date(value).toLocaleDateString('th-TH')
}

function getReturnDate(orderId) {
  const tx = transactions.value.find((row) => row.order_id === orderId && row.return_date)
  if (!tx?.return_date) return '-'
  return new Date(tx.return_date).toLocaleDateString('th-TH')
}

function getTransactionByOrderId(orderId) {
  return transactions.value.find((row) => row.order_id === orderId) || null
}

function getWithdrawAmount(order) {
  const tx = getTransactionByOrderId(order.id)
  return tx?.amount ?? order.amount ?? '-'
}

function getWithdrawUnit(order) {
  const tx = getTransactionByOrderId(order.id)
  return tx?.unit || order.unit || '-'
}

function getMachineNumber(note) {
  return note?.split('\nสาเหตุทดแทน: ')[0]?.replace('หมายเลขเครื่องจักร: ', '') || '-'
}

function getReplaceReason(note) {
  return note?.split('\nสาเหตุทดแทน: ')[1] || '-'
}

function isPurposeChecked(value, label) {
  if (!value) return false
  return value
    .split(',')
    .map((part) => part.trim())
    .some((part) => part.startsWith(label))
}

function getPurposeDetail(value, label) {
  if (!value) return ''
  const entry = value
    .split(',')
    .map((part) => part.trim())
    .find((part) => part.startsWith(label))
  if (!entry) return ''
  return entry.slice(label.length).trim()
}

function getBillPreviewTotalAmount() {
  return (billPreviewResult.value?.items || []).reduce((sum, order) => sum + Number(getWithdrawAmount(order) || 0), 0)
}

function loadJsBarcode() {
  return new Promise((resolve, reject) => {
    if (window.JsBarcode) {
      resolve(window.JsBarcode)
      return
    }
    const s = document.createElement('script')
    s.src = 'https://cdn.jsdelivr.net/npm/jsbarcode@3.11.5/dist/JsBarcode.all.min.js'
    s.onload = () => resolve(window.JsBarcode)
    s.onerror = reject
    document.head.appendChild(s)
  })
}

async function renderBillPreviewBarcode(requestId) {
  if (!requestId) return
  try {
    const barcodeLib = await loadJsBarcode()
    const barcodeElement = document.querySelector('#barcode-bill-preview')
    if (!barcodeElement) return
    barcodeLib('#barcode-bill-preview', String(requestId), {
      format: 'CODE128',
      width: 1.2,
      height: 35,
      displayValue: true,
      fontSize: 10,
      margin: 0
    })
  } catch (err) {
    console.error('Failed to load JsBarcode:', err)
  }
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
    </div>

    <!-- search bar -->
    <div class="flex flex-col md:flex-row gap-4 mb-6 p-4 rounded-xl border" style="background: var(--color-bg-card); border-color: var(--color-border)">
      <div class="flex-1 relative">
        <i class="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-[14px]" style="color: var(--color-text-muted)"></i>
        <input v-model="searchText" type="text" placeholder="ค้นหารหัส, ชื่อสินค้า, หมายเหตุ..." class="w-full pl-9 pr-4 py-2 bg-transparent border rounded-lg text-[13px] focus:outline-none focus:ring-1 transition-all" style="border-color: var(--color-border); color: var(--color-text-primary)" />
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
                <div class="flex flex-wrap items-center justify-center gap-2">
                  <button @click="openBillPreview(group)" class="inline-flex items-center gap-1.5 px-3 py-1 rounded bg-blue-50 dark:bg-blue-700/20 dark:border-blue-700/30 dark:text-blue-400 text-blue-700 border border-blue-200 text-[11px] font-medium hover:bg-blue-100 transition-colors">
                    <i class="fa-solid fa-file-lines text-[12px]"></i>
                    <span>เบิกใบบิน</span>
                  </button>
                </div>
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

    <!-- ====== BILL PREVIEW MODAL ====== -->
    <Transition name="slide-right">
      <div v-if="isBillPreviewOpen && billPreviewResult" class="fixed inset-0 z-50 flex justify-end">
        <div class="absolute inset-0 bg-black/30 backdrop-blur-sm" @click="closeBillPreview"></div>
        <div class="relative w-full max-w-[1040px] h-full shadow-2xl flex flex-col" style="background: var(--color-bg-card)">
          <div class="px-6 py-4 border-b flex items-center justify-between" style="border-color: var(--color-border)">
            <div>
              <div class="flex items-center gap-2">
                <i class="fa-solid fa-file-lines text-[16px]" style="color: var(--color-text-muted)"></i>
                <h2 class="text-[16px] font-semibold" style="color: var(--color-text-primary)">เบิกใบบิน</h2>
                <span class="px-2 py-0.5 rounded-full text-[11px] bg-blue-50 text-blue-700 dark:bg-blue-800/20 dark:border-blue-800/20 dark:text-blue-500 border border-blue-100">
                  Request #{{ billPreviewResult.requestId }}
                </span>
              </div>
              <p class="text-[12px] mt-0.5" style="color: var(--color-text-muted)">
                แสดงโครงร่างใบบินจากข้อมูลที่บันทึกไว้ {{ billPreviewResult.items.length }} รายการ
              </p>
            </div>
            <button @click="closeBillPreview" class="p-2 hover:bg-gray-100 rounded-lg transition-colors">
              <i class="fa-solid fa-xmark" style="color: var(--color-text-muted)"></i>
            </button>
          </div>

          <div class="flex-1 overflow-y-auto p-6">
            <div v-if="scanLoading" class="flex items-center justify-center py-16">
              <div class="flex flex-col items-center gap-3">
                <div class="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                <p class="text-[13px]" style="color: var(--color-text-muted)">กำลังค้นหา...</p>
              </div>
            </div>

            <div v-else-if="scanResult?.notFound" class="flex flex-col items-center justify-center py-16 gap-3">
              <i class="fa-solid fa-circle-xmark text-[40px] text-red-400"></i>
              <p class="text-[14px] font-medium" style="color: var(--color-text-primary)">ไม่พบใบเบิกเลขที่ {{ scanResult.requestId }}</p>
              <p class="text-[13px]" style="color: var(--color-text-muted)">กรุณาตรวจสอบบาร์โค้ดและลองใหม่อีกครั้ง</p>
            </div>

            <div v-else class="paper-scroll-wrap">
              <div
                class="paper-sheet text-gray-900 shadow-xl rounded-lg overflow-hidden font-['Niramit',sans-serif] text-[9px] relative"
                :class="isBillPreviewCompleted ? 'bg-blue-50/30 ring-4 ring-blue-500/25' : 'bg-white'"
                style="color: #111;"
              >
                <div v-if="isBillPreviewCompleted" class="absolute inset-0 pointer-events-none flex items-center justify-center">
                  <div class="rotate-[-12deg] border-[6px] border-blue-600/25 bg-blue-600/5 px-10 py-6">
                    <div class="text-[78px] font-extrabold tracking-widest text-blue-700/15 leading-none whitespace-nowrap">เบิกแล้ว</div>
                  </div>
                </div>

                <div class="p-6 pb-4 pt-4 relative">
                  <div class="relative flex items-stretch gap-3 mb-0">
                    <div class="flex-1 min-w-0 flex flex-col z-10">
                      <div class="flex items-center gap-3">
                        <div class="w-[55px] h-[36px] overflow-hidden flex items-center justify-center bg-white">
                          <img :src="logoThaiDrill" alt="ThaiDrill" class="max-w-full max-h-full object-contain" />
                        </div>
                        <div class="w-[69px] h-[59px] overflow-hidden flex items-center justify-center bg-white">
                          <img :src="logoThaiDrillLao" alt="ThaiDrill Lao" class="max-w-full max-h-full object-contain" />
                        </div>
                        <div class="w-[60px] h-[32px] overflow-hidden flex items-center justify-center bg-white p-0.5">
                          <img :src="logoTDL_MVDC" alt="TDLAO & MVDC" class="max-w-full max-h-full object-contain" />
                        </div>
                        <div class="w-[45px] h-[45px] overflow-hidden flex items-center justify-center bg-white p-0.5">
                          <img :src="logoSunny" alt="SUNNY" class="max-w-full max-h-full object-contain" />
                        </div>
                      </div>

                      <div class="mt-0.3 space-y-1">
                        <div class="flex items-center gap-2">
                          <span class="font-semibold whitespace-nowrap text-[9px]">เลขที่ MR</span>
                          <input :value="billPreviewResult.items[0]?.mr_number || '-'" readonly class="flex-1 max-w-[189px] border-b border-gray-400 outline-none text-[9px] px-1 bg-transparent" />
                        </div>
                        <div class="flex items-center gap-2">
                          <span class="font-semibold whitespace-nowrap text-[9px]">วันที่</span>
                          <input :value="formatDateOnly(billPreviewResult.items[0]?.created_at)" readonly class="border-b border-gray-400 outline-none text-[9px] px-1 w-52 bg-transparent" />
                        </div>
                      </div>

                      <div class="flex items-center gap-5 mt-auto pt-0.3 text-[9px]">
                        <label class="flex items-center gap-1.5">
                          <input type="checkbox" disabled class="w-3 h-3 accent-gray-700" />
                          เบิกเพื่อขาย
                        </label>
                        <label class="flex items-center gap-1.5">
                          <input type="checkbox" disabled class="w-3 h-3 accent-gray-700" />
                          เบิกใหม่
                        </label>
                        <div class="flex items-end gap-1.5">
                          <span class="whitespace-nowrap">ทดแทนของเก่า : สาเหตุ</span>
                          <input :value="getReplaceReason(billPreviewResult.items[0]?.note)" readonly class="border-b border-gray-400 outline-none text-[9px] px-1 flex-1 min-w-[276px] bg-transparent" />
                        </div>
                      </div>
                    </div>

                    <div class="absolute inset-0 flex items-center justify-center pointer-events-none">
                      <h1 class="text-[18px] font-bold tracking-wide" style="color: #111;">ใบเบิกพัสดุ</h1>
                    </div>

                    <div class="shrink-0 z-10">
                      <div class="text-[9px] text-gray-500 mb-0.2 text-right">FM-MT-ST01-02 REV 03 - 09/04/2669</div>
                      <div class="border border-gray-400 p-0.5 text-[9px] min-w-[150px]">
                        <div v-for="(label, idx) in companyOptions" :key="idx" class="flex items-center gap-1.5 leading-[1.2]">
                          <input type="radio" disabled :checked="billPreviewResult.items[0]?.company === label" class="w-2 h-2 accent-gray-700" />
                          <span>{{ label }}</span>
                        </div>
                        <div class="flex items-center gap-1 mt-0.2 pt-0.3 border-t border-gray-300">
                          <span class="text-[10px]">CONST CENTER</span>
                          <div class="flex gap-1 ml-1">
                            <div v-for="i in 5" :key="i" class="w-3 h-3 border border-gray-400 text-center text-[9px]">-</div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div class="flex flex-wrap items-center gap-x-4 gap-y-1 mb-1 mt-2 text-[9px]">
                    <div class="flex items-center gap-1">
                      <span class="font-semibold">รหัสใบสั่งช่อม</span>
                      <input :value="billPreviewResult.items[0]?.fixed_bill_number || '-'" readonly class="border-b border-gray-400 outline-none w-28 bg-transparent" />
                    </div>
                    <div class="flex items-center gap-1">
                      <span>หมายเลขเครื่องจักร</span>
                      <input :value="getMachineNumber(billPreviewResult.items[0]?.note)" readonly class="border-b border-gray-400 outline-none w-28 bg-transparent" />
                    </div>
                    <div class="flex items-center gap-1">
                      <span>มิเตอร์ (ชม.)</span>
                      <input :value="billPreviewResult.items[0]?.metter_hour || '-'" readonly class="border-b border-gray-400 outline-none px-1 w-20 bg-transparent" />
                    </div>
                    <div class="flex items-center gap-1">
                      <span>มิเตอร์ (กม.)</span>
                      <input :value="billPreviewResult.items[0]?.metter_kilometter || '-'" readonly class="border-b border-gray-400 outline-none px-1 w-20 bg-transparent" />
                    </div>
                  </div>

                  <div class="border border-gray-300 rounded p-0.5 mb-0.8">
                    <div class="font-semibold mb-1 text-[9px]">จุดประสงค์การเบิก</div>
                    <div class="grid grid-cols-5 gap-x-4 gap-y-1 text-[9px]">
                      <div v-for="col in 5" :key="col" class="space-y-1">
                        <div v-for="opt in purposeOptions.slice((col - 1) * 3, col * 3)" :key="opt.key" class="flex items-end gap-1.5 min-h-[18px]">
                          <input type="checkbox" disabled :checked="isPurposeChecked(billPreviewResult.items[0]?.withdraw_purpose, opt.label)" class="w-3 h-3 accent-gray-700 shrink-0" />
                          <span class="whitespace-nowrap pb-0.5">{{ opt.label }}</span>
                          <div v-if="opt.key === 'pm' || opt.key.startsWith('other')" class="border-b border-gray-300 flex-1 min-w-[20px] px-1 pb-0.5 h-[16px]">
                            {{ getPurposeDetail(billPreviewResult.items[0]?.withdraw_purpose, opt.label) }}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div v-if="!isBillPreviewCompleted" class="mb-3 rounded-lg border border-blue-200 bg-blue-50/60 p-3">
                    <div class="grid grid-cols-2 gap-3">
                      <div class="space-y-1 relative">
                        <label class="text-[11px] font-medium text-blue-700">ผู้รับของ (ค้นหาชื่อ/รหัส)</label>
                        <input
                          v-model="sharedReceiveBy"
                          @input="activeSearchField = 'receive_by'; searchEmployees($event.target.value)"
                          type="text"
                          class="w-full px-2 py-1.5 border rounded-lg text-[12px] focus:outline-none bg-white"
                          style="border-color: var(--color-border)"
                          placeholder="พิมพ์เพื่อค้นหา..."
                        />
                        <div v-if="activeSearchField === 'receive_by' && employeeResults.length > 0" class="absolute left-0 right-0 top-full mt-1 bg-white border rounded-lg shadow-xl z-30 max-h-48 overflow-y-auto">
                          <button
                            v-for="emp in employeeResults" :key="emp.employee_code"
                            @click="selectEmployee(emp, 'receive_by')"
                            class="w-full text-left px-3 py-2 text-[12px] hover:bg-blue-50 border-b last:border-0"
                          >
                            <span class="font-medium">{{ emp.fullname }}</span>
                            <span class="text-[10px] text-gray-500 ml-2">({{ emp.employee_code }})</span>
                          </button>
                        </div>
                      </div>
                      <div class="space-y-1 relative">
                        <label class="text-[11px] font-medium text-blue-700">ผู้ตรวจรับ (ค้นหาชื่อ/รหัส)</label>
                        <input
                          v-model="sharedInspectorBy"
                          @input="activeSearchField = 'inspector_by'; searchEmployees($event.target.value)"
                          type="text"
                          class="w-full px-2 py-1.5 border rounded-lg text-[12px] focus:outline-none bg-white"
                          style="border-color: var(--color-border)"
                          placeholder="พิมพ์เพื่อค้นหา..."
                        />
                        <div v-if="activeSearchField === 'inspector_by' && employeeResults.length > 0" class="absolute left-0 right-0 top-full mt-1 bg-white border rounded-lg shadow-xl z-30 max-h-48 overflow-y-auto">
                          <button
                            v-for="emp in employeeResults" :key="emp.employee_code"
                            @click="selectEmployee(emp, 'inspector_by')"
                            class="w-full text-left px-3 py-2 text-[12px] hover:bg-blue-50 border-b last:border-0"
                          >
                            <span class="font-medium">{{ emp.fullname }}</span>
                            <span class="text-[10px] text-gray-500 ml-2">({{ emp.employee_code }})</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>

                  <table class="w-full border-collapse text-[9px] mb-0.5">
                    <thead>
                      <tr>
                        <th rowspan="2" class="border border-gray-400 py-0.1 text-center text-[10px] w-5 bg-gray-300">ลำดับ</th>
                        <th rowspan="2" class="border border-gray-400 py-0.1 text-center text-[10px] w-21 bg-gray-300">รหัสสินค้า</th>
                        <th rowspan="2" class="border border-gray-400 py-0.1 text-center text-[10px] w-29 bg-gray-300">รายการ</th>
                        <th colspan="2" class="border border-gray-400 py-0.1 text-center text-[10px] w-26 bg-gray-300">จำนวน (เบิก)</th>
                        <th colspan="2" class="border border-gray-400 py-0.1 text-center text-[10px] w-28 bg-gray-300">จำนวนเงิน</th>
                        <th rowspan="2" class="border border-gray-400 py-0.1 text-center text-[10px] w-10 bg-gray-300">คืน</th>
                        <th rowspan="2" class="border border-gray-400 py-0.1 text-center text-[10px] w-10 bg-gray-300">ไม่คืน</th>
                        <th rowspan="2" class="border border-gray-400 py-0.1 text-center text-[10px] w-20 bg-gray-300">หมายเหตุ</th>
                      </tr>
                      <tr>
                        <th class="border border-gray-400 px-0.3 py-0.1 text-center text-[9px] w-12 bg-gray-300">จำนวน</th>
                        <th class="border border-gray-400 px-0.3 py-0.1 text-center text-[9px] w-12 bg-gray-300">หน่วย</th>
                        <th class="border border-gray-400 px-0.3 py-0.1 text-center text-[9px] w-12 bg-gray-300">ราคา / หน่วย</th>
                        <th class="border border-gray-400 px-0.3 py-0.1 text-center text-[9px] w-12 bg-gray-300">รวม</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="(order, idx) in billPreviewResult.items" :key="order.id" class="bg-blue-50/40">
                        <td class="border border-gray-400 px-1 py-1 text-center text-[9px]">{{ idx + 1 }}</td>
                        <td class="border border-gray-400 px-1 py-1 text-center font-mono text-[9px]">{{ order.items?.item_code || '-' }}</td>
                        <td class="border border-gray-400 px-1 py-1 text-center text-[9px]">{{ order.items?.item_name || '-' }}</td>
                        <td class="border border-gray-400 px-1 py-1 text-center font-bold text-blue-700 text-[9px]">
                          <span v-if="isBillPreviewCompleted">{{ getWithdrawAmount(order) }}</span>
                          <input
                            v-else-if="scanItemForms[order.id]"
                            v-model.number="scanItemForms[order.id].amount"
                            type="number"
                            min="1"
                            :max="scanItemForms[order.id].max_amount"
                            :disabled="!canWithdrawScan(order)"
                            class="w-full text-center bg-transparent outline-none p-0 m-0 border-none h-full focus:ring-0 hide-number-spinners"
                            style="line-height: 1;"
                          />
                          <span v-else>{{ getWithdrawAmount(order) }}</span>
        </td>
                        <td class="border border-gray-400 px-1 py-1 text-center text-[9px]">
                          <span v-if="isBillPreviewCompleted">{{ getWithdrawUnit(order) }}</span>
                          <input
                            v-else-if="scanItemForms[order.id]"
                            v-model="scanItemForms[order.id].unit"
                            type="text"
                            readonly
                            class="w-full text-center bg-transparent outline-none p-0 m-0 border-none h-full focus:ring-0"
                            style="line-height: 1;"
                          />
                          <span v-else>{{ getWithdrawUnit(order) }}</span>
                        </td>
                        <td class="border border-gray-400 px-1 py-1 text-center text-gray-400 text-[9px]">-</td>
                        <td class="border border-gray-400 px-1 py-1 text-center text-gray-400 text-[9px]">-</td>
                        <td class="border border-gray-400 px-1 py-1 text-center text-[9px]">
                          <input
                            v-if="isBillPreviewCompleted"
                            type="checkbox"
                            disabled
                            :checked="order.is_return === true"
                            class="w-3 h-3 accent-blue-600 m-0 align-middle"
                          />
                          <input
                            v-else
                            type="checkbox"
                            :checked="scanItemForms[order.id]?.is_return === true"
                            @click.prevent="onReturnClick(order)"
                            class="w-3 h-3 accent-blue-600 m-0 align-middle"
                          />
                          <div v-if="scanItemForms[order.id]?.is_return === true && scanItemForms[order.id]?.return_date" class="text-[8px] leading-none mt-0.5 whitespace-nowrap">
                            {{ formatDateOnly(scanItemForms[order.id].return_date) }}
                          </div>
                        </td>
                        <td class="border border-gray-400 px-1 py-1 text-center text-[9px]">
                          <input
                            v-if="isBillPreviewCompleted"
                            type="checkbox"
                            disabled
                            :checked="order.is_return === false"
                            class="w-3 h-3 accent-blue-600 m-0 align-middle"
                          />
                          <input
                            v-else
                            type="checkbox"
                            :checked="scanItemForms[order.id]?.is_return === false"
                            :disabled="!canWithdrawScan(order) || isReturnChoiceLocked(order.id)"
                            @click.prevent="onNotReturnClick(order)"
                            class="w-3 h-3 accent-blue-600 m-0 align-middle"
                          />
                        </td>
                        <td class="border border-gray-400 px-1 py-1 text-center text-[9px]">
                          <div class="space-y-1">
                            <span v-if="isBillPreviewCompleted">{{ order.remark || '-' }}</span>
                            <input
                              v-else-if="scanItemForms[order.id]"
                              v-model="scanItemForms[order.id].remark"
                              type="text"
                              :disabled="!canWithdrawScan(order)"
                              class="w-full text-center bg-transparent outline-none p-0 m-0 border-none h-full focus:ring-0"
                              style="line-height: 1;"
                              placeholder="หมายเหตุ"
                            />
                          </div>
                        </td>
                      </tr>
                      <tr v-for="n in Math.max(0, 4 - billPreviewResult.items.length)" :key="'preview-empty-' + n">
                        <td class="border border-gray-400 px-1 py-1 text-center text-gray-400">{{ billPreviewResult.items.length + n }}</td>
                        <td v-for="i in 9" :key="i" class="border border-gray-400 px-1 py-1"></td>
                      </tr>
                      <tr class="bg-gray-50 font-semibold">
                        <td colspan="3" class="border border-gray-400 px-0.5 py-0.5 text-center bg-gray-200">รวม</td>
                        <td class="border border-gray-400 px-0.5 py-0.5 text-center text-blue-700">{{ getBillPreviewTotalAmount() }}</td>
                        <td class="border border-gray-400 px-0.5 py-0.5 text-center bg-gray-400"></td>
                        <td class="border border-gray-400 px-0.5 py-0.5 text-center bg-gray-400"></td>
                        <td class="border border-gray-400 px-0.5 py-0.5"></td>
                        <td class="border border-gray-400 px-0.5 py-0.5 text-center bg-gray-400"></td>
                        <td class="border border-gray-400 px-0.5 py-0.5 text-center bg-gray-400"></td>
                        <td class="border border-gray-400 px-0.5 py-0.5 text-center bg-gray-400"></td>
                      </tr>
                    </tbody>
                  </table>

                  <table class="w-full border-collapse text-[9px] mb-1">
                    <thead>
                      <tr>
                        <th v-for="h in ['ผู้เบิก','ผู้อนุมัต','ผู้จ่าย','ผู้รับ','ผู้ตรวจสอบ/หน.พัสดุ']" :key="h" class="border border-gray-400 px-0.5 py-0.5 text-center bg-gray-300 w-1/5">{{ h }}</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td class="border border-gray-400 px-0.5 py-0 text-[9px]" style="height:40px; vertical-align:top;">{{ userLabel(billPreviewResult.items[0]?.created_by) }}</td>
                        <td class="border border-gray-400 px-0.5 py-0 text-[9px]" style="height:40px; vertical-align:top;">{{ userLabel(billPreviewResult.items[0]?.updated_by) }}</td>
                        <td class="border border-gray-400 px-0.5 py-0 text-[9px]" style="height:40px; vertical-align:top;">{{ userLabel(billPreviewResult.items[0]?.updated_by) }}</td>
                        <td class="border border-gray-400 px-0.5 py-0 text-[9px]" style="height:40px; vertical-align:top;">{{ sharedReceiveBy || '' }}</td>
                        <td class="border border-gray-400 px-0.5 py-0 text-[9px]" style="height:40px; vertical-align:top;">{{ sharedInspectorBy || '' }}</td>
                      </tr>
                      <tr>
                        <td class="border border-gray-400 px-0.5 py-0.2">
                          <div class="text-[9px] text-gray-500 mb-0.2">ลงชื่อตัวบรรจง</div>
                          <div class="border-b border-gray-300 text-[9px] pb-0.2">{{ userLabel(billPreviewResult.items[0]?.created_by) }}</div>
                        </td>
                        <td class="border border-gray-400 px-0.5 py-0.2">
                          <div class="text-[9px] text-gray-500 mb-0.2">ลงชื่อตัวบรรจง</div>
                          <div class="border-b border-gray-300 text-[9px] pb-0.2">{{ userLabel(billPreviewResult.items[0]?.updated_by) }}</div>
                        </td>
                        <td class="border border-gray-400 px-0.5 py-0.2">
                          <div class="text-[9px] text-gray-500 mb-0.2">ลงชื่อตัวบรรจง</div>
                          <div class="border-b border-gray-300 text-[9px] pb-0.2">{{ userLabel(billPreviewResult.items[0]?.updated_by) }}</div>
                        </td>
                        <td class="border border-gray-400 px-0.5 py-0.2">
                          <div class="text-[9px] text-gray-500 mb-0.2">ลงชื่อตัวบรรจง</div>
                          <div class="border-b border-gray-300 text-[9px] pb-0.2">{{ sharedReceiveBy || '' }}</div>
                        </td>
                        <td class="border border-gray-400 px-0.5 py-0.2">
                          <div class="text-[9px] text-gray-500 mb-0.2">ลงชื่อตัวบรรจง</div>
                          <div class="border-b border-gray-300 text-[9px] pb-0.2">{{ sharedInspectorBy || '' }}</div>
                        </td>
                      </tr>
                      <tr>
                        <td class="border border-gray-400 px-0.2 py-0.1">
                          <div class="text-[9px] text-gray-500 mb-0.1">วันที่</div>
                          <div class="text-[9px]">{{ formatDateOnly(billPreviewResult.items[0]?.created_at) }}</div>
                        </td>
                        <td class="border border-gray-400 px-0.2 py-0.1">
                          <div class="text-[9px] text-gray-500 mb-0.1">วันที่</div>
                          <div class="text-[9px]">{{ formatDateOnly(billPreviewResult.items[0]?.updated_at) }}</div>
                        </td>
                        <td class="border border-gray-400 px-0.2 py-0.1">
                          <div class="text-[9px] text-gray-500 mb-0.1">วันที่</div>
                          <div class="text-[9px]">{{ formatDateOnly(billPreviewResult.items[0]?.updated_at) }}</div>
                        </td>
                        <td class="border border-gray-400 px-0.2 py-0.1">
                          <div class="text-[9px] text-gray-500 mb-0.1">วันที่</div>
                          <div class="text-[9px]">{{ formatDateOnly(billPreviewResult.items[0]?.updated_at) }}</div>
                        </td>
                        <td class="border border-gray-400 px-0.2 py-0.1">
                          <div class="text-[9px] text-gray-500 mb-0.1">วันที่</div>
                          <div class="text-[9px]">{{ formatDateOnly(billPreviewResult.items[0]?.updated_at) }}</div>
                        </td>
                      </tr>
                    </tbody>
                  </table>

                  <div class="flex items-end justify-between mt-2">
                    <div class="text-[10px]">
                      <span class="font-bold underline whitespace-nowrap leading-none">หมายเหตุ : กรณีเบิกใช้งานช่อมต้องแนบใบแจ้งช่อมทุกครั้ง</span>
                    </div>
                    <div class="flex flex-col items-center">
                      <svg id="barcode-bill-preview" class="w-[180px] h-[55px]"></svg>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div v-if="!isBillPreviewCompleted && isReturnDateModalOpen" class="absolute inset-0 z-50 flex items-center justify-center">
            <div class="absolute inset-0 bg-black/30" @click="closeReturnDateModal"></div>
            <div class="relative w-full max-w-sm rounded-xl border bg-white p-5 shadow-2xl" style="border-color: var(--color-border)">
              <div class="text-[14px] font-semibold" style="color: var(--color-text-primary)">{{ returnDateModalTitle }}</div>
              <div class="mt-3 space-y-1">
                <label class="text-[12px] font-medium" style="color: var(--color-text-muted)">วันที่ส่งคืน</label>
                <input
                  v-model="returnDateDraft"
                  type="date"
                  :disabled="returnDateReadOnly"
                  class="w-full px-3 py-2 border rounded-lg text-[13px] focus:outline-none focus:ring-1"
                  style="border-color: var(--color-border); background: var(--color-bg-body)"
                />
              </div>
              <div class="mt-4 flex justify-end gap-2">
                <button
                  @click="closeReturnDateModal"
                  class="px-4 py-2 rounded-lg text-[13px] font-medium border hover:bg-gray-50 transition-all"
                  style="border-color: var(--color-border); color: var(--color-text-secondary)"
                >
                  ยกเลิก
                </button>
                <button
                  @click="confirmReturnDate"
                  v-if="!returnDateReadOnly"
                  class="px-4 py-2 rounded-lg text-[13px] font-medium border transition-all hover:opacity-90"
                  style="background: var(--color-primary); border-color: var(--color-border)"
                >
                  บันทึก
                </button>
              </div>
            </div>
          </div>

          <div class="p-6 border-t flex justify-end gap-3" style="border-color: var(--color-border)">
            <button
              v-if="billPreviewResult.items.some(canWithdrawScan)"
              @click="openApproveBillConfirm"
              :disabled="saving"
              class="px-5 py-2 rounded-lg text-[14px] font-medium border border-blue-500 bg-white text-blue-600 transition-all hover:bg-blue-50 disabled:opacity-50"
            >
              {{ saving ? 'กำลังบันทึก...' : 'อนุมัติใบเบิก' }}
            </button>
            <button @click="closeBillPreview" class="px-5 py-2 rounded-lg text-[14px] font-medium border hover:bg-gray-50 transition-all" style="border-color: var(--color-border); color: var(--color-text-secondary)">
              ปิด
            </button>
          </div>
        </div>
      </div>
    </Transition>

    <ConfirmDialog
      :show="isApproveBillConfirmOpen"
      title="ยืนยันอนุมัติใบเบิก"
      :message="approveConfirmMessage"
      confirmText="ตกลง"
      cancelText="ยกเลิก"
      type="primary"
      @confirm="confirmApproveBill"
      @cancel="closeApproveBillConfirm"
    />

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

.paper-scroll-wrap {
  width: 100%;
  max-width: 960px;
  margin: 0 auto;
  overflow-x: auto;
  overflow-y: visible;
  padding-bottom: 0;
  -webkit-overflow-scrolling: touch;
}

.paper-sheet {
  width: 960px;
  min-width: 960px;
  margin: 0 auto;
}

input:focus:not(.border-none),
select:focus:not(.border-none),
textarea:focus:not(.border-none) {
  border-color: var(--color-primary) !important;
  box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.1);
}

/* ซ่อนลูกศรขึ้นลงใน input type number สำหรับในใบบิน */
.hide-number-spinners::-webkit-outer-spin-button,
.hide-number-spinners::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}
.hide-number-spinners[type=number] {
  -moz-appearance: textfield;
}
</style>
