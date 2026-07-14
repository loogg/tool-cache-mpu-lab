export const REGION_SIZES = [
  32, 64, 128, 256, 512, 1024, 2048, 4096, 8192, 16384, 32768, 65536,
  131072, 262144, 524288, 1048576, 2097152, 4194304, 8388608, 16777216,
  33554432, 67108864, 134217728, 268435456, 536870912, 1073741824,
  2147483648, 4294967296,
]

export function formatHex(value, width = 8) {
  return `0x${Math.max(0, Number(value)).toString(16).toUpperCase().padStart(width, '0')}`
}

export function parseAddress(value, fallback = 0) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const text = String(value).trim().replaceAll('_', '')
  const parsed = Number.parseInt(text, text.toLowerCase().startsWith('0x') ? 16 : 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

export function effectiveRegionBase(region) {
  return Math.floor(region.base / region.size) * region.size
}

export function validateRegion(region) {
  const validSize = REGION_SIZES.includes(region.size)
  const aligned = validSize && region.base % region.size === 0
  return {
    validSize,
    aligned,
    effectiveBase: validSize ? effectiveRegionBase(region) : region.base,
    message: !validSize
      ? 'Region 大小必须是 32B 到 4GB 的 2 次幂。'
      : aligned
        ? '基地址与 Region 大小正确对齐。'
        : `基地址未按 ${region.size} 字节对齐；低地址位不能用于区分 Region。`,
  }
}

export function splitSubregions(region) {
  if (region.size < 256) return []
  const base = effectiveRegionBase(region)
  const size = region.size / 8
  return Array.from({ length: 8 }, (_, index) => ({
    index,
    start: base + size * index,
    end: base + size * (index + 1) - 1,
    size,
    disabled: Boolean((region.srd ?? 0) & (1 << index)),
  }))
}

export function regionContains(region, address) {
  if (region.enabled === false || !REGION_SIZES.includes(region.size)) return false
  const base = effectiveRegionBase(region)
  if (address < base || address >= base + region.size) return false
  if (region.size < 256) return true
  const subregionSize = region.size / 8
  const index = Math.min(7, Math.floor((address - base) / subregionSize))
  return !((region.srd ?? 0) & (1 << index))
}

export function resolveRegion(regions, address) {
  const matches = regions
    .filter((region) => regionContains(region, address))
    .sort((left, right) => right.number - left.number)
  return { region: matches[0] ?? null, matches }
}

export function checkPermission(ap, { privileged = true, kind = 'read' }) {
  const write = kind === 'write'
  switch (ap) {
    case 'no-access': return false
    case 'priv-rw': return privileged
    case 'priv-rw-user-ro': return privileged || !write
    case 'full': return true
    case 'priv-ro': return privileged && !write
    case 'read-only': return !write
    default: return false
  }
}

export function evaluateAccess({ regions, address, actor = 'cpu', privileged = true, kind = 'read', privdefena = true }) {
  if (actor === 'dma') {
    return {
      allowed: true,
      source: 'soc-bus',
      fault: null,
      reason: 'DMA 不经过 Cortex-M7 内核 MPU；能否访问取决于 GD32H75E 总线连接和目标存储器状态。',
      region: null,
    }
  }

  const { region, matches } = resolveRegion(regions, address)
  if (!region) {
    if (privileged && privdefena) {
      return {
        allowed: true,
        source: 'background',
        fault: null,
        reason: '没有显式 Region 命中；特权访问使用默认背景内存映射。',
        region: null,
        matches,
      }
    }
    return {
      allowed: false,
      source: 'unmapped',
      fault: 'MemManage',
      reason: privileged
        ? 'PRIVDEFENA=0，未命中任何 Region。'
        : '非特权访问不能依靠 PRIVDEFENA 使用背景区域。',
      region: null,
      matches,
    }
  }

  if (kind === 'execute' && region.xn) {
    return { allowed: false, source: 'region', fault: 'MemManage · IACCVIOL', reason: `Region ${region.number} 设置了 XN，禁止取指。`, region, matches }
  }

  if (!checkPermission(region.ap, { privileged, kind })) {
    return { allowed: false, source: 'region', fault: 'MemManage · DACCVIOL', reason: `Region ${region.number} 的 AP 权限拒绝本次${kind === 'write' ? '写入' : '访问'}。`, region, matches }
  }

  return { allowed: true, source: 'region', fault: null, reason: `由最高优先级 Region ${region.number} 授权。`, region, matches }
}

export function makeAxiSplitRegions() {
  return [
    { number: 1, base: 0x24000000, size: 524288, srd: 0x00, ap: 'full', xn: false, attributes: { tex: 1, c: 1, b: 1, s: false }, label: '全部 512KB · WBWA' },
    { number: 2, base: 0x24000000, size: 524288, srd: 0x0f, ap: 'full', xn: false, attributes: { tex: 0, c: 1, b: 0, s: false }, label: '后 256KB · WT/NWA' },
  ]
}

export function makeGuardRegions({ whitelist = false } = {}) {
  const regions = [
    { number: 0, base: 0, size: 4294967296, srd: 0x87, ap: 'no-access', xn: true, attributes: { tex: 0, c: 0, b: 0, s: true }, label: '4GB 兜底禁区' },
  ]
  if (whitelist) {
    regions.push({ number: 3, base: 0xc0000000, size: 268435456, srd: 0, ap: 'full', xn: false, attributes: { tex: 1, c: 1, b: 1, s: false }, label: 'SDRAM0 白名单' })
  }
  return regions
}
