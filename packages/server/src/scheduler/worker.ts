import type { AppDatabase } from '../db.js'
import { claimNextTask, completeTask, failTask, reclaimStaleTasks, type TaskRow, type TaskType } from './task-queue.js'

export type TaskHandler = (db: AppDatabase, task: TaskRow) => Promise<unknown>

export type WorkerOptions = {
  pollIntervalMs?: number
  staleAfterMs?: number
}

class TaskWorker {
  private readonly handlers = new Map<TaskType, TaskHandler>()
  private timer: NodeJS.Timeout | null = null
  private pollIntervalMs: number
  private staleAfterMs: number
  private busy = false

  constructor(private readonly db: AppDatabase, options: WorkerOptions = {}) {
    this.pollIntervalMs = options.pollIntervalMs ?? 1000
    this.staleAfterMs = options.staleAfterMs ?? 5 * 60 * 1000
  }

  register(type: TaskType, handler: TaskHandler) {
    this.handlers.set(type, handler)
  }

  start() {
    if (this.timer) return
    reclaimStaleTasks(this.db, this.staleAfterMs)
    this.timer = setInterval(() => { void this.tick() }, this.pollIntervalMs)
  }

  stop() {
    if (!this.timer) return
    clearInterval(this.timer)
    this.timer = null
  }

  async runOnce(): Promise<TaskRow | null> {
    const task = claimNextTask(this.db)
    if (!task) return null
    await this.execute(task)
    return task
  }

  private async tick() {
    if (this.busy) return
    this.busy = true
    try {
      const task = claimNextTask(this.db)
      if (!task) return
      await this.execute(task)
    } finally {
      this.busy = false
    }
  }

  private async execute(task: TaskRow) {
    const handler = this.handlers.get(task.type)
    if (!handler) {
      failTask(this.db, task.id, { message: `no handler for task type ${task.type}` })
      return
    }
    try {
      const result = await handler(this.db, task)
      completeTask(this.db, task.id, result)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const retryAfterMs = extractRetryDelayMs(message)
      failTask(this.db, task.id, { message, retryAfterMs })
    }
  }
}

let workerInstance: TaskWorker | null = null

export function getWorker(db: AppDatabase, options: WorkerOptions = {}): TaskWorker {
  if (!workerInstance) workerInstance = new TaskWorker(db, options)
  return workerInstance
}

export function resetWorkerForTest() {
  workerInstance?.stop()
  workerInstance = null
}

function extractRetryDelayMs(message: string): number | undefined {
  const match = message.match(/retry(?:Delay|.*?retry in)\D*(\d+(?:\.\d+)?)\s*s/i)
  if (match && match[1]) {
    const seconds = Number(match[1])
    if (Number.isFinite(seconds)) return Math.ceil((seconds + 2) * 1000)
  }
  if (/429|rate.?limit|quota/i.test(message)) return 60_000
  return undefined
}
