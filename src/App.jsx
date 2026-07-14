import { useEffect, useMemo, useState } from 'react'
import {
  BookOpen, Check, ChevronRight, Cpu, ExternalLink, Github, Map, Menu, Play,
  RotateCcw, Shield, SlidersHorizontal, Sparkles, X,
} from 'lucide-react'
import packageInfo from '../package.json'
import { AnimationStage } from './components/AnimationStage.jsx'
import { CACHE_POLICIES } from './model/cache.js'
import { CORTEX_M7_PROFILE, decodeMemoryAttributes, findMemoryMapEntry } from './model/architecture.js'
import { evaluateAccess, formatHex, parseAddress, splitSubregions, validateRegion } from './model/mpu.js'
import { regionsForExperiment, settingsForExperiment } from './model/simulation.js'
import { buildSimulationTrace } from './model/trace.js'
import { COURSE_STORAGE_KEY, parseCourseState, serializeCourseState } from './model/course-state.js'
import { EXPERIMENTS, EXPERIMENT_BY_ID, STAGES, experimentsForStage } from './data/experiments.js'

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

const validLessonIds = EXPERIMENTS.map((item) => item.id)

function currentRoute() {
  const params = new URLSearchParams(window.location.search)
  const mode = ['course', 'lab'].includes(params.get('mode')) ? params.get('mode') : 'home'
  const lessonId = EXPERIMENT_BY_ID[params.get('lesson')] ? params.get('lesson') : 'cache-line'
  return { mode, lessonId }
}

function stageFor(experiment) {
  return STAGES.find((stage) => stage.id === experiment.stage)
}

function Topbar({ mode, lessonId, navigate }) {
  return (
    <header className="topbar">
      <button className="brand brand-button" onClick={() => navigate('home')} aria-label="Cache & MPU 实验室首页">
        <span className="brand-mark"><Cpu size={19} /></span><span>Cache & MPU <b>LAB</b></span><small>v{packageInfo.version}</small>
      </button>
      <nav>
        <button className={mode === 'course' ? 'active' : ''} onClick={() => navigate('course', lessonId)}>引导课程</button>
        <button className={mode === 'lab' ? 'active' : ''} onClick={() => navigate('lab', lessonId)}>自由实验室</button>
        <button onClick={() => navigate('home', lessonId, 'map')}>地址地图</button>
        <a className="github" href="https://github.com/loogg/tool-cache-mpu-lab" target="_blank" rel="noreferrer"><Github size={17} />GitHub</a>
      </nav>
    </header>
  )
}

function HomePage({ startCourse, startStage, openLab, openAddress, completedCount }) {
  return (
    <>
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow"><span />Cortex-M7 · GD32H75E · 连续动画</p>
          <h1>看见每一笔数据，<br /><em>究竟停在哪里。</em></h1>
          <p>先做预测，再看数据沿 CPU、Cache、总线、内存与 DMA 连续移动。38 个实验从一条 32 字节 Cache Line 走到 4GB兜底禁区和SDRAM执行代码。</p>
          <div className="hero-actions"><button onClick={startCourse}>开始引导课程<Play size={16} /></button><button className="secondary" onClick={openLab}>打开自由实验室<SlidersHorizontal size={16} /></button><span><Shield size={16} />纯浏览器运行 · 不上传数据</span></div>
        </div>
        <div className="hero-board">
          <div className="hero-stat"><span>课程</span><strong>38</strong><small>全部支持连续动画</small></div>
          <div className="hero-stat"><span>已掌握</span><strong>{completedCount}</strong><small>进度保存在本机</small></div>
          <div className="hero-stat wide"><span>教学路径</span><div><b>先预测</b><i>→</i><b>看动画</b><i>→</i><b>改配置</b></div></div>
          <div className="mini-pipeline"><span>CPU</span><i /><span>MPU</span><i /><span>Cache</span><i /><span>总线</span><i /><span>内存</span></div>
        </div>
      </section>

      <section className="curriculum-summary" aria-label="课程阶段">
        {STAGES.map((stage) => <button key={stage.id} onClick={() => startStage(stage.id)}><span>{stage.short}</span><b>{stage.title}</b><small>{stage.range} · {experimentsForStage(stage.id).length} 个实验</small></button>)}
      </section>
      <InfoSections onPick={openAddress} />
    </>
  )
}

