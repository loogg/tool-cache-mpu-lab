import { simulateExperiment } from './simulation.js'

export const SCENE_TYPES = Object.freeze({
  CACHE_LINE: 'cache-line',
  PIPELINE: 'pipeline',
  MPU_REGION: 'mpu-region',
  DMA_COHERENCY: 'dma-coherency',
  BARRIER_TIMELINE: 'barrier-timeline',
  FAULT: 'fault',
})

const CACHE_LINE_SCENARIOS = new Set(['cache-read', 'cache-read-cross', 'store'])
const MPU_SCENARIOS = new Set(['decoder', 'alignment', 'region-size', 'subregion', 'subregion-denied', 'overlap', 'permission', 'xn', 'background', 'shareable', 'axi-split', 'guard'])
const DMA_SCENARIOS = new Set(['dma-tx', 'dma-rx', 'wrong-invalidate', 'rx-handoff', 'line-sharing'])
const BARRIER_SCENARIOS = new Set(['barrier', 'completion'])

export function sceneTypeForExperiment(experiment) {
  if (experiment.scenario === 'fault') return SCENE_TYPES.FAULT
  if (CACHE_LINE_SCENARIOS.has(experiment.scenario) && experiment.number <= 7) return SCENE_TYPES.CACHE_LINE
  if (MPU_SCENARIOS.has(experiment.scenario)) return SCENE_TYPES.MPU_REGION
  if (DMA_SCENARIOS.has(experiment.scenario)) return SCENE_TYPES.DMA_COHERENCY
  if (BARRIER_SCENARIOS.has(experiment.scenario)) return SCENE_TYPES.BARRIER_TIMELINE
  return SCENE_TYPES.PIPELINE
}

const NODE_PATH = ['cpu', 'mpu', 'icache', 'dcache', 'store', 'bus', 'memory', 'device', 'dma', 'fault']

function eventKind(frame, scenario) {
  const text = `${frame.title} ${frame.detail}`.toLowerCase()
  const title = String(frame.title).toLowerCase()
  if (frame.status === 'fault' || frame.node === 'fault') return 'fault-raise'
  if (text.includes('invalidate')) return 'invalidate'
  if (text.includes('clean')) return 'clean'
  if (text.includes('dirty')) return 'set-dirty'
  if (title.includes('linefill') || title.includes('填充')) return 'cache-line-fill'
  if (title.includes('hit') || title.includes('命中')) return 'cache-hit'
  if (text.includes('subregion') || text.includes('srd')) return 'subregion-mask'
  if (text.includes('region') || frame.node === 'mpu') return 'region-probe'
  if (text.includes('dmb') || text.includes('dsb') || scenario === 'barrier') return 'barrier'
  if (frame.node === 'store') return 'queue-store'
  if (frame.node === 'dma') return 'dma-observe'
  return 'move-token'
}

function certaintyForFrame(frame) {
  const text = `${frame.title} ${frame.detail}`
  if (/可能|允许|不一定|取决于/.test(text)) return 'possible'
  if (/示意|概念/.test(text)) return 'illustrative'
  return 'certain'
}

function nextNode(previous, current) {
  if (!previous || previous === current) return current
  const previousIndex = NODE_PATH.indexOf(previous)
  const currentIndex = NODE_PATH.indexOf(current)
  if (previousIndex === -1 || currentIndex === -1) return current
  return NODE_PATH[Math.max(0, Math.min(NODE_PATH.length - 1, currentIndex))]
}

export function buildSimulationTrace(experiment, settings) {
  const frames = simulateExperiment(experiment, settings)
  const outcome = frames.reduce((state, frame) => ({ ...state, ...frame }), {})
  const eventDurationMs = Math.max(1200, Math.min(2200, Math.round(9000 / frames.length)))
  const events = frames.map((frame, index) => {
    const previous = frames[index - 1]
    const startMs = index * eventDurationMs
    return {
      id: `${experiment.id}-${index + 1}`,
      index,
      kind: eventKind(frame, experiment.scenario),
      actor: frame.node === 'dma' ? 'dma' : 'cpu',
      from: previous?.node ?? frame.node,
      to: nextNode(previous?.node, frame.node),
      startMs,
      durationMs: eventDurationMs,
      payload: {
        address: settings.address,
        value: frame.dma ?? frame.memory ?? frame.cache ?? 'DATA',
        label: frame.title,
      },
      before: previous ? { ...previous } : {},
      after: { ...frame },
      caption: frame.detail,
      title: frame.title,
      certainty: certaintyForFrame(frame),
      status: frame.status,
    }
  })
  const durationMs = events.length * eventDurationMs
  return {
    id: experiment.id,
    scene: sceneTypeForExperiment(experiment),
    durationMs,
    chapters: events.map((event) => ({ id: event.id, timeMs: event.startMs, title: event.title })),
    events,
    snapshots: frames.map((frame, index) => ({ timeMs: index * eventDurationMs, state: { ...frame } })),
    outcome,
  }
}

export function clampPlayhead(trace, timeMs) {
  if (!Number.isFinite(timeMs)) return 0
  return Math.max(0, Math.min(trace.durationMs, timeMs))
}

export function sampleTrace(trace, timeMs) {
  const playheadMs = clampPlayhead(trace, timeMs)
  const isComplete = playheadMs >= trace.durationMs
  const fallback = trace.events.at(-1)
  const activeEvent = isComplete
    ? fallback
    : trace.events.find((event) => playheadMs >= event.startMs && playheadMs < event.startMs + event.durationMs) ?? trace.events[0]
  const eventProgress = isComplete || !activeEvent
    ? 1
    : Math.max(0, Math.min(1, (playheadMs - activeEvent.startMs) / activeEvent.durationMs))
  const completedEvents = trace.events.filter((event) => isComplete || event.startMs + event.durationMs <= playheadMs)
  const state = completedEvents.reduce((current, event) => ({ ...current, ...event.after }), {})
  if (activeEvent) Object.assign(state, activeEvent.after)
  return {
    playheadMs,
    progress: trace.durationMs ? playheadMs / trace.durationMs : 1,
    activeEvent,
    activeIndex: activeEvent?.index ?? 0,
    eventProgress,
    completedEvents,
    state,
    isComplete,
  }
}

export function previousEventTime(trace, timeMs) {
  const current = clampPlayhead(trace, timeMs)
  return [...trace.events].reverse().find((event) => event.startMs < current - 20)?.startMs ?? 0
}

export function nextEventTime(trace, timeMs) {
  const current = clampPlayhead(trace, timeMs)
  return trace.events.find((event) => event.startMs > current + 20)?.startMs ?? trace.durationMs
}

export function formatTraceTime(timeMs) {
  return `${(Math.max(0, timeMs) / 1000).toFixed(1)}s`
}
