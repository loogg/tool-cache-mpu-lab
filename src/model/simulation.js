import { decodeMemoryAttributes, findMemoryMapEntry } from './architecture.js'
import { cacheMaintenanceRange, simulateDmaRx, simulateDmaTx, simulateReadSequence, simulateStore } from './cache.js'
import { evaluateAccess, formatHex, makeAxiSplitRegions, makeGuardRegions, parseAddress, resolveRegion, splitSubregions, validateRegion } from './mpu.js'

const f = (node, title, detail, state = {}) => ({ node, title, detail, status: 'running', ...state })

function finish(frames) {
  if (frames.length) frames[frames.length - 1] = { ...frames.at(-1), status: frames.at(-1).status === 'fault' ? 'fault' : 'done' }
  return frames
}

export function settingsForExperiment(experiment) {
  return {
    address: '0x24000000',
    regionBase: '0x24000000',
    regionSize: 524288,
    srd: 0,
    tex: 1,
    c: 1,
    b: 1,
    shareable: false,
    siwt: false,
    xn: false,
    ap: 'full',
    actor: 'cpu',
    accessKind: 'read',
    privileged: true,
    privdefena: true,
    dcacheEnabled: true,
    cacheHit: false,
    policy: 'wb-wa',
    clean: false,
    invalidate: true,
    wrongClean: false,
    barrier: 'dmb',
    whitelist: false,
    length: 64,
    ...experiment.defaults,
  }
}

export function regionsForExperiment(experiment, settings) {
  if (experiment.scenario === 'axi-split') return makeAxiSplitRegions()
  if (experiment.scenario === 'guard') return makeGuardRegions({ whitelist: settings.whitelist })
  const base = parseAddress(settings.regionBase, 0x24000000)
  return [{
    number: 1,
    base,
    size: Number(settings.regionSize),
    srd: Number(settings.srd),
    ap: settings.ap,
    xn: settings.xn,
    attributes: { tex: Number(settings.tex), c: Number(settings.c), b: Number(settings.b), s: settings.shareable },
    label: '自由配置 Region 1',
  }]
}

function simulateDecoder(settings) {
  const decoded = decodeMemoryAttributes({ tex: Number(settings.tex), c: Number(settings.c), b: Number(settings.b), s: settings.shareable, siwt: settings.siwt })
  return finish([
    f('mpu', '读取 TEX/C/B/S', `当前编码：TEX=${Number(settings.tex).toString(2).padStart(3, '0')}、C=${settings.c}、B=${settings.b}、S=${settings.shareable ? 1 : 0}。`),
    f('mpu', decoded.name, decoded.detail, { region: decoded.effectivePolicy }),
    f('cpu', '应用到 CPU 访问', `${decoded.shareabilityNote}；实际策略：${decoded.effectivePolicy}。`, { cache: decoded.cacheable ? '由属性与 M7 规则决定' : 'bypass' }),
  ])
}

function simulateSubregions(settings, denied = false) {
  const region = regionsForExperiment({ scenario: 'free' }, settings)[0]
  const address = parseAddress(settings.address)
  const pieces = splitSubregions(region)
  const piece = pieces.find((item) => address >= item.start && address <= item.end)
  const frames = [
    f('mpu', '把 Region 平分成八块', region.size < 256 ? '当前 Region 小于 256B，不能使用 SRD。' : `每块 ${region.size / 8} 字节；SRD=${formatHex(region.srd, 2)}。`),
    f('mpu', `地址落在 Subregion ${piece?.index ?? '—'}`, piece ? `${formatHex(piece.start)}–${formatHex(piece.end)}，该块${piece.disabled ? '被禁用' : '参与匹配'}。` : '地址不在该 Region 中。', { region: piece?.disabled ? 'disabled' : 'active' }),
  ]
  if (denied && piece?.disabled) {
    frames.push(f('mpu', '继续匹配，不是立即拒绝', 'SRD 禁用意味着当前 Region 对这块地址“看不见”；处理器继续找其他 Region 或背景映射。'))
  } else {
    frames.push(f('cpu', piece?.disabled ? '当前 Region 不生效' : '应用当前 Region 属性', piece?.disabled ? '结果取决于其他 Region、特权级与 PRIVDEFENA。' : '访问权限和内存属性现在生效。'))
  }
  return finish(frames)
}

