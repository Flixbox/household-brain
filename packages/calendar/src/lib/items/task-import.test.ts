import { eventIdForTask, isEventId } from './ids'
import { describe, expect, it } from 'vitest'
import { importedTask, parseTaskNotes } from './task-import'

describe('parseTaskNotes', () => {
  it('accepts a clean object and a partial object with one fitting field', () => {
    expect(parseTaskNotes('{"title":"Cinema"}')).toEqual({ title: 'Cinema' })
    expect(parseTaskNotes('{"amount":"10.00","future":true}')).toEqual({ amount: '10.00', future: true })
  })

  it('rejects wrong types when there is no fitting known field', () => {
    expect(parseTaskNotes('{"title":7}')).toBeNull()
    expect(parseTaskNotes('{"amount":10}')).toBeNull()
    expect(parseTaskNotes('{"unknown":"value"}')).toBeNull()
  })

  it('rejects junk, arrays and prefixed text, but unwraps one exact JSON fence', () => {
    expect(parseTaskNotes('remember to call the bank')).toBeNull()
    expect(parseTaskNotes('[{"title":"Cinema"}]')).toBeNull()
    expect(parseTaskNotes('Here is the JSON: {"title":"Cinema"}')).toBeNull()
    expect(parseTaskNotes('```json\n{"title":"Cinema"}\n```')).toEqual({ title: 'Cinema' })
  })
})

describe('importedTask', () => {
  it('maps the Gem contract into an entry draft', () => {
    expect(importedTask({
      id: 'task-1',
      notes: JSON.stringify({ amount: '10.00', category: 'coupon', currency: 'eur', dueDate: '2026-12-31', interval: 'monthly', notes: 'Weekdays', startDate: '2026-01-01', title: 'Cinema', url: 'https://cinema.test' }),
      title: 'Task title',
    })).toEqual({
      draft: {
        amount: '10.00', category: 'coupon', code: '', currency: '', dueDate: '2026-12-31', interval: 'monthly', notes: 'Weekdays', reminders: '', startDate: '2026-01-01', status: 'open', title: 'Cinema', url: 'https://cinema.test',
      },
      taskId: 'task-1',
    })
  })

  it('falls back to the task title and paperwork, and clears invalid values', () => {
    expect(importedTask({
      id: 'task-2',
      notes: JSON.stringify({ amount: '10.000', category: 'unknown', dueDate: '2026-02-30', interval: 'sometimes', title: '  ' }),
      title: 'Task fallback',
    })?.draft).toEqual({
      amount: '', category: 'paperwork', code: '', currency: '', dueDate: '', interval: '', notes: '', reminders: '', startDate: '', status: 'open', title: 'Task fallback', url: '',
    })
  })
})

describe('eventIdForTask', () => {
  it('gives the same task the same valid event id, and different tasks different ones', () => {
    expect(eventIdForTask('MTIzNDU2Nzg5')).toBe(eventIdForTask('MTIzNDU2Nzg5'))
    expect(eventIdForTask('MTIzNDU2Nzg5')).not.toBe(eventIdForTask('MTIzNDU2Nzg6'))
    expect(isEventId(eventIdForTask('MTIzNDU2Nzg5'))).toBe(true)
  })
})
