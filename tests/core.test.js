import assert from 'node:assert/strict'
import test from 'node:test'

import { decodeMemoryAttributes } from '../src/model/architecture.js'
import { cacheMaintenanceRange, simulateDmaRx, simulateDmaTx, simulateStore } from '../src/model/cache.js'
import { EXPERIMENTS } from '../src/data/experiments.js'
import { evaluateAccess, makeAxiSplitRegions, makeGuardRegions, regionContains, resolveRegion, splitSubregions, validateRegion } from '../src/model/mpu.js'
import { settingsForExperiment, simulateExperiment } from '../src/model/simulation.js'

test('all 38 lessons are present and generate simulation frames', () => {
  assert.equal(EXPERIMENTS.length, 38)
  assert.deepEqual(EXPERIMENTS.map((item) => item.number), Array.from({ length: 38 }, (_, index) => index + 1))
  for (const experiment of EXPERIMENTS) {
    const frames = simulateExperiment(experiment, settingsForExperiment(experiment))
    assert.ok(frames.length >= 3, experiment.title)
    assert.equal(['done', 'fault'].includes(frames.at(-1).status), true, experiment.title)
  }
})

test('Armv7-M TEX/C/B teaching decoder covers the key encodings', () => {
  assert.equal(decodeMemoryAttributes({ tex: 0, c: 0, b: 0 }).type, 'Strongly-ordered')
  assert.equal(decodeMemoryAttributes({ tex: 0, c: 0, b: 1 }).type, 'Device')
  assert.equal(decodeMemoryAttributes({ tex: 0, c: 1, b: 0 }).policy, 'Write-Through · No Write Allocate')
  assert.equal(decodeMemoryAttributes({ tex: 0, c: 1, b: 1 }).policy, 'Write-Back · No Write Allocate')
  assert.equal(decodeMemoryAttributes({ tex: 1, c: 0, b: 0 }).policy, 'Non-cacheable')
  assert.equal(decodeMemoryAttributes({ tex: 1, c: 1, b: 1 }).policy, 'Write-Back · Write Allocate')
  assert.equal(decodeMemoryAttributes({ tex: 1, c: 0, b: 1 }).status, 'reserved')
  assert.equal(decodeMemoryAttributes({ tex: 1, c: 1, b: 0 }).status, 'implementation')
})

test('shareable cacheable Normal memory exposes the Cortex-M7 SIWT distinction', () => {
  const defaultMode = decodeMemoryAttributes({ tex: 1, c: 1, b: 1, s: true, siwt: false })
  const siwtMode = decodeMemoryAttributes({ tex: 1, c: 1, b: 1, s: true, siwt: true })
  assert.match(defaultMode.effectivePolicy, /Non-cacheable/)
  assert.match(siwtMode.effectivePolicy, /Write-Through/)
})

test('512KB AXI split uses Region 1 below and Region 2 above the 256KB boundary', () => {
  const regions = makeAxiSplitRegions()
  assert.equal(resolveRegion(regions, 0x2403ffff).region.number, 1)
  assert.equal(resolveRegion(regions, 0x24040000).region.number, 2)
  assert.equal(resolveRegion(regions, 0x2407ffff).region.number, 2)
  assert.equal(splitSubregions(regions[1]).filter((part) => part.disabled).length, 4)
})

test('4GB guard mask 0x87 enables only external subregions 3 through 6', () => {
  const guard = makeGuardRegions()[0]
  assert.equal(regionContains(guard, 0x08000000), false)
  assert.equal(regionContains(guard, 0x24000000), false)
  assert.equal(regionContains(guard, 0x40000000), false)
  assert.equal(regionContains(guard, 0x60000000), true)
  assert.equal(regionContains(guard, 0xdfffffff), true)
  assert.equal(regionContains(guard, 0xe0000000), false)
})

test('higher-priority SDRAM whitelist overrides the 4GB guard', () => {
  const result = resolveRegion(makeGuardRegions({ whitelist: true }), 0xc0000000)
  assert.equal(result.region.number, 3)
  assert.equal(result.matches.length, 2)
})

test('PRIVDEFENA applies to privileged background access but not unprivileged access', () => {
  const privileged = evaluateAccess({ regions: [], address: 0x08000000, privileged: true, privdefena: true })
  const user = evaluateAccess({ regions: [], address: 0x08000000, privileged: false, privdefena: true })
  assert.equal(privileged.allowed, true)
  assert.equal(privileged.source, 'background')
  assert.equal(user.allowed, false)
  assert.equal(user.fault, 'MemManage')
})

test('DMA bypasses the Cortex-M7 MPU model', () => {
  const result = evaluateAccess({ regions: makeGuardRegions(), address: 0x60000000, actor: 'dma', kind: 'write' })
  assert.equal(result.allowed, true)
  assert.equal(result.source, 'soc-bus')
})

test('region validation reports misalignment and subregion minimum', () => {
  const validation = validateRegion({ base: 0x24001000, size: 524288 })
  assert.equal(validation.validSize, true)
  assert.equal(validation.aligned, false)
  assert.equal(splitSubregions({ base: 0x24000000, size: 128, srd: 0xff }).length, 0)
  assert.equal(splitSubregions({ base: 0x24000000, size: 256, srd: 0xff }).length, 8)
})

test('cache simulations distinguish WB dirty data, DMA clean, and RX invalidate', () => {
  const wb = simulateStore({ policy: 'wb-wa', hit: false })
  assert.match(wb.at(-1).cache, /dirty/)
  assert.equal(wb.at(-1).memory, '旧值')
  assert.match(simulateDmaTx({ policy: 'wb-wa', clean: false }).at(-1).dma, /旧值/)
  assert.match(simulateDmaTx({ policy: 'wb-wa', clean: true }).at(-1).dma, /新值/)
  assert.equal(simulateDmaRx({ invalidate: true }).at(-1).cache, 'DMA 新值')
  assert.equal(simulateDmaRx({ invalidate: false }).at(-1).status, 'fault')
})

test('cache maintenance range expands to complete 32-byte lines', () => {
  assert.deepEqual(cacheMaintenanceRange(0x24000004, 40), { start: 0x24000000, end: 0x24000040, length: 64, lines: 2 })
  assert.deepEqual(cacheMaintenanceRange(0x24000000, 64), { start: 0x24000000, end: 0x24000040, length: 64, lines: 2 })
})
