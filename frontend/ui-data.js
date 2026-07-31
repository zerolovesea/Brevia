/**
 * Static page data used by the demo views. Each collection uses display-ready fields;
 * nested objects describe related state (for example, a meeting's status or speaker).
 */
const uiData = {
  meetings: [],
  live: {
    transcript: [
      { time: '09:41', speaker: { id: '1', name: '说话人 1' }, text: '我们下周先完成试点，把客服和销售两个场景跑通。', translation: 'Next week, we will complete the pilot for customer support and sales.' },
      { time: '09:42', speaker: { id: '2', name: '说话人 2' }, text: '预算部分我会在周五前补一版，重点说明模型的本地部署成本。', translation: 'I will update the budget by Friday, focusing on local deployment costs.' },
      { time: '09:43', speaker: { id: '1', name: '说话人 1' }, text: '还有一个需要确认的是...', translation: 'One thing we still need to confirm is...', partial: true }
    ],
    participants: [],
    status: [{ label: '识别模型', value: 'Streaming Paraformer' }, { label: '计算设备', value: 'CPU' }]
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
    cards: [{ title: '纪要模型', description: '配置用于生成会议纪要的 API。所有配置信息仅保存在本地，不会上传。', action: '管理纪要模型', modal: 'summary-model' }, { title: '存储与隐私', description: '会议资料保存在此 Mac。外部 LLM 需要在发送逐字稿前明确确认。', action: '查看本地存储', modal: 'storage' }, { title: '进阶设置', description: '调整识别、端点检测、说话人分离和本地模型运行参数。', action: '配置进阶设置', modal: 'advanced-settings' }]
  }
};
