<script setup>
import { ref, onMounted, computed, watch } from 'vue'
import AppLayout from '@/components/layout/AppLayout.vue'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()

// State
const items = ref([])
const categories = ref([])
const loading = ref(true)
const searchText = ref('')
const selectedCategoryId = ref('all')

// Sidebar & Modal Visibility
const isSidebarOpen = ref(false)
const isCategoryModalOpen = ref(false)
const isRestockModalOpen = ref(false)
const isEditingCategory = ref(false)
const saving = ref(false)

// Watch for sidebar/modal open state to prevent body scrolling
watch([isSidebarOpen, isCategoryModalOpen, isRestockModalOpen], ([sidebar, category, restock]) => {
  if (sidebar || category || restock) {
    document.body.classList.add('no-scroll')
  } else {
    document.body.classList.remove('no-scroll')
  }
})

// Forms
const itemForm = ref({
  item_code: '',
  item_name: '',
  category_id: '',
  amount: 1,
  unit: '',
  remark: ''
})

const restockForm = ref({
  item_id: '',
  item_name: '',
  amount: 1,
  unit: '',
  remark: ''
})

const categoryForm = ref({
  id: null,
  category_name: '',
  remark: ''
})

// Fetch Data
async function fetchData() {
  loading.value = true
  try {
    const { data: itemsData, error: itemsError } = await supabase
      .from('items')
      .select('*, category(category_name), creator:system_users!created_by(fullname)')
      .order('created_at', { ascending: false })
    
    if (itemsError) throw itemsError
    items.value = itemsData

    const { data: categoriesData, error: categoriesError } = await supabase
      .from('category')
      .select('*')
      .order('category_name')
    
    if (categoriesError) throw categoriesError
    categories.value = categoriesData
  } catch (err) {
    console.error('Error fetching data:', err.message)
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  fetchData()
})

// Computed
const filteredItems = computed(() => {
  return items.value.filter(item => {
    const matchSearch = item.item_name.toLowerCase().includes(searchText.value.toLowerCase()) || 
                        item.item_code.toLowerCase().includes(searchText.value.toLowerCase())
    const matchCategory = selectedCategoryId.value === 'all' || item.category_id === selectedCategoryId.value
    return matchSearch && matchCategory
  })
})

// Sidebar Handlers (Add/Import Item)
function openAddItemSidebar() {
  itemForm.value = {
    item_code: '',
    item_name: '',
    category_id: categories.value[0]?.id || '',
    amount: 1,
    unit: 'ชิ้น',
    remark: ''
  }
  isSidebarOpen.value = true
}

async function saveItem() {
  if (!itemForm.value.item_code || !itemForm.value.item_name || !itemForm.value.category_id) {
    alert('กรุณากรอกข้อมูลที่จำเป็นให้ครบถ้วน (รหัสสินค้า, ชื่อสินค้า, ประเภท)')
    return
  }

  saving.value = true
  try {
    // 1. Check if item exists
    let { data: existingItem, error: findError } = await supabase
      .from('items')
      .select('id')
      .eq('item_code', itemForm.value.item_code)
      .maybeSingle()

    if (findError) throw findError

    let itemId

    if (existingItem) {
      itemId = existingItem.id
      // Update existing item stock (though trigger handles it, we might want to log who updated it)
      await supabase.from('items').update({
        updated_by: auth.user.id
      }).eq('id', itemId)
    } else {
      // 2. Insert into items
      const { data: newItem, error: insertItemError } = await supabase
        .from('items')
        .insert({
          item_code: itemForm.value.item_code,
          item_name: itemForm.value.item_name,
          category_id: itemForm.value.category_id,
          unit: itemForm.value.unit,
          remark: itemForm.value.remark,
          current_stock: 0, // Will be updated by trigger
          created_by: auth.user.id,
          updated_by: auth.user.id
        })
        .select()
        .single()
      
      if (insertItemError) throw insertItemError
      itemId = newItem.id
    }

    // 3. Insert into inventory_imports
    const { error: importError } = await supabase
      .from('inventory_imports')
      .insert({
        item_id: itemId,
        amount: itemForm.value.amount,
        unit: itemForm.value.unit,
        remark: itemForm.value.remark,
        note: 'นำเข้าสินค้า',
        created_by: auth.user.id,
        updated_by: auth.user.id
      })
    
    if (importError) throw importError

    // 4. Log the action
    await supabase.from('user_logs').insert({
      system_user_id: auth.user.id,
      action: 'import_item',
      user_agent: navigator.userAgent,
      old_value: { 
        item_code: itemForm.value.item_code, 
        amount: itemForm.value.amount 
      }
    })

    // Success
    isSidebarOpen.value = false
    await fetchData()
    alert('บันทึกข้อมูลสำเร็จ')
  } catch (err) {
    console.error(err)
    alert('Error saving item: ' + err.message)
  } finally {
    saving.value = false
  }
}