function simulateAccess(experiment, settings) {
  const address = parseAddress(settings.address)
  const regions = regionsForExperiment(experiment, settings)
  const result = evaluateAccess({ regions, address, actor: settings.actor, privileged: settings.privileged, kind: settings.accessKind, privdefena: settings.privdefena })
  const frames = [
    f(settings.actor === 'dma' ? 'dma' : 'cpu', `${settings.actor === 'dma' ? 'DMA' : 'CPU'} 发起${settings.accessKind === 'write' ? '写入' : settings.accessKind === 'execute' ? '取指' : '读取'}`, `目标地址 ${formatHex(address)}。`),
    f('mpu', result.region ? `命中 Region ${result.region.number}` : result.source === 'background' ? '使用背景映射' : result.source === 'soc-bus' ? '不经过 CPU MPU' : '没有 Region 命中', result.reason, { region: result.region?.label ?? result.source }),
    f(result.allowed ? 'bus' : 'fault', result.allowed ? '访问继续' : result.fault, result.allowed ? '接下来由 Cache、总线和目标设备完成访问。' : '若 MemManage 未启用，该异常会升级为 HardFault。', { status: result.allowed ? 'done' : 'fault', fault: result.fault }),
  ]
  return frames
}

function simulateAxiSplit(settings) {
  const address = parseAddress(settings.address, 0x24040000)
  const regions = makeAxiSplitRegions()
  const result = resolveRegion(regions, address)
  const selected = result.region
  const decoded = decodeMemoryAttributes({ ...selected.attributes })
  return finish([
    f('mpu', 'Region 1 覆盖全部 512KB', '0x24000000–0x2407FFFF 使用 WB + Write Allocate；八个 Subregion 全部有效。', { region: 'Region 1 · WBWA' }),
    f('mpu', 'Region 2 叠加后半区', 'SRD=0x0F 禁用低四个 Subregion，仅高四个 64KB 子区域参与匹配。', { region: 'Region 2 · WT/NWA' }),
    f('mpu', `${formatHex(address)} → Region ${selected.number}`, `同时命中时高编号优先；最终属性是 ${decoded.name}。`, { region: selected.label }),
    f('dcache', selected.number === 1 ? '写 Miss：分配并产生 Dirty Line' : '写 Miss：不分配，写向内存', selected.number === 1 ? '前 256KB 适合重复访问的 WBWA 数据。' : '后 256KB 使用 WT/NWA，不留下 Write-Back Dirty Line。', { cache: selected.number === 1 ? 'dirty' : 'no allocation' }),
  ])
}

function simulateGuard(settings) {
  const address = parseAddress(settings.address, 0x60000000)
  const regions = makeGuardRegions({ whitelist: settings.whitelist })
  const result = evaluateAccess({ regions, address, actor: settings.actor, privileged: settings.privileged, kind: settings.accessKind, privdefena: settings.privdefena })
  return finish([
    f('mpu', '4GB Region 拆成八块', 'SRD=0x87 禁用子区域 0、1、2、7；Region 0 在 0x60000000–0xDFFFFFFF 参与匹配。', { region: 'Region 0 · NO_ACCESS' }),
    f('mpu', `${formatHex(address)} 开始匹配`, result.region ? `最高优先级是 Region ${result.region.number}：${result.region.label}。` : result.reason, { region: result.region?.label ?? result.source }),
    f(result.allowed ? 'bus' : 'fault', result.allowed ? '访问被白名单授权' : '显式访问产生 MemManage', result.allowed ? result.reason : '推测请求可在成为架构有效访问前被保护属性阻止；程序显式访问则必须报告 Fault。', { status: result.allowed ? 'done' : 'fault', fault: result.fault }),
  ])
}

