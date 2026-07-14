export const STAGES = [
  { id: 'cache', title: 'Cache 基础', short: 'CACHE', range: '01–10', color: 'blue' },
  { id: 'mpu', title: 'MPU 配置', short: 'MPU', range: '11–22', color: 'violet' },
  { id: 'dma', title: 'DMA 与屏障', short: 'DMA', range: '23–32', color: 'amber' },
  { id: 'gd32', title: 'GD32H75E 综合', short: 'H75E', range: '33–38', color: 'green' },
]

const lesson = (number, stage, id, title, summary, scenario, options = {}) => ({
  number,
  stage,
  id,
  title,
  summary,
  scenario,
  tags: options.tags ?? [],
  misconception: options.misconception ?? '先看系统中的实际数据位置，再判断 CPU 或 DMA 能观察到哪一份。',
  question: options.question ?? '判断结果时，最先应该确认什么？',
  choices: options.choices ?? ['源码写了几行', '地址最终匹配的内存属性与观察者', '变量名称'],
  answer: options.answer ?? 1,
  defaults: options.defaults ?? {},
})

export const EXPERIMENTS = [
  lesson(1, 'cache', 'cache-line', 'Cache Line 与局部性', '一次 Miss 为什么可能让后续多个地址都变成 Hit。', 'cache-read', { tags: ['32B Line', 'Hit/Miss'], question: '读取 0x24000000 后，再读 0x24000001 通常会怎样？', choices: ['再次 Linefill', '命中同一条 Cache Line', '产生 Fault'], answer: 1 }),
  lesson(2, 'cache', 'access-patterns', '连续、随机与跨行访问', '拖动地址序列，比较连续访问和跨 32 字节边界的差异。', 'cache-read-cross', { tags: ['空间局部性'], question: '哪组地址更可能只触发一次 Linefill？', choices: ['0x00、0x01、0x1F', '0x00、0x20、0x40', '随机地址'], answer: 0 }),
  lesson(3, 'cache', 'wb-wa', 'WB + Write Allocate', '写未命中先分配 Cache Line，修改后形成 Dirty Line。', 'store', { tags: ['WB', 'Write Allocate'], defaults: { policy: 'wb-wa', cacheHit: false }, misconception: 'Write Allocate 只回答写 Miss 是否分配；Write-Back 回答数据何时写回。', question: 'WBWA 写 Miss 后，最新数据最先在哪里？', choices: ['只在 DMA', 'D-Cache Dirty Line', '外设寄存器'], answer: 1 }),
  lesson(4, 'cache', 'wb-nwa', 'WB + No Write Allocate', '写 Miss 旁路 Cache；写 Hit 仍可能产生 Dirty Line。', 'store', { tags: ['WB', 'No WA'], defaults: { policy: 'wb-nwa', cacheHit: false }, misconception: 'No Write Allocate 不等于 Non-cacheable；读操作仍可能把 Line 装入 Cache。', question: 'WB/NWA 写 Hit 会怎样？', choices: ['产生 Dirty Line', '永远绕过 Cache', '自动 Invalidate'], answer: 0 }),
  lesson(5, 'cache', 'wt-nwa', 'WT + No Write Allocate', '写命中更新 Cache 和内存路径，写 Miss 不分配。', 'store', { tags: ['WT', 'No WA'], defaults: { policy: 'wt-nwa', cacheHit: true }, question: 'WT 写指令返回时，事务是否一定已经到达存储阵列？', choices: ['一定', '不一定，仍可能经过 Store Buffer', '只与 I-Cache 有关'], answer: 1 }),
  lesson(6, 'cache', 'normal-nc', 'Normal Non-cacheable', '不进入 D-Cache，但仍然保持 Normal Memory 语义。', 'store', { tags: ['Non-cacheable'], defaults: { policy: 'nc' }, misconception: 'Non-cacheable 解决“没有 Cache 副本”，不等于没有 Store Buffer。', question: 'Normal Non-cacheable 是否可能经过 Store Buffer？', choices: ['可能', '绝不可能', '只有 DMA 会'], answer: 0 }),
  lesson(7, 'cache', 'write-hit-miss', 'Write Hit 与 Write Miss', '切换同一地址是否已经在 Cache，观察策略分支。', 'store', { tags: ['Hit/Miss'], defaults: { policy: 'wb-nwa', cacheHit: true }, question: 'No Write Allocate 主要影响哪种情况？', choices: ['Write Hit', 'Write Miss', '指令取指'], answer: 1 }),
  lesson(8, 'cache', 'cache-vs-buffer', 'D-Cache 与 Store Buffer', '一个长期保存副本，一个临时排队写事务。', 'store-buffer', { tags: ['Store Buffer'], question: '关闭 D-Cache 后，哪项仍需考虑？', choices: ['Store Buffer', 'Dirty Cache Line', 'I-Cache 自动关闭'], answer: 0 }),
  lesson(9, 'cache', 'write-combine', '相邻写与事务合并', '两个字节 Store 可能合并成一笔带字节选通的总线写。', 'write-combine', { tags: ['Merge'], question: '总线必须观察到两个独立字节写吗？', choices: ['必须', '不必，可能被合并', '只在 Device Memory 合并'], answer: 1 }),
  lesson(10, 'cache', 'global-cache-switch', '全局开关 × 区域属性', '只有全局 D-Cache 开启且区域有效可缓存时，数据才能进入 L1 D-Cache。', 'cache-switch', { tags: ['CCR.DC', 'MPU'], defaults: { dcacheEnabled: false, policy: 'wb-wa' }, question: 'MPU 标为 Cacheable，但 CCR.DC=0，会产生 Dirty Line吗？', choices: ['会', '不会', '由 DMA 决定'], answer: 1 }),

  lesson(11, 'mpu', 'texcb-decoder', 'TEX/C/B 完整解码', '逐位切换属性，查看有效、保留和实现相关编码。', 'decoder', { tags: ['TEX/C/B'], question: 'B 位能否独立理解为“写缓冲开关”？', choices: ['能', '不能，它参与内存类型组合编码', '只在 Flash 中能'], answer: 1 }),
  lesson(12, 'mpu', 'memory-types', 'Normal、Device、Strongly-ordered', '比较缓存、推测访问和寄存器副作用。', 'memory-type', { tags: ['Memory Type'], question: '普通外设寄存器通常应配置成什么？', choices: ['Normal WBWA', 'Device + XN', '可执行 SRAM'], answer: 1 }),
  lesson(13, 'mpu', 'region-alignment', 'Region 大小与基地址对齐', '输入未对齐地址，查看 Region 实际能够表达的边界。', 'alignment', { tags: ['Power of 2'], defaults: { address: '0x24001000', regionSize: 524288 }, question: '512KB Region 的基地址要求是什么？', choices: ['任意地址', '按 512KB 对齐', '只需按 32B 对齐'], answer: 1 }),
  lesson(14, 'mpu', 'region-size', '32B 到 4GB 与 Subregion 门槛', 'Region 是 2 次幂大小；达到 256B 后才可拆八个 Subregion。', 'region-size', { tags: ['Size', 'SRD'], defaults: { regionSize: 256 }, question: '128B Region 可以使用 SRD 八分区吗？', choices: ['可以', '不可以', '只对 DMA 可以'], answer: 1 }),
  lesson(15, 'mpu', 'srd-masks', 'SRD 掩码游乐场', '试用 0x00、0x0F、0xF0、0x55 和 0x87。', 'subregion', { tags: ['SRD'], defaults: { srd: 0x0f, address: '0x24040000', regionSize: 524288 }, question: 'SRD 某位为 1 表示什么？', choices: ['子区域启用', '子区域禁用', 'Region 只读'], answer: 1 }),
  lesson(16, 'mpu', 'disabled-vs-denied', 'Subregion 禁用 ≠ No Access', '禁用代表该 Region 不参与匹配；No Access 代表命中后拒绝。', 'subregion-denied', { tags: ['Matching'], defaults: { srd: 1, address: '0x24000000' }, question: '子区域被禁用后会发生什么？', choices: ['立即 Fault', '继续寻找其他 Region 或背景映射', 'DMA 被禁止'], answer: 1 }),
  lesson(17, 'mpu', 'region-priority', '重叠 Region 与固定优先级', '高编号 Region 覆盖低编号 Region，与配置调用顺序无关。', 'overlap', { tags: ['Priority'], defaults: { address: '0x24040000' }, question: 'Region 1 和 Region 2 同时命中，谁生效？', choices: ['先配置者', 'Region 2', '面积更大者'], answer: 1 }),
  lesson(18, 'mpu', 'access-permission', 'AP 权限矩阵', '切换特权级、读写类型和 AP，观察授权或 MemManage。', 'permission', { tags: ['AP'], defaults: { ap: 'priv-rw-user-ro', privileged: false, accessKind: 'write' }, question: '非特权写入“特权读写、用户只读”区域会怎样？', choices: ['允许', 'MemManage', '只清空 Cache'], answer: 1 }),
  lesson(19, 'mpu', 'execute-never', 'XN 执行保护', '数据可读写不代表允许从该地址取指。', 'xn', { tags: ['XN'], defaults: { xn: true, accessKind: 'execute' }, question: '从 XN 区域取指会怎样？', choices: ['正常执行', '产生指令访问违规', '只影响 DMA'], answer: 1 }),
  lesson(20, 'mpu', 'privdefena', 'PRIVDEFENA 背景区域', '没有显式 Region 命中时，比较特权与非特权访问。', 'background', { tags: ['Background'], defaults: { address: '0x08000000', privileged: true, privdefena: true }, question: 'PRIVDEFENA=1 是否允许非特权访问背景区域？', choices: ['允许', '不允许', '只允许写'], answer: 1 }),
  lesson(21, 'mpu', 'shareable-siwt', 'Shareable 与 CACR.SIWT', '观察 Cortex-M7 对共享可缓存 Normal Memory 的实际处理。', 'shareable', { tags: ['Shareable', 'SIWT'], defaults: { tex: 1, c: 1, b: 1, shareable: true, siwt: false }, question: 'Shareable 是否等于 DMA 访问许可？', choices: ['是', '不是', '只在双核上是'], answer: 1 }),
  lesson(22, 'mpu', 'dma-bypass-mpu', 'DMA 绕过 CPU MPU', '同一地址：CPU 可能 Fault，DMA 则由总线连接决定。', 'dma-mpu', { tags: ['Bus Master'], defaults: { actor: 'dma', ap: 'no-access' }, question: 'Cortex-M7 MPU 会直接检查 DMA 访问吗？', choices: ['会', '不会', '只检查写'], answer: 1 }),

  lesson(23, 'dma', 'dma-tx-clean', 'CPU → DMA：Clean', 'WB Cache 中的新数据必须写回，DMA 才能看到。', 'dma-tx', { tags: ['TX', 'Clean'], defaults: { policy: 'wb-wa', clean: false }, question: 'WB Buffer 交给 DMA 前只执行 DMB够吗？', choices: ['够', '不够，还要 Clean Dirty Line', '必须 Invalidate'], answer: 1 }),
  lesson(24, 'dma', 'dma-rx-invalidate', 'DMA → CPU：Invalidate', 'DMA 更新内存后，CPU 要丢弃旧 Cache 副本。', 'dma-rx', { tags: ['RX', 'Invalidate'], defaults: { invalidate: true }, question: 'DMA RX 完成后通常执行什么？', choices: ['Invalidate', 'Clean旧值', '关闭 I-Cache'], answer: 0 }),
  lesson(25, 'dma', 'wrong-invalidate', '错误 Invalidate 丢失 Dirty 数据', 'CPU 生产的数据不能通过直接 Invalidate 交给 DMA。', 'wrong-invalidate', { tags: ['错误实验'], question: 'CPU Dirty Line 直接 Invalidate 的风险是？', choices: ['DMA变快', 'CPU新数据被丢弃', '自动写回'], answer: 1 }),
  lesson(26, 'dma', 'wrong-clean', '错误 Clean 覆盖 DMA 新数据', 'DMA RX 后清理旧 Dirty Line，可能把新数据盖掉。', 'dma-rx', { tags: ['错误实验'], defaults: { wrongClean: true, invalidate: false }, question: 'DMA写完后为何不应盲目Clean旧Dirty Line？', choices: ['会覆盖DMA新值', '会启动DMA', '会改变XN'], answer: 0 }),
  lesson(27, 'dma', 'rx-handoff', 'RX 前后的所有权交接', '对齐、整行覆盖和旧内容是否保留决定开始前的操作。', 'rx-handoff', { tags: ['Ownership'], question: 'DMA完成后、CPU读取前的核心操作是？', choices: ['Invalidate', '只Clean', 'Write Allocate'], answer: 0 }),
  lesson(28, 'dma', 'line-sharing', 'Cache Line 共享污染', '未对齐 Buffer 的维护范围可能包含相邻变量。', 'line-sharing', { tags: ['Alignment'], defaults: { address: '0x24000004', length: 40 }, question: '为何建议 DMA Buffer 地址和大小按32字节规划？', choices: ['避免维护相邻数据', '让DMA获得MPU权限', '让SRAM可执行'], answer: 0 }),
  lesson(29, 'dma', 'publish-valid', 'data + valid 发布', '当前CPU能看到自己的写；DMA是独立观察者。', 'barrier', { tags: ['Publish'], defaults: { barrier: 'none' }, question: '同一CPU执行流读取自己刚写的数据通常需要DMB吗？', choices: ['需要', '不需要', '必须DSB'], answer: 1 }),
  lesson(30, 'dma', 'dmb-dsb', '无屏障、DMB 与 DSB', '区分内存访问排序和后续指令等待。', 'barrier', { tags: ['DMB', 'DSB'], defaults: { barrier: 'dmb' }, question: '写寄存器后立即WFI，更符合哪种屏障目的？', choices: ['DMB', 'DSB', 'Invalidate'], answer: 1 }),
  lesson(31, 'dma', 'completion-levels', '排序、事务完成与内部完成', '即使 DSB 返回，Flash 擦除等外设内部动作仍需状态位确认。', 'completion', { tags: ['BUSY/DONE'], question: 'DSB 能否表示外设内部任务已经完成？', choices: ['总能', '不能，仍看状态位/中断', '只对UART能'], answer: 1 }),
  lesson(32, 'dma', 'nc-store-buffer', 'WT/NC 仍可能缓冲', '没有 Dirty Line 不代表写事务已经离开处理器写缓冲。', 'store-buffer', { tags: ['Ordering'], defaults: { policy: 'nc' }, question: 'Non-cacheable 主要排除了什么？', choices: ['D-Cache副本', '所有总线队列', 'DMA访问'], answer: 0 }),

  lesson(33, 'gd32', 'axi-sram-split', '512KB AXI SRAM 双策略', 'Region 1 全部 WBWA；Region 2 用 SRD=0x0F 覆盖后 256KB为WT/NWA。', 'axi-split', { tags: ['0x24000000', 'Overlap'], defaults: { address: '0x24040000', srd: 0x0f }, question: '地址0x24040000最终使用哪个Region？', choices: ['Region 1', 'Region 2', '背景区域'], answer: 1 }),
  lesson(34, 'gd32', 'guard-4gb', '4GB 兜底禁区', '用No Access、XN和SRD=0x87阻止未准备好的外部地址窗口。', 'guard', { tags: ['0x87', 'Speculation'], defaults: { address: '0x60000000', srd: 0x87, ap: 'no-access', xn: true, privileged: true }, question: '真实SDRAM位于兜底禁区时应怎么办？', choices: ['删除所有MPU配置', '添加更高优先级白名单Region', '让DMA修改MPU'], answer: 1 }),
  lesson(35, 'gd32', 'sdram-code', '在 SDRAM 中执行代码', '代码区需要Normal、Cacheable、Non-shareable并允许执行。', 'sdram-code', { tags: ['I-Cache', 'XN'], defaults: { address: '0xc0000000', tex: 1, c: 1, b: 1, shareable: false, xn: false }, question: '复制新代码后跳转前要考虑什么？', choices: ['只改变量名', 'D-Cache Clean、I-Cache Invalidate与同步', '把SDRAM设Device'], answer: 1 }),
  lesson(36, 'gd32', 'external-init', '外部存储器初始化顺序', '控制器未就绪时先阻止访问，初始化后再开放Region。', 'external-init', { tags: ['EXMC', 'OSPI'], defaults: { address: '0x90000000', ap: 'no-access', xn: true }, question: '为何启动早期先保护外部地址窗口？', choices: ['防止推测访问未就绪设备', '增加Flash容量', '让GPIO可缓存'], answer: 0 }),
  lesson(37, 'gd32', 'memory-map', 'GD32H75E 推荐配置地图', '点击Flash、AXI SRAM、外设、EXMC、OSPI和SDRAM查看用途建议。', 'memory-map', { tags: ['Address Map'], defaults: { address: '0x24000000' }, question: '同一SDRAM是否应全部设为可执行？', choices: ['应该', '不应，代码/数据/DMA区分开', '只由DMA决定'], answer: 1 }),
  lesson(38, 'gd32', 'fault-diagnosis', 'Fault 诊断训练', '通过写只读区、XN取指和No Access访问理解Fault寄存器。', 'fault', { tags: ['CFSR', 'MMFAR'], defaults: { address: '0x60000000', ap: 'no-access', accessKind: 'write' }, question: 'MemManage未启用时，相关错误通常怎样处理？', choices: ['被忽略', '升级为HardFault', '自动重试'], answer: 1 }),
]

export const EXPERIMENT_BY_ID = Object.fromEntries(EXPERIMENTS.map((experiment) => [experiment.id, experiment]))

export function experimentsForStage(stageId) {
  return EXPERIMENTS.filter((experiment) => experiment.stage === stageId)
}