// Category Handlers
function openCategoryModal() {
  isCategoryModalOpen.value = true
  isEditingCategory.value = false
  categoryForm.value = { id: null, category_name: '', remark: '' }
}

function editCategory(cat) {
  isEditingCategory.value = true
  categoryForm.value = { ...cat }
}

function cancelEditCategory() {
  isEditingCategory.value = false
  categoryForm.value = { id: null, category_name: '', remark: '' }
}

// Restock Handlers
function openRestockModal(item) {
  restockForm.value = {
    item_id: item.id,
    item_name: item.item_name,
    amount: 1,
    unit: item.unit,
    remark: ''
  }
  isRestockModalOpen.value = true
}

async function handleRestock() {
  if (restockForm.value.amount <= 0) {
    alert('กรุณากรอกจำนวนที่ต้องการเติมให้ถูกต้อง')
    return
  }

  saving.value = true
  try {
    // Insert into inventory_imports (Trigger handles current_stock in items)
    const { error: importError } = await supabase
      .from('inventory_imports')
      .insert({
        item_id: restockForm.value.item_id,
        amount: restockForm.value.amount,
        unit: restockForm.value.unit,
        remark: restockForm.value.remark,
        note: 'เติมสินค้า (Restock)',
        created_by: auth.user.id,
        updated_by: auth.user.id
      })
    
    if (importError) throw importError

    // Log the action
    await supabase.from('user_logs').insert({
      system_user_id: auth.user.id,
      action: 'restock_item',
      user_agent: navigator.userAgent,
      old_value: { 
        item_name: restockForm.value.item_name, 
        amount: restockForm.value.amount 
      }
    })

    // Success
    isRestockModalOpen.value = false
    await fetchData()
    alert('เติมสินค้าสำเร็จ')
  } catch (err) {
    console.error(err)
    alert('Error restocking item: ' + err.message)
  } finally {
    saving.value = false
  }
}

