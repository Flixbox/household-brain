import { getDocs } from 'firebase/firestore'
import { auth } from '@household-brain/firebase/firebase'
import { itemFrom } from '@household-brain/calendar/lib/documents'
import { MEMBER_SCOPES, TASKS_SCOPE, cachedCalendarToken, forgetCalendarToken, hasCalendarToken } from '@household-brain/calendar/lib/google-token'
import { type GoogleTask, type TasksApi, createTasksApi } from '@household-brain/calendar/lib/tasks/api'
import { addItem, itemsCollection } from './store'
import { importedTask } from './task-import'

/** Task ids entries already came from: such a task is only ticked off, never imported twice. */
const importedTaskIds = async (): Promise<Set<string>> => {
  const { docs } = await getDocs(itemsCollection)
  return new Set(docs.flatMap(entry => itemFrom(entry.id, entry.data()).taskId ?? []))
}

/**
 * One task: a new entry when its notes hold the Gem's JSON (#118), then ticked off. The entry
 * carries the task id first, so an interruption before the tick never imports it twice.
 */
const takeTask = async (api: TasksApi, { listId, task }: { listId: string, task: GoogleTask }, known: Set<string>): Promise<void> => {
  const imported = known.has(task.id) ? null : importedTask(task)
  if (imported) {
    await addItem(imported.draft, [], imported.taskId).written
    known.add(imported.taskId)
  }
  if (known.has(task.id)) {
    await api.completeTask(listId, task.id)
  }
}

/** In order, one task after the other, as the calendar pull applies events. */
const inOrder = <Entry>(entries: readonly Entry[], take: (entry: Entry) => Promise<void>): Promise<void> =>
  entries.reduce<Promise<void>>(async (previous, entry) => {
    await previous
    await take(entry)
  }, Promise.resolve())

/** Every list, not just one: the Gemini app doesn't always use the list it was told to. */
const importOpenTasks = async (api: TasksApi): Promise<void> => {
  const known = await importedTaskIds()
  await inOrder(await api.listTaskLists(), async list =>
    inOrder((await api.listOpenTasks(list.id)).filter(task => task.id !== ''), task => takeTask(api, { listId: list.id, task }, known)))
}

const tasksScopes = [...MEMBER_SCOPES, TASKS_SCOPE] as const
const account = () => auth.currentUser?.email
const tasksApi = createTasksApi({
  forgetToken: forgetCalendarToken,
  token: () => {
    const token = cachedCalendarToken(tasksScopes, account())
    return token ? Promise.resolve(token) : Promise.reject(new Error('Google Tasks access is no longer available'))
  },
})

/**
 * Imports the Gem's open tasks, only while the cached Google token already covers Tasks (granted
 * when connecting in Settings): a background pull never asks Google for a new permission.
 */
export const importTasks = async (): Promise<void> => {
  if (!hasCalendarToken(tasksScopes, account())) {
    return
  }
  // Tasks are an optional way in: a failure (the API switched off, no network) is tried again
  // next pull and must not fail the calendar pull before it.
  await importOpenTasks(tasksApi).catch(() => null)
}
