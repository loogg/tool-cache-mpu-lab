import { useEffect, useMemo, useState } from 'react'
import {
  Activity, AlertTriangle, BookOpen, Check, ChevronRight, CircuitBoard, Cpu,
  Database, ExternalLink, Github, HardDrive, Layers3, Map, MemoryStick, Pause,
  Play, RotateCcw, Shield, SkipBack, SkipForward, SlidersHorizontal, Sparkles,
  X, Zap,
} from 'lucide-react'
import { CACHE_LINE_SIZE, CORTEX_M7_PROFILE, decodeMemoryAttributes, findMemoryMapEntry } from './model/architecture.js'
import { CACHE_POLICIES } from './model/cache.js'
import { evaluateAccess, formatHex, parseAddress, splitSubregions, validateRegion } from './model/mpu.js'
import { regionsForExperiment, settingsForExperiment, simulateExperiment } from './model/simulation.js'
import { EXPERIMENTS, STAGES, experimentsForStage } from './data/experiments.js'

const FLOW_NODES = [
  { id: 'cpu', label: 'CPU', icon: Cpu, note: '执行 Load / Store / Fetch' },
  { id: 'mpu', label: 'MPU', icon: Shield, note: '匹配 Region 与权限' },
  { id: 'icache', label: 'I-Cache', icon: Zap, note: '指令副本' },
  { id: 'dcache', label: 'D-Cache', icon: MemoryStick, note: '数据 Cache Line' },
  { id: 'store', label: 'Store Buffer', icon: Layers3, note: '待发送写事务' },
  { id: 'bus', label: '总线矩阵', icon: CircuitBoard, note: '连接各个 Master' },
  { id: 'memory', label: '物理内存', icon: Database, note: 'SRAM / SDRAM' },
  { id: 'device', label: '外设', icon: HardDrive, note: '寄存器与状态机' },
  { id: 'dma', label: 'DMA', icon: Activity, note: '独立总线 Master' },
]

const AP_OPTIONS = [
  ['no-access', 'No Access'], ['priv-rw', '仅特权读写'], ['priv-rw-user-ro', '特权读写 / 用户只读'],
  ['full', '全部读写'], ['priv-ro', '仅特权只读'], ['read-only', '全部只读'],
]

const SOURCES = [
  ['GigaDevice', 'H7 Cache 及 MPU 使用指南', 'https://gigadevice.feishu.cn/wiki/Tw2kwOc38i32dFkNtYecKQvHnne'],
  ['Arm', 'Cortex-M7 Technical Reference Manual', 'https://developer.arm.com/documentation/ddi0489/latest/'],
  ['CMSIS', 'Armv7-M MPU Defines', 'https://arm-software.github.io/CMSIS_6/latest/Core/group__mpu__defines.html'],
  ['CMSIS', 'Cortex-M7 D-Cache Functions', 'https://arm-software.github.io/CMSIS_6/latest/Core/group__Dcache__functions__m7.html'],
  ['ST', 'AN4838 · MPU management', 'https://www.st.com/resource/en/application_note/an4838-managing-memory-protection-unit-in-stm32-mcus-stmicroelectronics.pdf'],
  ['ST', 'AN4839 · Level 1 cache', 'https://www.st.com/resource/en/application_note/an4839-level-1-cache-on-stm32f7-series-and-stm32h7-series-stmicroelectronics.pdf'],
  ['GigaDevice', 'GD32H75E Datasheet', 'https://www.gd32mcu.com/download/down/document_id/652/path_type/1'],
]

const CORRECTIONS = [
  ['Shareable 不是 DMA 开关', 'DMA 是否能访问由芯片总线矩阵决定；Shareable 描述 CPU 内存模型中的共享域。'],
  ['Non-cacheable 不是“立即写入”', '它排除 D-Cache 副本，但 Normal Memory 写仍可能经过 Store Buffer。'],
  ['B 位不是独立开关', 'TEX、C、B 必须一起解码；改变 B 甚至可能改变 Memory Type。'],
  ['SRD 禁用不是 No Access', '禁用后当前 Region 不参与匹配，处理器会继续寻找其他 Region 或背景映射。'],
  ['No Write Allocate 仍可能缓存', '它只影响写 Miss；一次读取可以把 Line 装入 Cache，后续写入便会 Hit。'],
  ['DSB 不代表外设任务结束', '它等待架构定义的显式访问完成；外设内部完成仍看 BUSY/DONE 或中断。'],
]

