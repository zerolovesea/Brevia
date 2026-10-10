/**
 * 演示视图使用的静态页面数据。每个集合使用适合展示的字段；
 * 嵌套对象描述相关状态（例如会议的状态或说话人）。
 */
const uiData = {
  meetings: [],
  live: {
    transcript: [
      {
        time: '09:41',
        speaker: { id: '1', name: '说话人 1' },
        text: '我们下周先完成试点，把客服和销售两个场景跑通。',
        translation: 'Next week, we will complete the pilot for customer support and sales.',
      },
      {
        time: '09:42',
        speaker: { id: '2', name: '说话人 2' },
        text: '预算部分我会在周五前补一版，重点说明模型的本地部署成本。',
        translation: 'I will update the budget by Friday, focusing on local deployment costs.',
      },
    ],
  },
  detail: {
    transcript: [
      {
        time: '00:32',
        seconds: 32,
        speaker: { name: '王琳' },
        text: '我们下周先完成试点，把客服和销售两个场景跑通。',
        translation: 'Next week, we will complete the pilot for customer support and sales.',
      },
      {
        time: '02:14',
        seconds: 134,
        speaker: { name: '说话人 2' },
        text: '预算部分我会在周五前补一版，重点说明模型的本地部署成本。',
        translation: 'I will update the budget by Friday, focusing on local deployment costs.',
      },
      {
        time: '05:48',
        seconds: 348,
        speaker: { name: '王琳' },
        text: '试点数据确认后，再决定是否开放给更多团队使用。',
      },
    ],
    refinedTranscript: [],
    summary: {
      title: '先完成两个真实场景的本地试点，再评估推广范围。',
      sections: [
        { title: '决定', text: '客服与销售作为首批试点场景。' },
        {
          title: '待办',
          items: [
            { text: '周五前补充本地部署预算', speaker: '说话人 2' },
            { text: '确认试点数据指标', speaker: '王琳' },
          ],
        },
      ],
    },
  },
  settings: {
    cards: [
      {
        title: 'AI 功能',
        description: '配置 AI 模型会议纪要，以及智能笔记。',
        action: '配置 AI 功能',
        modal: 'ai-features',
      },
      {
        title: '进阶设置',
        description: '为特定会议环境微调识别、端点检测、说话人分离和本地模型。',
        action: '配置进阶设置',
        modal: 'advanced-settings',
      },
      {
        title: '存储与隐私',
        description: '查看和管理保存在此设备上的会议录音、会议纪要与模型。',
        action: '查看本地存储',
        modal: 'storage',
      },
    ],
  },
};
