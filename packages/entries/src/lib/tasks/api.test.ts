import { describe, expect, it } from 'vitest'
import { createTasksApi } from './api'

const access = () => ({
  forgetToken: () => null,
  token: async () => 'tasks-token',
})

const response = (body: unknown, status = 200) => new Response(JSON.stringify(body) ?? '', { status })

describe('createTasksApi', () => {
  it('reads every task list and every open-task page', async () => {
    const requests: string[] = []
    const fetchFn = async (url: string, init: RequestInit) => {
      requests.push(`${init.method} ${url}`)
      const parsed = new URL(url)
      if (parsed.pathname === '/tasks/v1/users/@me/lists' && !parsed.search) {
        return response({ items: [{ id: 'list-1' }], nextPageToken: 'lists-2' })
      }
      if (parsed.pathname === '/tasks/v1/users/@me/lists' && parsed.searchParams.get('pageToken') === 'lists-2') {
        return response({ items: [{ id: 'list-2' }] })
      }
      if (parsed.pathname === '/tasks/v1/lists/list-1/tasks' && !parsed.searchParams.has('pageToken')) {
        return response({ items: [{ id: 'task-1', notes: '{"title":"One"}' }], nextPageToken: 'tasks-2' })
      }
      return response({ items: [{ id: 'task-2', notes: '{"title":"Two"}' }] })
    }
    const api = createTasksApi(access(), fetchFn)

    expect(await api.listTaskLists()).toEqual([{ id: 'list-1' }, { id: 'list-2' }])
    expect(await api.listOpenTasks('list-1')).toEqual([{ id: 'task-1', notes: '{"title":"One"}' }, { id: 'task-2', notes: '{"title":"Two"}' }])
    expect(requests).toEqual([
      'GET https://tasks.googleapis.com/tasks/v1/users/@me/lists',
      'GET https://tasks.googleapis.com/tasks/v1/users/@me/lists?pageToken=lists-2',
      'GET https://tasks.googleapis.com/tasks/v1/lists/list-1/tasks?showCompleted=false&showHidden=false',
      'GET https://tasks.googleapis.com/tasks/v1/lists/list-1/tasks?showCompleted=false&showHidden=false&pageToken=tasks-2',
    ])
  })

  it('marks a task completed', async () => {
    const bodies: unknown[] = []
    const fetchFn = async (url: string, init: RequestInit) => {
      expect(url).toBe('https://tasks.googleapis.com/tasks/v1/lists/list-1/tasks/task-1')
      bodies.push(JSON.parse(String(init.body)))
      return response({ id: 'task-1', status: 'completed' })
    }
    await createTasksApi(access(), fetchFn).completeTask('list-1', 'task-1')
    expect(bodies).toEqual([{ status: 'completed' }])
  })

  it('does not ask for a new token after a rejected cached token', async () => {
    let calls = 0
    let forgotten = 0
    const fetchFn = async () => {
      calls += 1
      return new Response('', { status: 401 })
    }
    const api = createTasksApi({
      forgetToken: () => { forgotten += 1 },
      token: async () => 'stale-token',
    }, fetchFn)

    await expect(api.completeTask('list-1', 'task-1')).rejects.toMatchObject({ name: 'TasksApiError', status: 401 })
    expect(calls).toBe(1)
    expect(forgotten).toBe(1)
  })
})
