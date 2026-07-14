import { CACHE_LINE_SIZE } from './architecture.js'

export const CACHE_POLICIES = {
  'wb-wa': { id: 'wb-wa', label: 'WB + Write Allocate', writeBack: true, writeAllocate: true, cacheable: true },
  'wb-nwa': { id: 'wb-nwa', label: 'WB + No Write Allocate', writeBack: true, writeAllocate: false, cacheable: true },
  'wt-nwa': { id: 'wt-nwa', label: 'WT + No Write Allocate', writeBack: false, writeAllocate: false, cacheable: true },
  nc: { id: 'nc', label: 'Normal Non-cacheable', writeBack: false, writeAllocate: false, cacheable: false },
}

function frame(node, title, detail, state = {}) {
  return { node, title, detail, status: 'running', ...state }
}

export function simulateReadSequence({ addresses = [0x24000000, 0x24000001, 0x24000020] } = {}) {
  const loadedLines = new Set()
  const frames = [frame('cpu', 'CPU 发出第一次读取', '先检查目标地址属于哪一条 32 字节 Cache Line。')]
  for (const address of addresses) {
    const line = Math.floor(address / CACHE_LINE_SIZE) * CACHE_LINE_SIZE
    const hit = loadedLines.has(line)
    if (hit) {
      frames.push(frame('dcache', 'D-Cache Hit', `0x${address.toString(16).toUpperCase()} 与之前地址位于同一条 Cache Line，直接返回。`, { cache: 'hit', address, line }))
    } else {
      frames.push(frame('bus', 'D-Cache Miss', `Cache 中没有 0x${line.toString(16).toUpperCase()} 开始的整条数据，请求内存。`, { cache: 'miss', address, line }))
      frames.push(frame('memory', 'Linefill 32 字节', '内存返回整条 Cache Line，而不只是当前字节。', { cache: 'fill', address, line }))
      loadedLines.add(line)
    }
  }
  frames.push(frame('cpu', '读取序列完成', `共访问 ${addresses.length} 个地址，产生 ${loadedLines.size} 次 Linefill。`, { status: 'done' }))
  return frames
}

export function simulateStore({ policy = 'wb-wa', hit = false, dcacheEnabled = true } = {}) {
  const config = CACHE_POLICIES[policy] ?? CACHE_POLICIES['wb-wa']
  const frames = [frame('cpu', 'CPU 执行 Store', `目标 Cache Line 当前${hit ? '已经存在' : '不存在'}。`, { memory: '旧值', cache: hit ? 'clean' : 'empty' })]

  if (!dcacheEnabled || !config.cacheable) {
    frames.push(frame('store', dcacheEnabled ? '区域不可缓存' : 'D-Cache 全局关闭', '本次写不在 D-Cache 中形成 Dirty Line，但仍可进入 Store Buffer。', { cache: 'bypass', storeBuffer: '新值排队' }))
    frames.push(frame('memory', '写入内存系统', 'Store Buffer 将写事务送往总线；最终内存得到新值。', { memory: '新值', cache: 'bypass', storeBuffer: 'empty', status: 'done' }))
    return frames
  }

  if (!hit && config.writeAllocate) {
    frames.push(frame('memory', 'Write Allocate：Linefill', '先从内存读取整条 32 字节 Cache Line，并与本次写入合并。', { cache: 'fill', memory: '旧值' }))
    hit = true
  }

  if (!hit) {
    frames.push(frame('store', 'No Write Allocate：不分配', '写未命中不会把这条 Line 拉进 Cache，写事务进入 Store Buffer。', { cache: 'empty', storeBuffer: '新值排队' }))
    frames.push(frame('memory', '内存收到新值', '总线完成写入；Cache 中仍没有这条 Line。', { cache: 'empty', memory: '新值', storeBuffer: 'empty', status: 'done' }))
    return frames
  }

  if (config.writeBack) {
    frames.push(frame('dcache', '更新 Cache，标记 Dirty', 'Write-Back 暂不更新 SRAM/SDRAM；CPU 自己已经能读到新值。', { cache: 'dirty · 新值', memory: '旧值' }))
    frames.push(frame('dcache', '等待 Clean 或替换', '只有执行 Clean 或 Cache Line 被替换时，Dirty 数据才写回内存。', { cache: 'dirty · 新值', memory: '旧值', status: 'done' }))
  } else {
    frames.push(frame('dcache', 'Write-Through 命中', '先更新 Cache 中的副本，同时向 Store Buffer 发出外部写。', { cache: 'clean · 新值', memory: '旧值', storeBuffer: '新值排队' }))
    frames.push(frame('memory', '外部内存同步更新', '写事务到达内存系统，不留下 Write-Back Dirty Line。', { cache: 'clean · 新值', memory: '新值', storeBuffer: 'empty', status: 'done' }))
  }
  return frames
}

export function simulateDmaTx({ policy = 'wb-wa', clean = false } = {}) {
  const config = CACHE_POLICIES[policy] ?? CACHE_POLICIES['wb-wa']
  const frames = simulateStore({ policy, hit: true, dcacheEnabled: true })
  if (config.writeBack && clean) {
    frames.push(frame('dcache', 'Clean D-Cache', 'Dirty Cache Line 被写回物理内存，Cache 副本仍有效。', { cache: 'clean · 新值', memory: '新值' }))
  }
  const visible = !config.writeBack || clean
  frames.push(frame('dma', visible ? 'DMA 读到新值' : 'DMA 读到旧值', visible ? 'DMA 直接读取 SRAM/SDRAM，看到 CPU 已经发布的数据。' : '最新值仍只在 CPU 私有 D-Cache，DMA 无法观察。', { dma: visible ? '新值 ✓' : '旧值 ✕', memory: visible ? '新值' : '旧值', status: visible ? 'done' : 'fault' }))
  return frames
}

export function simulateDmaRx({ invalidate = true, wrongClean = false } = {}) {
  const frames = [
    frame('dcache', 'CPU Cache 中保留旧副本', 'CPU 之前读取过 RX Buffer，Cache Line 当前有效。', { cache: '旧值', memory: '旧值' }),
    frame('dma', 'DMA 写入物理内存', 'DMA 绕过 CPU D-Cache，把接收数据写入 SRAM/SDRAM。', { cache: '旧值', memory: 'DMA 新值' }),
  ]
  if (wrongClean) {
    frames.push(frame('dcache', '错误：Clean 旧 Dirty Line', 'CPU 旧值可能写回并覆盖 DMA 刚写入的新数据。', { cache: '旧值', memory: '旧值', status: 'fault' }))
  } else if (invalidate) {
    frames.push(frame('dcache', 'Invalidate D-Cache', '丢弃 CPU 旧副本；下一次读取从物理内存重新装载。', { cache: 'invalid', memory: 'DMA 新值' }))
    frames.push(frame('cpu', 'CPU 读到 DMA 新值', 'Cache Miss 后从 SRAM/SDRAM 取回最新数据。', { cache: 'DMA 新值', memory: 'DMA 新值', status: 'done' }))
  } else {
    frames.push(frame('cpu', 'CPU 命中旧 Cache', '没有 Invalidate，CPU 仍读到 DMA 传输前的旧值。', { cache: '旧值', memory: 'DMA 新值', status: 'fault' }))
  }
  return frames
}

export function cacheMaintenanceRange(address, length) {
  const start = Math.floor(address / CACHE_LINE_SIZE) * CACHE_LINE_SIZE
  const end = Math.ceil((address + length) / CACHE_LINE_SIZE) * CACHE_LINE_SIZE
  return { start, end, length: end - start, lines: (end - start) / CACHE_LINE_SIZE }
}