function StageRail({ selected, completed, onSelect }) {
  return (
    <aside className="course-rail" aria-label="完整实验课程">
      <div className="course-title">
        <BookOpen size={18} />
        <div><b>38 个交互实验</b><span>{completed.size} 个已掌握</span></div>
      </div>
      {STAGES.map((stage) => (
        <section key={stage.id} className={`course-stage stage-${stage.color}`}>
          <header><span>{stage.short}</span><b>{stage.title}</b><small>{stage.range}</small></header>
          <div className="lesson-list">
            {experimentsForStage(stage.id).map((lesson) => (
              <button key={lesson.id} className={selected.id === lesson.id ? 'active' : ''} onClick={() => onSelect(lesson)}>
                <span className="lesson-number">{String(lesson.number).padStart(2, '0')}</span>
                <span className="lesson-name">{lesson.title}</span>
                {completed.has(lesson.id) && <Check size={13} className="lesson-check" />}
              </button>
            ))}
          </div>
        </section>
      ))}
    </aside>
  )
}

function FlowDiagram({ frame }) {
  return (
    <div className="flow-shell">
      <div className="flow-path" aria-label="硬件数据路径">
        {FLOW_NODES.map((item) => {
          const { id, label, note } = item
          const NodeIcon = item.icon
          const active = frame.node === id || (frame.node === 'fault' && id === 'mpu')
          return (
            <div key={id} className={`flow-node ${active ? 'active' : ''} ${frame.node === 'fault' && id === 'mpu' ? 'danger' : ''}`}>
              <span><NodeIcon size={19} /></span><b>{label}</b><small>{note}</small>
              {active && <i className="pulse" />}
            </div>
          )
        })}
      </div>
      <div className={`frame-callout status-${frame.status}`}>
        <span>{frame.status === 'fault' ? <AlertTriangle size={17} /> : <Sparkles size={17} />}</span>
        <div><b>{frame.title}</b><p>{frame.detail}</p></div>
      </div>
    </div>
  )
}

function StateStrip({ frame }) {
  const cells = [
    ['D-Cache', frame.cache ?? '—'], ['Store Buffer', frame.storeBuffer ?? '—'],
    ['物理内存', frame.memory ?? '—'], ['DMA 观察', frame.dma ?? '—'],
    ['Region', frame.region ?? '—'], ['Fault', frame.fault ?? '无'],
  ]
  return <div className="state-strip">{cells.map(([label, value]) => <div key={label}><span>{label}</span><b>{value}</b></div>)}</div>
}

function SubregionView({ regions, address }) {
  return (
    <div className="region-stack">
      {regions.map((region) => {
        const parts = splitSubregions(region)
        const validation = validateRegion(region)
        return (
          <div className="region-row" key={region.number}>
            <div className="region-meta">
              <span>Region {region.number}</span><b>{region.label}</b>
              <small>{formatHex(validation.effectiveBase)} · {region.size === 4294967296 ? '4GB' : `${region.size / 1024}KB`} · SRD={formatHex(region.srd ?? 0, 2)}</small>
            </div>
            {parts.length ? (
              <div className="subregion-grid">
                {parts.map((part) => {
                  const selected = address >= part.start && address <= part.end
                  return <div key={part.index} className={`${part.disabled ? 'disabled' : ''} ${selected ? 'selected' : ''}`} title={`${formatHex(part.start)}–${formatHex(part.end)}`}><b>{part.index}</b><span>{part.disabled ? '禁用' : '有效'}</span></div>
                })}
              </div>
            ) : <div className="no-subregions">小于 256B：没有 Subregion</div>}
          </div>
        )
      })}
    </div>
  )
}

function Toggle({ checked, onChange, label, note }) {
  return (
    <label className="toggle-control">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span className="toggle-track"><i /></span>
      <span><b>{label}</b>{note && <small>{note}</small>}</span>
    </label>
  )
}

