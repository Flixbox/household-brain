import { auth } from '@household-brain/firebase/firebase'
import { MEMBER_SCOPES, TASKS_SCOPE, cachedCalendarToken, forgetCalendarToken, hasCalendarToken } from '@household-brain/entries/lib/google-token'
import { type GoogleTask, type TasksApi, createTasksApi } from '@household-brain/entries/lib/tasks/api'
import { addImportedItem } from './store'
import { eventIdForTask } from './ids'
import { importedTask } from './task-import'
import { repairedDraft } from './draft'
import { logErrorOnce, logEvent, logRecovered } from '@household-brain/entries/lib/logs'
import { entryLogMessage } from '@household-brain/entries/lib/logs-messages'
import { hasText } from '@household-brain/core/lib/read'

/**
 * One task: an entry when its notes hold the Gem's JSON (#118), then ticked off. The entry is saved
 * first, under an id that comes from the task, so an interruption before the tick never imports it
 * twice: the next pull finds the entry and only ticks the task off. What the entry schema doesn't
 * take is repaired rather than refused (`repairedDraft`), and the log says what was changed.
 */
const takeTask = async (api: TasksApi, listId: string, task: GoogleTask): Promise<void> => {
  const imported = importedTask(task)
  const id = eventIdForTask(task.id)
  if (imported && hasText(id)) {
    const { draft, repairs } = repairedDraft(imported.draft)
    const added = await addImportedItem(id, draft, task.id)
    if (added) {
      logEvent(entryLogMessage('Imported', draft.title), id, repairs.length > 0 ? `Repaired: ${repairs.join('; ')}` : '')
    }
    await api.completeTask(listId, task.id)
  }
}

/** In order, one task after the other, as the calendar pull applies events. */
const inOrder = async <Entry>(entries: readonly Entry[], take: (entry: Entry) => Promise<void>): Promise<void> =>
  entries.reduce<Promise<void>>(async (previous, entry) => {
    await previous
    await take(entry)
  }, Promise.resolve())

/** Every list, not just one: the Gemini app doesn't always use the list it was told to. */
const importOpenTasks = async (api: TasksApi): Promise<void> => {
  await inOrder(await api.listTaskLists(), async list =>
    inOrder((await api.listOpenTasks(list.id)).filter(task => task.id !== ''), async task => takeTask(api, list.id, task)))
}

const tasksScopes = [...MEMBER_SCOPES, TASKS_SCOPE] as const
const account = () => auth.currentUser?.email
const tasksApi = createTasksApi({
  forgetToken: forgetCalendarToken,
  token: async () => {
    const token = cachedCalendarToken(tasksScopes, account())
    return hasText(token) ? Promise.resolve(token) : Promise.reject(new Error('Google Tasks access is no longer available'))
  },
})

/**
 * Imports the Gem's open tasks, only while the cached Google token already covers Tasks (granted
 * when connecting in Settings): a background pull never asks Google for a new permission.
 */
export const importTasks = async (): Promise<void> => {
  if (!hasCalendarToken(tasksScopes, account())) {
    // Syncing, but without Tasks access: say so, instead of tasks quietly piling up in the inbox.
    if (hasCalendarToken(MEMBER_SCOPES, account())) {
      logErrorOnce('tasks-access', 'Google Tasks import paused', 'This device has no Google Tasks access yet. It is asked for with the next Google window: Sync now once the current access expires (within the hour), or Settings.')
    }
    return
  }
  // Tasks are an optional way in: a failure (the API switched off, no network) is tried again
  // next pull and must not fail the calendar pull before it.
  logRecovered('tasks-access')
  await importOpenTasks(tasksApi).then(() => { logRecovered('tasks-import') }, (error: unknown) => {
    logErrorOnce('tasks-import', 'Google Tasks import failed', error)
  })
}
