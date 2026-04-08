import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useUiStore = defineStore('ui', () => {
  const toast = ref({ show: false, message: '' })
  const sidebarOpen = ref(false)

  function showToast(message, duration = 3000) {
    toast.value = { show: true, message }
    setTimeout(() => toast.value.show = false, duration)
  }

  function toggleSidebar() {
    sidebarOpen.value = !sidebarOpen.value
  }

  return { toast, sidebarOpen, showToast, toggleSidebar }
})