function ConfigPanel({ settings, update }) {
  return (
    <section className="config-panel card">
      <div className="panel-heading"><span><SlidersHorizontal size={17} />自由配置</span><small>修改后模拟自动复位</small></div>
      <div className="config-grid">
        <label><span>访问地址</span><input aria-label="访问地址" value={settings.address} onChange={(event) => update('address', event.target.value)} /></label>
        <label><span>Cache 策略</span><select aria-label="Cache 策略" value={settings.policy} onChange={(event) => update('policy', event.target.value)}>{Object.values(CACHE_POLICIES).map((policy) => <option key={policy.id} value={policy.id}>{policy.label}</option>)}</select></label>
        <label><span>访问主体</span><select aria-label="访问主体" value={settings.actor} onChange={(event) => update('actor', event.target.value)}><option value="cpu">CPU</option><option value="dma">DMA</option></select></label>
        <label><span>访问类型</span><select aria-label="访问类型" value={settings.accessKind} onChange={(event) => update('accessKind', event.target.value)}><option value="read">读取</option><option value="write">写入</option><option value="execute">取指</option></select></label>
      </div>
      <div className="toggle-grid">
        <Toggle checked={settings.dcacheEnabled} onChange={(value) => update('dcacheEnabled', value)} label="D-Cache" note="CCR.DC" />
        <Toggle checked={settings.cacheHit} onChange={(value) => update('cacheHit', value)} label="Cache Hit" note="目标 Line 已存在" />
        <Toggle checked={settings.clean} onChange={(value) => update('clean', value)} label="Clean" note="写回 Dirty Line" />
        <Toggle checked={settings.invalidate} onChange={(value) => update('invalidate', value)} label="Invalidate" note="丢弃 Cache 副本" />
      </div>
      <details open>
        <summary>MPU Region 与 TEX/C/B/S</summary>
        <div className="config-grid advanced-grid">
          <label><span>Region 基地址</span><input aria-label="Region 基地址" value={settings.regionBase} onChange={(event) => update('regionBase', event.target.value)} /></label>
          <label><span>Region 大小</span><select aria-label="Region 大小" value={settings.regionSize} onChange={(event) => update('regionSize', Number(event.target.value))}><option value={128}>128B</option><option value={256}>256B</option><option value={4096}>4KB</option><option value={524288}>512KB</option><option value={268435456}>256MB</option><option value={4294967296}>4GB</option></select></label>
          <label><span>SRD 掩码</span><select aria-label="SRD 掩码" value={settings.srd} onChange={(event) => update('srd', Number(event.target.value))}><option value={0}>0x00</option><option value={15}>0x0F</option><option value={240}>0xF0</option><option value={85}>0x55</option><option value={135}>0x87</option></select></label>
          <label><span>AP 权限</span><select aria-label="AP 权限" value={settings.ap} onChange={(event) => update('ap', event.target.value)}>{AP_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label><span>TEX</span><select aria-label="TEX" value={settings.tex} onChange={(event) => update('tex', Number(event.target.value))}>{Array.from({ length: 8 }, (_, value) => <option key={value} value={value}>{value.toString(2).padStart(3, '0')}</option>)}</select></label>
          <label><span>屏障</span><select aria-label="屏障" value={settings.barrier} onChange={(event) => update('barrier', event.target.value)}><option value="none">无屏障</option><option value="dmb">DMB</option><option value="dsb">DSB</option></select></label>
        </div>
        <div className="toggle-grid compact-toggles">
          <Toggle checked={Boolean(settings.c)} onChange={(value) => update('c', value ? 1 : 0)} label={`C = ${settings.c}`} />
          <Toggle checked={Boolean(settings.b)} onChange={(value) => update('b', value ? 1 : 0)} label={`B = ${settings.b}`} />
          <Toggle checked={settings.shareable} onChange={(value) => update('shareable', value)} label="Shareable" />
          <Toggle checked={settings.siwt} onChange={(value) => update('siwt', value)} label="CACR.SIWT" />
          <Toggle checked={settings.xn} onChange={(value) => update('xn', value)} label="XN" />
          <Toggle checked={settings.privileged} onChange={(value) => update('privileged', value)} label="特权访问" />
          <Toggle checked={settings.privdefena} onChange={(value) => update('privdefena', value)} label="PRIVDEFENA" />
          <Toggle checked={settings.whitelist} onChange={(value) => update('whitelist', value)} label="SDRAM 白名单" />
        </div>
      </details>
    </section>
  )
}

function DecoderPanel({ settings, outcome, mapEntry }) {
  const decoded = decodeMemoryAttributes({ tex: Number(settings.tex), c: Number(settings.c), b: Number(settings.b), s: settings.shareable, siwt: settings.siwt })
  return (
    <section className="decoder card">
      <div className="decoder-code"><span>TEX</span><b>{Number(settings.tex).toString(2).padStart(3, '0')}</b><span>C</span><b>{settings.c}</b><span>B</span><b>{settings.b}</b><span>S</span><b>{settings.shareable ? 1 : 0}</b></div>
      <div className="decoder-result">
        <span className={`result-pill result-${decoded.status}`}>{decoded.status === 'valid' ? decoded.type : decoded.status}</span>
        <h3>{decoded.name}</h3><p>{decoded.detail}</p>
        <dl><div><dt>配置策略</dt><dd>{decoded.policy}</dd></div><div><dt>M7 实际处理</dt><dd>{decoded.effectivePolicy}</dd></div><div><dt>共享属性</dt><dd>{decoded.shareabilityNote}</dd></div></dl>
      </div>
      <div className={`access-result ${outcome.allowed ? 'allowed' : 'denied'}`}>
        {outcome.allowed ? <Check size={18} /> : <X size={18} />}
        <div><b>{outcome.allowed ? '本次访问允许' : outcome.fault}</b><span>{outcome.reason}</span></div>
      </div>
      <div className="map-hit"><Map size={16} /><span>{mapEntry ? `${mapEntry.name} · ${mapEntry.kind}` : '地址未命中内置 H75E 地图条目'}</span></div>
    </section>
  )
}

function Quiz({ experiment, answer, onAnswer, onNext, isLast }) {
  const correct = answer === experiment.answer
  return (
    <section className="quiz card">
      <div className="quiz-kicker"><span>为什么？</span><small>回答正确才算掌握本实验</small></div>
      <h3>{experiment.question}</h3>
      <div className="quiz-options">
        {experiment.choices.map((choice, index) => <button key={choice} onClick={() => onAnswer(index)} className={`${answer === index ? 'selected' : ''} ${answer !== null && index === experiment.answer ? 'correct' : ''} ${answer === index && !correct ? 'wrong' : ''}`}><span>{String.fromCharCode(65 + index)}</span>{choice}</button>)}
      </div>
      {answer !== null && <div className={`quiz-feedback ${correct ? 'ok' : 'retry'}`}>{correct ? <Check size={17} /> : <RotateCcw size={17} />}<span>{correct ? '回答正确：你已经抓住这个实验的关键。' : `再想一下：${experiment.misconception}`}</span></div>}
      <button className="next-lesson" disabled={!correct || isLast} onClick={onNext}>{isLast ? '已完成全部课程' : '进入下一个实验'}<ChevronRight size={16} /></button>
    </section>
  )
}

export default function App() {
  const [experiment, setExperiment] = useState(EXPERIMENTS[0])
  const [settings, setSettings] = useState(() => settingsForExperiment(EXPERIMENTS[0]))
  const [frameIndex, setFrameIndex] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [answer, setAnswer] = useState(null)
  const [completed, setCompleted] = useState(() => new Set())

  const frames = useMemo(() => simulateExperiment(experiment, settings), [experiment, settings])
  const safeIndex = Math.min(frameIndex, frames.length - 1)
  const frame = frames[safeIndex]
  const regions = useMemo(() => regionsForExperiment(experiment, settings), [experiment, settings])
  const address = parseAddress(settings.address)
  const outcome = useMemo(() => evaluateAccess({ regions, address, actor: settings.actor, privileged: settings.privileged, kind: settings.accessKind, privdefena: settings.privdefena }), [regions, address, settings.actor, settings.privileged, settings.accessKind, settings.privdefena])
  const mapEntry = findMemoryMapEntry(address)
  const progress = Math.round((completed.size / EXPERIMENTS.length) * 100)

  useEffect(() => {
    if (!playing) return undefined
    if (safeIndex >= frames.length - 1) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPlaying(false)
      return undefined
    }
    const timer = window.setTimeout(() => setFrameIndex((value) => Math.min(value + 1, frames.length - 1)), 950)
    return () => window.clearTimeout(timer)
  }, [playing, safeIndex, frames.length])

  const chooseExperiment = (next) => {
    setExperiment(next)
    setSettings(settingsForExperiment(next))
    setFrameIndex(0)
    setPlaying(false)
    setAnswer(null)
    window.scrollTo({ top: 360, behavior: 'smooth' })
  }

  const update = (key, value) => {
    setSettings((current) => ({ ...current, [key]: value }))
    setFrameIndex(0)
    setPlaying(false)
  }

  const answerQuestion = (index) => {
    setAnswer(index)
    if (index === experiment.answer) setCompleted((current) => new Set([...current, experiment.id]))
  }

  const nextLesson = () => {
    const next = EXPERIMENTS[experiment.number]
    if (next) chooseExperiment(next)
  }

  return (
    <main id="top">
      <header className="topbar">
        <a href="#top" className="brand" aria-label="Cache & MPU 实验室首页"><span className="brand-mark"><Cpu size={19} /></span><span>Cache & MPU <b>LAB</b></span><small>v{import.meta.env.APP_VERSION}</small></a>
        <nav><a href="#course">实验室</a><a href="#map">地址地图</a><a href="#sources">资料依据</a><a className="github" href="https://github.com/loogg/tool-cache-mpu-lab" target="_blank" rel="noreferrer"><Github size={17} />GitHub</a></nav>
      </header>

      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow"><span />首发架构：Cortex-M7 · GD32H75E</p>
          <h1>看见每一笔数据，<br /><em>究竟停在哪里。</em></h1>
          <p>从一条 32 字节 Cache Line 开始，逐步走到 MPU Region、DMA 一致性、4GB兜底禁区和SDRAM执行代码。所有结论都能暂停、改配置、再验证。</p>
          <div className="hero-actions"><a href="#course">开始第一个实验<Play size={16} /></a><span><Shield size={16} />纯浏览器运行 · 不上传数据</span></div>
        </div>
        <div className="hero-board">
          <div className="hero-stat"><span>课程</span><strong>38</strong><small>从基础到芯片实战</small></div>
          <div className="hero-stat"><span>Cache Line</span><strong>32B</strong><small>Cortex-M7 L1</small></div>
          <div className="hero-stat wide"><span>教学路径</span><div><b>通用原理</b><i>→</i><b>Armv7-M</b><i>→</i><b>GD32H75E</b></div></div>
          <div className="mini-pipeline"><span>CPU</span><i /><span>MPU</span><i /><span>Cache</span><i /><span>总线</span><i /><span>内存</span></div>
        </div>
      </section>

      <section className="curriculum-summary">
        {STAGES.map((stage) => <button key={stage.id} onClick={() => chooseExperiment(experimentsForStage(stage.id)[0])}><span>{stage.short}</span><b>{stage.title}</b><small>{stage.range} · {experimentsForStage(stage.id).length} 个实验</small></button>)}
      </section>

      <section className="workspace" id="course">
        <StageRail selected={experiment} completed={completed} onSelect={chooseExperiment} />
        <div className="lab-workspace">
          <div className="lesson-head">
            <div><span className={`stage-chip stage-${STAGES.find((item) => item.id === experiment.stage)?.color}`}>{STAGES.find((item) => item.id === experiment.stage)?.title}</span><small>实验 {String(experiment.number).padStart(2, '0')} / 38</small></div>
            <h2>{experiment.title}</h2><p>{experiment.summary}</p>
            <div className="lesson-tags">{experiment.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>
          </div>

          <section className="simulator card">
            <div className="simulator-top">
              <div><span className="live-dot" /><b>硬件状态模拟</b><small>先预测，再单步观察</small></div>
              <div className="transport">
                <button aria-label="复位动画" onClick={() => { setFrameIndex(0); setPlaying(false) }}><RotateCcw size={16} /></button>
                <button aria-label="上一步" onClick={() => { setFrameIndex((value) => Math.max(0, value - 1)); setPlaying(false) }}><SkipBack size={16} /></button>
                <button className="play" aria-label={playing ? '暂停动画' : '播放动画'} onClick={() => { if (safeIndex === frames.length - 1) setFrameIndex(0); setPlaying((value) => !value) }}>{playing ? <Pause size={17} /> : <Play size={17} />}{playing ? '暂停' : '播放'}</button>
                <button aria-label="下一步" onClick={() => { setFrameIndex((value) => Math.min(frames.length - 1, value + 1)); setPlaying(false) }}><SkipForward size={16} /></button>
              </div>
            </div>
            <div className="timeline"><span style={{ width: `${frames.length <= 1 ? 100 : (safeIndex / (frames.length - 1)) * 100}%` }} /><b>{safeIndex + 1} / {frames.length}</b></div>
            <FlowDiagram frame={frame} />
            <StateStrip frame={frame} />
            <SubregionView regions={regions} address={address} />
          </section>

          <div className="lab-columns">
            <ConfigPanel settings={settings} update={update} />
            <DecoderPanel settings={settings} outcome={outcome} mapEntry={mapEntry} />
          </div>

          <Quiz experiment={experiment} answer={answer} onAnswer={answerQuestion} onNext={nextLesson} isLast={experiment.number === EXPERIMENTS.length} />
        </div>
      </section>

      <section className="memory-map-section" id="map">
        <div className="section-heading"><div><span>GD32H75E</span><h2>地址不是数字，是一张硬件地图</h2></div><p>点击任意区域，将实验室访问地址切换到该窗口起点。TCM/共享RAM的实际容量和别名关系仍应以具体封装、启动配置和数据手册为准。</p></div>
        <div className="memory-map-grid">
          {CORTEX_M7_PROFILE.memoryMap.map((entry) => <button key={`${entry.name}-${entry.start}`} className={`map-card map-${entry.kind.toLowerCase()}`} onClick={() => { update('address', formatHex(entry.start)); document.querySelector('#course')?.scrollIntoView({ behavior: 'smooth' }) }}><span>{entry.kind}</span><b>{entry.name}</b><code>{formatHex(entry.start)}–{formatHex(entry.end)}</code><small>{entry.advice}</small></button>)}
        </div>
      </section>

      <section className="corrections-section">
        <div className="section-heading"><div><span>CONCEPT CHECK</span><h2>六个最容易混淆的地方</h2></div><p>这些卡片专门修正文档或口头讲解中为了简化而留下的歧义。</p></div>
        <div className="correction-grid">{CORRECTIONS.map(([title, body], index) => <article key={title}><span>{String(index + 1).padStart(2, '0')}</span><h3>{title}</h3><p>{body}</p></article>)}</div>
      </section>

      <section className="sources-section" id="sources">
        <div className="source-intro"><span>资料边界</span><h2>以架构定义为骨架，以芯片资料为落点</h2><p>工具用于建立心智模型，不代替具体芯片勘误、参考手册或安全评审。实现中将厂商示例与Arm架构约束分层标注。</p></div>
        <div className="source-list">{SOURCES.map(([org, title, url]) => <a key={title} href={url} target="_blank" rel="noreferrer"><span>{org}</span><b>{title}</b><ExternalLink size={15} /></a>)}</div>
      </section>

      <footer><div><Cpu size={18} /><b>Cache & MPU LAB</b><span>通用原理 · Cortex-M7 · GD32H75E</span></div><p>当前学习进度：{completed.size}/38</p><div className="footer-progress"><span style={{ width: `${progress}%` }} /></div><small>教学模拟使用伪代码和架构模型，不直接生成产品初始化代码。</small></footer>
    </main>
  )
}
