<script setup>
import { useUiStore } from '@/stores/ui'
const ui = useUiStore()
</script>

<template>
  <Transition enter-active-class="transition ease-out duration-200"
              enter-from-class="opacity-0 translate-y-2"
              enter-to-class="opacity-100 translate-y-0"
              leave-active-class="transition ease-in duration-150"
              leave-from-class="opacity-100"
              leave-to-class="opacity-0">
    <div v-if="ui.toast.show"
         class="fixed bottom-5 right-5 z-[100] flex items-center gap-3 px-4 py-3 rounded-xl border shadow-sm text-[13px]"
         style="background: var(--color-bg-card); border-color: var(--color-border); color: var(--color-text-primary)">
      <i class="fa-solid fa-circle-info text-primary-DEFAULT"></i>
      {{ ui.toast.message }}
    </div>
  </Transition>
</template>