function CourseDrawer({ experiment, completed, open, onToggle, onSelect, onReset }) {
  const currentStage = stageFor(experiment)
  return (
    <aside className={`course-drawer ${open ? 'open' : ''}`} aria-label="课程目录">
      <div className="drawer-heading">
        <div><BookOpen size={17} /><span><b>{completed.size}/38 已掌握</b><small>{currentStage.title} · {currentStage.range}</small></span></div>
        <button className="drawer-close" onClick={onToggle} aria-label="关闭课程目录"><X size={18} /></button>
      </div>
      <div className="stage-tabs">{STAGES.map((stage) => <button key={stage.id} className={stage.id === currentStage.id ? 'active' : ''} onClick={() => onSelect(experimentsForStage(stage.id)[0])}>{stage.short}</button>)}</div>
      <div className="drawer-lessons">
        {experimentsForStage(currentStage.id).map((lesson) => <button key={lesson.id} className={lesson.id === experiment.id ? 'active' : ''} onClick={() => onSelect(lesson)}><span>{String(lesson.number).padStart(2, '0')}</span><b>{lesson.title}</b>{completed.has(lesson.id) && <Check size={14} />}</button>)}
      </div>
      <button className="reset-progress" onClick={onReset}><RotateCcw size={14} />重置学习进度</button>
    </aside>
  )
}