function genericStory(experiment) {
  return finish([
    f('cpu', '建立观察问题', experiment.summary),
    f(experiment.stage === 'mpu' || experiment.stage === 'gd32' ? 'mpu' : 'dcache', '应用当前配置', experiment.misconception),
    f('bus', '跟踪对外可见状态', '分别查看 CPU 私有状态、物理内存状态，以及 DMA 能观察到的内容。'),
  ])
}

export function simulateExperiment(experiment, settings) {
  switch (experiment.scenario) {
    case 'cache-read': return simulateReadSequence()
    case 'cache-read-cross': return simulateReadSequence({ addresses: [0x2400001e, 0x2400001f, 0x24000020, 0x24000040] })
    case 'store': return simulateStore({ policy: settings.policy, hit: settings.cacheHit, dcacheEnabled: settings.dcacheEnabled })
    case 'cache-switch': return simulateStore({ policy: settings.policy, hit: true, dcacheEnabled: settings.dcacheEnabled })
    case 'store-buffer': return finish([
      f('cpu', 'CPU 执行 Store', '本次访问是 Normal Memory。'),
      f('store', '写事务进入 Store Buffer', 'CPU 可以继续执行；这不是长期保存数据的 Cache Line。', { storeBuffer: 'pending' }),
      f('bus', 'DMB/DSB 或队列推进', '写事务按内存模型要求离开 Store Buffer，并进入总线系统。', { storeBuffer: 'empty' }),
      f('memory', '物理内存更新', '当前 CPU 此前一直能观察自己的新值，外部观察者现在也可见。'),
    ])
    case 'write-combine': return finish([
      f('cpu', '写 buf[0] = 0x11', '第一个字节写进入 Store Buffer。'),
      f('cpu', '写 buf[1] = 0x22', '第二个字节与前一个写位于同一总线数据拍。'),
      f('store', '合并相邻写', '总线侧可能形成一次数据 0x2211、字节选通 0b0011 的写事务。'),
      f('memory', '最终结果保持程序语义', 'buf[0]=0x11、buf[1]=0x22；不要依赖外部观察者看到中间状态。'),
    ])
    case 'decoder':
    case 'memory-type':
    case 'shareable': return simulateDecoder(settings)
    case 'alignment': {
      const region = regionsForExperiment(experiment, settings)[0]
      const check = validateRegion(region)
      return finish([
        f('mpu', '检查 Region 大小', `${region.size} 字节${check.validSize ? '是合法的 2 次幂大小' : '不是合法大小'}。`),
        f('mpu', check.aligned ? '基地址正确对齐' : '发现未对齐基地址', check.message, { region: `有效基址 ${formatHex(check.effectiveBase)}` }),
        f(check.aligned ? 'bus' : 'fault', check.aligned ? '配置可表达' : '修正配置再启用', check.aligned ? '地址比较可按预期工作。' : '教学工具不会悄悄接受可能误导的 Region 边界。'),
      ])
    }
    case 'region-size': return simulateSubregions(settings)
    case 'subregion': return simulateSubregions(settings)
    case 'subregion-denied': return simulateSubregions(settings, true)
    case 'overlap': return simulateAxiSplit(settings)
    case 'permission':
    case 'xn':
    case 'background':
    case 'dma-mpu':
    case 'fault': return simulateAccess(experiment, settings)
    case 'dma-tx': return simulateDmaTx({ policy: settings.policy, clean: settings.clean })
    case 'dma-rx': return simulateDmaRx({ invalidate: settings.invalidate, wrongClean: settings.wrongClean })
    case 'wrong-invalidate': return finish([
      f('dcache', 'CPU 新值只在 Dirty Line', '物理内存仍是旧值。', { cache: 'dirty · 新值', memory: '旧值' }),
      f('dcache', '错误执行 Invalidate', 'Dirty Line 被直接丢弃，没有先写回。', { cache: 'invalid', memory: '旧值', status: 'fault' }),
      f('dma', 'DMA 读到旧值', 'CPU 刚准备的新数据已经丢失。', { dma: '旧值 ✕', status: 'fault' }),
    ])
    case 'rx-handoff': return simulateDmaRx({ invalidate: true, wrongClean: false })
    case 'line-sharing': {
      const range = cacheMaintenanceRange(parseAddress(settings.address), Number(settings.length))
      return finish([
        f('cpu', '选择 DMA Buffer', `请求范围：${formatHex(parseAddress(settings.address))}，长度 ${settings.length} 字节。`),
        f('dcache', '扩大到完整 Cache Line', `实际维护 ${formatHex(range.start)}–${formatHex(range.end - 1)}，共 ${range.lines} 条 Line。`, { cache: `${range.length}B maintenance` }),
        f(range.start === parseAddress(settings.address) && range.length === Number(settings.length) ? 'bus' : 'fault', range.start === parseAddress(settings.address) && range.length === Number(settings.length) ? 'Buffer 独占完整 Line' : '可能包含相邻变量', range.start === parseAddress(settings.address) && range.length === Number(settings.length) ? '维护不会碰到缓冲区外的数据。' : 'Invalidate 前必须确认相邻 Dirty 数据不会被误伤。'),
      ])
    }
    case 'barrier': return finish([
      f('cpu', '写入 data', 'CPU 先准备描述符载荷。', { memory: 'data pending' }),
      f('store', settings.barrier === 'none' ? '没有发布屏障' : settings.barrier.toUpperCase(), settings.barrier === 'none' ? '外部观察者不应依赖两个独立 Normal Memory 写的可见顺序。' : settings.barrier === 'dmb' ? '约束屏障前后的显式内存访问顺序。' : '还要求后续指令等待前序访问达到完成条件。'),
      f('dma', '观察 valid', settings.barrier === 'none' ? 'DMA 可能先看到 valid，而 data 尚未对它可见。' : '发布点建立后，DMA 可按协议消费 data。', { status: settings.barrier === 'none' ? 'fault' : 'done' }),
    ])
    case 'completion': return finish([
      f('cpu', '写外设 START', '总线写启动外设内部状态机。'),
      f('bus', 'DSB 等待显式访问完成', '保证架构定义的事务完成条件，而非外设内部任务结束。'),
      f('device', '外设仍然 BUSY', 'Flash擦除、DMA传输等必须轮询状态位或等待完成中断。'),
    ])
    case 'axi-split': return simulateAxiSplit(settings)
    case 'guard': return simulateGuard(settings)
    case 'sdram-code': return finish([
      f('cpu', '从 Flash 复制代码到 SDRAM', 'CPU 写入的代码可能先存在 D-Cache Dirty Line。'),
      f('dcache', 'Clean D-Cache', '将新指令字节写回 SDRAM，供取指路径观察。'),
      f('icache', 'Invalidate I-Cache', '丢弃可能存在的旧指令副本。'),
      f('cpu', 'DSB + ISB 后跳转', '代码区必须允许执行；普通数据区保持 XN。'),
    ])
    case 'external-init': return finish([
      f('mpu', '启动早期建立 No Access + XN', '外部控制器尚未配置，先阻止显式和不期望的推测访问。'),
      f('device', '初始化 EXMC / OSPI / SDRAM', '配置时钟、时序和映射模式，并等待控制器就绪。'),
      f('mpu', '添加高优先级允许 Region', '按代码、普通数据、DMA Buffer用途分别设置属性。'),
      f('bus', '开放访问', '现在 CPU 才能安全访问真实外部存储器。'),
    ])
    case 'memory-map': {
      const address = parseAddress(settings.address)
      const entry = findMemoryMapEntry(address)
      return finish([
        f('cpu', '选择一个 GD32H75E 地址', formatHex(address)),
        f('bus', entry?.name ?? '未列入的地址窗口', entry?.advice ?? '先查芯片数据手册和总线矩阵，再配置 MPU。', { region: entry?.kind ?? 'Unknown' }),
        f('mpu', '按用途拆 Region', '同一物理存储器中的代码、普通数据和DMA Buffer不必使用相同属性。'),
      ])
    }
    default: return genericStory(experiment)
  }
}
