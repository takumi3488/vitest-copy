import type { WorkerGlobalState } from '../types/worker'
import { Console } from 'node:console'
import { relative } from 'node:path'
import { Writable } from 'node:stream'
import { getSafeTimers } from '@vitest/utils'
import c from 'tinyrainbow'
import { RealDate } from '../integrations/mock/date'
import { getWorkerState } from './utils'

export const UNKNOWN_TEST_ID = '__vitest__unknown_test__'

function getTaskIdByStack(root: string) {
  const stack = new Error('STACK_TRACE_ERROR').stack?.split('\n')

  if (!stack) {
    return UNKNOWN_TEST_ID
  }

  const index = stack.findIndex(line => line.includes('at Console.value'))
  const line = index === -1 ? null : stack[index + 2]

  if (!line) {
    return UNKNOWN_TEST_ID
  }

  const filepath = line.match(/at\s(.*)\s?/)?.[1]

  if (filepath) {
    return relative(root, filepath)
  }

  return UNKNOWN_TEST_ID
}

export function createCustomConsole(defaultState?: WorkerGlobalState) {
  const stdoutBuffer = new Map<string, any[]>()
  const stderrBuffer = new Map<string, any[]>()
  const timers = new Map<
    string,
    { stdoutTime: number; stderrTime: number; timer: any }
  >()

  const { setTimeout, clearTimeout } = getSafeTimers()

  const state = () => defaultState || getWorkerState()

  // group sync console.log calls with macro task
  function schedule(taskId: string) {
    const timer = timers.get(taskId)!
    const { stdoutTime, stderrTime } = timer
    clearTimeout(timer.timer)
    timer.timer = setTimeout(() => {
      if (stderrTime < stdoutTime) {
        sendStderr(taskId)
        sendStdout(taskId)
      }
      else {
        sendStdout(taskId)
        sendStderr(taskId)
      }
    })
  }
  function sendStdout(taskId: string) {
    sendBuffer('stdout', taskId)
  }

  function sendStderr(taskId: string) {
    sendBuffer('stderr', taskId)
  }

  function sendBuffer(type: 'stdout' | 'stderr', taskId: string) {
    const buffers = type === 'stdout' ? stdoutBuffer : stderrBuffer
    const buffer = buffers.get(taskId)
    if (!buffer) {
      return
    }
    if (state().config.printConsoleTrace) {
      buffer.forEach(([buffer, origin]) => {
        sendLog(type, taskId, String(buffer), buffer.length, origin)
      })
    }
    else {
      const content = buffer.map(i => String(i[0])).join('')
      sendLog(type, taskId, content, buffer.length)
    }
    const timer = timers.get(taskId)!
    buffers.delete(taskId)
    if (type === 'stderr') {
      timer.stderrTime = 0
    }
    else {
      timer.stdoutTime = 0
    }
  }

  function sendLog(
    type: 'stderr' | 'stdout',
    taskId: string,
    content: string,
    size: number,
    origin?: string,
  ) {
    const timer = timers.get(taskId)!
    const time = type === 'stderr' ? timer.stderrTime : timer.stdoutTime
    state().rpc.onUserConsoleLog({
      type,
      content: content || '<empty line>',
      taskId,
      time: time || RealDate.now(),
      size,
      origin,
    })
  }

  const stdout = new Writable({
    write(data, encoding, callback) {
      const s = state()
      const id
        = s?.current?.id
        || s?.current?.suite?.id
        || s.current?.file.id
        || getTaskIdByStack(s.config.root)
      let timer = timers.get(id)
      if (timer) {
        timer.stdoutTime = timer.stdoutTime || RealDate.now()
      }
      else {
        timer = {
          stdoutTime: RealDate.now(),
          stderrTime: RealDate.now(),
          timer: 0,
        }
        timers.set(id, timer)
      }
      let buffer = stdoutBuffer.get(id)
      if (!buffer) {
        buffer = []
        stdoutBuffer.set(id, buffer)
      }
      if (state().config.printConsoleTrace) {
        const limit = Error.stackTraceLimit
        Error.stackTraceLimit = limit + 6
        const stack = new Error('STACK_TRACE').stack
        const trace = stack?.split('\n').slice(7).join('\n')
        Error.stackTraceLimit = limit
        buffer.push([data, trace])
      }
      else {
        buffer.push([data, undefined])
      }
      schedule(id)
      callback()
    },
  })
  const stderr = new Writable({
    write(data, encoding, callback) {
      const s = state()
      const id
        = s?.current?.id
        || s?.current?.suite?.id
        || s.current?.file.id
        || getTaskIdByStack(s.config.root)
      let timer = timers.get(id)
      if (timer) {
        timer.stderrTime = timer.stderrTime || RealDate.now()
      }
      else {
        timer = {
          stderrTime: RealDate.now(),
          stdoutTime: RealDate.now(),
          timer: 0,
        }
        timers.set(id, timer)
      }
      let buffer = stderrBuffer.get(id)
      if (!buffer) {
        buffer = []
        stderrBuffer.set(id, buffer)
      }
      if (state().config.printConsoleTrace) {
        const limit = Error.stackTraceLimit
        Error.stackTraceLimit = limit + 6
        const stack = new Error('STACK_TRACE').stack?.split('\n')
        Error.stackTraceLimit = limit
        const isTrace = stack?.some(line =>
          line.includes('at Console.trace'),
        )
        if (isTrace) {
          buffer.push([data, undefined])
        }
        else {
          const trace = stack?.slice(7).join('\n')
          Error.stackTraceLimit = limit
          buffer.push([data, trace])
        }
      }
      else {
        buffer.push([data, undefined])
      }
      schedule(id)
      callback()
    },
  })
  return new Console({
    stdout,
    stderr,
    colorMode: c.isColorSupported,
    groupIndentation: 2,
  })
}
