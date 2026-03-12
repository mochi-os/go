import { createFileRoute } from '@tanstack/react-router'
import { useAuthStore } from '@mochi/common'
import { GoLayout } from '@/components/layout/go-layout'

export const Route = createFileRoute('/_authenticated')({
  beforeLoad: async () => {
    const store = useAuthStore.getState()
    if (!store.isInitialized) {
      await store.initialize()
    }
  },
  component: GoLayout,
})
