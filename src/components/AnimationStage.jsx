import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Gauge, Pause, Play, RotateCcw, SkipBack, SkipForward } from 'lucide-react'
import { formatHex, splitSubregions } from '../model/mpu.js'
import { formatTraceTime, nextEventTime, previousEventTime, sampleTrace, SCENE_TYPES } from '../model/trace.js'

const COLORS = {
  ink: '#14233d', blue: '#1768e5', blueSoft: '#eaf2ff', green: '#16815e', greenSoft: '#e7f7f0',
  amber: '#c67817', amberSoft: '#fff2dc', red: '#c34848', redSoft: '#fff0ef', muted: '#77869b', line: '#d7e0e8', violet: '#7157c8',
}

function useReducedMotion() {
  const [reduced, setReduced] = useState(() => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReduced(media.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  return reduced
}

function useCompactScene() {
  const [compact, setCompact] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 620px)').matches)
  useEffect(() => {
    const media = window.matchMedia('(max-width: 620px)')
    const update = () => setCompact(media.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  return compact
}

function ArrowDefs({ dashed = false }) {
  return (
    <defs>
      <marker id="scene-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
        <path d="M 0 0 L 10 5 L 0 10 z" fill={dashed ? COLORS.amber : COLORS.muted} />
      </marker>
      <filter id="scene-shadow" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="4" stdDeviation="5" floodOpacity=".13" /></filter>
    </defs>
  )
}

function SvgNode({ x, y, width = 120, height = 66, label, note, active, tone = 'blue' }) {
  const color = tone === 'red' ? COLORS.red : tone === 'green' ? COLORS.green : tone === 'amber' ? COLORS.amber : tone === 'violet' ? COLORS.violet : COLORS.blue
  return (
    <g transform={`translate(${x} ${y})`} filter={active ? 'url(#scene-shadow)' : undefined}>
      <rect width={width} height={height} rx="12" fill={active ? `${color}18` : '#fff'} stroke={active ? color : COLORS.line} strokeWidth={active ? 2 : 1} />
      <circle cx="20" cy="22" r="7" fill={color} opacity={active ? 1 : .35} />
      <text x="34" y="26" className="svg-node-label">{label}</text>
      <text x="14" y="48" className="svg-node-note">{note}</text>
    </g>
  )
}

function MovingToken({ from, to, progress, label = 'DATA', tone = 'blue', reducedMotion = false }) {
  const value = reducedMotion ? (progress > .45 ? 1 : 0) : Math.max(0, Math.min(1, progress))
  const x = from.x + (to.x - from.x) * value
  const y = from.y + (to.y - from.y) * value
  const color = tone === 'red' ? COLORS.red : tone === 'green' ? COLORS.green : tone === 'amber' ? COLORS.amber : COLORS.blue
  return (
    <g transform={`translate(${x} ${y})`} className="data-token">
      <rect x="-30" y="-13" width="60" height="26" rx="8" fill={color} />
      <text x="0" y="4" textAnchor="middle" fill="#fff" fontSize="10" fontWeight="800">{String(label).slice(0, 9)}</text>
    </g>
  )
}

function pathForEvent(event, points) {
  const normalize = (node) => ({ icache: 'cache', dcache: 'cache', store: 'store', bus: 'bus', memory: 'memory', device: 'device', fault: 'mpu' }[node] ?? node)
  return {
    from: points[normalize(event?.from)] ?? points.cpu,
    to: points[normalize(event?.to)] ?? points.memory,
  }
}

function CacheLineScene({ snapshot, reducedMotion, compact }) {
  const event = snapshot.activeEvent
  const fill = event?.kind === 'cache-line-fill' || /linefill|填充/i.test(`${event?.title}`)
  const history = [...snapshot.completedEvents, ...(snapshot.isComplete ? [] : [event])].filter(Boolean)
  const lastIndexOf = (kind) => history.reduce((found, item, index) => item.kind === kind ? index : found, -1)
  const filled = fill || lastIndexOf('cache-line-fill') > lastIndexOf('invalidate')
  const dirty = (event?.kind === 'set-dirty' || /dirty/i.test(`${snapshot.state.cache}`) || lastIndexOf('set-dirty') >= 0)
    && lastIndexOf('set-dirty') > Math.max(lastIndexOf('clean'), lastIndexOf('invalidate'))
  const hit = event?.kind === 'cache-hit' || /hit|命中/i.test(`${event?.title}`)
  const invalid = event?.kind === 'invalidate' || lastIndexOf('invalidate') > lastIndexOf('cache-line-fill')
  const viewBox = compact ? '0 0 360 620' : '0 0 900 420'
  const columns = compact ? 8 : 16
  const cellWidth = compact ? 34 : 36
  const gridX = compact ? 40 : 162
  const gridY = compact ? 286 : 204
  const from = compact ? { x: 180, y: 522 } : { x: 750, y: 96 }
  const to = compact ? { x: 180, y: 225 } : { x: 450, y: 128 }
  const normalFrom = compact ? { x: 180, y: 90 } : { x: 110, y: 96 }
  return (
    <svg viewBox={viewBox} role="img" aria-label="Cache Line 数据流动画">
      <ArrowDefs />
      {compact ? (
        <>
          <SvgNode x={100} y={28} width={160} label="CPU" note="Load / Store" active={event?.to === 'cpu' || event?.from === 'cpu'} />
          <line x1="180" y1="95" x2="180" y2="160" stroke={COLORS.muted} markerEnd="url(#scene-arrow)" />
          <SvgNode x={100} y={160} width={160} label="D-Cache" note={invalid ? 'INVALID' : dirty ? 'VALID · DIRTY' : hit ? 'HIT' : '查找 Tag'} active />
          <SvgNode x={100} y={505} width={160} label="物理内存" note="SRAM / SDRAM" active={fill} tone="green" />
        </>
      ) : (
        <>
          <SvgNode x={35} y={63} label="CPU" note="Load / Store" active={event?.from === 'cpu'} />
          <line x1="155" y1="96" x2="330" y2="96" stroke={COLORS.muted} markerEnd="url(#scene-arrow)" />
          <SvgNode x={330} y={63} width={190} label="D-Cache" note={invalid ? 'INVALID' : dirty ? 'VALID · DIRTY' : hit ? 'HIT' : 'Tag / 32B Line'} active />
          <line x1="520" y1="96" x2="690" y2="96" stroke={COLORS.muted} markerEnd="url(#scene-arrow)" />
          <SvgNode x={690} y={63} width={170} label="物理内存" note="SRAM / SDRAM" active={fill} tone="green" />
        </>
      )}
      <text x={gridX} y={gridY - 18} className="svg-section-title">32字节 CACHE LINE</text>
      {Array.from({ length: 32 }, (_, index) => {
        const row = Math.floor(index / columns)
        const col = index % columns
        const active = fill ? index <= Math.floor(snapshot.eventProgress * 31) : (filled || hit) && !invalid
        return (
          <g key={index} transform={`translate(${gridX + col * cellWidth} ${gridY + row * 42})`}>
            <rect width={cellWidth - 3} height="34" rx="5" fill={invalid ? '#f1f3f5' : active ? COLORS.blueSoft : dirty ? COLORS.amberSoft : '#fff'} stroke={active ? COLORS.blue : dirty ? COLORS.amber : COLORS.line} />
            <text x={(cellWidth - 3) / 2} y="15" textAnchor="middle" className="svg-byte-index">{index}</text>
            <text x={(cellWidth - 3) / 2} y="27" textAnchor="middle" className="svg-byte-value">{invalid ? '×' : active ? 'NEW' : '--'}</text>
          </g>
        )
      })}
      <MovingToken from={fill ? from : normalFrom} to={to} progress={snapshot.eventProgress} label={fill ? '32B' : hit ? 'HIT' : 'ADDR'} tone={fill ? 'green' : dirty ? 'amber' : 'blue'} reducedMotion={reducedMotion} />
      <g transform={`translate(${compact ? 44 : 665} ${compact ? 460 : 320})`}>
        <rect width={compact ? 272 : 195} height="66" rx="10" fill={dirty ? COLORS.amberSoft : hit ? COLORS.greenSoft : COLORS.blueSoft} />
        <text x="14" y="25" className="svg-result-label">{invalid ? 'CACHE副本已失效' : dirty ? 'VALID + DIRTY' : hit ? 'CACHE HIT' : fill ? 'LINEFILL进行中' : filled ? 'CACHE LINE有效' : '检查地址标签'}</text>
        <text x="14" y="46" className="svg-result-note">{dirty ? '最新值暂未写回物理内存' : hit ? 'CPU直接使用同一条Line' : filled ? '后续同Line访问可以命中' : '先根据地址查找Tag'}</text>
      </g>
    </svg>
  )
}

function PipelineScene({ snapshot, reducedMotion, compact }) {
  const event = snapshot.activeEvent
  const nodes = [
    ['cpu', 'CPU', '执行访问'], ['mpu', 'MPU', '匹配属性'], ['cache', 'I/D-Cache', '私有副本'],
    ['store', 'Store Buffer', '写事务队列'], ['bus', '总线矩阵', 'Master互联'], ['memory', '物理内存', 'SRAM/SDRAM'], ['dma', 'DMA', '独立Master'],
  ]
  const positions = compact
    ? Object.fromEntries(nodes.map(([id], index) => [id, { x: id === 'dma' ? 202 : 42, y: id === 'dma' ? 420 : 25 + Math.min(index, 5) * 88 }]))
    : Object.fromEntries(nodes.map(([id], index) => [id, { x: 25 + index * 123, y: id === 'dma' ? 260 : 98 }]))
  const centers = Object.fromEntries(nodes.map(([id]) => [id, { x: positions[id].x + (compact ? 58 : 52), y: positions[id].y + 32 }]))
  const tokenPath = pathForEvent(event, centers)
  return (
    <svg viewBox={compact ? '0 0 360 620' : '0 0 900 420'} role="img" aria-label="CPU、MPU、Cache、总线和DMA数据流动画">
      <ArrowDefs dashed={event?.certainty === 'possible'} />
      {!compact && <line x1="78" y1="130" x2="814" y2="130" stroke={event?.certainty === 'possible' ? COLORS.amber : COLORS.line} strokeDasharray={event?.certainty === 'possible' ? '7 6' : undefined} markerEnd="url(#scene-arrow)" />}
      {compact && <line x1="100" y1="58" x2="100" y2="498" stroke={COLORS.line} markerEnd="url(#scene-arrow)" />}
      {nodes.map(([id, label, note]) => {
        const source = ({ icache: 'cache', dcache: 'cache', device: 'bus', fault: 'mpu' }[event?.from] ?? event?.from)
        const target = ({ icache: 'cache', dcache: 'cache', device: 'bus', fault: 'mpu' }[event?.to] ?? event?.to)
        return <SvgNode key={id} {...positions[id]} width={compact ? 116 : 104} height={64} label={label} note={id === 'store' && snapshot.state.storeBuffer ? snapshot.state.storeBuffer : note} active={source === id || target === id} tone={id === 'dma' ? 'violet' : id === 'memory' ? 'green' : id === 'store' ? 'amber' : event?.status === 'fault' && id === 'mpu' ? 'red' : 'blue'} />
      })}
      {compact && <line x1="158" y1="452" x2="202" y2="452" stroke={COLORS.violet} strokeDasharray="5 5" markerEnd="url(#scene-arrow)" />}
      <MovingToken from={tokenPath.from} to={tokenPath.to} progress={snapshot.eventProgress} label={event?.payload?.value ?? 'DATA'} tone={event?.status === 'fault' ? 'red' : event?.certainty === 'possible' ? 'amber' : 'blue'} reducedMotion={reducedMotion} />
      <g transform={`translate(${compact ? 38 : 210} ${compact ? 545 : 278})`}>
        <rect width={compact ? 284 : 480} height={compact ? 54 : 72} rx="12" fill={event?.status === 'fault' ? COLORS.redSoft : COLORS.ink} />
        <text x="16" y={compact ? 22 : 28} fill={event?.status === 'fault' ? COLORS.red : '#fff'} fontSize="13" fontWeight="800">{event?.title}</text>
        <text x="16" y={compact ? 42 : 51} fill={event?.status === 'fault' ? '#7d4b4b' : '#b7c5d8'} fontSize={compact ? 9 : 11}>{String(event?.caption ?? '').slice(0, compact ? 45 : 78)}</text>
      </g>
    </svg>
  )
}

function MpuRegionScene({ snapshot, regions, address, reducedMotion, compact }) {
  const event = snapshot.activeEvent
  const region = regions.at(-1)
  const parts = region ? splitSubregions(region) : []
  const columns = compact ? 4 : 8
  const width = compact ? 68 : 82
  const gridX = compact ? 34 : 186
  const gridY = compact ? 272 : 168
  return (
    <svg viewBox={compact ? '0 0 360 620' : '0 0 900 420'} role="img" aria-label="MPU Region、Subregion和权限匹配动画">
      <ArrowDefs dashed={event?.certainty === 'possible'} />
      <SvgNode x={compact ? 96 : 32} y={compact ? 34 : 72} width={compact ? 168 : 160} label="访问地址" note={formatHex(address)} active tone="blue" />
      <line x1={compact ? 180 : 192} y1={compact ? 100 : 105} x2={compact ? 180 : 350} y2={compact ? 158 : 105} stroke={COLORS.muted} markerEnd="url(#scene-arrow)" />
      <SvgNode x={compact ? 96 : 350} y={compact ? 158 : 72} width={compact ? 168 : 184} label="MPU匹配器" note="高编号Region优先" active={event?.kind === 'region-probe'} tone={event?.status === 'fault' ? 'red' : 'violet'} />
      {!compact && <><line x1="534" y1="105" x2="704" y2="105" stroke={COLORS.muted} markerEnd="url(#scene-arrow)" /><SvgNode x={704} y={72} width={160} label="访问结果" note={event?.status === 'fault' ? 'MemManage' : '属性生效'} active tone={event?.status === 'fault' ? 'red' : 'green'} /></>}
      <text x={gridX} y={gridY - 20} className="svg-section-title">{region ? `REGION ${region.number} · SRD=${formatHex(region.srd ?? 0, 2)}` : 'BACKGROUND MAP'}</text>
      {(parts.length ? parts : Array.from({ length: 8 }, (_, index) => ({ index, disabled: false, start: 0, end: 0 }))).map((part) => {
        const row = Math.floor(part.index / columns)
        const col = part.index % columns
        const selected = address >= part.start && address <= part.end
        return (
          <g key={part.index} transform={`translate(${gridX + col * width} ${gridY + row * 74})`}>
            <rect width={width - 6} height="56" rx="8" fill={part.disabled ? '#eef1f4' : selected ? COLORS.blueSoft : COLORS.greenSoft} stroke={part.disabled ? '#aeb8c4' : selected ? COLORS.blue : COLORS.green} strokeDasharray={part.disabled ? '5 4' : undefined} strokeWidth={selected ? 2.5 : 1} />
            <text x={(width - 6) / 2} y="23" textAnchor="middle" className="svg-sub-index">{part.index}</text>
            <text x={(width - 6) / 2} y="41" textAnchor="middle" className="svg-sub-state">{part.disabled ? '禁用' : selected ? '命中' : '有效'}</text>
          </g>
        )
      })}
      <MovingToken from={compact ? { x: 180, y: 98 } : { x: 192, y: 104 }} to={compact ? { x: 180, y: 188 } : { x: 440, y: 104 }} progress={snapshot.eventProgress} label="ADDR" tone={event?.status === 'fault' ? 'red' : 'blue'} reducedMotion={reducedMotion} />
      <g transform={`translate(${compact ? 34 : 260} ${compact ? 460 : 320})`}>
        <rect width={compact ? 292 : 380} height="78" rx="12" fill={event?.status === 'fault' ? COLORS.redSoft : COLORS.ink} />
        <text x="16" y="29" fill={event?.status === 'fault' ? COLORS.red : '#fff'} fontSize="13" fontWeight="800">{event?.title}</text>
        <text x="16" y="52" fill={event?.status === 'fault' ? '#7d4b4b' : '#b7c5d8'} fontSize="10">{String(event?.caption ?? '').slice(0, compact ? 44 : 64)}</text>
      </g>
    </svg>
  )
}

function DmaCoherencyScene({ snapshot, reducedMotion, compact }) {
  const event = snapshot.activeEvent
  const isClean = event?.kind === 'clean'
  const isInvalidate = event?.kind === 'invalidate'
  const isFault = event?.status === 'fault'
  const positions = compact
    ? { cache: { x: 90, y: 35 }, memory: { x: 90, y: 250 }, dma: { x: 90, y: 465 } }
    : { cache: { x: 55, y: 95 }, memory: { x: 360, y: 95 }, dma: { x: 665, y: 95 } }
  const centers = Object.fromEntries(Object.entries(positions).map(([key, value]) => [key, { x: value.x + 90, y: value.y + 45 }]))
  const from = isClean ? centers.cache : isInvalidate ? centers.memory : event?.from === 'dma' ? centers.dma : centers.cache
  const to = isClean ? centers.memory : isInvalidate ? centers.cache : event?.to === 'dma' ? centers.dma : centers.memory
  return (
    <svg viewBox={compact ? '0 0 360 620' : '0 0 900 420'} role="img" aria-label="CPU Cache、物理内存和DMA一致性动画">
      <ArrowDefs />
      {!compact && <><line x1="235" y1="140" x2="360" y2="140" stroke={COLORS.line} markerEnd="url(#scene-arrow)" /><line x1="540" y1="140" x2="665" y2="140" stroke={COLORS.line} markerEnd="url(#scene-arrow)" /></>}
      {compact && <><line x1="180" y1="125" x2="180" y2="250" stroke={COLORS.line} markerEnd="url(#scene-arrow)" /><line x1="180" y1="340" x2="180" y2="465" stroke={COLORS.line} markerEnd="url(#scene-arrow)" /></>}
      <SvgNode {...positions.cache} width={180} height={90} label="CPU D-Cache" note={isInvalidate ? '丢弃旧副本' : snapshot.state.cache ?? '旧值 / Dirty新值'} active={event?.from === 'dcache' || event?.to === 'dcache' || isClean || isInvalidate} tone={isFault ? 'red' : 'blue'} />
      <SvgNode {...positions.memory} width={180} height={90} label="物理内存" note={snapshot.state.memory ?? 'DMA直接访问此处'} active={event?.after?.node === 'memory' || isClean} tone={isFault ? 'red' : 'green'} />
      <SvgNode {...positions.dma} width={180} height={90} label="DMA" note={snapshot.state.dma ?? '绕过CPU Cache'} active={event?.after?.node === 'dma'} tone="violet" />
      <MovingToken from={from} to={to} progress={snapshot.eventProgress} label={isClean ? 'CLEAN' : isInvalidate ? 'INVALID' : isFault ? 'OLD' : 'NEW'} tone={isFault ? 'red' : isClean ? 'amber' : 'blue'} reducedMotion={reducedMotion} />
      <g transform={`translate(${compact ? 34 : 232} ${compact ? 565 : 278})`}>
        <rect width={compact ? 292 : 436} height={compact ? 42 : 70} rx="12" fill={isFault ? COLORS.redSoft : COLORS.ink} />
        <text x="16" y={compact ? 26 : 28} fill={isFault ? COLORS.red : '#fff'} fontSize="13" fontWeight="800">{event?.title}</text>
        {!compact && <text x="16" y="50" fill={isFault ? '#7d4b4b' : '#b7c5d8'} fontSize="10">{String(event?.caption ?? '').slice(0, 68)}</text>}
      </g>
    </svg>
  )
}

function BarrierTimelineScene({ snapshot, reducedMotion, compact }) {
  const event = snapshot.activeEvent
  const lanes = ['CPU指令', 'Store Buffer', '系统总线', 'DMA / 外设']
  const xStart = compact ? 112 : 170
  const xEnd = compact ? 328 : 845
  const yStart = compact ? 80 : 82
  const yGap = compact ? 88 : 72
  const x = xStart + (xEnd - xStart) * (reducedMotion ? (snapshot.eventProgress > .45 ? 1 : 0) : snapshot.progress)
  const barrierX = xStart + (xEnd - xStart) * .48
  return (
    <svg viewBox={compact ? '0 0 360 500' : '0 0 900 390'} role="img" aria-label="无屏障、DMB和DSB访问顺序时间线">
      <ArrowDefs dashed={event?.certainty === 'possible'} />
      <text x={xStart} y="35" className="svg-section-title">时间 →</text>
      {lanes.map((lane, index) => {
        const y = yStart + index * yGap
        return <g key={lane}><text x="18" y={y + 4} className="svg-lane-label">{lane}</text><line x1={xStart} y1={y} x2={xEnd} y2={y} stroke={COLORS.line} strokeWidth="2" markerEnd="url(#scene-arrow)" /></g>
      })}
      <line x1={barrierX} y1="50" x2={barrierX} y2={yStart + 3 * yGap + 28} stroke={event?.kind === 'barrier' ? COLORS.blue : COLORS.amber} strokeWidth="3" strokeDasharray={event?.kind === 'barrier' ? undefined : '7 6'} />
      <rect x={barrierX - 29} y="48" width="58" height="24" rx="6" fill={event?.kind === 'barrier' ? COLORS.blue : COLORS.amber} />
      <text x={barrierX} y="64" textAnchor="middle" fill="#fff" fontSize="9" fontWeight="800">{event?.kind === 'barrier' ? 'DMB/DSB' : '无屏障'}</text>
      {lanes.map((lane, index) => <circle key={lane} cx={Math.max(xStart, x - index * (compact ? 16 : 24))} cy={yStart + index * yGap} r={index === 3 ? 10 : 8} fill={event?.status === 'fault' && index === 3 ? COLORS.red : index === 1 ? COLORS.amber : index === 3 ? COLORS.violet : COLORS.blue} />)}
      <g transform={`translate(${compact ? 20 : 230} ${compact ? 405 : 300})`}>
        <rect width={compact ? 320 : 440} height="68" rx="12" fill={event?.status === 'fault' ? COLORS.redSoft : COLORS.ink} />
        <text x="16" y="27" fill={event?.status === 'fault' ? COLORS.red : '#fff'} fontSize="13" fontWeight="800">{event?.title}</text>
        <text x="16" y="49" fill={event?.status === 'fault' ? '#7d4b4b' : '#b7c5d8'} fontSize="10">{String(event?.caption ?? '').slice(0, compact ? 48 : 70)}</text>
      </g>
    </svg>
  )
}

function FaultScene({ snapshot, reducedMotion, compact }) {
  const event = snapshot.activeEvent
  const items = [
    ['CPU访问', '0x60000000'], ['MPU拒绝', 'AP / XN'], ['MMFSR', 'IACCVIOL / DACCVIOL'], ['MMFAR', '记录Fault地址'], ['异常入口', event?.status === 'fault' ? 'MemManage → HardFault' : 'MemManage'],
  ]
  const positions = compact
    ? items.map((_, index) => ({ x: 75, y: 32 + index * 105 }))
    : items.map((_, index) => ({ x: 24 + index * 174, y: 128 }))
  const targetIndex = Math.min(items.length - 1, Math.floor(snapshot.progress * items.length))
  return (
    <svg viewBox={compact ? '0 0 360 620' : '0 0 900 420'} role="img" aria-label="MemManage和HardFault诊断动画">
      <ArrowDefs />
      {items.map(([label, note], index) => (
        <g key={label}>
          {index < items.length - 1 && (compact
            ? <line x1="180" y1={positions[index].y + 76} x2="180" y2={positions[index + 1].y} stroke={COLORS.red} markerEnd="url(#scene-arrow)" />
            : <line x1={positions[index].x + 150} y1="166" x2={positions[index + 1].x} y2="166" stroke={COLORS.red} markerEnd="url(#scene-arrow)" />)}
          <SvgNode {...positions[index]} width={compact ? 210 : 150} height={76} label={label} note={note} active={index === targetIndex} tone="red" />
        </g>
      ))}
      <MovingToken from={compact ? { x: 180, y: 68 } : { x: 98, y: 166 }} to={compact ? { x: 180, y: 488 } : { x: 795, y: 166 }} progress={snapshot.progress} label="FAULT" tone="red" reducedMotion={reducedMotion} />
      <g transform={`translate(${compact ? 32 : 215} ${compact ? 560 : 275})`}>
        <rect width={compact ? 296 : 470} height="58" rx="12" fill={COLORS.redSoft} />
        <text x="16" y="25" fill={COLORS.red} fontSize="13" fontWeight="800">{event?.title}</text>
        <text x="16" y="44" fill="#7d4b4b" fontSize="10">{String(event?.caption ?? '').slice(0, compact ? 46 : 74)}</text>
      </g>
    </svg>
  )
}

function Scene({ trace, snapshot, regions, address, reducedMotion }) {
  const compact = useCompactScene()
  const props = { snapshot, regions, address, reducedMotion, compact }
  if (trace.scene === SCENE_TYPES.CACHE_LINE) return <CacheLineScene {...props} />
  if (trace.scene === SCENE_TYPES.MPU_REGION) return <MpuRegionScene {...props} />
  if (trace.scene === SCENE_TYPES.DMA_COHERENCY) return <DmaCoherencyScene {...props} />
  if (trace.scene === SCENE_TYPES.BARRIER_TIMELINE) return <BarrierTimelineScene {...props} />
  if (trace.scene === SCENE_TYPES.FAULT) return <FaultScene {...props} />
  return <PipelineScene {...props} />
}

function CertaintyBadge({ certainty }) {
  const labels = { certain: '确定结果', possible: '架构允许的可能路径', illustrative: '简化示意' }
  return <span className={`certainty certainty-${certainty}`}>{labels[certainty] ?? labels.certain}</span>
}

export function AnimationStage({ trace, regions, address, speed, onSpeedChange, canPlay = true, onComplete, compactControls = false }) {
  const [playheadMs, setPlayheadMs] = useState(0)
  const [playing, setPlaying] = useState(false)
  const lastTimeRef = useRef(null)
  const completionSent = useRef(false)
  const reducedMotion = useReducedMotion()
  const snapshot = useMemo(() => sampleTrace(trace, playheadMs), [trace, playheadMs])

  useEffect(() => {
    if (!playing) {
      lastTimeRef.current = null
      return undefined
    }
    let handle
    const tick = (now) => {
      if (lastTimeRef.current === null) lastTimeRef.current = now
      const delta = now - lastTimeRef.current
      lastTimeRef.current = now
      setPlayheadMs((current) => {
        const next = Math.min(trace.durationMs, current + delta * speed)
        if (next >= trace.durationMs) setPlaying(false)
        return next
      })
      handle = window.requestAnimationFrame(tick)
    }
    handle = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(handle)
  }, [playing, speed, trace.durationMs])

  useEffect(() => {
    if (snapshot.isComplete && !completionSent.current) {
      completionSent.current = true
      onComplete?.()
    }
  }, [snapshot.isComplete, onComplete])

  const seek = (next) => {
    setPlaying(false)
    setPlayheadMs(Math.max(0, Math.min(trace.durationMs, next)))
  }
  const toggle = () => {
    if (!canPlay) return
    if (snapshot.isComplete) {
      completionSent.current = false
      setPlayheadMs(0)
    }
    setPlaying((value) => !value)
  }
  const handleKeyboard = (event) => {
    if (event.key === ' ') { event.preventDefault(); toggle() }
    if (event.key === 'ArrowLeft') { event.preventDefault(); seek(previousEventTime(trace, playheadMs)) }
    if (event.key === 'ArrowRight') { event.preventDefault(); seek(nextEventTime(trace, playheadMs)) }
  }

  return (
    <section className="animation-player card" tabIndex="0" onKeyDown={handleKeyboard} aria-label="可交互动画播放器">
      <div className="animation-toolbar">
        <div><span className="live-dot" /><b>连续因果演示</b><CertaintyBadge certainty={snapshot.activeEvent?.certainty} /></div>
        <div className="transport">
          <button aria-label="重播动画" onClick={() => { completionSent.current = false; seek(0) }}><RotateCcw size={16} /></button>
          <button aria-label="上一个事件" onClick={() => seek(previousEventTime(trace, playheadMs))}><SkipBack size={16} /></button>
          <button className="play" aria-label={playing ? '暂停动画' : '播放动画'} disabled={!canPlay} onClick={toggle}>{playing ? <Pause size={17} /> : <Play size={17} />}{playing ? '暂停' : '播放'}</button>
          <button aria-label="下一个事件" onClick={() => seek(nextEventTime(trace, playheadMs))}><SkipForward size={16} /></button>
        </div>
      </div>
      {!canPlay && <div className="play-locked">先做一个预测，或选择“暂不确定，直接观察”，即可播放。</div>}
      <div className="scene-canvas"><Scene trace={trace} snapshot={snapshot} regions={regions} address={address} reducedMotion={reducedMotion} /></div>
      <div className="caption-strip">
        <span>{String(snapshot.activeIndex + 1).padStart(2, '0')}</span>
        <div><b>{snapshot.activeEvent?.title}</b><p>{snapshot.activeEvent?.caption}</p></div>
        {reducedMotion && <small>已启用减少动态效果</small>}
      </div>
      <div className="timeline-controls">
        <span>{formatTraceTime(playheadMs)}</span>
        <input aria-label="动画时间轴" type="range" min="0" max={trace.durationMs} step="10" value={Math.round(playheadMs)} onChange={(event) => seek(Number(event.target.value))} />
        <span>{formatTraceTime(trace.durationMs)}</span>
        <label className={compactControls ? 'compact-speed' : ''}><Gauge size={14} /><span className="sr-only">播放速度</span><select aria-label="播放速度" value={speed} onChange={(event) => onSpeedChange(Number(event.target.value))}><option value="0.5">0.5×</option><option value="1">1×</option><option value="2">2×</option></select></label>
      </div>
      <div className="event-chapters" aria-label="事件章节">
        {trace.chapters.map((chapter, index) => <button key={chapter.id} className={index === snapshot.activeIndex ? 'active' : ''} onClick={() => seek(chapter.timeMs)}><span>{index + 1}</span>{chapter.title}</button>)}
      </div>
    </section>
  )
}

export function TraceStatePanel({ snapshot }) {
  const cells = [
    ['D-Cache', snapshot.state.cache ?? '—'], ['Store Buffer', snapshot.state.storeBuffer ?? '—'],
    ['物理内存', snapshot.state.memory ?? '—'], ['DMA观察', snapshot.state.dma ?? '—'],
    ['Region', snapshot.state.region ?? '—'], ['Fault', snapshot.state.fault ?? '无'],
  ]
  return <div className="trace-state-panel">{cells.map(([label, value]) => <div key={label}><span>{label}</span><b>{value}</b></div>)}</div>
}

export function AnimationWarning({ children }) {
  return <div className="animation-warning"><AlertTriangle size={16} />{children}</div>
}
