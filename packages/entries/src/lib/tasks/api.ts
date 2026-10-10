const BASE = 'https://tasks.googleapis.com/tasks/v1'

export class TasksApiError extends Error {
  public readonly status: number

  public constructor(status: number, message: string) {
    super(message)
    this.name = 'TasksApiError'
    this.status = status
  }
}

export interface TaskList {
  id: string
  title?: string
}

export interface GoogleTask {
  id: string
  title?: string
  notes?: string
  status?: string
}

export interface TasksApi {
  listTaskLists: () => Promise<TaskList[]>
  listOpenTasks: (taskListId: string) => Promise<GoogleTask[]>
  completeTask: (taskListId: string, taskId: string) => Promise<void>
}

interface Access {
  token: () => Promise<string>
  forgetToken: () => void
}

interface ApiRequest {
  method: string
  path: string
  body?: unknown
}

type Fetch = (input: string, init: RequestInit) => Promise<Response>
type Call = <Result>(request: ApiRequest) => Promise<Result>

const id = encodeURIComponent

const createCall = (access: Access, fetchFn: Fetch): Call => {
  const send = async ({ method, path, body = null }: ApiRequest) => fetchFn(`${BASE}${path}`, {
    body: body === null ? null : JSON.stringify(body),
    headers: { Authorization: `Bearer ${await access.token()}`, 'Content-Type': 'application/json' },
    method,
  })
  return async <Result>(request: ApiRequest): Promise<Result> => {
    const response = await send(request)
    if (response.status === 401) {
      // A background Tasks pull must not turn an invalid cached token into a consent prompt.
      access.forgetToken()
    }
    if (!response.ok) {
      const detail = await response.text()
      throw new TasksApiError(response.status, `Google Tasks ${request.method} ${request.path} failed (${response.status}): ${detail}`)
    }
    return JSON.parse(response.status === 204 ? '{}' : await response.text())
  }
}

/** Every item of a paged listing, following `nextPageToken` from page to page. */
const allItems = async <Item>(call: Call, listing: { path: string, query: Record<string, string> }, before: { items: Item[], pageToken?: string } = { items: [] }): Promise<Item[]> => {
  const query = new URLSearchParams({ ...listing.query, ...before.pageToken ? { pageToken: before.pageToken } : {} }).toString()
  const page = await call<{ items?: Item[], nextPageToken?: string }>({ method: 'GET', path: `${listing.path}${query ? `?${query}` : ''}` })
  const items = [...before.items, ...page.items ?? []]
  return page.nextPageToken ? allItems(call, listing, { items, pageToken: page.nextPageToken }) : items
}

export const createTasksApi = (access: Access, fetchFn: Fetch = (input, init) => fetch(input, init)): TasksApi => {
  const call = createCall(access, fetchFn)
  return {
    completeTask: async (taskListId, taskId) => {
      await call({ body: { status: 'completed' }, method: 'PATCH', path: `/lists/${id(taskListId)}/tasks/${id(taskId)}` })
    },
    listOpenTasks: (taskListId: string) => allItems<GoogleTask>(call, { path: `/lists/${id(taskListId)}/tasks`, query: { showCompleted: 'false', showHidden: 'false' } }),
    listTaskLists: () => allItems<TaskList>(call, { path: '/users/@me/lists', query: {} }),
  }
}
