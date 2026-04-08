<script setup>
import { ref } from 'vue'
import { useNotificationsStore } from '@/stores/notifications'

const store = useNotificationsStore()
const open = ref(false)

function timeAgo(isoString) {
  const diff = Math.floor((Date.now() - new Date(isoString)) / 60000)
  if (diff < 1) return 'เมื่อกี้'
  if (diff < 60) return `${diff} นาทีที่แล้ว`
  if (diff < 1440) return `${Math.floor(diff/60)} ชั่วโมงที่แล้ว`
  return `${Math.floor(diff/1440)} วันที่แล้ว`
}

function handleClickOutside() { open.value = false }
</script>

<template>
  <div class="relative" v-click-outside="handleClickOutside">
    <button @click="open = !open"
            class="relative p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-700 text-[15px]"
            style="color: var(--color-text-secondary)">
      <i class="fa-solid fa-bell"></i>
      <span v-if="store.unreadCount > 0"
            class="absolute top-1 right-1 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[10px] flex items-center justify-center font-medium">
        {{ store.unreadCount }}
      </span>
    </button>

    <div v-if="open"
         class="absolute right-0 top-full mt-2 w-80 rounded-xl border shadow-sm z-50"
         style="background: var(--color-bg-card); border-color: var(--color-border)">
      <div class="flex items-center justify-between px-4 py-3 border-b"
           style="border-color: var(--color-border)">
        <span class="font-medium text-[13px]" style="color: var(--color-text-primary)">การแจ้งเตือน</span>
        <button @click="store.markAllAsRead()"
                class="text-[12px] text-primary-DEFAULT hover:underline">
          ทำเครื่องหมายทั้งหมด
        </button>
      </div>
      <ul>
        <li v-for="n in store.latest5" :key="n.id"
            @click="store.markAsRead(n.id)"
            class="px-4 py-3 cursor-pointer border-b last:border-b-0 transition-colors hover:bg-gray-50 dark:hover:bg-slate-700"
            :class="!n.is_read ? 'border-l-[3px] border-l-rose-400 bg-primary-light/50 dark:bg-gray-50/20' : ''"
            style="border-bottom-color: var(--color-border)">
          <p class="text-[13px] font-medium" style="color: var(--color-text-primary)">{{ n.title }}</p>
          <p class="text-[12px] truncate mt-0.5" style="color: var(--color-text-muted)">{{ n.message }}</p>
          <p class="text-[11px] mt-1" style="color: var(--color-text-muted)">{{ timeAgo(n.created_at) }}</p>
        </li>
      </ul>
    </div>
  </div>
</template>
