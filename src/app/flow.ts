// state of the New review → Configure → Running flow (sessionStorage)
export interface RunConfig {
  source: string
  head: string
  base: string
  harnessId: string
  model?: string
}

const RUN_KEY = 'revai:run'
const SOURCE_KEY = 'revai:new'

export function saveRun(c: RunConfig) {
  sessionStorage.setItem(RUN_KEY, JSON.stringify(c))
}
export function loadRun(): RunConfig | null {
  try {
    return JSON.parse(sessionStorage.getItem(RUN_KEY) ?? 'null') as RunConfig | null
  } catch {
    return null
  }
}
export function clearRun() {
  sessionStorage.removeItem(RUN_KEY)
}
export function saveSource(s: string) {
  sessionStorage.setItem(SOURCE_KEY, JSON.stringify(s))
}
export function loadSource(): string | null {
  try {
    return JSON.parse(sessionStorage.getItem(SOURCE_KEY) ?? 'null') as string | null
  } catch {
    return null
  }
}
