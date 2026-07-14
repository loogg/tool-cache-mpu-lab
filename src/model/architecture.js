export const CACHE_LINE_SIZE = 32

const POLICY_LABELS = {
  '00': 'Non-cacheable',
  '01': 'Write-Back · Write Allocate',
  '10': 'Write-Through · No Write Allocate',
  '11': 'Write-Back · No Write Allocate',
}

function normalResult(name, policy, detail) {
  return {
    status: 'valid',
    type: 'Normal',
    name,
    policy,
    cacheable: policy !== 'Non-cacheable',
    speculative: true,
    detail,
  }
}

export function decodeMemoryAttributes({ tex = 0, c = 0, b = 0, s = false, siwt = false }) {
  const key = `${tex}:${c}:${b}`
  let result

  if (key === '0:0:0') {
    result = {
      status: 'valid', type: 'Strongly-ordered', name: 'Strongly-ordered', policy: 'Non-cacheable',
      cacheable: false, speculative: false, detail: '严格的设备访问语义；架构上始终属于 Shareable。',
    }
  } else if (key === '0:0:1') {
    result = {
      status: 'valid', type: 'Device', name: 'Device · Shareable', policy: 'Non-cacheable',
      cacheable: false, speculative: false, detail: '适合有读写副作用的外设寄存器。',
    }
  } else if (key === '0:1:0') {
    result = normalResult('Normal · WT / No WA', 'Write-Through · No Write Allocate', '写命中同时更新 Cache 与内存系统；写未命中不分配 Cache Line。')
  } else if (key === '0:1:1') {
    result = normalResult('Normal · WB / No WA', 'Write-Back · No Write Allocate', '写命中产生 Dirty Line；写未命中不分配 Cache Line。')
  } else if (key === '1:0:0') {
    result = normalResult('Normal · Non-cacheable', 'Non-cacheable', '不进入 L1 D-Cache，但 Normal Memory 写仍可能经过 Store Buffer。')
  } else if (key === '1:0:1') {
    result = { status: 'reserved', type: 'Reserved', name: '保留编码', policy: '—', cacheable: false, speculative: false, detail: '不要在产品配置中使用。' }
  } else if (key === '1:1:0') {
    result = { status: 'implementation', type: 'Implementation-defined', name: '实现相关编码', policy: '实现相关', cacheable: false, speculative: false, detail: '必须查具体处理器实现文档。' }
  } else if (key === '1:1:1') {
    result = normalResult('Normal · WB / Write Allocate', 'Write-Back · Write Allocate', '写未命中会分配 Cache Line，适合会重复访问的数据。')
  } else if (key === '2:0:0') {
    result = {
      status: 'valid', type: 'Device', name: 'Device · Non-shareable', policy: 'Non-cacheable',
      cacheable: false, speculative: false, detail: '非共享设备内存编码；是否适用由芯片内存映射决定。',
    }
  } else if (tex === 2 || tex === 3) {
    result = { status: 'reserved', type: 'Reserved', name: '保留编码', policy: '—', cacheable: false, speculative: false, detail: '该 TEX/C/B 组合在 Armv7-M 中保留。' }
  } else if (tex >= 4 && tex <= 7) {
    const outer = POLICY_LABELS[(tex & 0b11).toString(2).padStart(2, '0')]
    const inner = POLICY_LABELS[`${c}${b}`]
    result = normalResult(`Normal · Outer ${outer} / Inner ${inner}`, `Inner ${inner}`, 'TEX[2]=1 时，TEX[1:0] 描述 Outer 属性，C/B 描述 Inner 属性。')
  } else {
    result = { status: 'reserved', type: 'Reserved', name: '无效编码', policy: '—', cacheable: false, speculative: false, detail: 'TEX 必须是 0 到 7。' }
  }

  const architecturallyShareable = result.type === 'Strongly-ordered' ? true : Boolean(s)
  let effectivePolicy = result.policy
  let shareabilityNote = architecturallyShareable ? '属于共享域' : '不属于共享域'

  if (result.type === 'Normal' && result.cacheable && architecturallyShareable) {
    effectivePolicy = siwt ? 'Cortex-M7：按共享 Write-Through 处理' : 'Cortex-M7 默认：按 Non-cacheable 处理'
    shareabilityNote = siwt
      ? 'CACR.SIWT=1，共享可缓存数据按 Write-Through 处理'
      : 'CACR.SIWT=0，共享 Normal Memory 默认不进入 L1 D-Cache'
  }

  return { ...result, shareable: architecturallyShareable, effectivePolicy, shareabilityNote }
}

