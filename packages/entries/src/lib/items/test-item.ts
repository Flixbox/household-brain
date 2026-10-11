import type { Item } from './model'

/** A complete entry for unit tests to spread and override, so no test has to cast a partial one. */
export const testItem: Item = {
  amount: '', category: 'coupon', code: '', currency: '', dirty: [], dueDate: '2026-11-03', etags: {}, id: 'evt1', interval: '', notes: '', pendingOp: 'upsert', reminders: '', rev: 'r1', startDate: '', status: 'open', sync: 'pending', syncError: null, title: 'Amazon', url: '',
}
