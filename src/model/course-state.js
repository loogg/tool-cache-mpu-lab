export const COURSE_STORAGE_KEY = 'cache-mpu-lab:course:v2'

export const DEFAULT_COURSE_STATE = Object.freeze({
  completed: [],
  lastLesson: 'cache-line',
  speed: 1,
  mode: 'home',
})

export function parseCourseState(raw, validLessonIds = []) {
  if (!raw) return { ...DEFAULT_COURSE_STATE }
  try {
    const value = JSON.parse(raw)
    const allowed = new Set(validLessonIds)
    const completed = Array.isArray(value.completed) ? value.completed.filter((id) => allowed.has(id)) : []
    const lastLesson = allowed.has(value.lastLesson) ? value.lastLesson : DEFAULT_COURSE_STATE.lastLesson
    const speed = [0.5, 1, 2].includes(Number(value.speed)) ? Number(value.speed) : 1
    const mode = ['home', 'course', 'lab'].includes(value.mode) ? value.mode : 'home'
    return { completed: [...new Set(completed)], lastLesson, speed, mode }
  } catch {
    return { ...DEFAULT_COURSE_STATE }
  }
}

export function serializeCourseState(state) {
  return JSON.stringify({
    completed: [...new Set(state.completed ?? [])],
    lastLesson: state.lastLesson ?? DEFAULT_COURSE_STATE.lastLesson,
    speed: [0.5, 1, 2].includes(Number(state.speed)) ? Number(state.speed) : 1,
    mode: ['home', 'course', 'lab'].includes(state.mode) ? state.mode : 'home',
  })
}
