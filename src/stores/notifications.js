import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { supabase } from '@/lib/supabase'

const READ_LS_KEY = 'mwm_notif_read_ids'

function loadReadIds() {
  try {
    const raw = localStorage.getItem(READ_LS_KEY)
    if (!raw) return new Set()
    const arr = JSON.parse(raw)
    return new Set(Array.isArray(arr) ? arr : [])
  } catch {
    return new Set()
  }
}

function saveReadIds(set) {
  localStorage.setItem(READ_LS_KEY, JSON.stringify([...set]))
}

export const useNotificationsStore = defineStore('notifications', () => {
  const notifications = ref([])
  const loading = ref(false)
  const readIds = ref(loadReadIds())

  const unreadCount = computed(() => notifications.value.filter((n) => !readIds.value.has(n.id)).length)

  const latest5 = computed(() =>
    [...notifications.value].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 8)
  )

  async function refresh() {
    loading.value = true
    try {
      const [lowRes, pendingRes] = await Promise.all([
        supabase
          .from('items')
          .select('id, item_name, item_code, current_stock, unit, created_at, updated_at')
          .lte('current_stock', 5)
          .order('current_stock', { ascending: true })
          .limit(20),
        supabase
          .from('order_req')
          .select('id, amount, unit, created_at, items(item_name, item_code)')
          .eq('status', 'pending')
          .order('created_at', { ascending: false })
          .limit(20),
      ])

      if (lowRes.error) throw lowRes.error
      if (pendingRes.error) throw pendingRes.error

      const list = []

      for (const it of lowRes.data || []) {
        const stock = Number(it.current_stock ?? 0)
        const title = stock <= 2 ? 'สินค้าวิกฤต' : 'สินค้าใกล้หมด'
        const t = it.updated_at || it.created_at
        list.push({
          id: `stock-${it.id}`,
          title,
          message: `${it.item_name || it.item_code || 'สินค้า'} เหลือเพียง ${stock} ${it.unit || ''}`.trim(),
          created_at: t,
          is_read: readIds.value.has(`stock-${it.id}`),
        })
      }

      for (const o of pendingRes.data || []) {
        const name = o.items?.item_name || o.items?.item_code || 'สินค้า'
        list.push({
          id: `req-${o.id}`,
          title: 'คำขอเบิกใหม่',
          message: `${name} — จำนวน ${o.amount} ${o.unit || ''} (รออนุมัติ)`.trim(),
          created_at: o.created_at,
          is_read: readIds.value.has(`req-${o.id}`),
        })
      }

      list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      notifications.value = list.slice(0, 25)
    } catch (err) {
      console.error('notifications refresh:', err)
      notifications.value = []
    } finally {
      loading.value = false
    }
  }

  function markAsRead(id) {
    const next = new Set(readIds.value)
    next.add(id)
    readIds.value = next
    saveReadIds(next)
  }

  function markAllAsRead() {
    const next = new Set(readIds.value)
    for (const n of notifications.value) next.add(n.id)
    readIds.value = next
    saveReadIds(next)
  }

  return { notifications, readIds, loading, unreadCount, latest5, refresh, markAsRead, markAllAsRead }
})
