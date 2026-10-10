import { readFileSync } from 'node:fs'
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing'
import { collection, collectionGroup, deleteDoc, doc, getDoc, getDocs, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore'
import { afterAll, beforeEach, describe, it } from 'vitest'

const env = await initializeTestEnvironment({
  firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  projectId: 'demo-household-brain',
})

afterAll(() => env.cleanup())

beforeEach(async () => {
  await env.clearFirestore()
  await env.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'allowlist/alice'), { name: 'Alice' })
    await setDoc(doc(context.firestore(), 'items/coupon-1'), { title: 'Coupon' })
  })
})

const as = (uid: string) => env.authenticatedContext(uid).firestore()

/** Every field the app writes when it adds an entry (`addItem`). */
const appEntry = {
  amount: '10', category: 'coupon', code: '', currency: '', dirty: ['title'], dueDate: '2026-12-01', etags: {}, extraDates: [],
  interval: '', notes: '', pendingOp: 'upsert', reminders: '', rev: 'r1', startDate: '', status: 'open', sync: 'pending',
  syncError: null, title: 'Coupon', updatedAt: serverTimestamp(), updatedBy: 'alice', url: '',
}

describe('data collections', () => {
  it('are closed to signed-out visitors', async () => {
    await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'items/coupon-1')))
  })

  it('are closed to signed-in accounts that are not on the allowlist', async () => {
    await assertFails(getDoc(doc(as('mallory'), 'items/coupon-1')))
    await assertFails(setDoc(doc(as('mallory'), 'items/coupon-2'), { title: 'x' }))
  })

  it('are open to allowlisted accounts', async () => {
    await assertSucceeds(getDoc(doc(as('alice'), 'items/coupon-1')))
    await assertSucceeds(setDoc(doc(as('alice'), 'items/coupon-2'), { ...appEntry, id: 'coupon-2' }))
    await assertSucceeds(updateDoc(doc(as('alice'), 'items/coupon-2'), { dirty: ['url'], notes: 'n'.repeat(400_000), url: 'https://shop.test' }))
    await assertSucceeds(updateDoc(doc(as('alice'), 'items/coupon-1'), { 'etags.alice': 'e1', 'status': 'done' }))
    await assertSucceeds(deleteDoc(doc(as('alice'), 'items/coupon-1')))
    await assertSucceeds(getDocs(collection(as('alice'), 'categories')))
  })

  it('refuse signed-out and non-member writes and deletes', async () => {
    await assertFails(setDoc(doc(env.unauthenticatedContext().firestore(), 'items/coupon-2'), { title: 'x' }))
    await assertFails(deleteDoc(doc(env.unauthenticatedContext().firestore(), 'items/coupon-1')))
    await assertFails(deleteDoc(doc(as('mallory'), 'items/coupon-1')))
  })

  it('refuse other collections, subcollections and collection-group queries', async () => {
    await assertFails(setDoc(doc(as('alice'), 'other/1'), { title: 'x' }))
    await assertFails(getDoc(doc(as('alice'), 'other/1')))
    await assertFails(setDoc(doc(as('alice'), 'syncState/alice/history/1'), { at: 1 }))
    await assertFails(setDoc(doc(as('alice'), 'items/coupon-1/notes/1'), { text: 'x' }))
    await assertFails(getDocs(collectionGroup(as('alice'), 'items')))
  })

  it('refuse unknown fields and oversized text, but keep fields an older version left behind', async () => {
    await assertFails(setDoc(doc(as('alice'), 'items/coupon-2'), { owner: 'mallory', title: 'x' }))
    await assertFails(setDoc(doc(as('alice'), 'items/coupon-2'), { title: 'x'.repeat(50_001) }))
    await assertFails(updateDoc(doc(as('alice'), 'items/coupon-1'), { notes: 'x'.repeat(500_001) }))
    await assertFails(setDoc(doc(as('alice'), 'items/coupon-2'), { id: 'coupon-3', title: 'x' }))
    await assertFails(setDoc(doc(as('alice'), 'categories/bills'), { colorId: '1', label: 'Bills', slug: 'other', sortOrder: 1 }))
    await assertSucceeds(setDoc(doc(as('alice'), 'categories/bills'), { colorId: '1', label: 'Bills', slug: 'bills', sortOrder: 1 }))
    await env.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), 'items/legacy'), { createdAt: 1, title: 'Old' }))
    await assertSucceeds(updateDoc(doc(as('alice'), 'items/legacy'), { title: 'Renamed' }))
  })
})

