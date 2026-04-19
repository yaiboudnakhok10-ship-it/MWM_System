<script setup>
import { ref, onMounted, computed } from 'vue'
import AppLayout from '@/components/layout/AppLayout.vue'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'
import * as XLSX from 'xlsx'

const auth = useAuthStore()

const items = ref([])
const loading = ref(false)
const processing = ref(false)
const dropActive = ref(false)
const message = ref('')
const successCount = ref(0)
const errorCount = ref(0)
const errorRows = ref([])

const expectedHeaders = ['item_code', 'item_name', 'unit', 'amount', 'remark']

async function fetchItems() {
  const { data, error } = await supabase
    .from('items')
    .select('id,item_code,item_name,unit')
    .order('item_code')
  if (!error) items.value = data || []
}

onMounted(() => {
  fetchItems()
})

function downloadTemplate() {
  const rows = items.value.map(it => ({
    item_code: it.item_code,
    item_name: it.item_name,
    unit: it.unit,
    amount: '',
    remark: ''
  }))
  const ws = XLSX.utils.json_to_sheet(rows, { header: expectedHeaders })
  const csv = XLSX.utils.sheet_to_csv(ws)
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `import_template_${new Date().toISOString().slice(0,10)}.csv`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

function onDragOver(e) {
  e.preventDefault()
  dropActive.value = true
}
function onDragLeave() {
  dropActive.value = false
}
function onDrop(e) {
  e.preventDefault()
  dropActive.value = false
  const file = e.dataTransfer.files?.[0]
  if (file) handleFile(file)
}

function onFileChange(e) {
  const file = e.target.files?.[0]
  if (file) handleFile(file)
  e.target.value = ''
}

async function handleFile(file) {
  if (!file.name.toLowerCase().endsWith('.csv')) {
    message.value = 'อนุญาตเฉพาะไฟล์ .csv เท่านั้น'
    return
  }
  const text = await file.text()
  const wb = XLSX.read(text, { type: 'string' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const data = XLSX.utils.sheet_to_json(ws, { header: 1 })
  if (!data.length) {
    message.value = 'ไฟล์ว่าง ไม่พบข้อมูล'
    return
  }
  const headers = (data[0] || []).map(h => String(h || '').trim())
  if (headers.join(',') !== expectedHeaders.join(',')) {
    message.value = 'รูปแบบคอลัมน์ไม่ถูกต้อง ต้องเป็น: ' + expectedHeaders.join(', ')
    return
  }
  const rows = data.slice(1).map(r => {
    const row = {}
    expectedHeaders.forEach((h, i) => (row[h] = r[i] !== undefined ? String(r[i]).trim() : ''))
    return row
  }).filter(r => r.item_code)

  if (!rows.length) {
    message.value = 'ไม่พบแถวข้อมูลสำหรับนำเข้า'
    return
  }
  await processRows(rows)
}

async function processRows(rows) {
  processing.value = true
  message.value = ''
  successCount.value = 0
  errorCount.value = 0
  errorRows.value = []

  try {
    const codeToItem = new Map(items.value.map(it => [it.item_code, it]))

    const validInserts = []
    const touchedItemIds = new Set()

    for (const r of rows) {
      const it = codeToItem.get(r.item_code)
      if (!it) {
        errorRows.value.push({ ...r, error: 'ไม่พบรหัสสินค้าในระบบ' })
        continue
      }
      if (r.item_name && r.item_name !== it.item_name) {
        errorRows.value.push({ ...r, error: 'ชื่อสินค้าไม่ตรงกับระบบ' })
        continue
      }
      const amt = Number(r.amount)
      if (!Number.isFinite(amt) || amt <= 0) {
        errorRows.value.push({ ...r, error: 'จำนวนต้องเป็นตัวเลขมากกว่า 0' })
        continue
      }
      validInserts.push({
        item_id: it.id,
        amount: amt,
        unit: it.unit,
        remark: r.remark || null,
        note: 'นำเข้าแบบหลายรายการ',
        created_by: auth.user?.id || null,
        updated_by: auth.user?.id || null
      })
      touchedItemIds.add(it.id)
    }

    if (validInserts.length) {
      const { error: insErr } = await supabase
        .from('inventory_imports')
        .insert(validInserts)
      if (insErr) {
        validInserts.forEach(v => {
          const b = [...codeToItem.entries()].find(([, val]) => val.id === v.item_id)
          const code = b ? b[0] : ''
          errorRows.value.push({ item_code: code, item_name: '', unit: '', amount: String(v.amount), remark: v.remark || '', error: 'บันทึกข้อมูลล้มเหลว' })
        })
      } else {
        successCount.value = validInserts.length
        if (touchedItemIds.size) {
          await supabase.from('items').update({ updated_by: auth.user?.id || null }).in('id', Array.from(touchedItemIds))
        }
        await supabase.from('user_logs').insert({
          system_user_id: auth.user?.id || null,
          action: 'bulk_import_items',
          user_agent: navigator.userAgent,
          old_value: { total: rows.length, success: successCount.value, error: errorRows.value.length }
        })
      }
    }
    errorCount.value = errorRows.value.length
    if (!successCount.value && !errorCount.value) {
      message.value = 'ไม่มีรายการที่สามารถบันทึกได้'
    } else {
      message.value = `อัปโหลดสำเร็จ ${successCount.value} รายการ, ผิดพลาด ${errorCount.value} รายการ`
    }
    if (successCount.value) await fetchItems()
  } catch (e) {
    message.value = 'เกิดข้อผิดพลาดระหว่างประมวลผล โปรดติดต่อผู้ดูแลระบบ'
  } finally {
    processing.value = false
  }
}

function downloadErrorCsv() {
  if (!errorRows.value.length) return
  const ws = XLSX.utils.json_to_sheet(errorRows.value)
  const csv = XLSX.utils.sheet_to_csv(ws)
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `import_errors_${new Date().toISOString().slice(0,10)}.csv`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
</script>

<template>
  <AppLayout>
    <div class="flex items-start justify-between gap-4 mb-6">
      <div>
        <h1 class="text-[20px] font-semibold" style="color: var(--color-text-primary)">นำเข้าสินค้าแบบหลายรายการ (CSV)</h1>
        <p class="text-[13px] mt-0.5" style="color: var(--color-text-muted)">อัปโหลดเฉพาะไฟล์ CSV ที่ได้จากเทมเพลตของระบบ</p>
      </div>
      <div class="flex gap-2">
        <button @click="downloadTemplate"
                class="px-4 py-2 rounded-lg text-[13px] font-medium transition-all bg-emerald-600 hover:bg-emerald-700 text-white active:scale-95">
          <i class="fa-solid fa-file-csv mr-1"></i> ดาวน์โหลดเทมเพลต
        </button>
        <button v-if="errorRows.length"
                @click="downloadErrorCsv"
                class="px-4 py-2 rounded-lg text-[13px] font-medium transition-all bg-amber-600 hover:bg-amber-700 text-white active:scale-95">
          <i class="fa-solid fa-triangle-exclamation mr-1"></i> ดาวน์โหลดข้อผิดพลาด
        </button>
      </div>
    </div>

    <div class="grid md:grid-cols-3 gap-6">
      <div class="md:col-span-2">
        <div class="rounded-2xl border p-6 text-center"
             :class="dropActive ? 'ring-2 ring-blue-400' : ''"
             style="background: var(--color-bg-card); border-color: var(--color-border)">
          <div class="mb-3">
            <i class="fa-solid fa-cloud-arrow-up text-4xl text-blue-500"></i>
          </div>
          <p class="text-[14px] font-medium mb-1" style="color: var(--color-text-primary)">ลากไฟล์ .csv มาวางที่นี่</p>
          <p class="text-[12px] mb-4" style="color: var(--color-text-muted)">หรือคลิกเพื่อเลือกไฟล์จากเครื่อง</p>
          <div @dragover="onDragOver" @dragleave="onDragLeave" @drop="onDrop"
               class="border-2 border-dashed rounded-xl p-8 cursor-pointer"
               :class="dropActive ? 'border-blue-400 bg-blue-50/40 dark:bg-blue-900/10' : ''"
               style="border-color: var(--color-border)">
            <input type="file" accept=".csv" @change="onFileChange" class="hidden" id="csvInput">
            <label for="csvInput" class="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-medium transition-all bg-blue-600 hover:bg-blue-700 text-white active:scale-95 cursor-pointer">
              <i class="fa-solid fa-file-arrow-up"></i>
              เลือกไฟล์ CSV
            </label>
          </div>

          <div class="mt-4 text-[13px]" :style="errorCount ? 'color: var(--color-danger)' : 'color: var(--color-text-secondary)'">
            {{ message }}
          </div>
          <div class="mt-2 text-[12px]" style="color: var(--color-text-muted)">
            อนุญาตเฉพาะคอลัมน์: item_code, item_name, unit, amount, remark
          </div>
        </div>
      </div>

      <div>
        <div class="rounded-2xl border p-5 space-y-2" style="background: var(--color-bg-card); border-color: var(--color-border)">
          <div class="flex items-center justify-between">
            <span class="text-[13px]" style="color: var(--color-text-secondary)">สถานะการประมวลผล</span>
            <i v-if="processing" class="fa-solid fa-spinner fa-spin text-blue-500"></i>
          </div>
          <div class="flex items-center justify-between text-[13px]">
            <span style="color: var(--color-text-muted)">สำเร็จ</span>
            <span class="font-semibold text-emerald-600 dark:text-emerald-400">{{ successCount }}</span>
          </div>
          <div class="flex items-center justify-between text-[13px]">
            <span style="color: var(--color-text-muted)">ผิดพลาด</span>
            <span class="font-semibold text-amber-600 dark:text-amber-400">{{ errorCount }}</span>
          </div>
          <hr style="border-color: var(--color-border)" />
          <div class="text-[12px]" style="color: var(--color-text-muted)">
            ดาวน์โหลดเทมเพลต แล้วกรอกเฉพาะคอลัมน์จำนวนและหมายเหตุ ห้ามแก้ไขรหัสและชื่อสินค้า
          </div>
        </div>
      </div>
    </div>
  </AppLayout>
</template>

<style scoped>
input:focus {
  border-color: var(--color-primary);
  box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.1);
}
</style>