export const GD32H75E_MEMORY_MAP = [
  { name: 'ITCM / 启动别名窗口', start: 0x00000000, end: 0x000fffff, kind: 'TCM', advice: '容量与共享 RAM 配置有关；按芯片启动配置核对。' },
  { name: '内部 Flash', start: 0x08000000, end: 0x083bffff, kind: 'Flash', advice: '代码：Normal、Cacheable、可执行；通常只读。' },
  { name: 'DTCM 窗口', start: 0x20000000, end: 0x200fffff, kind: 'TCM', advice: '低延迟 CPU 数据；DMA 可达性必须查总线连接。' },
  { name: 'AXI SRAM', start: 0x24000000, end: 0x2407ffff, kind: 'SRAM', advice: '普通数据可 WBWA；DMA Buffer 需维护一致性或设 Non-cacheable。' },
  { name: '共享 TCM / AXI RAM', start: 0x24080000, end: 0x240fffff, kind: 'SRAM', advice: '实际映射取决于共享 RAM 配置。' },
  { name: 'SRAM0', start: 0x30000000, end: 0x30003fff, kind: 'SRAM', advice: '16KB；按 CPU/DMA 用途选择 Cache 策略。' },
  { name: 'SRAM1', start: 0x30004000, end: 0x30007fff, kind: 'SRAM', advice: '16KB；数据区建议 XN。' },
  { name: '外设寄存器', start: 0x40000000, end: 0x5fffffff, kind: 'Device', advice: 'Device、Non-cacheable、XN。' },
  { name: 'EXMC NOR/PSRAM/SRAM', start: 0x60000000, end: 0x6fffffff, kind: 'External', advice: '控制器初始化后再开放对应 MPU Region。' },
  { name: 'OSPI1', start: 0x70000000, end: 0x7fffffff, kind: 'External', advice: 'Memory-mapped 模式按代码/数据用途设置。' },
  { name: 'EXMC NAND', start: 0x80000000, end: 0x8fffffff, kind: 'External', advice: '不要把寄存器式访问误设为普通可缓存 RAM。' },
  { name: 'OSPI0', start: 0x90000000, end: 0x9fffffff, kind: 'External', advice: '未初始化前应阻止推测访问。' },
  { name: 'SDRAM Device 0', start: 0xc0000000, end: 0xcfffffff, kind: 'SDRAM', advice: '代码区可执行；普通数据与 DMA Buffer 应分 Region。' },
  { name: 'SDRAM Device 1', start: 0xd0000000, end: 0xdfffffff, kind: 'SDRAM', advice: '同上；注意 4GB 兜底 Region 会覆盖这里。' },
  { name: '系统控制空间 / PPB', start: 0xe0000000, end: 0xffffffff, kind: 'System', advice: '使用架构默认 Device/Strongly-ordered 属性。' },
]

export const CORTEX_M7_PROFILE = {
  id: 'cortex-m7-gd32h75e',
  name: 'Cortex-M7 · GD32H75E',
  architecture: 'Armv7-M / PMSAv7',
  cacheLineSize: CACHE_LINE_SIZE,
  maxRegions: 16,
  supportsSubregionsFrom: 256,
  memoryMap: GD32H75E_MEMORY_MAP,
}

export function findMemoryMapEntry(address) {
  return GD32H75E_MEMORY_MAP.find((entry) => address >= entry.start && address <= entry.end)
}