describe('meta/config', () => {
  const config = (calendarId: string) => ({ calendarId, ownerUid: 'alice', timeZone: 'Europe/Berlin' })

  it('is set once and then stays as it is', async () => {
    await assertSucceeds(setDoc(doc(as('alice'), 'meta/config'), config('household@group.calendar.test')))
    await assertFails(setDoc(doc(as('alice'), 'meta/config'), config('mallory@group.calendar.test')))
    await assertFails(updateDoc(doc(as('alice'), 'meta/config'), { ownerUid: 'mallory' }))
    await assertFails(updateDoc(doc(as('alice'), 'meta/config'), { timeZone: 'UTC' }))
    await assertFails(deleteDoc(doc(as('alice'), 'meta/config')))
    await assertFails(setDoc(doc(as('alice'), 'meta/other'), config('x')))
  })

  it('can be completed when the calendar is still missing', async () => {
    await env.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), 'meta/config'), config('')))
    await assertSucceeds(setDoc(doc(as('alice'), 'meta/config'), config('household@group.calendar.test')))
  })
})

describe('syncState', () => {
  beforeEach(() => env.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'allowlist/bob'), { name: 'Bob' })
    await setDoc(doc(context.firestore(), 'syncState/bob'), { schema: 4, syncToken: 'sync-1' })
  }))

  it('lets each person write only their own, and everyone read all', async () => {
    await assertSucceeds(setDoc(doc(as('alice'), 'syncState/alice'), { listingStartedAt: serverTimestamp() }, { merge: true }))
    await assertSucceeds(setDoc(doc(as('alice'), 'syncState/alice'), { readingRules: 2, syncToken: 's1' }, { merge: true }))
    await assertSucceeds(setDoc(doc(as('bob'), 'syncState/bob'), { schema: 5 }, { merge: true }))
    await assertSucceeds(getDocs(collection(as('alice'), 'syncState')))
    await assertSucceeds(getDocs(collection(as('bob'), 'syncState')))
    await assertFails(setDoc(doc(as('alice'), 'syncState/bob'), { syncToken: 'x' }, { merge: true }))
    await assertFails(deleteDoc(doc(as('alice'), 'syncState/bob')))
    await assertFails(setDoc(doc(as('alice'), 'syncState/alice'), { other: 1 }, { merge: true }))
  })
})

describe('allowlist', () => {
  it('lets a signed-in account read only its own entry', async () => {
    await assertSucceeds(getDoc(doc(as('alice'), 'allowlist/alice')))
    await assertSucceeds(getDoc(doc(as('mallory'), 'allowlist/mallory')))
    await assertFails(getDoc(doc(as('alice'), 'allowlist/bob')))
  })

  it('cannot be changed from the app, even by an allowlisted account', async () => {
    await assertFails(setDoc(doc(as('alice'), 'allowlist/mallory'), { name: 'Mallory' }))
    await assertFails(setDoc(doc(as('alice'), 'allowlist/alice'), { name: 'Changed' }))
    await assertFails(deleteDoc(doc(as('alice'), 'allowlist/alice')))
    await assertFails(setDoc(doc(as('mallory'), 'allowlist/mallory'), { name: 'Mallory' }))
    await assertFails(setDoc(doc(as('alice'), 'allowlist/alice/notes/1'), { text: 'x' }))
  })

  it('is closed to signed-out visitors and cannot be listed', async () => {
    await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'allowlist/alice')))
    await assertFails(getDocs(collection(as('alice'), 'allowlist')))
  })
})
