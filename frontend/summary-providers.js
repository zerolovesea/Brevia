// 固定服务商共用兼容 API；自定义服务的地址与凭据由用户单独配置。
function onlineProvider(label, endpoint, model, format = 'openai') {
  return { label, endpoint, model, format, needsKey: true, needsEndpoint: false };
}
const summaryProviderPresets = {
  'built-in': { format: 'openai', endpoint: '', needsKey: false, needsEndpoint: false, model: '' },
  claude: onlineProvider('Claude', 'https://api.anthropic.com', 'claude-sonnet-4-6', 'claude'),
  openai: onlineProvider('OpenAI', 'https://api.openai.com/v1/chat/completions', 'gpt-5-mini'),
  gemini: onlineProvider(
    'Google Gemini',
    'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    'gemini-3.5-flash',
  ),
  deepseek: onlineProvider(
    'DeepSeek',
    'https://api.deepseek.com/chat/completions',
    'deepseek-flash',
  ),
  qwen: onlineProvider(
    'Qwen · CN',
    'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    'qwen-plus',
  ),
  kimi: onlineProvider('Kimi · CN', 'https://api.moonshot.cn/v1/chat/completions', 'kimi-k3.1-pro'),
  glm: onlineProvider(
    'Zhipu GLM · CN',
    'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    'glm-4.7-flash',
  ),
  mistral: onlineProvider(
    'Mistral AI',
    'https://api.mistral.ai/v1/chat/completions',
    'mistral-small-latest',
  ),
  groq: onlineProvider(
    'Groq',
    'https://api.groq.com/openai/v1/chat/completions',
    'openai/gpt-oss-20b',
  ),
  openrouter: onlineProvider(
    'OpenRouter',
    'https://openrouter.ai/api/v1/chat/completions',
    'openai/gpt-5-mini',
  ),
  'opencode-go': onlineProvider(
    'OpenCode Go',
    'https://opencode.ai/inference/go/openai/v1/chat/completions',
    'glm-5.3-flash',
  ),
  'custom-openai': {
    format: 'openai',
    endpoint: '',
    needsKey: true,
    needsEndpoint: true,
    model: '',
  },
  'custom-claude': {
    format: 'claude',
    endpoint: '',
    needsKey: true,
    needsEndpoint: true,
    model: '',
  },
};
function configuredSummaryProvider(config, fallbackModel = '') {
  const provider = config.provider;
  const preset = summaryProviderPresets[provider];
  if (!preset) return null;
  const entry = config.providers?.[provider] || {};
  // 内置模型：未显式选择时自动回退到第一个已安装的 llama-chat 模型，
  // 避免“首次点击就要求配置”的摩擦（本地模型与 API Key 无关）。
  const model = entry.model || (provider === 'built-in' ? fallbackModel : '');
  if (!model) return null;
  const endpoint = preset.needsEndpoint ? entry.endpoint : preset.endpoint;
  if (preset.needsEndpoint && !endpoint) return null;
  if (preset.needsKey && !entry.keyReference) return null;
  return { provider, endpoint, model, format: preset.format, keyReference: entry.keyReference };
}

if (typeof module !== 'undefined') module.exports = { configuredSummaryProvider };
