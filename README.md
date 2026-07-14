# Cache & MPU 交互实验室

面向第一次接触 Cache、MPU 和 DMA 一致性的嵌入式开发者，通过 38 个可操作实验理解：

- 通用 Cache：Cache Line、Hit/Miss、局部性、WT/WB、Write Allocate、Store Buffer。
- Cortex-M7 / Armv7-M：TEX/C/B/S、AP、XN、Region、Subregion、优先级和背景映射。
- DMA 一致性：Clean、Invalidate、Cache Line 对齐、DMB/DSB与所有权交接。
- GD32H75E：AXI SRAM双策略、4GB兜底禁区、外部存储器初始化和SDRAM执行代码。

所有模拟都在浏览器本地运行，不上传任何数据。课程中的代码为教学伪代码，不是可直接复制到产品中的芯片初始化代码。

## v0.2 教学方式

- **引导课程**：按“预测 → 连续动画 → 状态解释 → 修正答案”学习，答对并完整观察后记录掌握进度。
- **自由实验室**：开放地址、Cache策略、TEX/C/B/S、AP、XN、SRD、Region和屏障等完整参数。
- **六类动画**：Cache Line、硬件流水线、MPU Region、DMA一致性、屏障时间线和Fault诊断，共用确定性的语义事件模型。
- **可控时间轴**：支持播放、暂停、拖动、逐事件、0.5×/1×/2×以及键盘操作；减少动态效果模式保留离散状态与字幕。
- **响应式硬件路径**：桌面使用横向总线视图，手机自动切换为纵向路径，不依赖页面横向滚动。

可通过 `?mode=course&lesson=cache-line` 分享具体课程；学习进度、最后课程和播放速度仅保存在当前浏览器。

## 本地运行

```powershell
npm ci
npm run dev
```

## 验证

```powershell
npm test
npm run lint
npm run build
npm run test:e2e
```

模拟内核位于 `src/model/`，React界面只消费模型生成的 `SimulationTrace`。Node单元测试覆盖38课的模型完整性和最终状态，Playwright回归测试覆盖教学流程、六类动画、键盘操作、进度恢复和390/768/1440px布局。

## 资料依据

- [GigaDevice H7 Cache及MPU使用指南](https://gigadevice.feishu.cn/wiki/Tw2kwOc38i32dFkNtYecKQvHnne)
- [Arm Cortex-M7 Technical Reference Manual](https://developer.arm.com/documentation/ddi0489/latest/)
- [CMSIS Armv7-M MPU Defines](https://arm-software.github.io/CMSIS_6/latest/Core/group__mpu__defines.html)
- [CMSIS Cortex-M7 D-Cache Functions](https://arm-software.github.io/CMSIS_6/latest/Core/group__Dcache__functions__m7.html)
- [ST AN4838 - Managing MPU](https://www.st.com/resource/en/application_note/an4838-managing-memory-protection-unit-in-stm32-mcus-stmicroelectronics.pdf)
- [ST AN4839 - Level 1 cache](https://www.st.com/resource/en/application_note/an4839-level-1-cache-on-stm32f7-series-and-stm32h7-series-stmicroelectronics.pdf)
- [GD32H75E Datasheet](https://www.gd32mcu.com/download/down/document_id/652/path_type/1)

具体芯片应用还必须结合相应版本的数据手册、参考手册和勘误表。
