import { expect, test } from '@playwright/test'

test('预测、完整播放、揭示、掌握和进度恢复形成闭环', async ({ page }) => {
  await page.goto('/?mode=course&lesson=cache-line')
  await page.evaluate(() => localStorage.clear())
  await page.reload()

  const play = page.getByRole('button', { name: '播放动画' })
  await expect(play).toBeDisabled()
  await page.getByRole('button', { name: 'B 命中同一条 Cache Line' }).click()
  await page.getByLabel('播放速度').selectOption('2')
  await play.click()

  await expect(page.getByText('判断正确：你已经把动画中的状态变化和结论对应起来了。')).toBeVisible()
  await expect(page.getByRole('button', { name: '进入下一课' })).toBeEnabled()
  await expect(page.getByText('当前学习进度：1/38')).toBeVisible()
  await page.getByRole('button', { name: '进入下一课' }).click()
  await expect(page).toHaveURL(/mode=course&lesson=access-patterns/)

  await page.reload()
  await expect(page.getByText('当前学习进度：1/38')).toBeVisible()
  await expect(page.getByLabel('播放速度')).toHaveValue('2')
})

test('自由实验室开放完整配置，修改参数后动画回到起点', async ({ page }) => {
  await page.goto('/?mode=lab&lesson=access-patterns')
  const timeline = page.getByLabel('动画时间轴')
  await page.getByRole('button', { name: '下一个事件' }).click()
  await expect.poll(async () => Number(await timeline.inputValue())).toBeGreaterThan(0)

  await page.getByLabel('Cache策略').selectOption({ label: 'WT + No Write Allocate' })
  await expect(timeline).toHaveValue('0')
  await page.getByRole('button', { name: '返回引导课程' }).click()
  await expect(page).toHaveURL(/mode=course&lesson=access-patterns/)
})

test('六类共享场景都有独立、可访问的动画视图', async ({ page }) => {
  const scenes = [
    ['cache-line', 'Cache Line 数据流动画'],
    ['cache-vs-buffer', 'CPU、MPU、Cache、总线和DMA数据流动画'],
    ['axi-sram-split', 'MPU Region、Subregion和权限匹配动画'],
    ['dma-tx-clean', 'CPU Cache、物理内存和DMA一致性动画'],
    ['dmb-dsb', '无屏障、DMB和DSB访问顺序时间线'],
    ['fault-diagnosis', 'MemManage和HardFault诊断动画'],
  ]

  for (const [lesson, label] of scenes) {
    await page.goto(`/?mode=course&lesson=${lesson}`)
    await expect(page.getByRole('img', { name: label })).toBeVisible()
    await expect(page.getByText('连续因果演示')).toBeVisible()
  }
})

test('键盘、速度、减少动态效果和三档布局均可用', async ({ page }) => {
  await page.goto('/?mode=course&lesson=cache-vs-buffer')
  await page.getByRole('button', { name: '暂不确定，直接观察' }).click()
  const player = page.getByRole('region', { name: '可交互动画播放器' })
  const timeline = page.getByLabel('动画时间轴')
  await player.focus()
  await page.keyboard.press('Space')
  await expect.poll(async () => Number(await timeline.inputValue())).toBeGreaterThan(0)
  await page.keyboard.press('Space')
  await page.keyboard.press('ArrowRight')
  const afterRight = Number(await timeline.inputValue())
  expect(afterRight).toBeGreaterThan(0)
  await page.keyboard.press('ArrowLeft')
  expect(Number(await timeline.inputValue())).toBeLessThan(afterRight)

  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.reload()
  await expect(page.getByText('已启用减少动态效果')).toBeVisible()

  for (const viewport of [{ width: 1440, height: 900 }, { width: 768, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport)
    await page.goto('/?mode=course&lesson=axi-sram-split')
    const dimensions = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }))
    expect(dimensions.scroll).toBe(dimensions.client)
  }

  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/?mode=lab&lesson=axi-sram-split')
  const mobileLab = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }))
  expect(mobileLab.scroll).toBe(mobileLab.client)
})
