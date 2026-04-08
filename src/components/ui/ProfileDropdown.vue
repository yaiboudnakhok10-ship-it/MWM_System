<script setup>
import { ref } from 'vue'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const open = ref(false)
</script>

<template>
  <div class="relative">
    <button @click="open = !open"
            class="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors">
      <div class="w-8 h-8 rounded-full bg-blue-500 text-white flex items-center justify-center text-[12px] font-semibold shrink-0">
        {{ auth.initials }}
      </div>
      <div class="hidden sm:block text-left">
        <p class="text-[13px] font-medium leading-none" style="color: var(--color-text-primary)">{{ auth.user?.fullname }}</p>
        <p class="text-[11px] mt-0.5" style="color: var(--color-text-muted)">{{ auth.user?.emp_code }}</p>
      </div>
      <i class="fa-solid fa-chevron-down text-[10px] hidden sm:block" style="color: var(--color-text-muted)"></i>
    </button>

    <div v-if="open"
         class="absolute right-0 top-full mt-2 w-64 rounded-xl border shadow-sm z-50"
         style="background: var(--color-bg-card); border-color: var(--color-border)">
      <div class="px-4 py-4">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-full bg-blue-500 text-white flex items-center justify-center font-semibold">
            {{ auth.initials }}
          </div>
          <div>
            <p class="text-[14px] font-medium" style="color: var(--color-text-primary)">{{ auth.user?.fullname }}</p>
            <p class="text-[12px]" style="color: var(--color-text-muted)">{{ auth.user?.position }}</p>
            <p class="text-[12px]" style="color: var(--color-text-muted)">{{ auth.user?.department }}</p>
          </div>
        </div>
      </div>
      <hr style="border-color: var(--color-border)" />
      <ul class="p-2">
        <li>
          <button @click="alert('ฟีเจอร์นี้กำลังพัฒนา')"
                  class="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] hover:bg-gray-50 dark:hover:bg-slate-700 text-left"
                  style="color: var(--color-text-secondary)">
            <i class="fa-solid fa-user-pen w-4 text-center"></i>
            แก้ไขข้อมูลโปรไฟล์
          </button>
        </li>
        <li>
          <button @click="auth.logout()"
                  class="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] hover:bg-red-50 dark:hover:bg-red-900/20 text-left text-red-500">
            <i class="fa-solid fa-right-from-bracket w-4 text-center"></i>
            ออกจากระบบ
          </button>
        </li>
      </ul>
    </div>

    <div v-if="open" class="fixed inset-0 z-40" @click="open = false" />
  </div>
</template>