async function saveCategory() {
  if (!categoryForm.value.category_name) {
    alert('กรุณากรอกชื่อประเภทสินค้า')
    return
  }

  saving.value = true
  try {
    if (isEditingCategory.value) {
      const { error } = await supabase
        .from('category')
        .update({
          category_name: categoryForm.value.category_name,
          remark: categoryForm.value.remark,
          updated_by: auth.user.id
        })
        .eq('id', categoryForm.value.id)
      
      if (error) throw error
    } else {
      const { error } = await supabase
        .from('category')
        .insert({
          category_name: categoryForm.value.category_name,
          remark: categoryForm.value.remark,
          created_by: auth.user.id,
          updated_by: auth.user.id
        })
      
      if (error) throw error
    }

    // Log the action
    await supabase.from('user_logs').insert({
      system_user_id: auth.user.id,
      action: isEditingCategory.value ? 'edit_category' : 'add_category',
      user_agent: navigator.userAgent,
      old_value: { category_name: categoryForm.value.category_name }
    })

    await fetchData()
    isEditingCategory.value = false
    categoryForm.value = { id: null, category_name: '', remark: '' }
    alert('บันทึกหมวดหมู่สำเร็จ')
  } catch (err) {
    alert('Error saving category: ' + err.message)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <AppLayout>
    <!-- Header Section -->
    <div class="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
      <div>
        <h1 class="text-[20px] font-semibold" style="color: var(--color-text-primary)">รายการสินค้า</h1>
        <p class="text-[13px] mt-0.5" style="color: var(--color-text-muted)">จัดการข้อมูลสินค้าและสต็อกในระบบ</p>
      </div>
      <div class="flex flex-wrap gap-2">
        <button @click="openCategoryModal" class="flex items-center gap-2 px-3 py-1.5 rounded-lg border text-[13px] font-medium transition-all hover:bg-gray-50 active:scale-95" style="background: var(--color-bg-card); border-color: var(--color-border); color: var(--color-text-primary)">
          <i class="fa-solid fa-tags"></i>
          จัดการประเภทสินค้า
        </button>
        <button @click="openAddItemSidebar" class="flex items-center gap-2 px-4 py-1.5 rounded-lg border text-[13px] font-medium transition-all hover:bg-gray-100 active:scale-95" style="background: var(--color-card); color: var(--color-text-primary); border-color: var(--color-border)">
          <i class="fa-solid fa-plus"></i>
          เพิ่มสินค้า / นำเข้า
        </button>
      </div>
    </div>

    <!-- Filters Section -->
    <div class="flex flex-col md:flex-row gap-4 mb-6 p-4 rounded-xl border" style="background: var(--color-bg-card); border-color: var(--color-border)">
      <div class="flex-1 relative">
        <i class="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-[14px]" style="color: var(--color-text-muted)"></i>
        <input 
          v-model="searchText"
          type="text" 
          placeholder="ค้นหาด้วยรหัส หรือ ชื่อสินค้า..." 
          class="w-full pl-9 pr-4 py-2 bg-transparent border rounded-lg text-[13px] focus:outline-none focus:ring-1 transition-all"
          style="border-color: var(--color-border); color: var(--color-text-primary)"
        />
      </div>
      <div class="w-full md:w-48">
        <select 
          v-model="selectedCategoryId"
          class="w-full px-3 py-2 border rounded-lg text-[13px] focus:outline-none focus:ring-1 transition-all"
          style="background-color: var(--color-bg-card); border-color: var(--color-border); color: var(--color-text-primary)"
        >
          <option value="all" style="background-color: var(--color-bg-card)">ทุกประเภทสินค้า</option>
          <option v-for="cat in categories" :key="cat.id" :value="cat.id" style="background-color: var(--color-bg-card)">{{ cat.category_name }}</option>
        </select>
      </div>
    </div>

    <!-- Table Section -->
    <div class="rounded-xl border overflow-hidden" style="background: var(--color-bg-card); border-color: var(--color-border)">
      <div class="overflow-x-auto">
        <table class="w-full text-[13px]">
          <thead>
            <tr style="border-bottom: 1px solid var(--color-border)">
              <th class="text-left px-4 py-3 font-medium" style="color: var(--color-text-muted)">รหัสสินค้า</th>
              <th class="text-left px-4 py-3 font-medium" style="color: var(--color-text-muted)">ชื่อสินค้า</th>
              <th class="text-left px-4 py-3 font-medium" style="color: var(--color-text-muted)">ประเภท</th>
              <th class="text-right px-4 py-3 font-medium" style="color: var(--color-text-muted)">จำนวนคงเหลือ</th>
              <!-- <th class="text-left px-4 py-3 font-medium" style="color: var(--color-text-muted)">หน่วย</th> -->
              <th class="text-center px-4 py-3 font-medium" style="color: var(--color-text-muted)">ผู้เพิ่ม</th>
              <th class="text-left px-4 py-3 font-medium" style="color: var(--color-text-muted)">หมายเหตุ</th>
              <th class="text-center px-4 py-3 font-medium" style="color: var(--color-text-muted)">เติมสินค้า</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in filteredItems" :key="item.id"
                class="border-b last:border-b-0 hover:bg-gray-50 dark:hover:bg-slate-700/30 transition-colors"
                style="border-color: var(--color-border)">
              <td class="px-4 py-3 font-mono" style="color: var(--color-text-muted)">{{ item.item_code }}</td>
              <td class="px-4 py-3 font-medium" style="color: var(--color-text-primary)">{{ item.item_name }}</td>
              <td class="px-4 py-3" style="color: var(--color-text-secondary)">
                <span class="px-2 py-0.5 rounded-full text-[11px] bg-blue-50 dark:bg-blue-500/30 text-blue-600 dark:text-blue-500 border border-blue-100 dark:border-blue-600/30">
                  {{ item.category?.category_name || 'ไม่มีประเภท' }}
                </span>
              </td>
              <td class="px-4 py-3 font-bold text-right">
                <span class="rounded-md px-1 py-0.5 text-center item-center" :class="item.current_stock <= 5 ? 'bg-red-100 dark:bg-red-600/30 text-red dark:text-red-500' : 'bg-green-100 dark:bg-green-600/30 text-emerald-600 dark:text-green-500'">{{ item.current_stock }} {{ item.unit }}</span>
              </td>
              <!-- <td class="px-4 py-3" style="color: var(--color-text-muted)">{{ item.unit }}</td> -->
              <td class="px-4 py-3 text-center" style="color: var(--color-text-secondary)">{{ item.creator?.fullname || '-' }}</td>
              <td class="px-4 py-3" style="color: var(--color-text-muted)">{{ item.remark || '-' }}</td>
              <td class="px-4 py-3 text-center">
                <button @click="openRestockModal(item)" class="px-3 py-1 rounded bg-emerald-50 dark:bg-emerald-600/20 text-emerald-600 dark:text-emerald-500 border border-emerald-200 dark:border-emerald-600/20 text-[11px] font-medium hover:bg-emerald-100 transition-colors">
                  <i class="fa-solid fa-plus-circle mr-1"></i>
                  Restock
                </button>
              </td>
            </tr>
            <tr v-if="loading">
              <td colspan="7" class="px-4 py-8 text-center" style="color: var(--color-text-muted)">กำลังโหลดข้อมูล...</td>
            </tr>
            <tr v-else-if="filteredItems.length === 0">
              <td colspan="7" class="px-4 py-8 text-center" style="color: var(--color-text-muted)">ไม่พบข้อมูลสินค้า</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Sidebar: Add Item / Import -->
    <Transition name="slide-right">
      <div v-if="isSidebarOpen" class="fixed inset-0 z-50 flex justify-end">
        <div class="absolute inset-0 bg-black/30 backdrop-blur-sm" @click="isSidebarOpen = false"></div>
        <div class="relative w-full max-w-md h-full shadow-2xl flex flex-col" style="background: var(--color-bg-card)">
          <div class="px-6 py-4 border-b flex items-center justify-between" style="border-color: var(--color-border)">
            <h2 class="text-[16px] font-semibold" style="color: var(--color-text-primary)">เพิ่มสินค้า / นำเข้า</h2>
            <button @click="isSidebarOpen = false" class="p-2 hover:bg-gray-100 rounded-lg transition-colors">
              <i class="fa-solid fa-xmark" style="color: var(--color-text-muted)"></i>
            </button>
          </div>
          <div class="flex-1 overflow-y-auto p-6 space-y-4">
            <div class="space-y-1">
              <label class="text-[13px] font-medium" style="color: var(--color-text-primary)">รหัสสินค้า</label>
              <input v-model="itemForm.item_code" type="text" class="w-full px-3 py-2 border rounded-lg text-[13px] focus:outline-none focus:ring-1" style="border-color: var(--color-border); background: var(--color-bg-body)" />
            </div>
            <div class="space-y-1">
              <label class="text-[13px] font-medium" style="color: var(--color-text-primary)">ชื่อสินค้า</label>
              <input v-model="itemForm.item_name" type="text" class="w-full px-3 py-2 border rounded-lg text-[13px] focus:outline-none focus:ring-1" style="border-color: var(--color-border); background: var(--color-bg-body)" />
            </div>
            <div class="grid grid-cols-2 gap-4">
              <div class="space-y-1">
                <label class="text-[13px] font-medium" style="color: var(--color-text-primary)">ประเภทสินค้า</label>
                <select v-model="itemForm.category_id" class="w-full px-3 py-2 border rounded-lg text-[13px] focus:outline-none focus:ring-1" style="border-color: var(--color-border); background: var(--color-bg-body); color: var(--color-text-primary)">
                  <option v-for="cat in categories" :key="cat.id" :value="cat.id" style="background-color: var(--color-bg-body)">{{ cat.category_name }}</option>
                </select>
              </div>
              <div class="space-y-1">
                <label class="text-[13px] font-medium" style="color: var(--color-text-primary)">หน่วย</label>
                <input v-model="itemForm.unit" type="text" placeholder="เช่น ชิ้น, กล่อง" class="w-full px-3 py-2 border rounded-lg text-[13px] focus:outline-none focus:ring-1" style="border-color: var(--color-border); background: var(--color-bg-body)" />
              </div>
            </div>
            <div class="space-y-1">
              <label class="text-[13px] font-medium" style="color: var(--color-text-primary)">จำนวนนำเข้า</label>
              <input v-model.number="itemForm.amount" type="number" min="1" class="w-full px-3 py-2 border rounded-lg text-[13px] focus:outline-none focus:ring-1" style="border-color: var(--color-border); background: var(--color-bg-body)" />
            </div>
            <div class="space-y-1">
              <label class="text-[13px] font-medium" style="color: var(--color-text-primary)">หมายเหตุ</label>
              <textarea v-model="itemForm.remark" rows="3" class="w-full px-3 py-2 border rounded-lg text-[13px] focus:outline-none focus:ring-1" style="border-color: var(--color-border); background: var(--color-bg-body)"></textarea>
            </div>
          </div>
          <div class="p-6 border-t" style="border-color: var(--color-border)">
            <button 
              @click="saveItem" 
              :disabled="saving"
              class="w-full py-2.5 rounded-lg text-[14px] font-medium text-white transition-all hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed" 
              style="background: var(--color-primary)"
            >
              {{ saving ? 'กำลังบันทึก...' : 'บันทึกข้อมูล' }}
            </button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- Modal: Category Management -->
    <div v-if="isCategoryModalOpen" class="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div class="absolute inset-0 bg-black/40 backdrop-blur-sm" @click="isCategoryModalOpen = false"></div>
      <div class="relative w-full max-w-2xl max-h-[90vh] shadow-2xl rounded-2xl flex flex-col" style="background: var(--color-bg-card)">
        <div class="px-6 py-4 border-b flex items-center justify-between" style="border-color: var(--color-border)">
          <h2 class="text-[16px] font-semibold" style="color: var(--color-text-primary)">จัดการประเภทสินค้า</h2>
          <button @click="isCategoryModalOpen = false" class="p-2 hover:bg-gray-100 rounded-lg transition-colors">
            <i class="fa-solid fa-xmark" style="color: var(--color-text-muted)"></i>
          </button>
        </div>
        
        <div class="flex-1 overflow-y-auto p-6">
          <!-- Add/Edit Category Form -->
          <div class="mb-8 p-4 rounded-xl border" style="background: var(--color-bg-body); border-color: var(--color-border)">
            <h3 class="text-[14px] font-medium mb-4" style="color: var(--color-text-primary)">
              {{ isEditingCategory ? 'แก้ไขประเภทสินค้า' : 'เพิ่มประเภทสินค้าใหม่' }}
            </h3>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div class="space-y-1">
                <label class="text-[12px] font-medium" style="color: var(--color-text-secondary)">ชื่อประเภทสินค้า</label>
                <input v-model="categoryForm.category_name" placeholder="กรอกชื่อประเภทสินค้า" type="text" class="w-full px-3 py-1.5 border rounded-lg text-[13px] focus:outline-none dark:bg-slate-800/50" style="border-color: var(--color-border)" />
              </div>
              <div class="space-y-1">
                <label class="text-[12px] font-medium" style="color: var(--color-text-secondary)">หมายเหตุ</label>
                <input v-model="categoryForm.remark" placeholder="(ถ้ามี)" type="text" class="w-full px-3 py-1.5 border rounded-lg text-[13px] focus:outline-none dark:bg-slate-800/50" style="border-color: var(--color-border)" />
              </div>
            </div>
            <div class="mt-4 flex justify-end gap-2">
              <button v-if="isEditingCategory" @click="cancelEditCategory" :disabled="saving" class="px-3 py-1.5 rounded-lg text-[12px] border disabled:opacity-50" style="border-color: var(--color-border); color: var(--color-text-muted)">ยกเลิก</button>
              <button @click="saveCategory" :disabled="saving" class="px-4 py-1.5 rounded-lg text-[12px] border border-slate-500 dark:border-slate-300 hover:bg-slate-300/50 dark:hover:bg-slate-600 text-slate-600 dark:text-slate-100 font-medium disabled:opacity-50 transition-all duration-300 delay-100">
                {{ saving ? 'กำลังบันทึก...' : (isEditingCategory ? 'บันทึกการแก้ไข' : 'บันทึก') }}
              </button>
            </div>
          </div>

          <!-- Category Table -->
          <div class="rounded-xl border overflow-hidden" style="border-color: var(--color-border)">
            <table class="w-full text-[13px]">
              <thead>
                <tr class="bg-gray-50 dark:bg-slate-800/50" style="border-bottom: 1px solid var(--color-border)">
                  <th class="text-left px-4 py-2 font-medium" style="color: var(--color-text-muted)">ชื่อประเภท</th>
                  <th class="text-left px-4 py-2 font-medium" style="color: var(--color-text-muted)">หมายเหตุ</th>
                  <th class="text-right px-4 py-2 font-medium" style="color: var(--color-text-muted)">จัดการ</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="cat in categories" :key="cat.id" class="border-b last:border-b-0" style="border-color: var(--color-border)">
                  <td class="px-4 py-2" style="color: var(--color-text-primary)">{{ cat.category_name }}</td>
                  <td class="px-4 py-2" style="color: var(--color-text-muted)">{{ cat.remark || '-' }}</td>
                  <td class="px-4 py-2 text-right">
                    <button @click="editCategory(cat)" class="p-1.5 text-blue-600 hover:bg-blue-50 rounded transition-colors">
                      <i class="fa-solid fa-pen-to-square"></i>
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
                  <!-- <th class="text-left px-4 py-2 font-medium" style="color: var(--color-text-muted)">หมายเหตุ</th>
                  <th class="text-right px-4 py-2 font-medium" style="color: var(--color-text-muted)">จัดการ</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="cat in categories" :key="cat.id" class="border-b last:border-b-0" style="border-color: var(--color-border)">
                  <td class="px-4 py-2" style="color: var(--color-text-primary)">{{ cat.category_name }}</td>
                  <td class="px-4 py-2" style="color: var(--color-text-muted)">{{ cat.remark || '-' }}</td>
                  <td class="px-4 py-2 text-right">
                    <button @click="editCategory(cat)" class="p-1.5 text-blue-600 hover:bg-blue-50 rounded transition-colors">
                      <i class="fa-solid fa-pen-to-square"></i>
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div> -->

    <!-- Modal: Restock Item -->
    <div v-if="isRestockModalOpen" class="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div class="absolute inset-0 bg-black/40 backdrop-blur-sm" @click="isRestockModalOpen = false"></div>
      <div class="relative w-full max-w-md shadow-2xl rounded-2xl flex flex-col overflow-hidden" style="background: var(--color-bg-card)">
        <div class="px-6 py-4 border-b flex items-center justify-between" style="border-color: var(--color-border)">
          <h2 class="text-[16px] font-semibold" style="color: var(--color-text-primary)">เติมสินค้า (Restock)</h2>
          <button @click="isRestockModalOpen = false" class="p-2 hover:bg-gray-100 rounded-lg transition-colors">
            <i class="fa-solid fa-xmark" style="color: var(--color-text-muted)"></i>
          </button>
        </div>
        <div class="p-6 space-y-4">
          <div class="p-3 rounded-lg bg-amber-50 border border-amber-100 mb-2">
            <p class="text-[12px] text-amber-700 font-medium">กำลังเติมสินค้า:</p>
            <p class="text-[15px] text-amber-900 font-bold">{{ restockForm.item_name }}</p>
          </div>
          <div class="space-y-1">
            <label class="text-[13px] font-medium" style="color: var(--color-text-primary)">จำนวนที่ต้องการเติม</label>
            <div class="flex gap-2">
              <input v-model.number="restockForm.amount" type="number" min="1" class="flex-1 px-3 py-2 border rounded-lg text-[13px] focus:outline-none focus:ring-1" style="border-color: var(--color-border); background: var(--color-bg-body)" />
              <div class="px-4 py-2 border rounded-lg text-[13px] bg-gray-50 flex items-center justify-center min-w-[60px]" style="border-color: var(--color-border)">
                {{ restockForm.unit }}
              </div>
            </div>
          </div>
          <div class="space-y-1">
            <label class="text-[13px] font-medium" style="color: var(--color-text-primary)">หมายเหตุ</label>
            <textarea v-model="restockForm.remark" rows="2" placeholder="ระบุรายละเอียดการเติมสินค้า (ถ้ามี)" class="w-full px-3 py-2 border rounded-lg text-[13px] focus:outline-none focus:ring-1" style="border-color: var(--color-border); background: var(--color-bg-body)"></textarea>
          </div>
        </div>
        <div class="p-6 border-t flex gap-3" style="border-color: var(--color-border)">
          <button @click="isRestockModalOpen = false" class="flex-1 py-2 rounded-lg text-[14px] font-medium border hover:bg-gray-50 transition-all" style="border-color: var(--color-border); color: var(--color-text-secondary)">
            ยกเลิก
          </button>
          <button 
            @click="handleRestock" 
            :disabled="saving"
            class="flex-2 py-2 px-6 rounded-lg text-[14px] font-medium text-white transition-all hover:opacity-90 disabled:opacity-50" 
            style="background: var(--color-primary)"
          >
            {{ saving ? 'กำลังบันทึก...' : 'ยืนยันการเติมสินค้า' }}
          </button>
        </div>
      </div>
    </div>
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

/* Prevent body scroll when modal/sidebar is open */
body.no-scroll {
  overflow: hidden;
}

input:focus, select:focus, textarea:focus {
  border-color: var(--color-primary) !important;
  box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.1);
}
</style>
