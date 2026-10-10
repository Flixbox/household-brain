import { auth } from '@household-brain/firebase/firebase'
import { MEMBER_SCOPES, TASKS_SCOPE, cachedCalendarToken, forgetCalendarToken, hasCalendarToken } from '@household-brain/entries/lib/google-token'
import { type GoogleTask, type TasksApi, createTasksApi } from '@household-brain/entries/lib/tasks/api'
import { addImportedItem } from './store'
import { eventIdForTask } from './ids'
import { importedTask } from './task-import'

/**
 * One task: an entry when its notes hold the Gem's JSON (#118), then ticked off. The entry is saved
 * first, under an id that comes from the task, so an interruption before the tick never imports it
 * twice: the next pull finds the entry and only ticks the task off.
 */
const takeTask = async (api: TasksApi, listId: string, task: GoogleTask): Promise<void> => {
  const imported = importedTask(task)
  const id = eventIdForTask(task.id)
  if (imported && id) {
    await addImportedItem(id, imported.draft, task.id)
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
  await inOrder(await api.listTaskLists(), async list =>
    inOrder((await api.listOpenTasks(list.id)).filter(task => task.id !== ''), task => takeTask(api, list.id, task)))
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
