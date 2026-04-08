import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { mockNotifications } from '@/lib/mockData'

export const useNotificationsStore = defineStore('notifications', () => {
  const notifications = ref([...mockNotifications])
  const unreadCount = computed(() => notifications.value.filter(n => !n.is_read).length)
  const latest5 = computed(() =>
    [...notifications.value].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 5)
  )

  function markAsRead(id) {
    const n = notifications.value.find(n => n.id === id)
    if (n) n.is_read = true
  }

  function markAllAsRead() {
    notifications.value.forEach(n => n.is_read = true)
  }

  return { notifications, unreadCount, latest5, markAsRead, markAllAsRead }
})
