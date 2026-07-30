/**
 * Static page data used by the demo views. Each collection uses display-ready fields;
 * nested objects describe related state (for example, a meeting's status or speaker).
 */
const uiData = {
  meetings: [
    { tone: 'violet', title: '产品策略周会', meta: '今天 09:30 · 42 分钟 · 产品', category: '产品', tags: ['需求评审', 'Q3'], status: { tone: 'complete', label: '已整理', detail: '3 项待办' } },
    { tone: 'mint', title: '向量数据库供应商沟通', meta: '昨天 15:10 · 31 分钟 · 外部会议', category: '外部会议', tags: ['供应商'], status: { tone: 'processing', label: '正在精修', detail: '双轨录音' } },
    { tone: 'coral', title: '设计系统对齐', meta: '7 月 26 日 · 56 分钟 · 设计', category: '设计', tags: ['设计', '组件库'], status: { tone: 'complete', label: '已整理', detail: '无待办' } }
  ],
  live: {
    transcript: [
      { time: '09:41', speaker: { id: '1', name: '说话人 1' }, text: '我们下周先完成试点，把客服和销售两个场景跑通。', translation: 'Next week, we will complete the pilot for customer support and sales.' },
      { time: '09:42', speaker: { id: '2', name: '说话人 2' }, text: '预算部分我会在周五前补一版，重点说明模型的本地部署成本。', translation: 'I will update the budget by Friday, focusing on local deployment costs.' },
      { time: '09:43', speaker: { id: '1', name: '说话人 1' }, text: '还有一个需要确认的是...', translation: 'One thing we still need to confirm is...', partial: true }
    ],
    participants: [{ id: '1', name: '说话人 1', source: '麦克风', avatar: 'blue', level: '' }, { id: '2', name: '说话人 2', source: '系统音频', avatar: 'gray', level: 'quiet' }],
    status: [{ label: '识别模型', value: 'SenseVoice' }, { label: '计算设备', value: 'MPS' }, { label: '已应用术语', value: '12' }]
  },
  detail: {
    transcript: [
      { time: '00:32', seconds: 32, speaker: { name: '王琳' }, text: '我们下周先完成试点，把客服和销售两个场景跑通。', translation: 'Next week, we will complete the pilot for customer support and sales.' },
      { time: '02:14', seconds: 134, speaker: { name: '说话人 2' }, text: '预算部分我会在周五前补一版，重点说明模型的本地部署成本。', translation: 'I will update the budget by Friday, focusing on local deployment costs.' },
      { time: '05:48', seconds: 348, speaker: { name: '王琳' }, text: '试点数据确认后，再决定是否开放给更多团队使用。' }
    ],
    summary: { title: '先完成两个真实场景的本地试点，再评估推广范围。', sections: [{ title: '决定', text: '客服与销售作为首批试点场景。' }, { title: '待办', items: [{ text: '周五前补充本地部署预算', speaker: '说话人 2' }, { text: '确认试点数据指标', speaker: '王琳' }] }] }
  },
  settings: {
    models: [
      { icon: '⌁', name: 'Streaming Paraformer', detail: '实时字幕 · 中文 / 英语 / 粤语', intro: '原生流式识别，持续更新当前字幕。' },
      { icon: 'Q', name: 'Qwen3-ASR', detail: '会后精修 · 多语种', intro: '基于完整录音生成高精度修订版本。' }
    ],
    cards: [{ title: '术语库', description: '12 个词条可用于会议准备、搜索和纪要。仅支持的模型会将其用于转写。', terms: ['Brevia', '向量数据库', 'CAM++', '+ 9'], action: '管理术语库', modal: 'terms' }, { title: '纪要模型', description: '配置用于生成会议纪要的 API。所有配置信息仅保存在本地，不会上传。', action: '管理纪要模型', modal: 'summary-model' }, { title: '存储与隐私', description: '会议资料保存在此 Mac。外部 LLM 需要在发送逐字稿前明确确认。', action: '查看本地存储', modal: 'storage' }]
  }
};