function LessonHeading({ experiment, onMenu }) {
  const stage = stageFor(experiment)
  return (
    <div className="focused-lesson-head">
      <button className="lesson-menu-button" onClick={onMenu}><Menu size={17} />课程目录</button>
      <div><span className={`stage-chip stage-${stage.color}`}>{stage.title}</span><small>实验 {String(experiment.number).padStart(2, '0')} / 38</small></div>
      <h1>{experiment.title}</h1>
      <p>{experiment.summary}</p>
      <div className="lesson-tags">{experiment.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>
    </div>
  )
}

function PredictionCard({ experiment, answer, skipped, revealed, onAnswer, onSkip }) {
  const correct = answer === experiment.answer
  return (
    <section className={`prediction-card card ${revealed ? 'revealed' : ''}`}>
      <div className="prediction-title"><span>01</span><div><b>{revealed ? '修正你的判断' : '先预测，再看动画'}</b><small>{revealed ? '动画已经给出证据，现在重新判断。' : '此时不显示答案，选错也没关系。'}</small></div></div>
      <h2>{experiment.question}</h2>
      <div className="prediction-options">
        {experiment.choices.map((choice, index) => <button key={choice} onClick={() => onAnswer(index)} className={`${answer === index ? 'selected' : ''} ${revealed && index === experiment.answer ? 'correct' : ''} ${revealed && answer === index && !correct ? 'wrong' : ''}`}><span>{String.fromCharCode(65 + index)}</span>{choice}</button>)}
      </div>
      {!revealed && <button className={`skip-prediction ${skipped ? 'active' : ''}`} onClick={onSkip}>{skipped ? <Check size={14} /> : <Sparkles size={14} />}{skipped ? '已选择直接观察' : '暂不确定，直接观察'}</button>}
      {revealed && <div className={`prediction-feedback ${correct ? 'ok' : 'retry'}`}>{correct ? <Check size={17} /> : <RotateCcw size={17} />}<span>{correct ? '判断正确：你已经把动画中的状态变化和结论对应起来了。' : experiment.misconception}</span></div>}
    </section>
  )
}

function GuidedControls({ experiment, settings, update }) {
  const scenario = experiment.scenario
  const cache = ['store', 'cache-switch', 'store-buffer', 'write-combine'].includes(scenario)
  const mpu = ['decoder', 'memory-type', 'alignment', 'region-size', 'subregion', 'subregion-denied', 'overlap', 'permission', 'xn', 'background', 'shareable', 'dma-mpu', 'axi-split', 'guard', 'fault'].includes(scenario)
  const dma = ['dma-tx', 'dma-rx', 'wrong-invalidate', 'rx-handoff', 'line-sharing'].includes(scenario)
  const barrier = ['barrier', 'completion'].includes(scenario)
  return (
    <section className="guided-controls card">
      <div><span>03</span><div><b>试一试</b><small>这里只保留本课最相关的参数，修改后动画会从头开始。</small></div></div>
      <div className="guided-control-grid">
        {(cache || dma) && <label><span>Cache策略</span><select value={settings.policy} onChange={(event) => update('policy', event.target.value)}>{Object.values(CACHE_POLICIES).map((policy) => <option key={policy.id} value={policy.id}>{policy.label}</option>)}</select></label>}
        {(mpu || scenario === 'memory-map' || scenario === 'sdram-code' || scenario === 'external-init') && <label><span>访问地址</span><input value={settings.address} onChange={(event) => update('address', event.target.value)} /></label>}
        {cache && <Toggle checked={settings.cacheHit} onChange={(value) => update('cacheHit', value)} label="Cache Hit" note="目标Line已存在" />}
        {cache && <Toggle checked={settings.dcacheEnabled} onChange={(value) => update('dcacheEnabled', value)} label="D-Cache" note="CCR.DC" />}
        {mpu && <label><span>SRD掩码</span><select value={settings.srd} onChange={(event) => update('srd', Number(event.target.value))}><option value={0}>0x00</option><option value={15}>0x0F</option><option value={240}>0xF0</option><option value={85}>0x55</option><option value={135}>0x87</option></select></label>}
        {mpu && <Toggle checked={settings.xn} onChange={(value) => update('xn', value)} label="XN" note="禁止取指" />}
        {dma && <Toggle checked={settings.clean} onChange={(value) => update('clean', value)} label="Clean" note="写回Dirty Line" />}
        {dma && <Toggle checked={settings.invalidate} onChange={(value) => update('invalidate', value)} label="Invalidate" note="丢弃Cache副本" />}
        {barrier && <label><span>屏障</span><select value={settings.barrier} onChange={(event) => update('barrier', event.target.value)}><option value="none">无屏障</option><option value="dmb">DMB</option><option value="dsb">DSB</option></select></label>}
        {scenario === 'guard' && <Toggle checked={settings.whitelist} onChange={(value) => update('whitelist', value)} label="SDRAM白名单" note="高优先级Region" />}
      </div>
    </section>
  )
}

function CoursePage({ experiment, settings, update, completed, speed, setSpeed, onSelect, onOpenLab, onCompleteLesson, onResetProgress }) {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [answer, setAnswer] = useState(null)
  const [skipped, setSkipped] = useState(false)
  const [watched, setWatched] = useState(false)
  const regions = useMemo(() => regionsForExperiment(experiment, settings), [experiment, settings])
  const address = parseAddress(settings.address)
  const trace = useMemo(() => buildSimulationTrace(experiment, settings), [experiment, settings])
  const canPlay = answer !== null || skipped
  const correct = watched && answer === experiment.answer

  const chooseLesson = (lesson) => {
    setAnswer(null); setSkipped(false); setWatched(false); setDrawerOpen(false); onSelect(lesson)
  }
  const changeSetting = (key, value) => {
    setWatched(false)
    update(key, value)
  }
  const chooseAnswer = (index) => {
    setAnswer(index)
    setSkipped(false)
    if (watched && index === experiment.answer) onCompleteLesson(experiment.id)
  }
  const watchedTrace = () => {
    setWatched(true)
    if (answer === experiment.answer) onCompleteLesson(experiment.id)
  }
  const next = () => {
    const lesson = EXPERIMENTS[experiment.number]
    if (lesson) chooseLesson(lesson)
  }

  return (
    <div className="focused-course-shell">
      {drawerOpen && <CourseDrawer experiment={experiment} completed={completed} open onToggle={() => setDrawerOpen(false)} onSelect={chooseLesson} onReset={onResetProgress} />}
      {drawerOpen && <button className="drawer-backdrop" aria-label="关闭课程目录" onClick={() => setDrawerOpen(false)} />}
      <main className="focused-course">
        <LessonHeading experiment={experiment} onMenu={() => setDrawerOpen(true)} />
        <div className="course-step-label"><span>01</span><b>预测</b><i /><span>02</span><b>观察</b><i /><span>03</span><b>验证</b></div>
        <PredictionCard experiment={experiment} answer={answer} skipped={skipped} revealed={watched} onAnswer={chooseAnswer} onSkip={() => { setSkipped(true); setAnswer(null) }} />
        <AnimationStage key={`${experiment.id}-${JSON.stringify(settings)}`} trace={trace} regions={regions} address={address} speed={speed} onSpeedChange={setSpeed} canPlay={canPlay} onComplete={watchedTrace} />

        <section className={`explanation-panel card ${watched ? 'revealed' : 'locked'}`}>
          <div className="explanation-heading"><span>02</span><div><b>状态变化解释</b><small>{watched ? '逐条回看动画中的因果关系。' : '完整播放一次动画后解锁。'}</small></div></div>
          {watched ? <div className="explanation-events">{trace.events.map((event, index) => <article key={event.id}><span>{index + 1}</span><div><b>{event.title}</b><p>{event.caption}</p></div><small className={`certainty certainty-${event.certainty}`}>{event.certainty === 'possible' ? '可能路径' : event.certainty === 'illustrative' ? '简化示意' : '确定结果'}</small></article>)}</div> : <div className="explanation-placeholder"><Play size={20} />先保留你的预测，再完整播放动画。</div>}
        </section>

        <GuidedControls experiment={experiment} settings={settings} update={changeSetting} />
        <div className="course-finish-row">
          <button className="open-full-lab" onClick={onOpenLab}><SlidersHorizontal size={16} />打开完整配置</button>
          <div><small>{correct ? '本课已掌握' : watched ? '修正答案后即可完成' : '播放完成后再回答'}</small><button className="next-lesson" disabled={!correct || experiment.number === 38} onClick={next}>{experiment.number === 38 ? '已完成全部课程' : '进入下一课'}<ChevronRight size={16} /></button></div>
        </div>
      </main>
    </div>
  )
}

function CourseRail({ selected, completed, onSelect }) {
  return (
    <aside className="course-rail" aria-label="完整实验课程">
      <div className="course-title"><BookOpen size={18} /><div><b>38 个交互实验</b><span>{completed.size} 个已掌握</span></div></div>
      {STAGES.map((stage) => <section key={stage.id} className={`course-stage stage-${stage.color}`}><header><span>{stage.short}</span><b>{stage.title}</b><small>{stage.range}</small></header><div className="lesson-list">{experimentsForStage(stage.id).map((lesson) => <button key={lesson.id} className={selected.id === lesson.id ? 'active' : ''} onClick={() => onSelect(lesson)}><span className="lesson-number">{String(lesson.number).padStart(2, '0')}</span><span className="lesson-name">{lesson.title}</span>{completed.has(lesson.id) && <Check size={13} className="lesson-check" />}</button>)}</div></section>)}
    </aside>
  )
}

function Toggle({ checked, onChange, label, note }) {
  return <label className="toggle-control"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><span className="toggle-track"><i /></span><span><b>{label}</b>{note && <small>{note}</small>}</span></label>
}

function ConfigPanel({ settings, update }) {
  return (
    <section className="config-panel card">
      <div className="panel-heading"><span><SlidersHorizontal size={17} />自由配置</span><small>修改后动画自动复位</small></div>
      <div className="config-grid">
        <label><span>访问地址</span><input aria-label="访问地址" value={settings.address} onChange={(event) => update('address', event.target.value)} /></label>
        <label><span>Cache策略</span><select aria-label="Cache策略" value={settings.policy} onChange={(event) => update('policy', event.target.value)}>{Object.values(CACHE_POLICIES).map((policy) => <option key={policy.id} value={policy.id}>{policy.label}</option>)}</select></label>
        <label><span>访问主体</span><select aria-label="访问主体" value={settings.actor} onChange={(event) => update('actor', event.target.value)}><option value="cpu">CPU</option><option value="dma">DMA</option></select></label>
        <label><span>访问类型</span><select aria-label="访问类型" value={settings.accessKind} onChange={(event) => update('accessKind', event.target.value)}><option value="read">读取</option><option value="write">写入</option><option value="execute">取指</option></select></label>
      </div>
      <div className="toggle-grid"><Toggle checked={settings.dcacheEnabled} onChange={(value) => update('dcacheEnabled', value)} label="D-Cache" note="CCR.DC" /><Toggle checked={settings.cacheHit} onChange={(value) => update('cacheHit', value)} label="Cache Hit" note="目标Line已存在" /><Toggle checked={settings.clean} onChange={(value) => update('clean', value)} label="Clean" note="写回Dirty Line" /><Toggle checked={settings.invalidate} onChange={(value) => update('invalidate', value)} label="Invalidate" note="丢弃Cache副本" /></div>
      <details open><summary>MPU Region 与 TEX/C/B/S</summary>
        <div className="config-grid advanced-grid">
          <label><span>Region基地址</span><input aria-label="Region基地址" value={settings.regionBase} onChange={(event) => update('regionBase', event.target.value)} /></label>
          <label><span>Region大小</span><select aria-label="Region大小" value={settings.regionSize} onChange={(event) => update('regionSize', Number(event.target.value))}><option value={128}>128B</option><option value={256}>256B</option><option value={4096}>4KB</option><option value={524288}>512KB</option><option value={268435456}>256MB</option><option value={4294967296}>4GB</option></select></label>
          <label><span>SRD掩码</span><select aria-label="SRD掩码" value={settings.srd} onChange={(event) => update('srd', Number(event.target.value))}><option value={0}>0x00</option><option value={15}>0x0F</option><option value={240}>0xF0</option><option value={85}>0x55</option><option value={135}>0x87</option></select></label>
          <label><span>AP权限</span><select aria-label="AP权限" value={settings.ap} onChange={(event) => update('ap', event.target.value)}>{AP_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label><span>TEX</span><select aria-label="TEX" value={settings.tex} onChange={(event) => update('tex', Number(event.target.value))}>{Array.from({ length: 8 }, (_, value) => <option key={value} value={value}>{value.toString(2).padStart(3, '0')}</option>)}</select></label>
          <label><span>屏障</span><select aria-label="屏障" value={settings.barrier} onChange={(event) => update('barrier', event.target.value)}><option value="none">无屏障</option><option value="dmb">DMB</option><option value="dsb">DSB</option></select></label>
        </div>
        <div className="toggle-grid compact-toggles"><Toggle checked={Boolean(settings.c)} onChange={(value) => update('c', value ? 1 : 0)} label={`C = ${settings.c}`} /><Toggle checked={Boolean(settings.b)} onChange={(value) => update('b', value ? 1 : 0)} label={`B = ${settings.b}`} /><Toggle checked={settings.shareable} onChange={(value) => update('shareable', value)} label="Shareable" /><Toggle checked={settings.siwt} onChange={(value) => update('siwt', value)} label="CACR.SIWT" /><Toggle checked={settings.xn} onChange={(value) => update('xn', value)} label="XN" /><Toggle checked={settings.privileged} onChange={(value) => update('privileged', value)} label="特权访问" /><Toggle checked={settings.privdefena} onChange={(value) => update('privdefena', value)} label="PRIVDEFENA" /><Toggle checked={settings.whitelist} onChange={(value) => update('whitelist', value)} label="SDRAM白名单" /></div>
      </details>
    </section>
  )
}

function SubregionView({ regions, address }) {
  return <div className="region-stack">{regions.map((region) => { const parts = splitSubregions(region); const validation = validateRegion(region); return <div className="region-row" key={region.number}><div className="region-meta"><span>Region {region.number}</span><b>{region.label}</b><small>{formatHex(validation.effectiveBase)} · {region.size === 4294967296 ? '4GB' : `${region.size / 1024}KB`} · SRD={formatHex(region.srd ?? 0, 2)}</small></div>{parts.length ? <div className="subregion-grid">{parts.map((part) => { const selected = address >= part.start && address <= part.end; return <div key={part.index} className={`${part.disabled ? 'disabled' : ''} ${selected ? 'selected' : ''}`} title={`${formatHex(part.start)}–${formatHex(part.end)}`}><b>{part.index}</b><span>{part.disabled ? '禁用' : '有效'}</span></div> })}</div> : <div className="no-subregions">小于256B：没有Subregion</div>}</div>})}</div>
}

function DecoderPanel({ settings, outcome, mapEntry }) {
  const decoded = decodeMemoryAttributes({ tex: Number(settings.tex), c: Number(settings.c), b: Number(settings.b), s: settings.shareable, siwt: settings.siwt })
  return <section className="decoder card"><div className="decoder-code"><span>TEX</span><b>{Number(settings.tex).toString(2).padStart(3, '0')}</b><span>C</span><b>{settings.c}</b><span>B</span><b>{settings.b}</b><span>S</span><b>{settings.shareable ? 1 : 0}</b></div><div className="decoder-result"><span className={`result-pill result-${decoded.status}`}>{decoded.status === 'valid' ? decoded.type : decoded.status}</span><h3>{decoded.name}</h3><p>{decoded.detail}</p><dl><div><dt>配置策略</dt><dd>{decoded.policy}</dd></div><div><dt>M7实际处理</dt><dd>{decoded.effectivePolicy}</dd></div><div><dt>共享属性</dt><dd>{decoded.shareabilityNote}</dd></div></dl></div><div className={`access-result ${outcome.allowed ? 'allowed' : 'denied'}`}>{outcome.allowed ? <Check size={18} /> : <X size={18} />}<div><b>{outcome.allowed ? '本次访问允许' : outcome.fault}</b><span>{outcome.reason}</span></div></div><div className="map-hit"><Map size={16} /><span>{mapEntry ? `${mapEntry.name} · ${mapEntry.kind}` : '地址未命中内置H75E地图条目'}</span></div></section>
}

function FreeLabPage({ experiment, settings, update, completed, speed, setSpeed, onSelect, onOpenCourse }) {
  const regions = useMemo(() => regionsForExperiment(experiment, settings), [experiment, settings])
  const address = parseAddress(settings.address)
  const outcome = useMemo(() => evaluateAccess({ regions, address, actor: settings.actor, privileged: settings.privileged, kind: settings.accessKind, privdefena: settings.privdefena }), [regions, address, settings.actor, settings.privileged, settings.accessKind, settings.privdefena])
  const trace = useMemo(() => buildSimulationTrace(experiment, settings), [experiment, settings])
  const mapEntry = findMemoryMapEntry(address)
  return <main className="lab-page"><div className="lab-mode-banner"><div><SlidersHorizontal size={18} /><span><b>自由实验室</b><small>全部参数已开放；结论由纯逻辑模型重新计算。</small></span></div><label className="lab-lesson-select"><span>选择实验</span><select aria-label="选择实验" value={experiment.id} onChange={(event) => onSelect(EXPERIMENT_BY_ID[event.target.value])}>{EXPERIMENTS.map((lesson) => <option key={lesson.id} value={lesson.id}>{String(lesson.number).padStart(2, '0')} · {lesson.title}</option>)}</select></label><button onClick={onOpenCourse}><BookOpen size={15} />返回引导课程</button></div><section className="workspace lab-workspace-v2"><CourseRail selected={experiment} completed={completed} onSelect={onSelect} /><div className="lab-workspace"><LessonHeading experiment={experiment} onMenu={() => {}} /><AnimationStage key={`${experiment.id}-${JSON.stringify(settings)}`} trace={trace} regions={regions} address={address} speed={speed} onSpeedChange={setSpeed} /><SubregionView regions={regions} address={address} /><div className="lab-columns"><ConfigPanel settings={settings} update={update} /><DecoderPanel settings={settings} outcome={outcome} mapEntry={mapEntry} /></div></div></section><MemoryMapSection onPick={(value) => update('address', value)} /></main>
}

function MemoryMapSection({ onPick }) {
  return <section className="memory-map-section" id="map"><div className="section-heading"><div><span>GD32H75E</span><h2>地址不是数字，是一张硬件地图</h2></div><p>点击区域可把自由实验室切换到对应起始地址；TCM和共享RAM实际映射仍以具体封装与数据手册为准。</p></div><div className="memory-map-grid">{CORTEX_M7_PROFILE.memoryMap.map((entry) => <button key={`${entry.name}-${entry.start}`} className={`map-card map-${entry.kind.toLowerCase()}`} onClick={() => onPick?.(formatHex(entry.start))}><span>{entry.kind}</span><b>{entry.name}</b><code>{formatHex(entry.start)}–{formatHex(entry.end)}</code><small>{entry.advice}</small></button>)}</div></section>
}

function InfoSections({ onPick }) {
  return <><MemoryMapSection onPick={onPick} /><section className="corrections-section"><div className="section-heading"><div><span>CONCEPT CHECK</span><h2>六个最容易混淆的地方</h2></div><p>这些卡片修正文档或口头讲解中为了简化而留下的歧义。</p></div><div className="correction-grid">{CORRECTIONS.map(([title, body], index) => <article key={title}><span>{String(index + 1).padStart(2, '0')}</span><h3>{title}</h3><p>{body}</p></article>)}</div></section><section className="sources-section" id="sources"><div className="source-intro"><span>资料边界</span><h2>以架构定义为骨架，以芯片资料为落点</h2><p>工具用于建立心智模型，不代替具体芯片勘误、参考手册或安全评审。</p></div><div className="source-list">{SOURCES.map(([org, title, url]) => <a key={title} href={url} target="_blank" rel="noreferrer"><span>{org}</span><b>{title}</b><ExternalLink size={15} /></a>)}</div></section></>
}

function Footer({ completed }) {
  const progress = Math.round((completed.size / EXPERIMENTS.length) * 100)
  return <footer><div><Cpu size={18} /><b>Cache & MPU LAB</b><span>通用原理 · Cortex-M7 · GD32H75E</span></div><p>当前学习进度：{completed.size}/38</p><div className="footer-progress"><span style={{ width: `${progress}%` }} /></div><small>教学模拟使用伪代码和架构模型，不直接生成产品初始化代码。</small></footer>
}

export default function App() {
  const saved = useMemo(() => parseCourseState(window.localStorage.getItem(COURSE_STORAGE_KEY), validLessonIds), [])
  const initialRoute = useMemo(() => currentRoute(), [])
  const [mode, setMode] = useState(initialRoute.mode)
  const [experiment, setExperiment] = useState(EXPERIMENT_BY_ID[initialRoute.lessonId] ?? EXPERIMENT_BY_ID[saved.lastLesson])
  const [courseSettings, setCourseSettings] = useState(() => settingsForExperiment(EXPERIMENT_BY_ID[initialRoute.lessonId] ?? EXPERIMENTS[0]))
  const [labSettings, setLabSettings] = useState(() => settingsForExperiment(EXPERIMENT_BY_ID[initialRoute.lessonId] ?? EXPERIMENTS[0]))
  const [completed, setCompleted] = useState(() => new Set(saved.completed))
  const [speed, setSpeed] = useState(saved.speed)

  useEffect(() => {
    const onPopState = () => {
      const route = currentRoute()
      const lesson = EXPERIMENT_BY_ID[route.lessonId] ?? EXPERIMENTS[0]
      setMode(route.mode)
      setExperiment(lesson)
      setCourseSettings(settingsForExperiment(lesson))
      setLabSettings(settingsForExperiment(lesson))
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  useEffect(() => {
    window.localStorage.setItem(COURSE_STORAGE_KEY, serializeCourseState({ completed: [...completed], lastLesson: experiment.id, speed, mode }))
  }, [completed, experiment.id, speed, mode])

  const navigate = (nextMode, lessonId = experiment.id, anchor) => {
    const lesson = EXPERIMENT_BY_ID[lessonId] ?? experiment
    const url = new URL(window.location.href)
    url.search = ''
    url.hash = anchor ? `#${anchor}` : ''
    if (nextMode !== 'home') { url.searchParams.set('mode', nextMode); url.searchParams.set('lesson', lesson.id) }
    window.history.pushState({}, '', `${url.pathname}${url.search}${url.hash}`)
    setMode(nextMode)
    if (lesson.id !== experiment.id) {
      setCourseSettings(settingsForExperiment(lesson))
      setLabSettings(settingsForExperiment(lesson))
    }
    setExperiment(lesson)
    if (nextMode !== 'home') window.scrollTo({ top: 0, behavior: 'smooth' })
    if (anchor) window.setTimeout(() => document.getElementById(anchor)?.scrollIntoView({ behavior: 'smooth' }), 0)
  }

  const chooseLesson = (lesson) => {
    setExperiment(lesson)
    setCourseSettings(settingsForExperiment(lesson))
    setLabSettings(settingsForExperiment(lesson))
    navigate(mode === 'home' ? 'course' : mode, lesson.id)
  }
  const updateCourse = (key, value) => setCourseSettings((current) => ({ ...current, [key]: value }))
  const updateLab = (key, value) => setLabSettings((current) => ({ ...current, [key]: value }))
  const completeLesson = (id) => setCompleted((current) => new Set([...current, id]))
  const resetProgress = () => setCompleted(new Set())
  const openAddress = (address) => {
    const lesson = EXPERIMENT_BY_ID['memory-map']
    const url = new URL(window.location.href)
    url.search = ''
    url.hash = ''
    url.searchParams.set('mode', 'lab')
    url.searchParams.set('lesson', lesson.id)
    window.history.pushState({}, '', `${url.pathname}${url.search}`)
    setExperiment(lesson)
    setMode('lab')
    setCourseSettings(settingsForExperiment(lesson))
    setLabSettings({ ...settingsForExperiment(lesson), address })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return (
    <div id="top">
      <Topbar mode={mode} lessonId={experiment.id} navigate={navigate} />
      {mode === 'home' && <HomePage completedCount={completed.size} startCourse={() => navigate('course', saved.lastLesson)} openLab={() => navigate('lab', experiment.id)} openAddress={openAddress} startStage={(stageId) => navigate('course', experimentsForStage(stageId)[0].id)} />}
      {mode === 'course' && <CoursePage key={experiment.id} experiment={experiment} settings={courseSettings} update={updateCourse} completed={completed} speed={speed} setSpeed={setSpeed} onSelect={chooseLesson} onOpenLab={() => navigate('lab', experiment.id)} onCompleteLesson={completeLesson} onResetProgress={resetProgress} />}
      {mode === 'lab' && <FreeLabPage experiment={experiment} settings={labSettings} update={updateLab} completed={completed} speed={speed} setSpeed={setSpeed} onSelect={chooseLesson} onOpenCourse={() => navigate('course', experiment.id)} />}
      <Footer completed={completed} />
    </div>
  )
}
