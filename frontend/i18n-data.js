/* 唯一的界面词条数据源；按语言直接定义，禁止追加覆盖表。 */
(() => {
const onboardingStorageCopy = {
  "zh": {
    "moving": "正在移动文件…",
    "movingHint": "正在迁移已有模型或会议录音。文件较大时可能需要几分钟，请保持应用开启，暂勿断开存储设备。完成后会自动恢复操作。",
    "moved": "文件夹已更改，文件迁移完成。",
    "title": "数据存放位置",
    "models": "模型文件夹",
    "recordings": "会议与录音文件夹",
    "choose": "更改路径"
  },
  "en": {
    "moving": "Moving files…",
    "movingHint": "Existing models or meeting recordings are being moved. Large files may take several minutes. Keep the app open and the drive connected; controls will become available when finished.",
    "moved": "Folder changed. File migration is complete.",
    "title": "Data storage locations",
    "models": "Model folder",
    "recordings": "Recordings and meetings folder",
    "choose": "Choose folder"
  },
  "es": {
    "moving": "Moviendo archivos…",
    "movingHint": "Se están moviendo los modelos o las grabaciones existentes. Los archivos grandes pueden tardar varios minutos. Mantén la aplicación abierta y la unidad conectada; los controles se reactivarán al terminar.",
    "moved": "Carpeta cambiada. La migración ha finalizado.",
    "title": "Ubicaciones de almacenamiento",
    "models": "Carpeta de modelos",
    "recordings": "Carpeta de grabaciones y reuniones",
    "choose": "Elegir carpeta"
  },
  "ja": {
    "moving": "ファイルを移動中…",
    "movingHint": "既存のモデルまたは会議録音を移動しています。大きなファイルは数分かかる場合があります。アプリを開いたまま、ドライブを接続してお待ちください。完了後に操作を再開できます。",
    "moved": "保存先を変更し、ファイルの移動が完了しました。",
    "title": "データの保存先",
    "models": "モデルフォルダー",
    "recordings": "録音・会議フォルダー",
    "choose": "フォルダーを選択"
  },
  "ko": {
    "moving": "파일 이동 중…",
    "movingHint": "기존 모델 또는 회의 녹음을 이동하고 있습니다. 큰 파일은 몇 분 걸릴 수 있습니다. 앱을 열어 두고 드라이브 연결을 유지해 주세요. 완료되면 다시 조작할 수 있습니다.",
    "moved": "폴더를 변경하고 파일 이동을 완료했습니다.",
    "title": "데이터 저장 위치",
    "models": "모델 폴더",
    "recordings": "녹음 및 회의 폴더",
    "choose": "폴더 선택"
  },
  "fr": {
    "moving": "Déplacement des fichiers…",
    "movingHint": "Les modèles ou enregistrements existants sont en cours de déplacement. Les fichiers volumineux peuvent prendre plusieurs minutes. Gardez l’application ouverte et le disque connecté. Les commandes seront réactivées à la fin.",
    "moved": "Dossier modifié. Le déplacement est terminé.",
    "title": "Emplacements des données",
    "models": "Dossier des modèles",
    "recordings": "Dossier des enregistrements et réunions",
    "choose": "Choisir un dossier"
  },
  "de": {
    "moving": "Dateien werden verschoben…",
    "movingHint": "Vorhandene Modelle oder Aufnahmen werden verschoben. Große Dateien können mehrere Minuten benötigen. Lassen Sie die App geöffnet und das Laufwerk angeschlossen. Danach sind die Bedienelemente wieder verfügbar.",
    "moved": "Ordner geändert. Die Dateien wurden verschoben.",
    "title": "Speicherorte für Daten",
    "models": "Modellordner",
    "recordings": "Aufnahme- und Besprechungsordner",
    "choose": "Ordner wählen"
  },
  "ru": {
    "moving": "Перемещение файлов…",
    "movingHint": "Перемещаются существующие модели или записи встреч. Большие файлы могут занять несколько минут. Не закрывайте приложение и не отключайте диск. После завершения управление станет доступно.",
    "moved": "Папка изменена. Перемещение файлов завершено.",
    "title": "Места хранения данных",
    "models": "Папка моделей",
    "recordings": "Папка записей и встреч",
    "choose": "Выбрать папку"
  }
};

const catalog = {
  "zh": {
    "views": {
      "home": "所有会议",
      "prepare": "准备录制",
      "live": "正在录制",
      "detail": "会议详情",
      "settings": "设置"
    },
    "labels": {
      "所有会议": "所有会议",
      "最近删除": "最近删除",
      "设置": "设置",
      "开始会议": "开始会议",
      "会议库": "会议库",
      "准备录制": "准备录制",
      "实时字幕": "实时字幕",
      "会议详情": "会议详情",
      "每一场对话，都留有依据。": "每一场对话，都留有依据。",
      "返回会议库": "返回会议库",
      "开始一场会议": "开始一场会议",
      "会议名称": "会议名称",
      "会议语言": "会议语言",
      "译文目标": "译文目标",
      "系统音频": "系统音频",
      "输入良好": "输入良好",
      "当前模型": "当前模型",
      "管理模型与术语": "管理模型与术语",
      "正在录制": "正在录制",
      "暂停": "暂停",
      "继续": "继续",
      "结束会议": "结束会议",
      "译文: 开": "译文: 开",
      "译文: 关": "译文: 关",
      "回到最新": "回到最新",
      "参与者": "参与者",
      "我": "我",
      "麦克风": "麦克风",
      "导出": "导出",
      "逐字稿": "逐字稿",
      "摘要": "摘要",
      "纪要与待办": "纪要与待办",
      "模型与本地数据": "模型与本地数据",
      "已安装模型": "已安装模型",
      "存储与隐私": "存储与隐私",
      "查看本地存储": "查看本地存储",
      "中文": "中文",
      "不需要翻译": "不需要翻译",
      "切换语言": "切换语言",
      "切换主题": "切换主题",
      "Brevia": "言录",
      "ERes2Net": "ERes2Net",
      "最小化": "最小化",
      "关闭": "关闭",
      "取消": "取消",
      "返回": "返回",
      "播放此段": "播放",
      "开始录制": "开始录制",
      "继续会议": "继续会议",
      "识别模型": "识别模型",
      "可用": "可用",
      "模型库": "模型库",
      "管理模型库": "管理模型库",
      "纪要模型": "纪要模型",
      "分钟": "分钟",
      "本地录音": "本地录音",
      "本地保存": "本地保存",
      "本地会议": "本地会议",
      "检查音频": "检查音频",
      "← 返回会议库": "← 返回会议库",
      "说话人分离": "说话人分离",
      "说话人": "说话人",
      "转发": "转发",
      "会后精修": "会后精修",
      "精修": "精修",
      "会后精修已完成": "会后精修已完成",
      "已整理": "已整理",
      "决定": "决定",
      "待办": "待办",
      "悬浮字幕": "悬浮字幕",
      "更多操作": "更多操作",
      "恢复": "恢复",
      "重命名": "重命名",
      "删除": "删除",
      "保存": "保存",
      "添加": "添加",
      "公开工作区": "公开工作区",
      "导入录音": "导入录音",
      "录制权限": "录制权限",
      "录制你的发言。": "录制你的发言。",
      "录制屏幕共享中的系统声音。": "录制屏幕共享中的系统声音。",
      "稍后": "稍后",
      "言录需要以下系统权限以提供服务": "言录需要以下系统权限以提供服务",
      "应用设置": "应用设置",
      "纪要不能为空": "纪要不能为空",
      "移至工作区": "移至工作区",
      "已移至": "已移至",
      "展开": "展开",
      "屏幕与系统音频": "屏幕与系统音频",
      "允许": "允许",
      "已允许": "已允许",
      "请在系统设置中允许": "请在系统设置中批准 言录 的屏幕与系统音频权限。",
      "已准备就绪": "已准备就绪",
      "当前系统不支持直接录制系统音频，请仅使用麦克风": "当前系统不支持直接录制系统音频，请仅使用麦克风",
      "系统权限": "系统权限",
      "打开系统设置": "打开系统设置",
      "请在系统设置中开启此权限": "已拒绝，请在系统设置中开启此权限。",
      "结束中": "结束中",
      "全选": "全选",
      "取消全选": "取消全选",
      "重新聚类说话人": "重新聚类说话人",
      "校正说话人": "校正说话人",
      "正在取消": "正在取消",
      "软件更新": "软件更新",
      "检查更新": "检查更新",
      "会议纪要已生成": "会议纪要已生成",
      "正在播放": "正在播放",
      "操作失败": "操作失败",
      "应用错误": "应用错误",
      "发现可恢复录音": "发现 {count} 场可恢复录音",
      "离线功能": "离线功能",
      "请选择声音": "请选择声音",
      "请先配置翻译模型": "请先配置翻译模型",
      "纪要服务拒绝了请求": "纪要服务拒绝了请求",
      "纪要模型需要配置": "纪要模型需要配置",
      "请检查 API 地址、密钥和服务商访问策略。": "请检查 API 地址、密钥和服务商访问策略。",
      "API Key 未配置、已失效或不匹配当前服务。": "API Key 未配置、已失效或不匹配当前服务。",
      "配置纪要模型": "配置纪要模型",
      "内置纪要模型未配置": "内置纪要模型未配置",
      "刚刚": "刚刚",
      "请先选择译文目标并配置纪要模型": "请先选择译文目标并配置纪要模型",
      "将确认字幕发送到 {provider} 生成译文。是否继续？": "将确认字幕发送到 {provider} 生成译文。是否继续？",
      "选择格式：md / txt / json / srt / docx / pdf / flac / wav / m4a": "选择格式：md / txt / json / srt / docx / pdf / flac / wav / m4a",
      "已导出「{title}」": "已导出「{title}」",
      "示例会议及录音已删除": "示例会议及录音已删除",
      "会议已移至最近删除": "会议已移至最近删除",
      "暂停录音": "暂停录音",
      "这场会议没有可播放的录音": "这场会议没有可播放的录音",
      "纪要配置加载失败": "纪要配置加载失败",
      "配置或后端启动失败": "配置或后端启动失败",
      "翻译失败": "翻译失败",
      "压缩包已导出": "压缩包已导出",
      "未找到录音，已导出逐字稿压缩包": "未找到录音，已导出逐字稿压缩包",
      "请前往「设置」>「AI 会议总结」，选择并下载内置纪要模型。": "请前往「设置」>「AI 会议总结」，选择并下载内置纪要模型。",
      "前往 AI 会议总结": "前往 AI 会议总结",
      "操作超时，请稍后重试": "操作超时，请稍后重试",
      "实时会议中，结束后再生成会议纪要。": "实时会议中，结束后再生成会议纪要。",
      "已有会议纪要正在生成，请稍候。": "已有会议纪要正在生成，请稍候。",
      "字幕": "字幕",
      "字幕：开": "字幕：开",
      "字幕：关": "字幕：关",
      "新建工作区": "新建工作区",
      "翻译：开": "翻译：开",
      "翻译：关": "翻译：关",
      "分享": "分享",
      "精修字幕": "精修字幕",
      "已精修": "已精修",
      "精修全文": "精修全文",
      "经过会后模型整理后的完整转写文本。由于当前模型不提供时间戳，该版本不支持逐句音频定位。": "经过会后模型整理后的完整转写文本。由于当前模型不提供时间戳，该版本不支持逐句音频定位。",
      "会议中没有记录笔记。": "会议中没有记录笔记。",
      "位参与者": "位参与者",
      "重新精修": "重新精修",
      "尚未生成": "尚未生成",
      "生成纪要": "生成纪要",
      "更多": "更多",
      "会议纪要": "会议纪要",
      "已生成纪要": "已生成纪要",
      "完成": "完成",
      "生成": "生成",
      "重新生成": "重新生成",
      "编辑": "编辑",
      "复制会议纪要": "复制会议纪要",
      "已连接": "已连接",
      "未就绪": "未就绪",
      "标准模式": "标准模式",
      "我的笔记": "我的笔记",
      "展开字幕": "展开字幕",
      "返回笔记": "返回笔记",
      "预览": "预览",
      "纪要生成失败：模型未返回有效内容，请稍后重试。": "纪要生成失败：模型未返回有效内容，请稍后重试。",
      "富文本": "富文本",
      "加粗": "加粗",
      "斜体": "斜体",
      "标题 1": "标题 1",
      "标题 2": "标题 2",
      "标题 3": "标题 3",
      "列表": "列表",
      "编号列表": "编号列表",
      "引用": "引用",
      "插入链接": "插入链接",
      "插入图片": "插入图片",
      "行内代码": "行内代码",
      "代码": "代码",
      "会议总结": "会议总结",
      "VAD 模型": "VAD 模型",
      "查看完整内容": "查看完整内容",
      "会议人数": "会议人数",
      "留空自动识别": "留空自动识别",
      "选择导出格式": "选择导出格式",
      "播放进度": "播放进度",
      "暂停播放": "暂停播放",
      "关闭播放": "关闭播放",
      "清空搜索": "清空搜索",
      "搜索结果": "搜索结果",
      "最近会议": "最近会议",
      "展开会议纪要": "展开会议纪要",
      "请求建议": "请求建议",
      "还没有下载内置 AI 模型。": "还没有下载内置 AI 模型。",
      "本次会议无法生成实时字幕": "本次会议无法生成实时字幕",
      "识别模型未能加载，录音仍在正常保存。会议结束后可在详情页生成完整逐字稿。": "识别模型未能加载，录音仍在正常保存。会议结束后可在详情页生成完整逐字稿。",
      "精修模型": "精修模型",
      "从文件夹打开": "从文件夹打开",
      "清空数据": "清空数据",
      "此操作不可恢复。": "此操作不可恢复。",
      "已清空": "已清空",
      "未找到录音文件": "未找到录音文件",
      "未找到模型文件": "未找到模型文件",
      "准备中": "准备中",
      "需要下载以下模型": "需要下载以下模型：",
      "模型下载队列": "模型下载队列",
      "下载失败": "下载失败，请检查网络",
      "重试": "重试",
      "正在下载会议所需模型，完成后会自动开始录制": "正在下载会议所需模型，完成后会自动开始录制",
      "正在下载模型，完成后会自动切换": "正在下载模型，完成后会自动切换",
      "工作区": "工作区",
      "正在精修": "正在精修",
      "音量": "音量",
      "未知工作区": "未知工作区",
      "工作区会议": "工作区会议",
      "创建一个新的工作区来组织会议": "创建一个新的工作区来组织会议",
      "工作区名称": "工作区名称",
      "描述": "描述",
      "（可选）": "（可选）",
      "创建工作区": "创建工作区",
      "工作区已创建": "工作区已创建",
      "编辑工作区": "编辑工作区",
      "保存更改": "保存更改",
      "删除工作区": "删除工作区",
      "工作区内的会议将移至最近删除。恢复会议时将还原原工作区。此操作不能撤销。": "工作区内的会议将移至最近删除。恢复会议时将还原原工作区。此操作不能撤销。",
      "工作区已删除": "工作区已删除",
      "工作区已更新": "工作区已更新",
      "调整识别、端点检测、说话人分离和本地模型运行参数。": "调整识别、端点检测、说话人分离和本地模型运行参数。",
      "下载": "下载",
      "下载中": "下载中",
      "内置": "内置",
      "查看录音": "查看录音",
      "收起": "收起",
      "选择录音并添加": "选择录音并添加",
      "播放录音": "播放录音",
      "已复制到剪贴板": "已复制到剪贴板",
      "暂无可分享的内容": "暂无可分享的内容",
      "进阶设置": "进阶设置",
      "配置进阶设置": "配置进阶设置",
      "恢复默认": "恢复默认",
      "确定": "确定",
      "已保存": "已保存",
      "已注册声纹": "已注册声纹",
      "说话人名称": "说话人名称",
      "可修改模型、端点静音、说话人分离及 sherpa-onnx 运行参数。": "可修改模型、端点静音、说话人分离及 sherpa-onnx 运行参数。",
      "添加录音到声纹库": "添加录音到声纹库",
      "暂无已注册声纹": "暂无已注册声纹",
      "已添加录音到声纹库": "已添加录音到声纹库",
      "新增声纹": "新增声纹",
      "声纹名称": "声纹名称",
      "已创建声纹并添加录音": "已创建声纹并添加录音",
      "确认": "确认",
      "重叠说话": "重叠说话",
      "请先选择或填写纪要模型。": "请先选择或填写纪要模型。",
      "请填写请求地址。": "请填写请求地址。",
      "请填写 API Key。": "请填写 API Key。",
      "纪要模型已保存": "纪要模型已保存",
      "主导航": "主导航",
      "Brevia 首页": "Brevia 首页",
      "在 GitHub 上查看 Brevia": "在 GitHub 上查看 Brevia",
      "转写中": "转写中",
      "加入笔记": "加入笔记",
      "已加入笔记": "已加入笔记",
      "数字": "数字",
      "日期": "日期",
      "问句": "问句",
      "暂无字幕可插入": "暂无字幕可插入",
      "无法获取字幕内容": "无法获取字幕内容",
      "笔记已达容量上限，超出部分未保存。": "笔记已达容量上限，超出部分未保存。",
      "可能是一个结论": "可能是一个结论",
      "可能的决策": "可能的决策",
      "可能的待办": "可能的待办",
      "重要数字": "重要数字",
      "重要日期": "重要日期",
      "待确认事项": "待确认事项",
      "可能的风险": "可能的风险",
      "新话题": "新话题",
      "补充": "补充",
      "忽略": "忽略",
      "1 条建议": "1 条建议",
      "AI 检测到新话题：": "AI 检测到新话题：",
      "整理笔记": "整理笔记",
      "校对": "校对",
      "修正": "修正",
      "提问": "提问",
      "重点": "重点",
      "插入表格": "插入表格",
      "切换到富文本": "切换到富文本",
      "切换到 Markdown": "切换到 Markdown",
      "列 1": "列 1",
      "列 2": "列 2",
      "内容": "内容",
      "重点：": "重点：",
      "原始转写": "原始转写",
      "列 {n}": "列 {n}",
      "选择行列数": "选择行列数",
      "行数": "行数",
      "列数": "列数",
      "插入": "插入",
      "已暂停": "已暂停",
      "系统默认": "系统默认",
      "麦克风设备": "麦克风设备",
      "刷新设备": "刷新设备",
      "笔记": "笔记",
      "会议录音": "会议录音",
      "在文件夹中显示": "在文件夹中显示",
      "查找": "查找",
      "替换为": "替换为",
      "上一个": "上一个",
      "下一个": "下一个",
      "全部替换": "全部替换",
      "导出与分享": "导出与分享",
      "请先选择要导出的内容": "请先选择要导出的内容",
      "依据 {count} 段字幕": "依据 {count} 段字幕",
      "图片必须是 PNG、JPEG、GIF 或 WebP，且不超过 10 MB。": "图片必须是 PNG、JPEG、GIF 或 WebP，且不超过 10 MB。",
      "未找到匹配的会议": "未找到匹配的会议",
      "{count} 条结果": "{count} 条结果",
      "标题匹配": "标题匹配",
      "搜索会议、字幕或说话人…": "搜索会议、字幕或说话人…",
      "更换精修模型": "更换精修模型",
      "该会议已有逐句修改。用新模型重新精修会按新模型重新分段，这些修改可能无法保留。": "该会议已有逐句修改。用新模型重新精修会按新模型重新分段，这些修改可能无法保留。",
      "开始精修": "开始精修",
      "自动（记住上次）": "自动（记住上次）",
      "仅麦克风": "仅麦克风",
      "仅系统音频": "仅系统音频",
      "麦克风 + 系统音频": "麦克风 + 系统音频",
      "适合线下会议场景": "适合线下会议场景",
      "适合网课、视频场景": "适合网课、视频场景",
      "适合线上会议场景": "适合线上会议场景",
      "录制来源": "录制来源",
      "采集模式": "采集模式",
      "沿用上次成功录制的方式": "沿用上次成功录制的方式",
      "未启用": "未启用",
      "多语言混说": "多语言混说",
      "翻译": "翻译",
      "正在翻译字幕": "正在翻译字幕",
      "字幕文本": "字幕文本",
      "字幕已保存": "字幕已保存",
      "字幕内容不能为空": "字幕内容不能为空",
      "保存失败": "保存失败",
      "占用": "占用",
      "内存": "内存",
      "随应用安装": "随应用安装",
      "必需": "必需",
      "磁盘空间不足，请先清理空间再下载。": "磁盘空间不足，请先清理空间再下载。",
      "文件校验未通过，下载可能已损坏，请删除后重试。": "文件校验未通过，下载可能已损坏，请删除后重试。",
      "网络中断导致下载失败，请检查网络后重试。": "网络中断导致下载失败，请检查网络后重试。",
      "模型不可用，请刷新模型库后重试。": "模型不可用，请刷新模型库后重试。",
      "已安装": "已安装",
      "后退 15 秒": "后退 15 秒",
      "前进 15 秒": "前进 15 秒",
      "请选择空文件夹。": "请选择空文件夹。",
      "请先结束会议、精修和模型下载，再更改文件夹。": "请先结束会议、精修和模型下载，再更改文件夹。",
      "模型和录音文件夹必须相互独立，且不能包含原数据文件夹。": "模型和录音文件夹必须相互独立，且不能包含原数据文件夹。",
      "此文件夹由环境变量指定，无法在应用内更改。": "此文件夹由环境变量指定，无法在应用内更改。",
      "文件夹更改失败，请检查路径、磁盘连接和写入权限。": "文件夹更改失败，请检查路径、磁盘连接和写入权限。",
      "error.operation_failed": "操作失败，请稍后重试。",
      "error.audio_backpressure": "音频处理积压，录音正在停止；已采集的音频会保存。",
      "error.worker_exited": "转写进程已退出。",
      "error.worker_recovery": "录音仍保存在本地，但转写无法恢复。",
      "error.storage_recovery": "数据文件夹需要恢复",
      "error.storage_recovery_hint": "请检查存储设备和配置文件。原始数据与迁移日志已保留，修复后重新启动 Brevia。",
      "error.storage_unavailable": "数据文件夹不可用。请连接存储设备后重新启动 Brevia。",
      "error.summary.no_transcript": "当前会议暂无逐字稿内容，请先完成转写后再生成会议纪要。",
      "error.voice_sample_owned": "这段录音已属于另一个声纹。",
      "error.voice_sample_short": "录音太短，请选择更长的声音样本。",
      "error.audio_not_found": "未找到录音文件，请检查文件是否存在。",
      "error.audio_too_long": "录音超过当前操作的时长上限，请选择较短的录音。",
      "error.refinement.no_audio": "这场会议没有可精修的录音。",
      "error.tasks.running": "请等待后台任务结束后再操作。",
      "error.meeting.active": "请先结束当前会议。",
      "error.sharing_not_confirmed": "请先确认逐字稿共享。",
      "error.segment_not_found": "未找到这段字幕，请刷新后重试。",
      "error.command_too_large": "内容超出容量上限，请减少内容后重试。",
      "error.summary.failed": "纪要生成失败，请检查服务配置或稍后重试。",
      "error.timeout": "操作超时，请稍后重试",
      "error.summary.live_meeting": "实时会议中，结束后再生成会议纪要。",
      "error.summary.empty_response": "纪要生成失败：模型未返回有效内容，请稍后重试。",
      "error.summary.authentication": "API Key 未配置、已失效或不匹配当前服务。"
    },
    "messages": {
      "recordingSaved": "录音已安全保存，正在整理逐字稿",
      "located": "已定位到对应音频片段",
      "playing": "正在播放混音轨道",
      "paused": "播放已暂停"
    }
  },
  "en": {
    "views": {
      "home": "All meetings",
      "prepare": "Prepare meeting",
      "live": "Recording",
      "detail": "Meeting details",
      "settings": "Settings"
    },
    "labels": {
      "所有会议": "All meetings",
      "最近删除": "Recently deleted",
      "设置": "Settings",
      "开始会议": "Start meeting",
      "会议库": "Meeting library",
      "准备录制": "Prepare recording",
      "实时字幕": "Live transcript",
      "会议详情": "Meeting details",
      "本地优先": "Local first",
      "音频与文本仅保存在此设备": "Audio and text stay on this device",
      "每一场对话，都留有依据。": "Every conversation leaves a traceable record.",
      "录音、逐字稿和纪要只在你明确操作时导出或发送。": "Audio, transcripts, and notes are exported or shared only when you choose to.",
      "搜索会议、逐字稿或标签": "Search meetings, transcripts, or tags",
      "所有分类": "All categories",
      "最近 30 天": "Last 30 days",
      "返回会议库": "Back to library",
      "开始一场会议": "Start a meeting",
      "先确认语言与音频输入。模型会在开始前加载，录制过程不会因网络状态中断。": "Confirm language and audio input first. The model loads before recording and keeps working without a network connection.",
      "录制音频": "Audio capture",
      "会议名称": "Meeting name",
      "会议语言": "Meeting language",
      "译文目标": "Translation target",
      "我的麦克风": "My microphone",
      "系统音频": "System audio",
      "输入良好": "Input ready",
      "已就绪": "Ready",
      "当前模型": "Current model",
      "中文确认文本与说话人分离": "Chinese final transcription and speaker separation",
      "管理模型与术语": "Manage models and terms",
      "正在录制": "Recording",
      "暂停": "Pause",
      "继续": "Resume",
      "结束会议": "End meeting",
      "保持在当下": "Stay with the conversation",
      "译文: 开": "Translation: On",
      "译文: 关": "Translation: Off",
      "回到最新": "Back to latest",
      "参与者": "Participants",
      "本场状态": "Session status",
      "我": "Me",
      "麦克风": "Microphone",
      "打开会议面板": "Open meeting panel",
      "导出": "Export",
      "逐字稿": "Transcript",
      "摘要": "Summary",
      "纪要与待办": "Notes and actions",
      "播放此段": "Play",
      "生成完整会议纪要": "Generate meeting notes",
      "模型与本地数据": "Models and local data",
      "已安装模型": "Installed models",
      "术语库": "Term library",
      "12 个词条可用于会议准备、搜索和纪要。仅支持的模型会将其用于转写。": "12 terms are available for meeting preparation, search, and notes. Only supported models use them during transcription.",
      "管理术语库": "Manage terms",
      "存储与隐私": "Storage and privacy",
      "会议资料保存在此 Mac。外部 LLM 需要在发送逐字稿前明确确认。": "Meeting data stays on this Mac. External LLMs require explicit confirmation before receiving a transcript.",
      "查看本地存储": "View local storage",
      "中文": "Chinese",
      "英语": "English",
      "不需要翻译": "No translation",
      "自动 · 仅麦克风": "Auto · Mic only",
      "自动 · 仅系统音频": "Auto · System audio only",
      "自动音源": "Auto source",
      "自动检测": "Auto detect",
      "切换语言": "Switch language",
      "切换主题": "Switch theme",
      "Brevia": "Brevia",
      "向量数据库": "Vector database",
      "ERes2Net": "ERes2Net",
      "最小化": "Minimize",
      "关闭": "Close",
      "取消": "Cancel",
      "返回": "Back",
      "开始录制": "Start recording",
      "继续会议": "Resume meeting",
      "我 · 麦克风": "Me · Microphone",
      "计算设备": "Compute device",
      "预计空间": "Estimated storage",
      "识别模型": "Recognition model",
      "已应用术语": "Applied terms",
      "12 个词条": "12 terms",
      "可用": "Available",
      "已完成精修": "Refinement complete",
      "中文确认文本 · 1.2 GB": "Chinese final transcription · 1.2 GB",
      "英文与其他语言 · 466 MB": "English and other languages · 466 MB",
      "+ 9": "+ 9",
      "模型库": "Model library",
      "管理模型库": "Manage model library",
      "纪要模型": "Summary models",
      "配置用于生成会议纪要的 API。所有配置信息仅保存在本地，不会上传。": "Configure APIs for meeting notes. All configuration stays local and is never uploaded.",
      "管理纪要模型": "Manage summary models",
      "总结提示词": "Summary prompt",
      "编辑提示词": "Edit prompt",
      "配置 JSON": "Configuration JSON",
      "当前启用的纪要模型配置。": "The active summary model configuration.",
      "分钟": "min",
      "本地录音": "Local recording",
      "本地保存": "Saved locally",
      "本地会议": "Local meeting",
      "检查音频": "Checking audio",
      "检测语音": "Detecting speech",
      "识别说话人": "Identifying speakers",
      "重新聚类说话人": "Reclustering speakers",
      "匹配声纹": "Matching voiceprints",
      "整理说话人": "Preparing speaker timeline",
      "← 返回会议库": "← Back to library",
      "说话人分离": "Speaker diarization",
      "自定义术语": "Custom term",
      "暂无术语": "No terms",
      "说话人": "Speaker",
      "等待识别说话人": "Waiting to identify speakers",
      "会议摘要": "Meeting summary",
      "尚未生成会议摘要": "No meeting summary yet",
      "转发": "Share",
      "会后精修": "Refine",
      "精修": "Refine",
      "精修字稿": "Refined transcript",
      "完成精修后，这里会显示不带时间戳的校对稿。": "The refined transcript without timestamps appears here when refinement finishes.",
      "正在精修…": "Refining…",
      "会后精修已完成": "Refinement complete",
      "已整理": "Complete",
      "决定": "Decisions",
      "待办": "Action items",
      "悬浮字幕": "Floating caption",
      "悬浮字幕：开": "Floating caption: On",
      "⌖ 开": "⌖ On",
      "最近 7 天": "Last 7 days",
      "最近 90 天": "Last 90 days",
      "全部时间": "All time",
      "系统默认麦克风": "System default microphone",
      "需要授予屏幕与系统音频权限": "Screen and system-audio permission required",
      "中文 / 英语": "Chinese / English",
      "更多操作": "More actions",
      "恢复": "Restore",
      "重命名": "Rename",
      "删除": "Delete",
      "保存": "Save",
      "添加": "Add",
      "公开工作区": "Public workspace",
      "导入录音": "Import recording",
      "语音对话": "Voice conversation",
      "请先在声纹库注册可用声音": "Register a voiceprint before sending speech",
      "录制权限": "Recording permissions",
      "首次使用时完成设置": "Complete setup on first use",
      "录制你的发言。": "Records your speech.",
      "录制屏幕共享中的系统声音。": "Records system audio from screen sharing.",
      "稍后": "Later",
      "言录需要以下系统权限以提供服务": "Brevia needs the following system permissions to provide its services.",
      "应用设置": "App settings",
      "纪要不能为空": "Meeting notes cannot be empty.",
      "当前没有正在进行的会议": "There is no meeting in progress.",
      "移至工作区": "Move to workspace",
      "已移至": "Moved to",
      "展开": "Expand",
      "屏幕与系统音频": "Screen and system audio",
      "允许": "Allow",
      "已允许": "Allowed",
      "请在系统设置中允许": "Approve Brevia for screen and system-audio access in System Settings.",
      "已准备就绪": "Ready",
      "当前系统不支持直接录制系统音频，请仅使用麦克风": "Direct system-audio recording is not supported on this system. Use only the microphone.",
      "系统权限": "System permissions",
      "打开系统设置": "Open System Settings",
      "请在系统设置中开启此权限": "Denied. Enable this permission in System Settings.",
      "结束中": "Ending meeting…",
      "正在精修": "Refining",
      "原版逐字稿仍可查看": "The original transcript remains available",
      "准备中": "Preparing",
      "正在取消": "Cancelling",
      "全选": "Select all",
      "取消全选": "Deselect all",
      "校正说话人": "Correcting speakers",
      "软件更新": "Software updates",
      "检查更新": "Check for updates",
      "会议纪要已生成": "Meeting notes generated",
      "正在播放": "Playing",
      "操作失败": "Action failed",
      "应用错误": "Application error",
      "会后精修失败": "Post-meeting refinement failed",
      "发现可恢复录音": "Found {count} recoverable recording(s)",
      "离线功能": "Offline features",
      "请选择声音": "Select a voice first",
      "请先配置翻译模型": "Configure a translation model first",
      "纪要服务拒绝了请求": "Summary provider rejected the request",
      "纪要模型需要配置": "Configure summary model",
      "请检查 API 地址、密钥和服务商访问策略。": "Check the API URL, key, and provider access policy.",
      "API Key 未配置、已失效或不匹配当前服务。": "The API key is missing, invalid, or rejected by this provider.",
      "配置纪要模型": "Configure model",
      "内置纪要模型未配置": "Built-in summary model not configured",
      "请选择并下载一个内置纪要模型，之后即可完全离线生成纪要。": "Choose and download a built-in summary model to generate meeting notes fully offline.",
      "选择纪要模型": "Choose model",
      "刚刚": "Just now",
      "请先选择译文目标并配置纪要模型": "Choose a translation target and configure a summary model first",
      "将确认字幕发送到 {provider} 生成译文。是否继续？": "Send confirmed captions to {provider} for translation?",
      "选择格式：md / txt / json / srt / docx / pdf / flac / wav / m4a": "Choose format: md / txt / json / srt / docx / pdf / flac / wav / m4a",
      "已导出「{title}」": "Exported “{title}”",
      "示例会议及录音已删除": "Example meeting and recording deleted",
      "会议已移至最近删除": "Meeting moved to Recently Deleted",
      "暂停录音": "Pause recording",
      "这场会议没有可播放的录音": "This meeting has no playable recording",
      "纪要配置加载失败": "Failed to load summary configuration",
      "配置或后端启动失败": "Configuration or backend startup failed",
      "翻译失败": "Translation failed",
      "压缩包已导出": "Archive exported",
      "未找到录音，已导出逐字稿压缩包": "No recording found; transcript archive exported",
      "请前往「设置」>「AI 会议总结」，选择并下载内置纪要模型。": "Go to Settings > AI meeting summary to choose and download a built-in summary model.",
      "前往 AI 会议总结": "Go to AI meeting summary",
      "操作超时，请稍后重试": "The operation timed out. Please try again.",
      "实时会议中，结束后再生成会议纪要。": "Live meeting in progress. Finish it before generating the meeting notes.",
      "已有会议纪要正在生成，请稍候。": "A meeting summary is already being generated. Please wait.",
      "字幕": "Captions",
      "字幕：开": "Captions: On",
      "字幕：关": "Captions: Off",
      "新建工作区": "New workspace",
      "翻译：开": "Translation: On",
      "翻译：关": "Translation: Off",
      "分享": "Share",
      "精修字幕": "Refine captions",
      "已精修": "Refined",
      "查看原始转写": "View original transcript",
      "查看精修字幕": "View refined captions",
      "精修全文": "Full refined transcript",
      "经过会后模型整理后的完整转写文本。由于当前模型不提供时间戳，该版本不支持逐句音频定位。": "A continuous transcript reworked by the post-meeting model. Because this model provides no timestamps, per-segment audio seeking is not supported.",
      "会议中没有记录笔记。": "No notes were taken during the meeting.",
      "位参与者": "participants",
      "重新精修": "Re-refine",
      "更换精修模型": "Change refinement model",
      "尚未生成": "Not generated yet",
      "生成纪要": "Generate notes",
      "更多": "More",
      "会议纪要": "Meeting notes",
      "新建会议": "New meeting",
      "已生成纪要": "Notes generated",
      "完成": "Done",
      "生成": "Generate",
      "重新生成": "Regenerate",
      "笔记已达 20000 字符上限，超出部分未保存。": "Notes are limited to 20,000 characters; the rest was not saved.",
      "编辑": "Edit",
      "搜索会议…": "Search meetings…",
      "复制会议纪要": "Copy meeting notes",
      "已连接": "Connected",
      "未就绪": "Not ready",
      "需要麦克风权限": "Microphone permission required",
      "标准模式": "Standard mode",
      "我的笔记": "My notes",
      "展开字幕": "Expand captions",
      "返回笔记": "Back to notes",
      "预览": "Preview",
      "记录笔记（支持 Markdown）": "Take notes here. Markdown supported.",
      "纪要生成失败：模型未返回有效内容，请稍后重试。": "Meeting notes failed: the model returned no content. Please try again.",
      "富文本": "Rich text",
      "加粗": "Bold",
      "斜体": "Italic",
      "标题 1": "Heading 1",
      "标题 2": "Heading 2",
      "标题 3": "Heading 3",
      "列表": "List",
      "编号列表": "Numbered list",
      "引用": "Quote",
      "插入链接": "Insert link",
      "插入图片": "Insert image",
      "行内代码": "Inline code",
      "代码": "Code",
      "会议总结": "Meeting summary",
      "管理会议总结": "Manage meeting summary",
      "AI 笔记与会议总结": "AI notes and meeting summary",
      "配置用于生成会议总结和 AI 笔记的服务。所有配置信息仅保存在本地，不会上传。": "Configure the service used for meeting summaries and AI notes. All configuration stays on this device.",
      "配置 AI 笔记与会议总结": "Configure AI notes and meeting summary",
      "管理语言识别模型的下载、删除与版本信息。": "Manage downloads, removal, and version details for speech-recognition models.",
      "VAD 模型": "VAD model",
      "查看完整内容": "View full content",
      "会议人数": "Participants",
      "继续精修": "Continue refinement",
      "留空自动识别": "Leave blank for auto-detection",
      "选择导出格式": "Choose export format",
      "播放进度": "Playback progress",
      "暂停播放": "Pause playback",
      "关闭播放": "Close playback",
      "清空搜索": "Clear search",
      "搜索结果": "Search results",
      "最近会议": "Recent meetings",
      "展开会议纪要": "Expand meeting notes",
      "请求建议": "Request a suggestion",
      "还没有下载内置 AI 模型。": "No built-in AI model is installed yet.",
      "本次会议无法生成实时字幕": "Live captions are unavailable for this meeting",
      "识别模型未能加载，录音仍在正常保存。会议结束后可在详情页生成完整逐字稿。": "The recognition model could not be loaded. Your audio is still being saved — you can generate the full transcript from the meeting details after it ends.",
      "实时字幕模型": "Live caption model",
      "说话人分离模型": "Speaker diarization model",
      "会后精修模型": "Post-meeting refinement model",
      "模型与设置": "Models & settings",
      "实时识别模型": "Live recognition model",
      "精修模型": "Refinement model",
      "从文件夹打开": "Open in folder",
      "清空数据": "Clear data",
      "此操作不可恢复。": "This action cannot be undone.",
      "已清空": "Data cleared",
      "未找到录音文件": "Recording file not found",
      "未找到模型文件": "Model files not found",
      "需要下载以下模型": "Download required models:",
      "模型下载队列": "Model download queue",
      "下载失败": "Download failed. Check your connection.",
      "重试": "Retry",
      "正在下载会议所需模型，完成后会自动开始录制": "Downloading the models needed for this meeting. Recording will start automatically when ready.",
      "正在下载模型，完成后会自动切换": "Downloading the model. The switch happens automatically when it is ready.",
      "预期说话人数": "Expected speakers",
      "留空自动匹配": "Leave blank to auto-match",
      "工作区": "Workspace",
      "自动匹配": "Auto-match",
      "音量": "Volume",
      "请先在\"模型与设置\"中选择译文目标语言": "Choose a target language in “Models & settings” first.",
      "未知工作区": "Unknown workspace",
      "工作区会议": "Workspace meetings",
      "创建一个新的工作区来组织会议": "Create a workspace to organize meetings.",
      "工作区名称": "Workspace name",
      "描述": "Description",
      "（可选）": "(Optional)",
      "创建工作区": "Create workspace",
      "工作区已创建": "Workspace created",
      "编辑工作区": "Edit workspace",
      "保存更改": "Save changes",
      "删除工作区": "Delete workspace",
      "工作区内的会议将移至最近删除。恢复会议时将还原原工作区。此操作不能撤销。": "Meetings in this workspace will move to Recently Deleted. Restoring a meeting also restores its original workspace. This cannot be undone.",
      "工作区已删除": "Workspace deleted",
      "工作区已更新": "Workspace updated",
      "调整识别、端点检测、说话人分离和本地模型运行参数。": "Adjust recognition, endpoint detection, speaker diarization, and local model runtime parameters.",
      "下载": "Download",
      "下载中": "Downloading",
      "内置": "Built in",
      "查看录音": "View recordings",
      "收起": "Collapse",
      "选择录音并添加": "Choose recording and add",
      "播放录音": "Play recording",
      "已复制到剪贴板": "Copied to clipboard",
      "暂无可分享的内容": "Nothing to share yet",
      "进阶设置": "Advanced settings",
      "配置进阶设置": "Configure advanced settings",
      "恢复默认": "Restore defaults",
      "确定": "Confirm",
      "已保存": "Saved",
      "标记说话人": "Assign speaker",
      "选择已注册声纹或新建说话人。": "Choose a registered voiceprint or create a speaker.",
      "已注册声纹": "Registered voiceprint",
      "新建说话人": "New speaker",
      "说话人名称": "Speaker name",
      "可修改模型、端点静音、说话人分离及 sherpa-onnx 运行参数。": "Configure model, endpoint, diarization, and sherpa-onnx runtime parameters.",
      "修改后会立即应用于下一次会议与精修。": "Changes apply to the next meeting and refinement.",
      "添加录音到声纹库": "Add recording to voiceprint",
      "暂无已注册声纹": "No registered voiceprints",
      "已添加录音到声纹库": "Recording added to voiceprint",
      "新增声纹": "Create voiceprint",
      "声纹名称": "Voiceprint name",
      "已创建声纹并添加录音": "Voiceprint created and recording added",
      "确认": "Confirm",
      "重叠说话": "Overlapping speech",
      "请先选择或填写纪要模型。": "Select or enter a summary model first.",
      "请填写请求地址。": "Enter the request URL.",
      "请填写 API Key。": "Enter the API key.",
      "纪要模型已保存": "Summary model saved",
      "主导航": "Main navigation",
      "Brevia 首页": "Brevia home",
      "在 GitHub 上查看 Brevia": "View Brevia on GitHub",
      "对齐音频": "Aligning audio",
      "准备精修": "Preparing refinement",
      "分析说话人": "Analyzing speakers",
      "转写中": "Transcribing",
      "整理结果": "Finalizing results",
      "未检测到麦克风设备，请在系统设置中开启麦克风访问权限": "No microphone was detected. Enable microphone access in System Settings.",
      "麦克风访问被拒绝，请在系统设置中允许应用使用麦克风后重试": "Microphone access was denied. Allow the app to use the microphone in System Settings, then try again.",
      "麦克风被其他程序占用，请关闭占用麦克风的程序后重试": "The microphone is in use by another app. Close that app, then try again.",
      "无法获取麦克风": "Unable to access the microphone",
      "无法获取系统音频，请检查系统权限后重试": "Unable to capture system audio. Check system permissions, then try again.",
      "未检测到系统音频，请在系统设置中允许屏幕与系统音频录制后重试": "No system audio was detected. Allow screen and system-audio recording in System Settings, then try again.",
      "麦克风没有可用的音频轨道": "The microphone has no available audio track",
      "至少选择一个音频输入": "Select at least one audio input",
      "系统音频未产生音频数据": "System audio produced no audio data",
      "麦克风未产生音频数据": "The microphone produced no audio data",
      "笔记已达容量上限，超出部分未保存。": "Notes reached the size limit; the rest was not saved.",
      "加入笔记": "Add to notes",
      "标记当前时间点": "Insert timestamp",
      "已加入笔记": "Added to notes",
      "数字": "Number",
      "日期": "Date",
      "问句": "Question",
      "暂无字幕可插入": "No caption to insert yet",
      "无法获取字幕内容": "Caption text unavailable",
      "可能是一个结论": "Possible conclusion",
      "可能的决策": "Possible decision",
      "可能的待办": "Possible action item",
      "重要数字": "Key number",
      "重要日期": "Key date",
      "待确认事项": "To confirm",
      "可能的风险": "Possible risk",
      "新话题": "New topic",
      "补充": "Add",
      "忽略": "Ignore",
      "1 条建议": "1 suggestion",
      "AI 检测到新话题：": "AI detected a new topic: ",
      "整理笔记": "Organize notes",
      "校对": "Fact-check",
      "关联历史": "Related history",
      "整理一下？": "Organize notes?",
      "替换原内容": "Replace",
      "插入整理版": "Insert organized version",
      "和会议原文可能存在差异": "Possible discrepancy with the transcript",
      "字幕中说的是：": "The transcript says:",
      "修正": "Fix",
      "保持原文": "Keep as is",
      "查看原会议": "Open meeting",
      "和之前内容有关": "Related to earlier content",
      "问 AI": "Ask AI",
      "问当前会议": "Ask about this meeting",
      "输入你的问题": "Type your question",
      "提问": "Ask",
      "搜索字幕…": "Search captions…",
      "重点": "Highlight",
      "插入表格": "Insert table",
      "切换到富文本": "Switch to rich text",
      "切换到 Markdown": "Switch to Markdown",
      "列 1": "Column 1",
      "列 2": "Column 2",
      "内容": "Content",
      "重点：": "Highlight: ",
      "原始转写": "Original transcript",
      "列 {n}": "Column {n}",
      "选择行列数": "Choose table size",
      "行数": "Rows",
      "列数": "Columns",
      "插入": "Insert",
      "已暂停": "Paused",
      "系统默认": "System default",
      "麦克风设备": "Microphone",
      "刷新设备": "Refresh devices",
      "导出会议资料": "Export meeting files",
      "笔记": "Notes",
      "会议录音": "Meeting recording",
      "混音录音": "Mixed recording",
      "传送到应用": "Send to app",
      "在文件夹中显示": "Show in folder",
      "暂无笔记可导出": "No notes to export",
      "查找": "Find",
      "替换为": "Replace with",
      "上一个": "Previous",
      "下一个": "Next",
      "全部替换": "Replace all",
      "导出与分享": "Export & share",
      "请先选择要导出的内容": "Select what to export first",
      "依据 {count} 段字幕": "Based on {count} captions",
      "图片必须是 PNG、JPEG、GIF 或 WebP，且不超过 10 MB。": "Image must be PNG, JPEG, GIF, or WebP and smaller than 10 MB.",
      "未找到匹配的会议": "No matching meetings",
      "{count} 条结果": "{count} results",
      "标题匹配": "Title match",
      "搜索会议、字幕或说话人…": "Search meetings, captions, or speakers…",
      "该会议已有逐句修改。用新模型重新精修会按新模型重新分段，这些修改可能无法保留。": "This meeting has per-sentence edits. Re-refining with a new model re-segments the transcript, so those edits may not be kept.",
      "开始精修": "Start refinement",
      "录制方式": "Recording mode",
      "自动（记住上次）": "Auto (remember last)",
      "仅麦克风": "Microphone only",
      "仅系统音频": "System audio only",
      "麦克风 + 系统音频": "Microphone + system audio",
      "适合线下会议场景": "For in-person meetings",
      "适合网课、视频场景": "For classes and video",
      "适合线上会议场景": "For online meetings",
      "录制来源": "Recording sources",
      "采集模式": "Capture mode",
      "沿用上次成功录制的方式": "Use the last successful mode",
      "未启用": "Not enabled",
      "多语言混说": "Mixed languages",
      "翻译": "Translate",
      "正在翻译字幕": "Translating subtitles",
      "字幕文本": "Subtitle text",
      "字幕已保存": "Subtitles saved",
      "字幕内容不能为空": "Subtitle text cannot be empty",
      "保存失败": "Could not save",
      "占用": "On disk",
      "内存": "Memory",
      "随应用安装": "Included",
      "必需": "Required",
      "磁盘空间不足，请先清理空间再下载。": "Not enough disk space. Free up some space, then download again.",
      "文件校验未通过，下载可能已损坏，请删除后重试。": "The download failed its integrity check and may be corrupted. Remove it and try again.",
      "网络中断导致下载失败，请检查网络后重试。": "The download was interrupted. Check your connection and try again.",
      "模型不可用，请刷新模型库后重试。": "That model is unavailable. Reopen the model library and try again.",
      "已安装": "Installed",
      "后退 15 秒": "Back 15 seconds",
      "前进 15 秒": "Forward 15 seconds",
      "请选择空文件夹。": "Choose an empty folder.",
      "请先结束会议、精修和模型下载，再更改文件夹。": "Finish meetings, refinement and model downloads before changing folders.",
      "模型和录音文件夹必须相互独立，且不能包含原数据文件夹。": "Model and recording folders must be separate and must not contain the existing data folders.",
      "此文件夹由环境变量指定，无法在应用内更改。": "This folder is set by an environment variable and cannot be changed in the app.",
      "文件夹更改失败，请检查路径、磁盘连接和写入权限。": "Could not change folders. Check the path, drive connection and write permissions.",
      "error.operation_failed": "The operation failed. Please try again.",
      "error.audio_backpressure": "Audio processing is falling behind. Recording is stopping; captured audio will be saved.",
      "error.worker_exited": "The transcription process exited.",
      "error.worker_recovery": "Recording is still saved locally, but transcription could not recover.",
      "error.storage_recovery": "Data folder recovery required",
      "error.storage_recovery_hint": "Check the storage drives and configuration file. Original data and migration records are preserved. Restart Brevia after fixing the issue.",
      "error.storage_unavailable": "The data folder is unavailable. Connect the storage drive and restart Brevia.",
      "error.summary.no_transcript": "Transcribe this meeting before generating meeting notes.",
      "error.voice_sample_owned": "This recording already belongs to another voiceprint.",
      "error.voice_sample_short": "The recording is too short. Choose a longer voice sample.",
      "error.audio_not_found": "Audio file not found. Check that the file still exists.",
      "error.audio_too_long": "The recording exceeds the duration limit for this operation. Choose a shorter recording.",
      "error.refinement.no_audio": "This meeting has no recording to refine.",
      "error.tasks.running": "Wait for background tasks to finish before continuing.",
      "error.meeting.active": "Finish the current meeting first.",
      "error.sharing_not_confirmed": "Confirm transcript sharing before continuing.",
      "error.segment_not_found": "Subtitle segment not found. Refresh and try again.",
      "error.command_too_large": "The content exceeds the size limit. Reduce it and try again.",
      "error.summary.failed": "Could not generate meeting notes. Check the service settings or try again later.",
      "error.timeout": "The operation timed out. Please try again.",
      "error.summary.live_meeting": "Live meeting in progress. Finish it before generating the meeting notes.",
      "error.summary.empty_response": "Meeting notes failed: the model returned no content. Please try again.",
      "error.summary.authentication": "The API key is missing, invalid, or rejected by this provider."
    },
    "messages": {
      "recordingSaved": "Recording saved safely. Preparing transcript.",
      "located": "Moved to the linked audio segment",
      "playing": "Playing mixed track",
      "paused": "Playback paused"
    }
  },
  "es": {
    "views": {
      "home": "Todas las reuniones",
      "prepare": "Preparar reunión",
      "live": "Grabando",
      "detail": "Detalles de la reunión",
      "settings": "Configuración"
    },
    "labels": {
      "所有会议": "Todas las reuniones",
      "最近删除": "Eliminadas recientemente",
      "设置": "Configuración",
      "开始会议": "Iniciar reunión",
      "会议库": "Biblioteca de reuniones",
      "准备录制": "Preparar grabación",
      "实时字幕": "Transcripción en vivo",
      "会议详情": "Detalles de la reunión",
      "本地优先": "Primero local",
      "音频与文本仅保存在此设备": "El audio y el texto permanecen en este dispositivo",
      "每一场对话，都留有依据。": "Cada conversación conserva un registro verificable.",
      "录音、逐字稿和纪要只在你明确操作时导出或发送。": "El audio, las transcripciones y las notas se exportan o comparten solo cuando lo eliges.",
      "搜索会议、逐字稿或标签": "Buscar reuniones, transcripciones o etiquetas",
      "所有分类": "Todas las categorías",
      "最近 30 天": "Últimos 30 días",
      "返回会议库": "Volver a la biblioteca",
      "开始一场会议": "Iniciar una reunión",
      "先确认语言与音频输入。模型会在开始前加载，录制过程不会因网络状态中断。": "Primero confirma el idioma y la entrada de audio. El modelo carga antes de grabar y sigue funcionando sin conexión.",
      "录制音频": "Captura de audio",
      "会议名称": "Nombre de la reunión",
      "会议语言": "Idioma de la reunión",
      "译文目标": "Idioma de traducción",
      "我的麦克风": "Mi micrófono",
      "系统音频": "Audio del sistema",
      "输入良好": "Entrada lista",
      "已就绪": "Listo",
      "当前模型": "Modelo actual",
      "中文确认文本与说话人分离": "Transcripción final en chino y separación de hablantes",
      "管理模型与术语": "Gestionar modelos y términos",
      "正在录制": "Grabando",
      "暂停": "Pausar",
      "继续": "Reanudar",
      "结束会议": "Finalizar reunión",
      "保持在当下": "Sigue la conversación",
      "译文: 开": "Traducción: Sí",
      "译文: 关": "Traducción: No",
      "回到最新": "Volver a lo último",
      "参与者": "Participantes",
      "本场状态": "Estado de la sesión",
      "我": "Yo",
      "麦克风": "Micrófono",
      "打开会议面板": "Abrir panel de reunión",
      "导出": "Exportar",
      "逐字稿": "Transcripción",
      "摘要": "Resumen",
      "纪要与待办": "Notas y tareas",
      "播放此段": "Reproducir",
      "生成完整会议纪要": "Generar notas de reunión",
      "模型与本地数据": "Modelos y datos locales",
      "已安装模型": "Modelos instalados",
      "术语库": "Biblioteca de términos",
      "12 个词条可用于会议准备、搜索和纪要。仅支持的模型会将其用于转写。": "Hay 12 términos para preparar reuniones, buscar y crear notas. Solo los modelos compatibles los usan durante la transcripción.",
      "管理术语库": "Gestionar términos",
      "存储与隐私": "Almacenamiento y privacidad",
      "会议资料保存在此 Mac。外部 LLM 需要在发送逐字稿前明确确认。": "Los datos de la reunión permanecen en este Mac. Los LLM externos requieren confirmación antes de recibir una transcripción.",
      "查看本地存储": "Ver almacenamiento local",
      "中文": "Chino",
      "英语": "Inglés",
      "不需要翻译": "Sin traducción",
      "自动 · 仅麦克风": "Auto · Solo micrófono",
      "自动 · 仅系统音频": "Auto · Solo audio del sistema",
      "自动音源": "Fuente automática",
      "自动检测": "Detección automática",
      "切换语言": "Cambiar idioma",
      "切换主题": "Cambiar tema",
      "Brevia": "Brevia",
      "向量数据库": "Base de datos vectorial",
      "ERes2Net": "ERes2Net",
      "最小化": "Minimizar",
      "关闭": "Cerrar",
      "取消": "Cancelar",
      "返回": "Atrás",
      "开始录制": "Iniciar grabación",
      "继续会议": "Reanudar reunión",
      "我 · 麦克风": "Yo · Micrófono",
      "计算设备": "Dispositivo de cálculo",
      "预计空间": "Almacenamiento estimado",
      "识别模型": "Modelo de reconocimiento",
      "已应用术语": "Términos aplicados",
      "12 个词条": "12 términos",
      "可用": "Disponible",
      "已完成精修": "Refinamiento completo",
      "中文确认文本 · 1.2 GB": "Transcripción final en chino · 1.2 GB",
      "英文与其他语言 · 466 MB": "Inglés y otros idiomas · 466 MB",
      "+ 9": "+ 9",
      "模型库": "Biblioteca de modelos",
      "管理模型库": "Gestionar la biblioteca de modelos",
      "纪要模型": "Modelos de resumen",
      "配置用于生成会议纪要的 API。所有配置信息仅保存在本地，不会上传。": "Configura API para las notas de reunión. Toda la configuración es local y no se carga.",
      "管理纪要模型": "Gestionar modelos de resumen",
      "总结提示词": "Prompt de resumen",
      "编辑提示词": "Editar prompt",
      "配置 JSON": "JSON de configuración",
      "当前启用的纪要模型配置。": "La configuración activa del modelo de resumen.",
      "分钟": "min",
      "本地录音": "Grabación local",
      "本地保存": "Guardado localmente",
      "本地会议": "Reunión local",
      "检查音频": "Comprobando audio",
      "检测语音": "Detectando voz",
      "识别说话人": "Identificando hablantes",
      "重新聚类说话人": "Reagrupando hablantes",
      "匹配声纹": "Comparando huellas de voz",
      "整理说话人": "Preparando la línea de hablantes",
      "← 返回会议库": "← Volver a la biblioteca",
      "说话人分离": "Separación de hablantes",
      "自定义术语": "Término personalizado",
      "暂无术语": "No hay términos",
      "说话人": "Hablante",
      "等待识别说话人": "Esperando identificar hablantes",
      "会议摘要": "Resumen de la reunión",
      "尚未生成会议摘要": "Aún no se ha generado el resumen",
      "转发": "Compartir",
      "会后精修": "Refinar",
      "精修": "Refinar",
      "精修字稿": "Transcripción refinada",
      "完成精修后，这里会显示不带时间戳的校对稿。": "La transcripción refinada sin marcas de tiempo aparecerá aquí al terminar.",
      "正在精修…": "Refinando…",
      "会后精修已完成": "Refinamiento completado",
      "已整理": "Completado",
      "决定": "Decisiones",
      "待办": "Tareas",
      "悬浮字幕": "Subtítulo flotante",
      "悬浮字幕：开": "Subtítulo flotante: Sí",
      "⌖ 开": "⌖ Sí",
      "最近 7 天": "Últimos 7 días",
      "最近 90 天": "Últimos 90 días",
      "全部时间": "Todo el tiempo",
      "系统默认麦克风": "Micrófono predeterminado del sistema",
      "需要授予屏幕与系统音频权限": "Se requiere permiso para pantalla y audio del sistema",
      "中文 / 英语": "Chino / inglés",
      "更多操作": "Más acciones",
      "恢复": "Restaurar",
      "重命名": "Renombrar",
      "删除": "Eliminar",
      "保存": "Guardar",
      "添加": "Añadir",
      "公开工作区": "Espacio de trabajo público",
      "导入录音": "Importar grabación",
      "语音对话": "Chat de voz",
      "请先在声纹库注册可用声音": "Registra una voz antes de enviar audio",
      "录制权限": "Permisos de grabación",
      "首次使用时完成设置": "Completa la configuración al usarla por primera vez",
      "录制你的发言。": "Graba tu voz.",
      "录制屏幕共享中的系统声音。": "Graba el audio del sistema al compartir pantalla.",
      "稍后": "Más tarde",
      "言录需要以下系统权限以提供服务": "Brevia necesita los siguientes permisos del sistema para prestar sus servicios.",
      "应用设置": "Configuración de la aplicación",
      "纪要不能为空": "Las notas de la reunión no pueden estar vacías.",
      "当前没有正在进行的会议": "No hay ninguna reunión en curso.",
      "移至工作区": "Mover al espacio de trabajo",
      "已移至": "Movido a",
      "展开": "Expandir",
      "屏幕与系统音频": "Pantalla y audio del sistema",
      "允许": "Permitir",
      "已允许": "Permitido",
      "请在系统设置中允许": "Aprueba el acceso de Brevia a la pantalla y al audio del sistema en Ajustes del Sistema.",
      "已准备就绪": "Listo",
      "系统权限": "Permisos del sistema",
      "打开系统设置": "Abrir Ajustes del Sistema",
      "请在系统设置中开启此权限": "Denegado. Habilita este permiso en Ajustes del Sistema.",
      "结束中": "Finalizando reunión…",
      "正在精修": "Refinando",
      "原版逐字稿仍可查看": "La transcripción original sigue disponible",
      "准备中": "Preparando",
      "全选": "Seleccionar todo",
      "取消全选": "Deseleccionar todo",
      "校正说话人": "Corrigiendo hablantes",
      "正在取消": "Cancelando",
      "软件更新": "Actualizaciones",
      "检查更新": "Buscar actualizaciones",
      "会议纪要已生成": "Notas de reunión generadas",
      "正在播放": "Reproduciendo",
      "操作失败": "Operación fallida",
      "应用错误": "Error de la aplicación",
      "会后精修失败": "Falló el refinamiento posterior",
      "发现可恢复录音": "Se encontraron {count} grabación(es) recuperable(s)",
      "离线功能": "Funciones sin conexión",
      "请选择声音": "Seleccione primero una voz",
      "请先配置翻译模型": "Configure primero un modelo de traducción",
      "纪要服务拒绝了请求": "El proveedor de resúmenes rechazó la solicitud",
      "纪要模型需要配置": "Configure el modelo de resumen",
      "请检查 API 地址、密钥和服务商访问策略。": "Revise la URL de la API, la clave y la política de acceso del proveedor.",
      "API Key 未配置、已失效或不匹配当前服务。": "La clave API falta, no es válida o fue rechazada por este proveedor.",
      "配置纪要模型": "Configurar modelo",
      "内置纪要模型未配置": "Modelo de resumen integrado no configurado",
      "请选择并下载一个内置纪要模型，之后即可完全离线生成纪要。": "Elija y descargue un modelo de resumen integrado para generar notas de reunión totalmente sin conexión.",
      "选择纪要模型": "Elegir modelo",
      "刚刚": "Ahora mismo",
      "请先选择译文目标并配置纪要模型": "Elija un idioma de traducción y configure primero un modelo de resumen",
      "将确认字幕发送到 {provider} 生成译文。是否继续？": "¿Enviar los subtítulos confirmados a {provider} para traducirlos?",
      "选择格式：md / txt / json / srt / docx / pdf / flac / wav / m4a": "Elija formato: md / txt / json / srt / docx / pdf / flac / wav / m4a",
      "已导出「{title}」": "Se exportó “{title}”",
      "示例会议及录音已删除": "Se eliminaron la reunión y grabación de ejemplo",
      "会议已移至最近删除": "La reunión se movió a Eliminadas recientemente",
      "暂停录音": "Pausar grabación",
      "这场会议没有可播放的录音": "Esta reunión no tiene una grabación reproducible",
      "纪要配置加载失败": "No se pudo cargar la configuración del resumen",
      "配置或后端启动失败": "Falló la configuración o el inicio del backend",
      "翻译失败": "Error de traducción",
      "压缩包已导出": "Archivo exportado",
      "未找到录音，已导出逐字稿压缩包": "No se encontró grabación; se exportó el archivo de transcripción",
      "请前往「设置」>「AI 会议总结」，选择并下载内置纪要模型。": "Ve a Configuración > Resumen de reunión con IA para elegir y descargar un modelo integrado.",
      "前往 AI 会议总结": "Ir al resumen de IA",
      "操作超时，请稍后重试": "La operación agotó el tiempo de espera. Inténtalo de nuevo.",
      "实时会议中，结束后再生成会议纪要。": "Reunión en directo en curso. Finalízala antes de generar las notas de la reunión.",
      "已有会议纪要正在生成，请稍候。": "Ya se está generando un resumen de reunión. Espera un momento.",
      "字幕": "Subtítulos",
      "字幕：开": "Subtítulos: Sí",
      "字幕：关": "Subtítulos: No",
      "新建工作区": "Nuevo espacio de trabajo",
      "翻译：开": "Traducción: Sí",
      "翻译：关": "Traducción: No",
      "分享": "Compartir",
      "精修字幕": "Refinar subtítulos",
      "已精修": "Refinado",
      "查看原始转写": "Ver transcripción original",
      "查看精修字幕": "Ver subtítulos refinados",
      "精修全文": "Transcripción refinada completa",
      "经过会后模型整理后的完整转写文本。由于当前模型不提供时间戳，该版本不支持逐句音频定位。": "Una transcripción completa revisada por el modelo posterior a la reunión. Como este modelo no proporciona marcas de tiempo, no se admite la búsqueda de audio por segmento.",
      "会议中没有记录笔记。": "No se tomaron notas durante la reunión.",
      "位参与者": "participantes",
      "重新精修": "Refinar de nuevo",
      "更换精修模型": "Cambiar el modelo de refinado",
      "尚未生成": "Aún no generado",
      "生成纪要": "Generar notas",
      "更多": "Más",
      "会议纪要": "Notas de reunión",
      "新建会议": "Nueva reunión",
      "已生成纪要": "Notas generadas",
      "完成": "Listo",
      "生成": "Generar",
      "重新生成": "Regenerar",
      "笔记已达 20000 字符上限，超出部分未保存。": "Las notas se limitan a 20.000 caracteres; el resto no se guardó.",
      "编辑": "Editar",
      "搜索会议…": "Buscar reuniones…",
      "复制会议纪要": "Copiar notas de reunión",
      "已连接": "Conectado",
      "未就绪": "No listo",
      "需要麦克风权限": "Se requiere permiso de micrófono",
      "标准模式": "Modo estándar",
      "我的笔记": "Mis notas",
      "展开字幕": "Ampliar subtítulos",
      "返回笔记": "Volver a notas",
      "预览": "Vista previa",
      "记录笔记（支持 Markdown）": "Toma notas aquí. Markdown compatible.",
      "纪要生成失败：模型未返回有效内容，请稍后重试。": "No se pudieron generar las notas: el modelo no devolvió contenido. Inténtalo de nuevo.",
      "富文本": "Texto enriquecido",
      "加粗": "Negrita",
      "斜体": "Cursiva",
      "标题 1": "Título 1",
      "标题 2": "Título 2",
      "标题 3": "Título 3",
      "列表": "Lista",
      "编号列表": "Lista numerada",
      "引用": "Cita",
      "插入链接": "Insertar enlace",
      "插入图片": "Insertar imagen",
      "行内代码": "Código en línea",
      "代码": "Código",
      "会议总结": "Resumen de la reunión",
      "管理会议总结": "Gestionar el resumen de la reunión",
      "AI 笔记与会议总结": "Notas de IA y resumen de la reunión",
      "配置用于生成会议总结和 AI 笔记的服务。所有配置信息仅保存在本地，不会上传。": "Configura el servicio para los resúmenes de reuniones y las notas de IA. La configuración se guarda en este dispositivo.",
      "配置 AI 笔记与会议总结": "Configurar notas de IA y resumen",
      "管理语言识别模型的下载、删除与版本信息。": "Gestiona las descargas, eliminaciones y versiones de los modelos de reconocimiento de voz.",
      "VAD 模型": "Modelo VAD",
      "查看完整内容": "Ver contenido completo",
      "会议人数": "Participantes",
      "继续精修": "Continuar refinamiento",
      "留空自动识别": "Déjalo vacío para auto-detección",
      "选择导出格式": "Elegir formato de exportación",
      "播放进度": "Progreso de reproducción",
      "暂停播放": "Pausar reproducción",
      "关闭播放": "Cerrar reproducción",
      "清空搜索": "Borrar búsqueda",
      "搜索结果": "Resultados de búsqueda",
      "最近会议": "Reuniones recientes",
      "展开会议纪要": "Expandir notas de la reunión",
      "请求建议": "Solicitar una sugerencia",
      "还没有下载内置 AI 模型。": "Aún no hay ningún modelo de IA integrado instalado.",
      "本次会议无法生成实时字幕": "No hay subtítulos en vivo para esta reunión",
      "识别模型未能加载，录音仍在正常保存。会议结束后可在详情页生成完整逐字稿。": "No se pudo cargar el modelo de reconocimiento. El audio se sigue guardando: al terminar podrás generar la transcripción completa desde los detalles de la reunión.",
      "实时字幕模型": "Modelo de subtítulos en vivo",
      "说话人分离模型": "Modelo de separación de hablantes",
      "会后精修模型": "Modelo de refinamiento posterior",
      "模型与设置": "Modelos y ajustes",
      "实时识别模型": "Modelo de reconocimiento en vivo",
      "精修模型": "Modelo de refinamiento",
      "从文件夹打开": "Abrir en la carpeta",
      "清空数据": "Borrar datos",
      "此操作不可恢复。": "Esta acción no se puede deshacer.",
      "已清空": "Datos borrados",
      "未找到录音文件": "No se encontró el archivo de grabación",
      "未找到模型文件": "No se encontraron archivos del modelo",
      "需要下载以下模型": "Descarga los modelos necesarios:",
      "模型下载队列": "Cola de descargas de modelos",
      "下载失败": "La descarga falló. Comprueba la conexión.",
      "重试": "Reintentar",
      "正在下载会议所需模型，完成后会自动开始录制": "Descargando los modelos necesarios para esta reunión. La grabación comenzará automáticamente al terminar.",
      "正在下载模型，完成后会自动切换": "Descargando el modelo. El cambio se aplicará automáticamente al terminar.",
      "当前系统不支持直接录制系统音频，请仅使用麦克风": "Este sistema no admite la grabación directa del audio del sistema. Usa solo el micrófono.",
      "预期说话人数": "Número previsto de hablantes",
      "留空自动匹配": "Déjalo vacío para la selección automática",
      "工作区": "Espacio de trabajo",
      "自动匹配": "Selección automática",
      "音量": "Volumen",
      "请先在\"模型与设置\"中选择译文目标语言": "Primero elige un idioma de destino en «Modelos y ajustes».",
      "未知工作区": "Espacio de trabajo desconocido",
      "工作区会议": "Reuniones del espacio de trabajo",
      "创建一个新的工作区来组织会议": "Crea un espacio de trabajo para organizar reuniones.",
      "工作区名称": "Nombre del espacio de trabajo",
      "描述": "Descripción",
      "（可选）": "(Opcional)",
      "创建工作区": "Crear espacio de trabajo",
      "工作区已创建": "Espacio de trabajo creado",
      "编辑工作区": "Editar espacio de trabajo",
      "保存更改": "Guardar cambios",
      "删除工作区": "Eliminar espacio de trabajo",
      "工作区内的会议将移至最近删除。恢复会议时将还原原工作区。此操作不能撤销。": "Las reuniones de este espacio se moverán a Eliminadas recientemente. Al restaurarlas se recuperará su espacio original. Esta acción no se puede deshacer.",
      "工作区已删除": "Espacio de trabajo eliminado",
      "工作区已更新": "Espacio de trabajo actualizado",
      "调整识别、端点检测、说话人分离和本地模型运行参数。": "Ajusta el reconocimiento, la detección de final, la separación de hablantes y los parámetros locales de los modelos.",
      "下载": "Descarga",
      "下载中": "Descargando",
      "内置": "Integrado",
      "查看录音": "Ver grabaciones",
      "收起": "Contraer",
      "选择录音并添加": "Elegir grabación y añadir",
      "播放录音": "Reproducir grabación",
      "已复制到剪贴板": "Copiado al portapapeles",
      "暂无可分享的内容": "Aún no hay nada que compartir",
      "进阶设置": "Configuración avanzada",
      "配置进阶设置": "Configurar opciones avanzadas",
      "恢复默认": "Restaurar valores predeterminados",
      "确定": "Confirmar",
      "已保存": "Guardado",
      "标记说话人": "Asignar hablante",
      "选择已注册声纹或新建说话人。": "Elige una huella de voz registrada o crea un hablante.",
      "已注册声纹": "Huella de voz registrada",
      "新建说话人": "Nuevo hablante",
      "说话人名称": "Nombre del hablante",
      "可修改模型、端点静音、说话人分离及 sherpa-onnx 运行参数。": "Configura modelos, detección de final, separación de hablantes y parámetros de sherpa-onnx.",
      "修改后会立即应用于下一次会议与精修。": "Los cambios se aplican a la próxima reunión y refinamiento.",
      "添加录音到声纹库": "Añadir grabación a la huella de voz",
      "暂无已注册声纹": "No hay huellas de voz registradas",
      "已添加录音到声纹库": "Grabación añadida a la huella de voz",
      "新增声纹": "Crear huella de voz",
      "声纹名称": "Nombre de huella de voz",
      "已创建声纹并添加录音": "Huella de voz creada y grabación añadida",
      "确认": "Confirmar",
      "重叠说话": "Habla superpuesta",
      "请先选择或填写纪要模型。": "Primero selecciona o introduce un modelo de resumen.",
      "请填写请求地址。": "Introduce la URL de solicitud.",
      "请填写 API Key。": "Introduce la clave API.",
      "纪要模型已保存": "Modelo de resumen guardado",
      "主导航": "Navegación principal",
      "Brevia 首页": "Inicio de Brevia",
      "在 GitHub 上查看 Brevia": "Ver Brevia en GitHub",
      "对齐音频": "Alineando el audio",
      "准备精修": "Preparando el refinamiento",
      "分析说话人": "Analizando hablantes",
      "转写中": "Transcribiendo",
      "整理结果": "Finalizando resultados",
      "未检测到麦克风设备，请在系统设置中开启麦克风访问权限": "No se detectó ningún micrófono. Habilita el acceso al micrófono en Ajustes del Sistema.",
      "麦克风访问被拒绝，请在系统设置中允许应用使用麦克风后重试": "Se denegó el acceso al micrófono. Permite que la app use el micrófono en Ajustes del Sistema y vuelve a intentarlo.",
      "麦克风被其他程序占用，请关闭占用麦克风的程序后重试": "El micrófono está en uso por otra app. Ciérrala y vuelve a intentarlo.",
      "无法获取麦克风": "No se pudo acceder al micrófono",
      "无法获取系统音频，请检查系统权限后重试": "No se pudo capturar el audio del sistema. Revisa los permisos del sistema y vuelve a intentarlo.",
      "未检测到系统音频，请在系统设置中允许屏幕与系统音频录制后重试": "No se detectó audio del sistema. Permite la grabación de pantalla y audio del sistema en Ajustes del Sistema y vuelve a intentarlo.",
      "麦克风没有可用的音频轨道": "El micrófono no tiene una pista de audio disponible",
      "至少选择一个音频输入": "Selecciona al menos una entrada de audio",
      "系统音频未产生音频数据": "El audio del sistema no produjo datos de audio",
      "麦克风未产生音频数据": "El micrófono no produjo datos de audio",
      "加入笔记": "Añadir a notas",
      "标记当前时间点": "Insertar marca de tiempo",
      "已加入笔记": "Añadido a notas",
      "数字": "Número",
      "日期": "Fecha",
      "问句": "Pregunta",
      "暂无字幕可插入": "Aún no hay subtítulos que insertar",
      "无法获取字幕内容": "Texto del subtítulo no disponible",
      "可能是一个结论": "Posible conclusión",
      "可能的决策": "Posible decisión",
      "可能的待办": "Posible tarea",
      "重要数字": "Cifra clave",
      "重要日期": "Fecha clave",
      "待确认事项": "Por confirmar",
      "可能的风险": "Posible riesgo",
      "新话题": "Nuevo tema",
      "补充": "Añadir",
      "忽略": "Ignorar",
      "1 条建议": "1 sugerencia",
      "AI 检测到新话题：": "La IA detectó un nuevo tema: ",
      "整理笔记": "Organizar notas",
      "校对": "Verificar",
      "关联历史": "Historial relacionado",
      "整理一下？": "¿Organizar notas?",
      "替换原内容": "Reemplazar",
      "插入整理版": "Insertar versión organizada",
      "和会议原文可能存在差异": "Posible diferencia con la transcripción",
      "字幕中说的是：": "La transcripción dice:",
      "修正": "Corregir",
      "保持原文": "Mantener",
      "查看原会议": "Abrir reunión",
      "和之前内容有关": "Relacionado con contenido anterior",
      "问 AI": "Preguntar a la IA",
      "问当前会议": "Preguntar sobre esta reunión",
      "输入你的问题": "Escribe tu pregunta",
      "提问": "Preguntar",
      "搜索字幕…": "Buscar subtítulos…",
      "重点": "Destacar",
      "插入表格": "Insertar tabla",
      "切换到富文本": "Cambiar a texto enriquecido",
      "切换到 Markdown": "Cambiar a Markdown",
      "列 1": "Columna 1",
      "列 2": "Columna 2",
      "内容": "Contenido",
      "重点：": "Destacar: ",
      "原始转写": "Transcripción original",
      "列 {n}": "Columna {n}",
      "选择行列数": "Elegir tamaño de tabla",
      "行数": "Filas",
      "列数": "Columnas",
      "插入": "Insertar",
      "已暂停": "En pausa",
      "系统默认": "Predeterminado",
      "麦克风设备": "Micrófono",
      "刷新设备": "Actualizar dispositivos",
      "笔记已达容量上限，超出部分未保存。": "Las notas alcanzaron el límite de tamaño; el resto no se guardó.",
      "导出会议资料": "Exportar archivos de reunión",
      "笔记": "Notas",
      "会议录音": "Grabación de reunión",
      "混音录音": "Grabación mezclada",
      "传送到应用": "Enviar a una app",
      "在文件夹中显示": "Mostrar en carpeta",
      "暂无笔记可导出": "No hay notas para exportar",
      "查找": "Buscar",
      "替换为": "Reemplazar por",
      "上一个": "Anterior",
      "下一个": "Siguiente",
      "全部替换": "Reemplazar todo",
      "导出与分享": "Exportar y compartir",
      "请先选择要导出的内容": "Selecciona qué exportar primero",
      "依据 {count} 段字幕": "Basado en {count} subtítulos",
      "图片必须是 PNG、JPEG、GIF 或 WebP，且不超过 10 MB。": "La imagen debe ser PNG, JPEG, GIF o WebP y tener menos de 10 MB.",
      "未找到匹配的会议": "No se encontraron reuniones",
      "{count} 条结果": "{count} resultados",
      "标题匹配": "Coincide con el título",
      "搜索会议、字幕或说话人…": "Buscar reuniones, subtítulos o hablantes…",
      "该会议已有逐句修改。用新模型重新精修会按新模型重新分段，这些修改可能无法保留。": "Esta reunión tiene ediciones por frase. Volver a refinar con otro modelo vuelve a segmentar la transcripción, por lo que esas ediciones podrían no conservarse.",
      "开始精修": "Iniciar refinamiento",
      "录制方式": "Modo de grabación",
      "自动（记住上次）": "Auto (recordar último)",
      "仅麦克风": "Solo micrófono",
      "仅系统音频": "Solo audio del sistema",
      "麦克风 + 系统音频": "Micrófono + audio del sistema",
      "适合线下会议场景": "Para reuniones presenciales",
      "适合网课、视频场景": "Para clases y vídeo",
      "适合线上会议场景": "Para reuniones en línea",
      "录制来源": "Fuentes de grabación",
      "采集模式": "Modo de captura",
      "沿用上次成功录制的方式": "Usar el último modo correcto",
      "未启用": "No activado",
      "多语言混说": "Idiomas mixtos",
      "翻译": "Traducir",
      "正在翻译字幕": "Traduciendo subtítulos",
      "字幕文本": "Texto del subtítulo",
      "字幕已保存": "Subtítulos guardados",
      "字幕内容不能为空": "El texto del subtítulo no puede estar vacío",
      "保存失败": "No se pudo guardar",
      "占用": "En disco",
      "内存": "Memoria",
      "随应用安装": "Incluido",
      "必需": "Obligatorio",
      "磁盘空间不足，请先清理空间再下载。": "No hay espacio suficiente en disco. Libera espacio y vuelve a descargar.",
      "文件校验未通过，下载可能已损坏，请删除后重试。": "La descarga no superó la verificación y puede estar dañada. Elimínala e inténtalo de nuevo.",
      "网络中断导致下载失败，请检查网络后重试。": "La descarga se interrumpió. Comprueba la conexión e inténtalo de nuevo.",
      "模型不可用，请刷新模型库后重试。": "Ese modelo no está disponible. Vuelve a abrir la biblioteca de modelos.",
      "已安装": "Instalados",
      "后退 15 秒": "Retroceder 15 segundos",
      "前进 15 秒": "Avanzar 15 segundos",
      "请选择空文件夹。": "Elige una carpeta vacía.",
      "请先结束会议、精修和模型下载，再更改文件夹。": "Finaliza las reuniones, el refinamiento y las descargas de modelos antes de cambiar las carpetas.",
      "模型和录音文件夹必须相互独立，且不能包含原数据文件夹。": "Las carpetas de modelos y grabaciones deben estar separadas y no contener las carpetas de datos actuales.",
      "此文件夹由环境变量指定，无法在应用内更改。": "Esta carpeta está definida por una variable de entorno y no se puede cambiar en la aplicación.",
      "文件夹更改失败，请检查路径、磁盘连接和写入权限。": "No se pudieron cambiar las carpetas. Comprueba la ruta, la conexión del disco y los permisos de escritura.",
      "error.operation_failed": "La operación falló. Inténtalo de nuevo.",
      "error.audio_backpressure": "El procesamiento de audio se está retrasando. La grabación se detiene; el audio capturado se guardará.",
      "error.worker_exited": "El proceso de transcripción terminó.",
      "error.worker_recovery": "La grabación sigue guardada localmente, pero no se pudo recuperar la transcripción.",
      "error.storage_recovery": "Es necesario recuperar la carpeta de datos",
      "error.storage_recovery_hint": "Comprueba los dispositivos de almacenamiento y el archivo de configuración. Los datos originales y los registros de migración se conservan. Reinicia Brevia tras resolver el problema.",
      "error.storage_unavailable": "La carpeta de datos no está disponible. Conecta el dispositivo y reinicia Brevia.",
      "error.summary.no_transcript": "Transcribe esta reunión antes de generar las notas.",
      "error.voice_sample_owned": "Esta grabación ya pertenece a otra huella de voz.",
      "error.voice_sample_short": "La grabación es demasiado corta. Elige una muestra más larga.",
      "error.audio_not_found": "No se encontró el audio. Comprueba que el archivo existe.",
      "error.audio_too_long": "La grabación supera el límite de duración de esta operación. Elige una grabación más corta.",
      "error.refinement.no_audio": "Esta reunión no tiene una grabación para refinar.",
      "error.tasks.running": "Espera a que terminen las tareas en segundo plano.",
      "error.meeting.active": "Finaliza primero la reunión actual.",
      "error.sharing_not_confirmed": "Confirma primero que deseas compartir la transcripción.",
      "error.segment_not_found": "No se encontró el subtítulo. Actualiza e inténtalo de nuevo.",
      "error.command_too_large": "El contenido supera el límite. Redúcelo e inténtalo de nuevo.",
      "error.summary.failed": "No se pudieron generar las notas. Revisa la configuración o inténtalo más tarde.",
      "error.timeout": "La operación agotó el tiempo de espera. Inténtalo de nuevo.",
      "error.summary.live_meeting": "Reunión en directo en curso. Finalízala antes de generar las notas de la reunión.",
      "error.summary.empty_response": "No se pudieron generar las notas: el modelo no devolvió contenido. Inténtalo de nuevo.",
      "error.summary.authentication": "La clave API falta, no es válida o fue rechazada por este proveedor."
    },
    "messages": {
      "recordingSaved": "Grabación guardada. Preparando la transcripción.",
      "located": "Se abrió el segmento de audio vinculado",
      "playing": "Reproduciendo pista mezclada",
      "paused": "Reproducción pausada"
    }
  },
  "ja": {
    "views": {
      "home": "すべての会議",
      "prepare": "録音の準備",
      "live": "録音中",
      "detail": "会議の詳細",
      "settings": "設定"
    },
    "labels": {
      "所有会议": "すべての会議",
      "最近删除": "最近削除した項目",
      "设置": "設定",
      "开始会议": "会議を開始",
      "会议库": "会議ライブラリ",
      "准备录制": "録音の準備",
      "实时字幕": "ライブ字幕",
      "会议详情": "会議の詳細",
      "本地优先": "ローカル優先",
      "音频与文本仅保存在此设备": "音声とテキストはこのデバイスにのみ保存されます",
      "每一场对话，都留有依据。": "すべての会話を、確かな記録に。",
      "录音、逐字稿和纪要只在你明确操作时导出或发送。": "録音・文字起こし・議事録は、明示的に操作した場合のみ書き出し・送信されます。",
      "搜索会议、逐字稿或标签": "会議、文字起こし、タグを検索",
      "所有分类": "すべての分類",
      "最近 30 天": "過去30日間",
      "返回会议库": "ライブラリに戻る",
      "开始一场会议": "会議を開始",
      "先确认语言与音频输入。模型会在开始前加载，录制过程不会因网络状态中断。": "まず言語と音声入力を確認してください。モデルは録音前に読み込まれ、ネットワークの状態にかかわらず録音できます。",
      "录制音频": "音声を録音",
      "会议名称": "会議名",
      "会议语言": "会議の言語",
      "译文目标": "翻訳先",
      "我的麦克风": "マイク",
      "系统音频": "システム音声",
      "输入良好": "入力は良好です",
      "已就绪": "準備完了",
      "当前模型": "現在のモデル",
      "中文确认文本与说话人分离": "中国語の確定文字起こしと話者分離",
      "管理模型与术语": "モデルと用語を管理",
      "正在录制": "録音中",
      "暂停": "一時停止",
      "继续": "再開",
      "结束会议": "会議を終了",
      "保持在当下": "会話に集中する",
      "译文: 开": "翻訳：オン",
      "译文: 关": "翻訳：オフ",
      "回到最新": "最新へ戻る",
      "参与者": "参加者",
      "本场状态": "セッションの状態",
      "我": "自分",
      "麦克风": "マイク",
      "打开会议面板": "会議パネルを開く",
      "导出": "エクスポート",
      "逐字稿": "文字起こし",
      "摘要": "要約",
      "纪要与待办": "議事録とタスク",
      "播放此段": "再生",
      "生成完整会议纪要": "会議メモを生成",
      "模型与本地数据": "モデルとローカルデータ",
      "已安装模型": "インストール済みモデル",
      "术语库": "用語集",
      "12 个词条可用于会议准备、搜索和纪要。仅支持的模型会将其用于转写。": "12 件の用語を会議の準備・検索・議事録に使用できます。対応モデルのみ文字起こしにも使用します。",
      "管理术语库": "用語集を管理",
      "存储与隐私": "ストレージとプライバシー",
      "会议资料保存在此 Mac。外部 LLM 需要在发送逐字稿前明确确认。": "会議データはこの Mac に保存されます。外部 LLM への送信には明示的な確認が必要です。",
      "查看本地存储": "ローカルストレージを表示",
      "中文": "中国語",
      "英语": "英語",
      "不需要翻译": "翻訳しない",
      "自动 · 仅麦克风": "自動 · マイクのみ",
      "自动 · 仅系统音频": "自動 · システム音声のみ",
      "自动音源": "自動音源",
      "自动检测": "自動検出",
      "切换语言": "言語を切り替え",
      "切换主题": "テーマを切り替え",
      "Brevia": "Brevia",
      "向量数据库": "ベクトルデータベース",
      "ERes2Net": "ERes2Net",
      "最小化": "最小化",
      "关闭": "閉じる",
      "取消": "キャンセル",
      "返回": "戻る",
      "开始录制": "録音を開始",
      "继续会议": "会議を再開",
      "我 · 麦克风": "自分 · マイク",
      "计算设备": "演算デバイス",
      "预计空间": "推定容量",
      "识别模型": "認識モデル",
      "已应用术语": "適用済みの用語",
      "12 个词条": "12 件の用語",
      "可用": "利用可能",
      "已完成精修": "校正完了",
      "中文确认文本 · 1.2 GB": "中国語の確定文字起こし · 1.2 GB",
      "英文与其他语言 · 466 MB": "英語・その他の言語 · 466 MB",
      "+ 9": "+ 9",
      "模型库": "モデルライブラリ",
      "管理模型库": "モデルライブラリを管理",
      "纪要模型": "要約モデル",
      "配置用于生成会议纪要的 API。所有配置信息仅保存在本地，不会上传。": "会議メモを生成する API を設定します。すべての設定はローカルに保存されます。",
      "管理纪要模型": "要約モデルを管理",
      "总结提示词": "要約プロンプト",
      "编辑提示词": "プロンプトを編集",
      "配置 JSON": "設定 JSON",
      "当前启用的纪要模型配置。": "現在有効な議事録モデルの設定。",
      "分钟": "分",
      "本地录音": "ローカル録音",
      "本地保存": "ローカルに保存",
      "本地会议": "ローカル会議",
      "检查音频": "音声を確認中",
      "检测语音": "音声を検出中",
      "识别说话人": "話者を識別中",
      "重新聚类说话人": "話者を再クラスタリング中",
      "匹配声纹": "声紋を照合中",
      "整理说话人": "話者タイムラインを準備中",
      "← 返回会议库": "← ライブラリに戻る",
      "说话人分离": "話者分離",
      "自定义术语": "カスタム用語",
      "暂无术语": "用語はありません",
      "说话人": "話者",
      "等待识别说话人": "話者の識別を待機中",
      "会议摘要": "会議の要約",
      "尚未生成会议摘要": "会議の要約はまだありません",
      "转发": "共有",
      "会后精修": "会議後の高精度化",
      "精修": "再調整",
      "精修字稿": "校正済み文字起こし",
      "完成精修后，这里会显示不带时间戳的校对稿。": "校正が完了すると、タイムスタンプのない校正済みテキストがここに表示されます。",
      "正在精修…": "校正中…",
      "会后精修已完成": "会議後の校正が完了しました",
      "已整理": "完了",
      "决定": "決定",
      "待办": "タスク",
      "悬浮字幕": "フローティング字幕",
      "悬浮字幕：开": "フローティング字幕：オン",
      "⌖ 开": "⌖ オン",
      "最近 7 天": "過去7日間",
      "最近 90 天": "過去90日間",
      "全部时间": "すべての期間",
      "系统默认麦克风": "システムのデフォルトマイク",
      "需要授予屏幕与系统音频权限": "画面とシステム音声のアクセス許可が必要です",
      "中文 / 英语": "中国語 / 英語",
      "更多操作": "その他の操作",
      "恢复": "復元",
      "重命名": "名前を変更",
      "删除": "削除",
      "保存": "保存",
      "添加": "追加",
      "公开工作区": "公開ワークスペース",
      "导入录音": "録音を読み込む",
      "语音对话": "音声チャット",
      "请先在声纹库注册可用声音": "音声を送信する前に声紋を登録してください",
      "录制权限": "録音の権限",
      "首次使用时完成设置": "初回使用時に設定を完了",
      "录制你的发言。": "あなたの発言を録音します。",
      "录制屏幕共享中的系统声音。": "画面共有中のシステム音声を録音します。",
      "稍后": "あとで",
      "言录需要以下系统权限以提供服务": "Brevia がサービスを提供するには、以下のシステム権限が必要です。",
      "应用设置": "アプリ設定",
      "纪要不能为空": "会議メモを空にすることはできません。",
      "当前没有正在进行的会议": "進行中の会議はありません。",
      "移至工作区": "ワークスペースに移動",
      "已移至": "移動先",
      "展开": "展開",
      "屏幕与系统音频": "画面とシステム音声",
      "允许": "許可する",
      "已允许": "許可済み",
      "请在系统设置中允许": "システム設定で、Brevia に画面とシステム音声へのアクセスを許可してください。",
      "已准备就绪": "準備完了",
      "系统权限": "システム権限",
      "打开系统设置": "システム設定を開く",
      "请在系统设置中开启此权限": "拒否されています。システム設定でこの権限を有効にしてください。",
      "结束中": "会議を終了中",
      "正在精修": "精密化中",
      "原版逐字稿仍可查看": "元の文字起こしは引き続き閲覧できます",
      "准备中": "準備中",
      "全选": "すべて選択",
      "取消全选": "選択を解除",
      "校正说话人": "話者を修正中",
      "正在取消": "キャンセル中",
      "软件更新": "ソフトウェアアップデート",
      "检查更新": "アップデートを確認",
      "会议纪要已生成": "会議メモを生成しました",
      "正在播放": "再生中",
      "操作失败": "操作に失敗しました",
      "应用错误": "アプリケーションエラー",
      "会后精修失败": "会議後の高精度化に失敗しました",
      "发现可恢复录音": "復元可能な録音が {count} 件見つかりました",
      "离线功能": "オフライン機能",
      "请选择声音": "先に声を選択してください",
      "请先配置翻译模型": "先に翻訳モデルを設定してください",
      "纪要服务拒绝了请求": "要約プロバイダーがリクエストを拒否しました",
      "纪要模型需要配置": "要約モデルを設定してください",
      "请检查 API 地址、密钥和服务商访问策略。": "API URL、キー、プロバイダーのアクセス方針を確認してください。",
      "API Key 未配置、已失效或不匹配当前服务。": "API キーが未設定、無効、またはこのプロバイダーで拒否されています。",
      "配置纪要模型": "モデルを設定",
      "内置纪要模型未配置": "内蔵要約モデルが未設定です",
      "请选择并下载一个内置纪要模型，之后即可完全离线生成纪要。": "内蔵の要約モデルを選択してダウンロードすると、完全オフラインで会議メモを生成できます。",
      "选择纪要模型": "モデルを選択",
      "刚刚": "たった今",
      "请先选择译文目标并配置纪要模型": "先に翻訳先を選択して要約モデルを設定してください",
      "将确认字幕发送到 {provider} 生成译文。是否继续？": "確認済み字幕を {provider} に送信して翻訳しますか？",
      "选择格式：md / txt / json / srt / docx / pdf / flac / wav / m4a": "形式を選択: md / txt / json / srt / docx / pdf / flac / wav / m4a",
      "已导出「{title}」": "「{title}」をエクスポートしました",
      "示例会议及录音已删除": "サンプル会議と録音を削除しました",
      "会议已移至最近删除": "会議を最近削除した項目に移動しました",
      "暂停录音": "録音を一時停止",
      "这场会议没有可播放的录音": "この会議には再生可能な録音がありません",
      "纪要配置加载失败": "要約設定の読み込みに失敗しました",
      "配置或后端启动失败": "設定またはバックエンドの起動に失敗しました",
      "翻译失败": "翻訳に失敗しました",
      "压缩包已导出": "アーカイブをエクスポートしました",
      "未找到录音，已导出逐字稿压缩包": "録音が見つからなかったため、文字起こしアーカイブをエクスポートしました",
      "请前往「设置」>「AI 会议总结」，选择并下载内置纪要模型。": "「設定」>「AI 会議要約」で内蔵要約モデルを選択してダウンロードしてください。",
      "前往 AI 会议总结": "AI 会議要約を開く",
      "操作超时，请稍后重试": "操作がタイムアウトしました。もう一度お試しください。",
      "实时会议中，结束后再生成会议纪要。": "ライブ会議中です。終了後に会議メモを生成できます。",
      "已有会议纪要正在生成，请稍候。": "別の会議メモを生成中です。しばらくお待ちください。",
      "字幕": "字幕",
      "字幕：开": "字幕：オン",
      "字幕：关": "字幕：オフ",
      "新建工作区": "ワークスペースを作成",
      "翻译：开": "翻訳：オン",
      "翻译：关": "翻訳：オフ",
      "分享": "共有",
      "精修字幕": "字幕を精修",
      "已精修": "精修済み",
      "查看原始转写": "元の文字起こしを見る",
      "查看精修字幕": "精修後の字幕を見る",
      "精修全文": "精修済み全文",
      "经过会后模型整理后的完整转写文本。由于当前模型不提供时间戳，该版本不支持逐句音频定位。": "会議後にモデルが整理した連続した文字起こしです。このモデルはタイムスタンプを提供しないため、文ごとの音声位置指定はできません。",
      "会议中没有记录笔记。": "会議中にメモはありませんでした。",
      "位参与者": "人の参加者",
      "重新精修": "再精修",
      "更换精修模型": "精修モデルを変更",
      "尚未生成": "未生成",
      "生成纪要": "議事録を生成",
      "更多": "その他",
      "会议纪要": "議事録",
      "新建会议": "新しい会議",
      "已生成纪要": "議事録生成済み",
      "完成": "完了",
      "生成": "生成",
      "重新生成": "再生成",
      "笔记已达 20000 字符上限，超出部分未保存。": "メモは 20,000 文字までです。超過分は保存されませんでした。",
      "编辑": "編集",
      "搜索会议…": "会議を検索…",
      "复制会议纪要": "議事録をコピー",
      "已连接": "接続済み",
      "未就绪": "未準備",
      "需要麦克风权限": "マイクのアクセス許可が必要です",
      "标准模式": "標準モード",
      "我的笔记": "私のメモ",
      "展开字幕": "字幕を拡大",
      "返回笔记": "メモに戻る",
      "预览": "プレビュー",
      "记录笔记（支持 Markdown）": "ここにメモを記録（Markdown 対応）",
      "纪要生成失败：模型未返回有效内容，请稍后重试。": "議事録の生成に失敗しました：モデルが内容を返しませんでした。後でもう一度お試しください。",
      "富文本": "リッチテキスト",
      "加粗": "太字",
      "斜体": "斜体",
      "标题 1": "見出し 1",
      "标题 2": "見出し 2",
      "标题 3": "見出し 3",
      "列表": "リスト",
      "编号列表": "番号付きリスト",
      "引用": "引用",
      "插入链接": "リンクを挿入",
      "插入图片": "画像を挿入",
      "行内代码": "インラインコード",
      "代码": "コード",
      "会议总结": "会議の要約",
      "管理会议总结": "会議の要約を管理",
      "AI 笔记与会议总结": "AI メモと会議要約",
      "配置用于生成会议总结和 AI 笔记的服务。所有配置信息仅保存在本地，不会上传。": "会議要約と AI メモに使うサービスを設定します。設定はこの端末だけに保存されます。",
      "配置 AI 笔记与会议总结": "AI メモと会議要約を設定",
      "管理语言识别模型的下载、删除与版本信息。": "音声認識モデルのダウンロード、削除、バージョン情報を管理します。",
      "VAD 模型": "VAD モデル",
      "查看完整内容": "すべて表示",
      "会议人数": "会議の人数",
      "继续精修": "高精度化を続ける",
      "留空自动识别": "空欄なら自動検出",
      "选择导出格式": "エクスポート形式を選択",
      "播放进度": "再生位置",
      "暂停播放": "再生を一時停止",
      "关闭播放": "再生を閉じる",
      "清空搜索": "検索をクリア",
      "搜索结果": "検索結果",
      "最近会议": "最近の会議",
      "展开会议纪要": "議事録を展開",
      "请求建议": "提案をリクエスト",
      "还没有下载内置 AI 模型。": "内蔵 AI モデルがまだダウンロードされていません。",
      "本次会议无法生成实时字幕": "この会議ではリアルタイム字幕を生成できません",
      "识别模型未能加载，录音仍在正常保存。会议结束后可在详情页生成完整逐字稿。": "認識モデルを読み込めませんでした。録音はそのまま保存されており、終了後に会議の詳細から完全な文字起こしを生成できます。",
      "实时字幕模型": "ライブ字幕モデル",
      "说话人分离模型": "話者分離モデル",
      "会后精修模型": "会議後の高精度化モデル",
      "模型与设置": "モデルと設定",
      "实时识别模型": "リアルタイム認識モデル",
      "精修模型": "高精度化モデル",
      "从文件夹打开": "フォルダで開く",
      "清空数据": "データを消去",
      "此操作不可恢复。": "この操作は元に戻せません。",
      "已清空": "データを消去しました",
      "未找到录音文件": "録音ファイルが見つかりません",
      "未找到模型文件": "モデルファイルが見つかりません",
      "需要下载以下模型": "次のモデルをダウンロードしてください：",
      "模型下载队列": "モデルダウンロードキュー",
      "下载失败": "ダウンロードに失敗しました。接続を確認してください。",
      "重试": "再試行",
      "正在下载会议所需模型，完成后会自动开始录制": "会議に必要なモデルをダウンロード中です。完了すると自動的に録音を開始します。",
      "正在下载模型，完成后会自动切换": "モデルをダウンロード中です。完了すると自動的に切り替わります。",
      "当前系统不支持直接录制系统音频，请仅使用麦克风": "このシステムではシステム音声を直接録音できません。マイクのみを使用してください。",
      "预期说话人数": "想定する話者数",
      "留空自动匹配": "空欄で自動選択",
      "工作区": "ワークスペース",
      "自动匹配": "自動選択",
      "音量": "音量",
      "请先在\"模型与设置\"中选择译文目标语言": "先に「モデルと設定」で翻訳先の言語を選択してください。",
      "未知工作区": "不明なワークスペース",
      "工作区会议": "ワークスペースの会議",
      "创建一个新的工作区来组织会议": "会議を整理する新しいワークスペースを作成します。",
      "工作区名称": "ワークスペース名",
      "描述": "説明",
      "（可选）": "（任意）",
      "创建工作区": "ワークスペースを作成",
      "工作区已创建": "ワークスペースを作成しました",
      "编辑工作区": "ワークスペースを編集",
      "保存更改": "変更を保存",
      "删除工作区": "ワークスペースを削除",
      "工作区内的会议将移至最近删除。恢复会议时将还原原工作区。此操作不能撤销。": "このワークスペースの会議は最近削除した項目に移動します。復元すると元のワークスペースも復元されます。この操作は取り消せません。",
      "工作区已删除": "ワークスペースを削除しました",
      "工作区已更新": "ワークスペースを更新しました",
      "调整识别、端点检测、说话人分离和本地模型运行参数。": "認識、終端検出、話者分離、ローカルモデルの実行パラメーターを調整します。",
      "下载": "ダウンロード",
      "下载中": "ダウンロード中",
      "内置": "内蔵",
      "查看录音": "録音を表示",
      "收起": "折りたたむ",
      "选择录音并添加": "録音を選択して追加",
      "播放录音": "録音を再生",
      "已复制到剪贴板": "クリップボードにコピーしました",
      "暂无可分享的内容": "共有できる内容がまだありません",
      "进阶设置": "詳細設定",
      "配置进阶设置": "詳細設定を構成",
      "恢复默认": "既定値に戻す",
      "确定": "確認",
      "已保存": "保存しました",
      "标记说话人": "話者を割り当て",
      "选择已注册声纹或新建说话人。": "登録済みの声紋を選択するか、話者を新規作成します。",
      "已注册声纹": "登録済みの声紋",
      "新建说话人": "新しい話者",
      "说话人名称": "話者名",
      "可修改模型、端点静音、说话人分离及 sherpa-onnx 运行参数。": "モデル、終端の無音、話者分離、sherpa-onnx の実行パラメーターを設定します。",
      "修改后会立即应用于下一次会议与精修。": "変更は次回の会議と高精度化に適用されます。",
      "添加录音到声纹库": "録音を声紋に追加",
      "暂无已注册声纹": "登録済みの声紋はありません",
      "已添加录音到声纹库": "録音を声紋に追加しました",
      "新增声纹": "声紋を作成",
      "声纹名称": "声紋名",
      "已创建声纹并添加录音": "声紋を作成し録音を追加しました",
      "确认": "確認",
      "重叠说话": "発話の重なり",
      "请先选择或填写纪要模型。": "まず要約モデルを選択または入力してください。",
      "请填写请求地址。": "リクエスト URL を入力してください。",
      "请填写 API Key。": "API キーを入力してください。",
      "纪要模型已保存": "要約モデルを保存しました",
      "主导航": "メインナビゲーション",
      "Brevia 首页": "Brevia ホーム",
      "在 GitHub 上查看 Brevia": "GitHub で Brevia を見る",
      "对齐音频": "音声を整列中",
      "准备精修": "高精度化を準備中",
      "分析说话人": "話者を分析中",
      "转写中": "文字起こし中",
      "整理结果": "結果を整理中",
      "未检测到麦克风设备，请在系统设置中开启麦克风访问权限": "マイクが検出されませんでした。システム設定でマイクへのアクセスを許可してください。",
      "麦克风访问被拒绝，请在系统设置中允许应用使用麦克风后重试": "マイクへのアクセスが拒否されました。システム設定でアプリのマイク使用を許可してから再試行してください。",
      "麦克风被其他程序占用，请关闭占用麦克风的程序后重试": "マイクが他のプログラムで使用されています。使用中のプログラムを閉じてから再試行してください。",
      "无法获取麦克风": "マイクを取得できません",
      "无法获取系统音频，请检查系统权限后重试": "システム音声を取得できません。システムの権限を確認して再試行してください。",
      "未检测到系统音频，请在系统设置中允许屏幕与系统音频录制后重试": "システム音声が検出されませんでした。システム設定で画面とシステム音声の録音を許可してから再試行してください。",
      "麦克风没有可用的音频轨道": "マイクに利用可能な音声トラックがありません",
      "至少选择一个音频输入": "少なくとも 1 つの音声入力を選択してください",
      "系统音频未产生音频数据": "システム音声から音声データが生成されませんでした",
      "麦克风未产生音频数据": "マイクから音声データが生成されませんでした",
      "笔记已达容量上限，超出部分未保存。": "メモが容量上限に達したため、超過分は保存されませんでした。",
      "加入笔记": "メモに追加",
      "标记当前时间点": "現在時刻を記録",
      "已加入笔记": "メモに追加しました",
      "暂无字幕可插入": "追加できる字幕はまだありません",
      "无法获取字幕内容": "字幕テキストを取得できません",
      "数字": "数字",
      "日期": "日付",
      "问句": "質問",
      "可能是一个结论": "結論かも",
      "可能的决策": "決定かも",
      "可能的待办": "ToDo かも",
      "重要数字": "重要な数字",
      "重要日期": "重要な日付",
      "待确认事项": "要確認",
      "可能的风险": "リスクかも",
      "新话题": "新しい議題",
      "补充": "補足",
      "忽略": "無視",
      "1 条建议": "1 件の提案",
      "AI 检测到新话题：": "AI が新しい議題を検出：",
      "整理笔记": "メモを整理",
      "校对": "校正",
      "关联历史": "関連履歴",
      "整理一下？": "整理しますか？",
      "替换原内容": "置き換え",
      "插入整理版": "整理版を挿入",
      "修正": "修正",
      "保持原文": "原文のまま",
      "查看原会议": "元の会議を開く",
      "和之前内容有关": "以前の内容に関連",
      "和会议原文可能存在差异": "会議の原文と異なる可能性",
      "字幕中说的是：": "字幕では：",
      "问 AI": "AI に質問",
      "问当前会议": "この会議について質問",
      "输入你的问题": "質問を入力",
      "提问": "質問する",
      "搜索字幕…": "字幕を検索…",
      "重点": "重要",
      "插入表格": "表を挿入",
      "切换到富文本": "リッチテキストに切替",
      "切换到 Markdown": "Markdown に切替",
      "列 1": "列 1",
      "列 2": "列 2",
      "内容": "内容",
      "重点：": "重点：",
      "原始转写": "原文の文字起こし",
      "列 {n}": "列 {n}",
      "选择行列数": "表のサイズを選択",
      "行数": "行数",
      "列数": "列数",
      "插入": "挿入",
      "已暂停": "一時停止中",
      "系统默认": "システム既定",
      "麦克风设备": "マイク",
      "刷新设备": "デバイスを更新",
      "导出会议资料": "会議ファイルを書き出す",
      "笔记": "メモ",
      "会议录音": "会議録音",
      "混音录音": "ミックス録音",
      "传送到应用": "アプリに送る",
      "在文件夹中显示": "フォルダに表示",
      "暂无笔记可导出": "書き出すメモがありません",
      "查找": "検索",
      "替换为": "置換後",
      "上一个": "前へ",
      "下一个": "次へ",
      "全部替换": "すべて置換",
      "导出与分享": "エクスポートと共有",
      "请先选择要导出的内容": "先に書き出す内容を選択してください",
      "依据 {count} 段字幕": "{count} 件の字幕に基づく",
      "图片必须是 PNG、JPEG、GIF 或 WebP，且不超过 10 MB。": "画像は PNG、JPEG、GIF、WebP のいずれかで、10 MB 未満にしてください。",
      "未找到匹配的会议": "一致する会議がありません",
      "{count} 条结果": "{count} 件の結果",
      "标题匹配": "タイトル一致",
      "搜索会议、字幕或说话人…": "会議・字幕・話者を検索…",
      "该会议已有逐句修改。用新模型重新精修会按新模型重新分段，这些修改可能无法保留。": "この会議には文単位の編集があります。別のモデルで再精修すると再分割されるため、その編集は保持されない可能性があります。",
      "开始精修": "精修を開始",
      "录制方式": "録音モード",
      "自动（记住上次）": "自動（前回を記憶）",
      "仅麦克风": "マイクのみ",
      "仅系统音频": "システム音声のみ",
      "麦克风 + 系统音频": "マイク + システム音声",
      "适合线下会议场景": "対面会議向け",
      "适合网课、视频场景": "授業・動画向け",
      "适合线上会议场景": "オンライン会議向け",
      "录制来源": "録音ソース",
      "采集模式": "収音モード",
      "沿用上次成功录制的方式": "前回正常に録音した方式を使用",
      "未启用": "未使用",
      "多语言混说": "複数言語",
      "翻译": "翻訳",
      "正在翻译字幕": "字幕を翻訳中",
      "字幕文本": "字幕テキスト",
      "字幕已保存": "字幕を保存しました",
      "字幕内容不能为空": "字幕テキストを空にはできません",
      "保存失败": "保存に失敗しました",
      "占用": "ディスク",
      "内存": "メモリ",
      "随应用安装": "同梱",
      "必需": "必須",
      "磁盘空间不足，请先清理空间再下载。": "ディスクの空き容量が足りません。空きを作ってから再試行してください。",
      "文件校验未通过，下载可能已损坏，请删除后重试。": "ファイル検証に失敗しました。破損の可能性があるため削除して再試行してください。",
      "网络中断导致下载失败，请检查网络后重试。": "通信が中断されました。接続を確認して再試行してください。",
      "模型不可用，请刷新模型库后重试。": "このモデルは利用できません。モデルライブラリを開き直してください。",
      "已安装": "インストール済み",
      "后退 15 秒": "15 秒戻る",
      "前进 15 秒": "15 秒進む",
      "请选择空文件夹。": "空のフォルダーを選択してください。",
      "请先结束会议、精修和模型下载，再更改文件夹。": "会議、精修、モデルのダウンロードを終了してから保存先を変更してください。",
      "模型和录音文件夹必须相互独立，且不能包含原数据文件夹。": "モデルと録音のフォルダーは互いに独立し、既存のデータフォルダーを含まない場所にしてください。",
      "此文件夹由环境变量指定，无法在应用内更改。": "このフォルダーは環境変数で指定されているため、アプリでは変更できません。",
      "文件夹更改失败，请检查路径、磁盘连接和写入权限。": "フォルダーを変更できませんでした。パス、ドライブの接続、書き込み権限を確認してください。",
      "error.operation_failed": "操作に失敗しました。もう一度お試しください。",
      "error.audio_backpressure": "音声処理が遅れています。録音を停止し、取得済みの音声を保存します。",
      "error.worker_exited": "文字起こしプロセスが終了しました。",
      "error.worker_recovery": "録音はローカルに保存されていますが、文字起こしを復旧できませんでした。",
      "error.storage_recovery": "データフォルダーの復旧が必要です",
      "error.storage_recovery_hint": "ストレージと設定ファイルを確認してください。元のデータと移行ログは保持されています。修復後、Brevia を再起動してください。",
      "error.storage_unavailable": "データフォルダーを利用できません。ストレージを接続し、Brevia を再起動してください。",
      "error.summary.no_transcript": "会議を文字起こししてから会議メモを生成してください。",
      "error.voice_sample_owned": "この録音はすでに別の声紋に登録されています。",
      "error.voice_sample_short": "録音が短すぎます。長い音声サンプルを選んでください。",
      "error.audio_not_found": "録音ファイルが見つかりません。ファイルを確認してください。",
      "error.audio_too_long": "録音がこの操作の時間制限を超えています。短い録音を選んでください。",
      "error.refinement.no_audio": "この会議には精修できる録音がありません。",
      "error.tasks.running": "バックグラウンド処理が終了するまでお待ちください。",
      "error.meeting.active": "現在の会議を終了してください。",
      "error.sharing_not_confirmed": "文字起こしの共有を確認してください。",
      "error.segment_not_found": "字幕が見つかりません。更新して再試行してください。",
      "error.command_too_large": "内容が上限を超えています。減らして再試行してください。",
      "error.summary.failed": "会議メモを生成できませんでした。設定を確認するか、後で再試行してください。",
      "error.timeout": "操作がタイムアウトしました。もう一度お試しください。",
      "error.summary.live_meeting": "ライブ会議中です。終了後に会議メモを生成できます。",
      "error.summary.empty_response": "議事録の生成に失敗しました：モデルが内容を返しませんでした。後でもう一度お試しください。",
      "error.summary.authentication": "API キーが未設定、無効、またはこのプロバイダーで拒否されています。"
    },
    "messages": {
      "recordingSaved": "録音を保存しました。文字起こしを準備しています。",
      "located": "該当する音声位置に移動しました",
      "playing": "ミックス音声を再生中",
      "paused": "再生を一時停止しました"
    }
  },
  "ko": {
    "views": {
      "home": "모든 회의",
      "prepare": "녹음 준비",
      "live": "녹음 중",
      "detail": "회의 세부 정보",
      "settings": "설정"
    },
    "labels": {
      "所有会议": "모든 회의",
      "最近删除": "최근 삭제됨",
      "设置": "설정",
      "开始会议": "회의 시작",
      "会议库": "회의 라이브러리",
      "准备录制": "녹음 준비",
      "实时字幕": "실시간 자막",
      "会议详情": "회의 세부 정보",
      "本地优先": "로컬 우선",
      "音频与文本仅保存在此设备": "오디오와 텍스트는 이 기기에만 저장됩니다",
      "每一场对话，都留有依据。": "모든 대화를 확인 가능한 기록으로.",
      "录音、逐字稿和纪要只在你明确操作时导出或发送。": "녹음, 전사 및 회의록은 사용자가 직접 선택할 때만 내보내거나 전송됩니다.",
      "搜索会议、逐字稿或标签": "회의, 녹취 또는 태그 검색",
      "所有分类": "모든 분류",
      "最近 30 天": "최근 30일",
      "返回会议库": "라이브러리로 돌아가기",
      "开始一场会议": "회의 시작",
      "先确认语言与音频输入。模型会在开始前加载，录制过程不会因网络状态中断。": "먼저 언어와 오디오 입력을 확인하세요. 모델은 녹음 전에 로드되며 네트워크 상태와 관계없이 녹음할 수 있습니다.",
      "录制音频": "오디오 녹음",
      "会议名称": "회의 이름",
      "会议语言": "회의 언어",
      "译文目标": "번역 대상",
      "我的麦克风": "내 마이크",
      "系统音频": "시스템 오디오",
      "输入良好": "입력 양호",
      "已就绪": "준비됨",
      "当前模型": "현재 모델",
      "中文确认文本与说话人分离": "중국어 최종 전사 및 화자 분리",
      "管理模型与术语": "모델 및 용어 관리",
      "正在录制": "녹음 중",
      "暂停": "일시 정지",
      "继续": "계속",
      "结束会议": "회의 종료",
      "保持在当下": "대화에 집중하세요",
      "译文: 开": "번역: 켜짐",
      "译文: 关": "번역: 꺼짐",
      "回到最新": "최신으로 돌아가기",
      "参与者": "참가자",
      "本场状态": "세션 상태",
      "我": "나",
      "麦克风": "마이크",
      "打开会议面板": "회의 패널 열기",
      "导出": "내보내기",
      "逐字稿": "녹취",
      "摘要": "요약",
      "纪要与待办": "회의록 및 할 일",
      "播放此段": "재생",
      "生成完整会议纪要": "회의록 생성",
      "模型与本地数据": "모델 및 로컬 데이터",
      "已安装模型": "설치된 모델",
      "术语库": "용어집",
      "12 个词条可用于会议准备、搜索和纪要。仅支持的模型会将其用于转写。": "12개 용어를 회의 준비, 검색 및 회의록에 사용할 수 있습니다. 지원하는 모델만 전사에 사용합니다.",
      "管理术语库": "용어집 관리",
      "存储与隐私": "저장 공간 및 개인정보",
      "会议资料保存在此 Mac。外部 LLM 需要在发送逐字稿前明确确认。": "회의 데이터는 이 Mac에 저장됩니다. 외부 LLM 전송 전 명시적 확인이 필요합니다.",
      "查看本地存储": "로컬 저장 공간 보기",
      "中文": "중국어",
      "英语": "영어",
      "不需要翻译": "번역 안 함",
      "自动 · 仅麦克风": "자동 · 마이크만",
      "自动 · 仅系统音频": "자동 · 시스템 오디오만",
      "自动音源": "자동 소스",
      "自动检测": "자동 감지",
      "切换语言": "언어 전환",
      "切换主题": "테마 전환",
      "Brevia": "Brevia",
      "向量数据库": "벡터 데이터베이스",
      "ERes2Net": "ERes2Net",
      "最小化": "최소화",
      "关闭": "닫기",
      "取消": "취소",
      "返回": "뒤로",
      "开始录制": "녹음 시작",
      "继续会议": "회의 재개",
      "我 · 麦克风": "나 · 마이크",
      "计算设备": "연산 장치",
      "预计空间": "예상 저장 공간",
      "识别模型": "인식 모델",
      "已应用术语": "적용된 용어",
      "12 个词条": "용어 12개",
      "可用": "사용 가능",
      "已完成精修": "교정 완료",
      "中文确认文本 · 1.2 GB": "중국어 최종 전사 · 1.2 GB",
      "英文与其他语言 · 466 MB": "영어 및 기타 언어 · 466 MB",
      "+ 9": "+ 9",
      "模型库": "모델 라이브러리",
      "管理模型库": "모델 라이브러리 관리",
      "纪要模型": "요약 모델",
      "配置用于生成会议纪要的 API。所有配置信息仅保存在本地，不会上传。": "회의록 생성 API를 설정합니다. 모든 설정은 로컬에만 저장됩니다.",
      "管理纪要模型": "요약 모델 관리",
      "总结提示词": "요약 프롬프트",
      "编辑提示词": "프롬프트 편집",
      "配置 JSON": "구성 JSON",
      "当前启用的纪要模型配置。": "현재 활성화된 회의록 모델 구성입니다.",
      "分钟": "분",
      "本地录音": "로컬 녹음",
      "本地保存": "로컬에 저장됨",
      "本地会议": "로컬 회의",
      "检查音频": "오디오 확인 중",
      "检测语音": "음성 감지 중",
      "识别说话人": "화자 식별 중",
      "重新聚类说话人": "화자 재클러스터링 중",
      "匹配声纹": "음성 지문 대조 중",
      "整理说话人": "화자 타임라인 준비 중",
      "← 返回会议库": "← 라이브러리로 돌아가기",
      "说话人分离": "화자 분리",
      "自定义术语": "사용자 지정 용어",
      "暂无术语": "용어 없음",
      "说话人": "화자",
      "等待识别说话人": "화자 인식 대기 중",
      "会议摘要": "회의 요약",
      "尚未生成会议摘要": "아직 회의 요약이 없습니다",
      "转发": "공유",
      "会后精修": "회의 후 정제",
      "精修": "정교화",
      "精修字稿": "교정된 전사",
      "完成精修后，这里会显示不带时间戳的校对稿。": "교정이 완료되면 타임스탬프 없는 교정본이 여기에 표시됩니다.",
      "正在精修…": "교정 중…",
      "会后精修已完成": "회의 후 교정이 완료되었습니다",
      "已整理": "완료",
      "决定": "결정",
      "待办": "할 일",
      "悬浮字幕": "플로팅 자막",
      "悬浮字幕：开": "플로팅 자막: 켜짐",
      "⌖ 开": "⌖ 켜짐",
      "最近 7 天": "최근 7일",
      "最近 90 天": "최근 90일",
      "全部时间": "전체 기간",
      "系统默认麦克风": "시스템 기본 마이크",
      "需要授予屏幕与系统音频权限": "화면 및 시스템 오디오 권한이 필요합니다",
      "中文 / 英语": "중국어 / 영어",
      "更多操作": "추가 작업",
      "恢复": "복원",
      "重命名": "이름 바꾸기",
      "删除": "삭제",
      "保存": "저장",
      "添加": "추가",
      "公开工作区": "공개 작업 공간",
      "导入录音": "녹음 가져오기",
      "语音对话": "음성 채팅",
      "请先在声纹库注册可用声音": "음성을 보내기 전에 음성 지문을 등록하세요",
      "录制权限": "녹음 권한",
      "首次使用时完成设置": "처음 사용할 때 설정 완료",
      "录制你的发言。": "내 발화를 녹음합니다.",
      "录制屏幕共享中的系统声音。": "화면 공유의 시스템 오디오를 녹음합니다.",
      "稍后": "나중에",
      "言录需要以下系统权限以提供服务": "Brevia 서비스를 제공하려면 다음 시스템 권한이 필요합니다.",
      "应用设置": "앱 설정",
      "纪要不能为空": "회의 메모는 비워 둘 수 없습니다.",
      "当前没有正在进行的会议": "진행 중인 회의가 없습니다.",
      "移至工作区": "작업 공간으로 이동",
      "已移至": "이동됨",
      "展开": "펼치기",
      "屏幕与系统音频": "화면 및 시스템 오디오",
      "允许": "허용",
      "已允许": "허용됨",
      "请在系统设置中允许": "시스템 설정에서 Brevia의 화면 및 시스템 오디오 접근을 허용하세요.",
      "已准备就绪": "준비됨",
      "系统权限": "시스템 권한",
      "打开系统设置": "시스템 설정 열기",
      "请在系统设置中开启此权限": "거부됨. 시스템 설정에서 이 권한을 허용하세요.",
      "结束中": "회의 종료 중",
      "正在精修": "정교화 중",
      "原版逐字稿仍可查看": "원본 녹취는 계속 볼 수 있습니다",
      "准备中": "준비 중",
      "全选": "전체 선택",
      "取消全选": "전체 해제",
      "校正说话人": "화자 보정 중",
      "正在取消": "취소 중",
      "软件更新": "소프트웨어 업데이트",
      "检查更新": "업데이트 확인",
      "会议纪要已生成": "회의록이 생성되었습니다",
      "正在播放": "재생 중",
      "操作失败": "작업에 실패했습니다",
      "应用错误": "애플리케이션 오류",
      "会后精修失败": "회의 후 정제에 실패했습니다",
      "发现可恢复录音": "복구 가능한 녹음 {count}개를 찾았습니다",
      "离线功能": "오프라인 기능",
      "请选择声音": "먼저 음성을 선택하세요",
      "请先配置翻译模型": "먼저 번역 모델을 구성하세요",
      "纪要服务拒绝了请求": "요약 공급자가 요청을 거부했습니다",
      "纪要模型需要配置": "요약 모델을 구성하세요",
      "请检查 API 地址、密钥和服务商访问策略。": "API URL, 키 및 공급자의 접근 정책을 확인하세요.",
      "API Key 未配置、已失效或不匹配当前服务。": "API 키가 없거나 유효하지 않거나 이 공급자에서 거부되었습니다.",
      "配置纪要模型": "모델 구성",
      "内置纪要模型未配置": "내장 요약 모델이 구성되지 않았습니다",
      "请选择并下载一个内置纪要模型，之后即可完全离线生成纪要。": "내장 요약 모델을 선택하고 다운로드하면 완전히 오프라인으로 회의록을 생성할 수 있습니다.",
      "选择纪要模型": "모델 선택",
      "刚刚": "방금",
      "请先选择译文目标并配置纪要模型": "먼저 번역 대상을 선택하고 요약 모델을 구성하세요",
      "将确认字幕发送到 {provider} 生成译文。是否继续？": "확인된 자막을 {provider}로 보내 번역할까요?",
      "选择格式：md / txt / json / srt / docx / pdf / flac / wav / m4a": "형식 선택: md / txt / json / srt / docx / pdf / flac / wav / m4a",
      "已导出「{title}」": "“{title}”을(를) 내보냈습니다",
      "示例会议及录音已删除": "예시 회의와 녹음을 삭제했습니다",
      "会议已移至最近删除": "회의를 최근 삭제됨으로 옮겼습니다",
      "暂停录音": "녹음 일시 중지",
      "这场会议没有可播放的录音": "이 회의에는 재생 가능한 녹음이 없습니다",
      "纪要配置加载失败": "요약 설정을 불러오지 못했습니다",
      "配置或后端启动失败": "구성 또는 백엔드 시작에 실패했습니다",
      "翻译失败": "번역에 실패했습니다",
      "压缩包已导出": "압축 파일을 내보냈습니다",
      "未找到录音，已导出逐字稿压缩包": "녹음을 찾지 못해 녹취 압축 파일을 내보냈습니다",
      "请前往「设置」>「AI 会议总结」，选择并下载内置纪要模型。": "설정 > AI 회의 요약에서 내장 요약 모델을 선택하고 다운로드하세요.",
      "前往 AI 会议总结": "AI 회의 요약으로 이동",
      "操作超时，请稍后重试": "작업 시간이 초과되었습니다. 다시 시도해 주세요.",
      "实时会议中，结束后再生成会议纪要。": "실시간 회의 중입니다. 종료 후 회의록을 생성하세요.",
      "已有会议纪要正在生成，请稍候。": "다른 회의록을 생성하고 있습니다. 잠시만 기다려 주세요.",
      "字幕": "자막",
      "字幕：开": "자막: 켬",
      "字幕：关": "자막: 끔",
      "新建工作区": "새 작업 공간",
      "翻译：开": "번역: 켬",
      "翻译：关": "번역: 끔",
      "分享": "공유",
      "精修字幕": "자막 정제",
      "已精修": "정제됨",
      "查看原始转写": "원본 전사 보기",
      "查看精修字幕": "정제된 자막 보기",
      "精修全文": "정제된 전문",
      "经过会后模型整理后的完整转写文本。由于当前模型不提供时间戳，该版本不支持逐句音频定位。": "회의 후 모델이 정리한 연속 전사 텍스트입니다. 이 모델은 타임스탬프를 제공하지 않으므로 문장별 오디오 위치 이동을 지원하지 않습니다.",
      "会议中没有记录笔记。": "회의 중 메모가 없습니다.",
      "位参与者": "명 참가자",
      "重新精修": "다시 정제",
      "更换精修模型": "정제 모델 변경",
      "尚未生成": "아직 생성 안 됨",
      "生成纪要": "회의록 생성",
      "更多": "더 보기",
      "会议纪要": "회의록",
      "新建会议": "새 회의",
      "已生成纪要": "회의록 생성됨",
      "完成": "완료",
      "生成": "생성",
      "重新生成": "다시 생성",
      "笔记已达 20000 字符上限，超出部分未保存。": "메모는 20,000자로 제한됩니다. 초과분은 저장되지 않았습니다.",
      "编辑": "편집",
      "搜索会议…": "회의 검색…",
      "复制会议纪要": "회의록 복사",
      "已连接": "연결됨",
      "未就绪": "준비 안 됨",
      "需要麦克风权限": "마이크 권한이 필요합니다",
      "标准模式": "표준 모드",
      "我的笔记": "내 메모",
      "展开字幕": "자막 확대",
      "返回笔记": "메모로 돌아가기",
      "预览": "미리 보기",
      "记录笔记（支持 Markdown）": "여기에 메모를 작성하세요. Markdown 지원",
      "纪要生成失败：模型未返回有效内容，请稍后重试。": "회의록 생성 실패: 모델이 내용을 반환하지 않았습니다. 잠시 후 다시 시도하세요.",
      "富文本": "리치 텍스트",
      "加粗": "굵게",
      "斜体": "기울임",
      "标题 1": "제목 1",
      "标题 2": "제목 2",
      "标题 3": "제목 3",
      "列表": "목록",
      "编号列表": "번호 목록",
      "引用": "인용",
      "插入链接": "링크 삽입",
      "插入图片": "이미지 삽입",
      "行内代码": "인라인 코드",
      "代码": "코드",
      "会议总结": "회의 요약",
      "管理会议总结": "회의 요약 관리",
      "AI 笔记与会议总结": "AI 메모 및 회의 요약",
      "配置用于生成会议总结和 AI 笔记的服务。所有配置信息仅保存在本地，不会上传。": "회의 요약과 AI 메모에 사용할 서비스를 구성합니다. 모든 설정은 이 기기에만 저장됩니다.",
      "配置 AI 笔记与会议总结": "AI 메모 및 회의 요약 구성",
      "管理语言识别模型的下载、删除与版本信息。": "음성 인식 모델의 다운로드, 삭제 및 버전 정보를 관리합니다.",
      "VAD 模型": "VAD 모델",
      "查看完整内容": "전체 내용 보기",
      "会议人数": "회의 참석자 수",
      "继续精修": "정제 계속",
      "留空自动识别": "비워 두면 자동 감지",
      "选择导出格式": "내보내기 형식 선택",
      "播放进度": "재생 진행률",
      "暂停播放": "재생 일시정지",
      "关闭播放": "재생 닫기",
      "清空搜索": "검색 지우기",
      "搜索结果": "검색 결과",
      "最近会议": "최근 회의",
      "展开会议纪要": "회의록 펼치기",
      "请求建议": "제안 요청",
      "还没有下载内置 AI 模型。": "아직 내려받은 내장 AI 모델이 없습니다.",
      "本次会议无法生成实时字幕": "이 회의에서는 실시간 자막을 만들 수 없습니다",
      "识别模型未能加载，录音仍在正常保存。会议结束后可在详情页生成完整逐字稿。": "인식 모델을 불러오지 못했습니다. 녹음은 계속 저장되며, 회의가 끝난 뒤 상세 화면에서 전체 녹취를 생성할 수 있습니다.",
      "实时字幕模型": "실시간 자막 모델",
      "说话人分离模型": "화자 분리 모델",
      "会后精修模型": "회의 후 정제 모델",
      "模型与设置": "모델 및 설정",
      "实时识别模型": "실시간 인식 모델",
      "精修模型": "정제 모델",
      "从文件夹打开": "폴더에서 열기",
      "清空数据": "데이터 지우기",
      "此操作不可恢复。": "이 작업은 되돌릴 수 없습니다.",
      "已清空": "데이터가 지워졌습니다",
      "未找到录音文件": "녹음 파일을 찾을 수 없습니다",
      "未找到模型文件": "모델 파일을 찾을 수 없습니다",
      "需要下载以下模型": "필요한 모델을 다운로드하세요:",
      "模型下载队列": "모델 다운로드 대기열",
      "下载失败": "다운로드에 실패했습니다. 연결을 확인하세요.",
      "重试": "다시 시도",
      "正在下载会议所需模型，完成后会自动开始录制": "회의에 필요한 모델을 다운로드하는 중입니다. 완료되면 자동으로 녹음을 시작합니다.",
      "正在下载模型，完成后会自动切换": "모델을 다운로드하는 중입니다. 완료되면 자동으로 전환됩니다.",
      "当前系统不支持直接录制系统音频，请仅使用麦克风": "이 시스템에서는 시스템 오디오를 직접 녹음할 수 없습니다. 마이크만 사용하세요.",
      "预期说话人数": "예상 화자 수",
      "留空自动匹配": "비워 두면 자동 선택",
      "工作区": "작업 공간",
      "自动匹配": "자동 선택",
      "音量": "볼륨",
      "请先在\"模型与设置\"中选择译文目标语言": "먼저 “모델 및 설정”에서 번역 대상 언어를 선택하세요.",
      "未知工作区": "알 수 없는 작업 공간",
      "工作区会议": "작업 공간 회의",
      "创建一个新的工作区来组织会议": "회의를 정리할 새 작업 공간을 만드세요.",
      "工作区名称": "작업 공간 이름",
      "描述": "설명",
      "（可选）": "(선택 사항)",
      "创建工作区": "작업 공간 만들기",
      "工作区已创建": "작업 공간을 만들었습니다",
      "编辑工作区": "작업 공간 편집",
      "保存更改": "변경 사항 저장",
      "删除工作区": "작업 공간 삭제",
      "工作区内的会议将移至最近删除。恢复会议时将还原原工作区。此操作不能撤销。": "이 작업 공간의 회의는 최근 삭제됨으로 이동합니다. 회의를 복원하면 원래 작업 공간도 복원됩니다. 이 작업은 취소할 수 없습니다.",
      "工作区已删除": "작업 공간을 삭제했습니다",
      "工作区已更新": "작업 공간을 업데이트했습니다",
      "调整识别、端点检测、说话人分离和本地模型运行参数。": "인식, 종점 감지, 화자 분리 및 로컬 모델 실행 매개변수를 조정합니다.",
      "下载": "다운로드",
      "下载中": "다운로드 중",
      "内置": "내장",
      "查看录音": "녹음 보기",
      "收起": "접기",
      "选择录音并添加": "녹음 선택 및 추가",
      "播放录音": "녹음 재생",
      "已复制到剪贴板": "클립보드에 복사했습니다",
      "暂无可分享的内容": "아직 공유할 내용이 없습니다",
      "进阶设置": "고급 설정",
      "配置进阶设置": "고급 설정 구성",
      "恢复默认": "기본값 복원",
      "确定": "확인",
      "已保存": "저장됨",
      "标记说话人": "화자 지정",
      "选择已注册声纹或新建说话人。": "등록된 음성 지문을 선택하거나 화자를 새로 만드세요.",
      "已注册声纹": "등록된 음성 지문",
      "新建说话人": "새 화자",
      "说话人名称": "화자 이름",
      "可修改模型、端点静音、说话人分离及 sherpa-onnx 运行参数。": "모델, 종점 무음, 화자 분리 및 sherpa-onnx 실행 매개변수를 구성합니다.",
      "修改后会立即应用于下一次会议与精修。": "변경 사항은 다음 회의와 정교화에 적용됩니다.",
      "添加录音到声纹库": "음성 지문에 녹음 추가",
      "暂无已注册声纹": "등록된 음성 지문이 없습니다",
      "已添加录音到声纹库": "녹음이 음성 지문에 추가되었습니다",
      "新增声纹": "음성 지문 만들기",
      "声纹名称": "음성 지문 이름",
      "已创建声纹并添加录音": "음성 지문을 만들고 녹음을 추가했습니다",
      "确认": "확인",
      "重叠说话": "중첩 발화",
      "请先选择或填写纪要模型。": "먼저 요약 모델을 선택하거나 입력하세요.",
      "请填写请求地址。": "요청 URL을 입력하세요.",
      "请填写 API Key。": "API 키를 입력하세요.",
      "纪要模型已保存": "요약 모델을 저장했습니다",
      "主导航": "주 탐색",
      "Brevia 首页": "Brevia 홈",
      "在 GitHub 上查看 Brevia": "GitHub에서 Brevia 보기",
      "对齐音频": "오디오 정렬 중",
      "准备精修": "정교화 준비 중",
      "分析说话人": "화자 분석 중",
      "转写中": "전사 중",
      "整理结果": "결과 정리 중",
      "未检测到麦克风设备，请在系统设置中开启麦克风访问权限": "마이크를 감지하지 못했습니다. 시스템 설정에서 마이크 접근을 허용하세요.",
      "麦克风访问被拒绝，请在系统设置中允许应用使用麦克风后重试": "마이크 접근이 거부되었습니다. 시스템 설정에서 앱의 마이크 사용을 허용한 후 다시 시도하세요.",
      "麦克风被其他程序占用，请关闭占用麦克风的程序后重试": "마이크를 다른 프로그램이 사용 중입니다. 해당 프로그램을 닫은 후 다시 시도하세요.",
      "无法获取麦克风": "마이크를 가져올 수 없습니다",
      "无法获取系统音频，请检查系统权限后重试": "시스템 오디오를 가져올 수 없습니다. 시스템 권한을 확인한 후 다시 시도하세요.",
      "未检测到系统音频，请在系统设置中允许屏幕与系统音频录制后重试": "시스템 오디오가 감지되지 않았습니다. 시스템 설정에서 화면 및 시스템 오디오 녹음을 허용한 후 다시 시도하세요.",
      "麦克风没有可用的音频轨道": "마이크에 사용 가능한 오디오 트랙이 없습니다",
      "至少选择一个音频输入": "오디오 입력을 하나 이상 선택하세요",
      "系统音频未产生音频数据": "시스템 오디오에서 오디오 데이터가 생성되지 않았습니다",
      "麦克风未产生音频数据": "마이크에서 오디오 데이터가 생성되지 않았습니다",
      "加入笔记": "메모에 추가",
      "标记当前时间点": "현재 시각 기록",
      "已加入笔记": "메모에 추가됨",
      "暂无字幕可插入": "추가할 자막이 아직 없습니다",
      "无法获取字幕内容": "자막 내용을 가져올 수 없습니다",
      "数字": "숫자",
      "日期": "날짜",
      "问句": "질문",
      "可能是一个结论": "결론일 수 있음",
      "可能的决策": "결정일 수 있음",
      "可能的待办": "할 일일 수 있음",
      "重要数字": "중요 수치",
      "重要日期": "중요 날짜",
      "待确认事项": "확인 필요",
      "可能的风险": "위험일 수 있음",
      "新话题": "새 주제",
      "补充": "보충",
      "忽略": "무시",
      "1 条建议": "제안 1개",
      "AI 检测到新话题：": "AI가 새 주제를 감지: ",
      "整理笔记": "메모 정리",
      "校对": "교정",
      "关联历史": "관련 기록",
      "整理一下？": "정리할까요?",
      "替换原内容": "바꾸기",
      "插入整理版": "정리본 삽입",
      "修正": "수정",
      "保持原文": "원문 유지",
      "查看原会议": "원래 회의 열기",
      "和之前内容有关": "이전 내용과 관련",
      "和会议原文可能存在差异": "회의 원문과 다를 수 있음",
      "字幕中说的是：": "자막 내용:",
      "问 AI": "AI에 묻기",
      "问当前会议": "이 회의에 대해 묻기",
      "输入你的问题": "질문 입력",
      "提问": "묻기",
      "搜索字幕…": "자막 검색…",
      "重点": "중요",
      "插入表格": "표 삽입",
      "切换到富文本": "리치 텍스트로 전환",
      "切换到 Markdown": "Markdown으로 전환",
      "列 1": "열 1",
      "列 2": "열 2",
      "内容": "내용",
      "重点：": "중요: ",
      "原始转写": "원문 전사",
      "列 {n}": "열 {n}",
      "选择行列数": "표 크기 선택",
      "行数": "행 수",
      "列数": "열 수",
      "插入": "삽입",
      "已暂停": "일시정지됨",
      "系统默认": "시스템 기본",
      "麦克风设备": "마이크",
      "刷新设备": "장치 새로고침",
      "笔记已达容量上限，超出部分未保存。": "메모가 용량 한도에 도달해 나머지는 저장되지 않았습니다.",
      "导出会议资料": "회의 파일 내보내기",
      "笔记": "메모",
      "会议录音": "회의 녹음",
      "混音录音": "믹스 녹음",
      "传送到应用": "앱으로 보내기",
      "在文件夹中显示": "폴더에서 보기",
      "暂无笔记可导出": "내보낼 메모가 없습니다",
      "查找": "찾기",
      "替换为": "바꾸기",
      "上一个": "이전",
      "下一个": "다음",
      "全部替换": "모두 바꾸기",
      "导出与分享": "내보내기 및 공유",
      "请先选择要导出的内容": "먼저 내보낼 내용을 선택하세요",
      "依据 {count} 段字幕": "{count}개 자막 기반",
      "图片必须是 PNG、JPEG、GIF 或 WebP，且不超过 10 MB。": "이미지는 PNG, JPEG, GIF 또는 WebP 형식이며 10MB 미만이어야 합니다.",
      "未找到匹配的会议": "일치하는 회의가 없습니다",
      "{count} 条结果": "{count}개 결과",
      "标题匹配": "제목 일치",
      "搜索会议、字幕或说话人…": "회의·자막·화자 검색…",
      "该会议已有逐句修改。用新模型重新精修会按新模型重新分段，这些修改可能无法保留。": "이 회의에는 문장 단위 편집이 있습니다. 다른 모델로 다시 정제하면 다시 분할되므로 해당 편집이 유지되지 않을 수 있습니다.",
      "开始精修": "정교화 시작",
      "录制方式": "녹음 모드",
      "自动（记住上次）": "자동(지난 설정 기억)",
      "仅麦克风": "마이크만",
      "仅系统音频": "시스템 오디오만",
      "麦克风 + 系统音频": "마이크 + 시스템 오디오",
      "适合线下会议场景": "대면 회의용",
      "适合网课、视频场景": "수업·영상용",
      "适合线上会议场景": "온라인 회의용",
      "录制来源": "녹음 소스",
      "采集模式": "수집 모드",
      "沿用上次成功录制的方式": "마지막으로 성공한 녹음 방식 사용",
      "未启用": "사용 안 함",
      "多语言混说": "혼합 언어",
      "翻译": "번역",
      "正在翻译字幕": "자막 번역 중",
      "字幕文本": "자막 텍스트",
      "字幕已保存": "자막을 저장했습니다",
      "字幕内容不能为空": "자막 내용은 비워 둘 수 없습니다",
      "保存失败": "저장하지 못했습니다",
      "占用": "디스크",
      "内存": "메모리",
      "随应用安装": "포함됨",
      "必需": "필수",
      "磁盘空间不足，请先清理空间再下载。": "디스크 공간이 부족합니다. 공간을 확보한 뒤 다시 시도하세요.",
      "文件校验未通过，下载可能已损坏，请删除后重试。": "파일 검증에 실패했습니다. 손상되었을 수 있으니 삭제 후 다시 시도하세요.",
      "网络中断导致下载失败，请检查网络后重试。": "다운로드가 중단되었습니다. 연결을 확인한 뒤 다시 시도하세요.",
      "模型不可用，请刷新模型库后重试。": "이 모델은 사용할 수 없습니다. 모델 라이브러리를 다시 여세요.",
      "已安装": "설치됨",
      "后退 15 秒": "15초 뒤로",
      "前进 15 秒": "15초 앞으로",
      "请选择空文件夹。": "빈 폴더를 선택하세요.",
      "请先结束会议、精修和模型下载，再更改文件夹。": "회의, 정제 및 모델 다운로드를 완료한 후 폴더를 변경하세요.",
      "模型和录音文件夹必须相互独立，且不能包含原数据文件夹。": "모델과 녹음 폴더는 서로 분리되어야 하며 기존 데이터 폴더를 포함할 수 없습니다.",
      "此文件夹由环境变量指定，无法在应用内更改。": "환경 변수로 지정된 폴더는 앱에서 변경할 수 없습니다.",
      "文件夹更改失败，请检查路径、磁盘连接和写入权限。": "폴더를 변경하지 못했습니다. 경로, 드라이브 연결 및 쓰기 권한을 확인하세요.",
      "error.operation_failed": "작업에 실패했습니다. 다시 시도해 주세요.",
      "error.audio_backpressure": "오디오 처리가 지연되어 녹음을 중지합니다. 수집한 오디오는 저장됩니다.",
      "error.worker_exited": "전사 프로세스가 종료되었습니다.",
      "error.worker_recovery": "녹음은 로컬에 저장되어 있지만 전사를 복구하지 못했습니다.",
      "error.storage_recovery": "데이터 폴더 복구 필요",
      "error.storage_recovery_hint": "저장 장치와 설정 파일을 확인하세요. 원본 데이터와 이전 기록은 보존됩니다. 문제를 해결한 후 Brevia를 다시 시작하세요.",
      "error.storage_unavailable": "데이터 폴더를 사용할 수 없습니다. 저장 장치를 연결하고 Brevia를 다시 시작하세요.",
      "error.summary.no_transcript": "회의를 전사한 후 회의록을 생성하세요.",
      "error.voice_sample_owned": "이 녹음은 이미 다른 성문에 등록되어 있습니다.",
      "error.voice_sample_short": "녹음이 너무 짧습니다. 더 긴 음성 샘플을 선택하세요.",
      "error.audio_not_found": "녹음 파일을 찾을 수 없습니다. 파일이 있는지 확인하세요.",
      "error.audio_too_long": "녹음이 이 작업의 길이 제한을 초과했습니다. 더 짧은 녹음을 선택하세요.",
      "error.refinement.no_audio": "이 회의에는 정제할 녹음이 없습니다.",
      "error.tasks.running": "백그라운드 작업이 끝날 때까지 기다려 주세요.",
      "error.meeting.active": "현재 회의를 먼저 종료하세요.",
      "error.sharing_not_confirmed": "먼저 전사문 공유를 확인하세요.",
      "error.segment_not_found": "자막을 찾을 수 없습니다. 새로 고친 후 다시 시도하세요.",
      "error.command_too_large": "내용이 용량 제한을 초과했습니다. 줄인 후 다시 시도하세요.",
      "error.summary.failed": "회의록을 생성하지 못했습니다. 서비스 설정을 확인하거나 나중에 다시 시도하세요.",
      "error.timeout": "작업 시간이 초과되었습니다. 다시 시도해 주세요.",
      "error.summary.live_meeting": "실시간 회의 중입니다. 종료 후 회의록을 생성하세요.",
      "error.summary.empty_response": "회의록 생성 실패: 모델이 내용을 반환하지 않았습니다. 잠시 후 다시 시도하세요.",
      "error.summary.authentication": "API 키가 없거나 유효하지 않거나 이 공급자에서 거부되었습니다."
    },
    "messages": {
      "recordingSaved": "녹음이 저장되었습니다. 녹취를 준비합니다.",
      "located": "연결된 오디오 구간으로 이동했습니다",
      "playing": "믹스 트랙 재생 중",
      "paused": "재생이 일시 정지되었습니다"
    }
  },
  "fr": {
    "views": {
      "home": "Toutes les réunions",
      "prepare": "Préparer la réunion",
      "live": "Enregistrement",
      "detail": "Détails de la réunion",
      "settings": "Paramètres"
    },
    "labels": {
      "所有会议": "Toutes les réunions",
      "最近删除": "Supprimées récemment",
      "设置": "Paramètres",
      "开始会议": "Démarrer la réunion",
      "会议库": "Bibliothèque de réunions",
      "准备录制": "Préparer l’enregistrement",
      "实时字幕": "Transcription en direct",
      "会议详情": "Détails de la réunion",
      "本地优先": "Priorité au local",
      "音频与文本仅保存在此设备": "L’audio et le texte restent sur cet appareil",
      "每一场对话，都留有依据。": "Chaque conversation laisse une trace vérifiable.",
      "录音、逐字稿和纪要只在你明确操作时导出或发送。": "Les enregistrements, transcriptions et notes ne sont exportés ou envoyés que sur votre demande.",
      "搜索会议、逐字稿或标签": "Rechercher des réunions, transcriptions ou étiquettes",
      "所有分类": "Toutes les catégories",
      "最近 30 天": "30 derniers jours",
      "返回会议库": "Retour à la bibliothèque",
      "开始一场会议": "Démarrer une réunion",
      "先确认语言与音频输入。模型会在开始前加载，录制过程不会因网络状态中断。": "Confirmez la langue et la source audio. Le modèle se charge avant l’enregistrement, qui fonctionne sans connexion.",
      "录制音频": "Capture audio",
      "会议名称": "Nom de la réunion",
      "会议语言": "Langue de la réunion",
      "译文目标": "Langue cible",
      "我的麦克风": "Mon microphone",
      "系统音频": "Audio système",
      "输入良好": "Entrée prête",
      "已就绪": "Prêt",
      "当前模型": "Modèle actuel",
      "中文确认文本与说话人分离": "Transcription finale en chinois et séparation des intervenants",
      "管理模型与术语": "Gérer les modèles et les termes",
      "正在录制": "Enregistrement",
      "暂停": "Pause",
      "继续": "Reprendre",
      "结束会议": "Terminer la réunion",
      "保持在当下": "Restez dans la conversation",
      "译文: 开": "Traduction : activée",
      "译文: 关": "Traduction : désactivée",
      "回到最新": "Revenir aux dernières",
      "参与者": "Participants",
      "本场状态": "État de la session",
      "我": "Moi",
      "麦克风": "Microphone",
      "打开会议面板": "Ouvrir le panneau de réunion",
      "导出": "Exporter",
      "逐字稿": "Transcription",
      "摘要": "Résumé",
      "纪要与待办": "Notes et tâches",
      "播放此段": "Lire",
      "生成完整会议纪要": "Générer les notes de réunion",
      "模型与本地数据": "Modèles et données locales",
      "已安装模型": "Modèles installés",
      "术语库": "Glossaire",
      "12 个词条可用于会议准备、搜索和纪要。仅支持的模型会将其用于转写。": "12 termes sont disponibles pour préparer les réunions, rechercher et rédiger les notes. Seuls les modèles compatibles les utilisent pour la transcription.",
      "管理术语库": "Gérer le glossaire",
      "存储与隐私": "Stockage et confidentialité",
      "会议资料保存在此 Mac。外部 LLM 需要在发送逐字稿前明确确认。": "Les données de réunion restent sur ce Mac. Les LLM externes exigent une confirmation explicite.",
      "查看本地存储": "Voir le stockage local",
      "中文": "Chinois",
      "英语": "Anglais",
      "不需要翻译": "Aucune traduction",
      "自动 · 仅麦克风": "Auto · Micro uniquement",
      "自动 · 仅系统音频": "Auto · Audio système uniquement",
      "自动音源": "Source automatique",
      "自动检测": "Détection automatique",
      "切换语言": "Changer de langue",
      "切换主题": "Changer de thème",
      "Brevia": "Brevia",
      "向量数据库": "Base de données vectorielle",
      "ERes2Net": "ERes2Net",
      "最小化": "Réduire",
      "关闭": "Fermer",
      "取消": "Annuler",
      "返回": "Retour",
      "开始录制": "Démarrer l’enregistrement",
      "继续会议": "Reprendre la réunion",
      "我 · 麦克风": "Moi · Microphone",
      "计算设备": "Appareil de calcul",
      "预计空间": "Espace estimé",
      "识别模型": "Modèle de reconnaissance",
      "已应用术语": "Termes appliqués",
      "12 个词条": "12 termes",
      "可用": "Disponible",
      "已完成精修": "Correction terminée",
      "中文确认文本 · 1.2 GB": "Transcription finale en chinois · 1,2 Go",
      "英文与其他语言 · 466 MB": "Anglais et autres langues · 466 Mo",
      "+ 9": "+ 9",
      "模型库": "Bibliothèque de modèles",
      "管理模型库": "Gérer la bibliothèque de modèles",
      "纪要模型": "Modèles de résumé",
      "配置用于生成会议纪要的 API。所有配置信息仅保存在本地，不会上传。": "Configurez les API pour les notes de réunion. Toute la configuration reste locale.",
      "管理纪要模型": "Gérer les modèles de résumé",
      "总结提示词": "Instructions de résumé",
      "编辑提示词": "Modifier les instructions",
      "配置 JSON": "Configuration au format JSON",
      "当前启用的纪要模型配置。": "Configuration du modèle de notes actuellement actif.",
      "分钟": "min",
      "本地录音": "Enregistrement local",
      "本地保存": "Enregistré localement",
      "本地会议": "Réunion locale",
      "检查音频": "Vérification de l’audio",
      "检测语音": "Détection de la parole",
      "识别说话人": "Identification des intervenants",
      "重新聚类说话人": "Regroupement des intervenants",
      "匹配声纹": "Comparaison des empreintes vocales",
      "整理说话人": "Préparation de la chronologie des intervenants",
      "← 返回会议库": "← Retour à la bibliothèque",
      "说话人分离": "Séparation des intervenants",
      "自定义术语": "Terme personnalisé",
      "暂无术语": "Aucun terme",
      "说话人": "Intervenant",
      "等待识别说话人": "Identification de l’intervenant en attente",
      "会议摘要": "Résumé de la réunion",
      "尚未生成会议摘要": "Aucun résumé de réunion",
      "转发": "Partager",
      "会后精修": "Affinage après réunion",
      "精修": "Affiner",
      "精修字稿": "Transcription corrigée",
      "完成精修后，这里会显示不带时间戳的校对稿。": "La transcription corrigée apparaîtra ici sans horodatage une fois terminée.",
      "正在精修…": "Correction en cours…",
      "会后精修已完成": "Correction après réunion terminée",
      "已整理": "Terminé",
      "决定": "Décision",
      "待办": "À faire",
      "悬浮字幕": "Sous-titres flottants",
      "悬浮字幕：开": "Sous-titres flottants : activés",
      "⌖ 开": "⌖ Activé",
      "最近 7 天": "7 derniers jours",
      "最近 90 天": "90 derniers jours",
      "全部时间": "Toute la période",
      "系统默认麦克风": "Microphone système par défaut",
      "需要授予屏幕与系统音频权限": "Autorisation d’écran et d’audio système requise",
      "中文 / 英语": "Chinois / anglais",
      "更多操作": "Plus d’actions",
      "恢复": "Restaurer",
      "重命名": "Renommer",
      "删除": "Supprimer",
      "保存": "Enregistrer",
      "添加": "Ajouter",
      "公开工作区": "Espace de travail public",
      "导入录音": "Importer un enregistrement",
      "语音对话": "Chat vocal",
      "请先在声纹库注册可用声音": "Enregistrez une empreinte vocale avant d’envoyer un message",
      "录制权限": "Autorisations d’enregistrement",
      "首次使用时完成设置": "Terminer la configuration à la première utilisation",
      "录制你的发言。": "Enregistre votre voix.",
      "录制屏幕共享中的系统声音。": "Enregistre l’audio système lors du partage d’écran.",
      "稍后": "Plus tard",
      "言录需要以下系统权限以提供服务": "Brevia a besoin des autorisations système suivantes pour fournir ses services.",
      "应用设置": "Paramètres de l’application",
      "纪要不能为空": "Les notes de réunion ne peuvent pas être vides.",
      "当前没有正在进行的会议": "Aucune réunion n’est en cours.",
      "移至工作区": "Déplacer vers l’espace de travail",
      "已移至": "Déplacé vers",
      "展开": "Développer",
      "屏幕与系统音频": "Écran et audio système",
      "允许": "Autoriser",
      "已允许": "Autorisé",
      "请在系统设置中允许": "Autorisez Brevia à accéder à l’écran et à l’audio système dans Réglages Système.",
      "已准备就绪": "Prêt",
      "系统权限": "Autorisations système",
      "打开系统设置": "Ouvrir Réglages Système",
      "请在系统设置中开启此权限": "Refusé. Activez cette autorisation dans Réglages Système.",
      "结束中": "Fin de la réunion…",
      "正在精修": "Affinage en cours",
      "原版逐字稿仍可查看": "La transcription d’origine reste disponible",
      "准备中": "Préparation",
      "全选": "Tout sélectionner",
      "取消全选": "Tout désélectionner",
      "校正说话人": "Correction des locuteurs",
      "正在取消": "Annulation en cours",
      "软件更新": "Mises à jour logicielles",
      "检查更新": "Rechercher des mises à jour",
      "会议纪要已生成": "Notes de réunion générées",
      "正在播放": "Lecture en cours",
      "操作失败": "Échec de l’action",
      "应用错误": "Erreur de l’application",
      "会后精修失败": "Échec de l’affinage après réunion",
      "发现可恢复录音": "{count} enregistrement(s) récupérable(s) trouvé(s)",
      "离线功能": "Fonctionnalités hors ligne",
      "请选择声音": "Sélectionnez d’abord une voix",
      "请先配置翻译模型": "Configurez d’abord un modèle de traduction",
      "纪要服务拒绝了请求": "Le fournisseur de résumés a refusé la demande",
      "纪要模型需要配置": "Configurez le modèle de résumé",
      "请检查 API 地址、密钥和服务商访问策略。": "Vérifiez l’URL de l’API, la clé et la politique d’accès du fournisseur.",
      "API Key 未配置、已失效或不匹配当前服务。": "La clé API est absente, invalide ou refusée par ce fournisseur.",
      "配置纪要模型": "Configurer le modèle",
      "内置纪要模型未配置": "Modèle de résumé intégré non configuré",
      "请选择并下载一个内置纪要模型，之后即可完全离线生成纪要。": "Choisissez et téléchargez un modèle de résumé intégré pour générer des notes de réunion entièrement hors ligne.",
      "选择纪要模型": "Choisir le modèle",
      "刚刚": "À l’instant",
      "请先选择译文目标并配置纪要模型": "Choisissez d’abord une langue cible et configurez un modèle de résumé",
      "将确认字幕发送到 {provider} 生成译文。是否继续？": "Envoyer les sous-titres confirmés à {provider} pour les traduire ?",
      "选择格式：md / txt / json / srt / docx / pdf / flac / wav / m4a": "Choisir le format : md / txt / json / srt / docx / pdf / flac / wav / m4a",
      "已导出「{title}」": "« {title} » a été exporté",
      "示例会议及录音已删除": "La réunion et l’enregistrement d’exemple ont été supprimés",
      "会议已移至最近删除": "La réunion a été placée dans Éléments récemment supprimés",
      "暂停录音": "Mettre l’enregistrement en pause",
      "这场会议没有可播放的录音": "Cette réunion ne contient aucun enregistrement lisible",
      "纪要配置加载失败": "Échec du chargement de la configuration du résumé",
      "配置或后端启动失败": "Échec de la configuration ou du démarrage du backend",
      "翻译失败": "Échec de la traduction",
      "压缩包已导出": "Archive exportée",
      "未找到录音，已导出逐字稿压缩包": "Aucun enregistrement trouvé ; archive de transcription exportée",
      "请前往「设置」>「AI 会议总结」，选择并下载内置纪要模型。": "Accédez à Réglages > Résumé de réunion IA pour choisir et télécharger un modèle intégré.",
      "前往 AI 会议总结": "Accéder au résumé IA",
      "操作超时，请稍后重试": "L’opération a expiré. Réessayez plus tard.",
      "实时会议中，结束后再生成会议纪要。": "Réunion en direct en cours. Terminez-la avant de générer les notes de la réunion.",
      "已有会议纪要正在生成，请稍候。": "Un compte rendu est déjà en cours de génération. Veuillez patienter.",
      "字幕": "Sous-titres",
      "字幕：开": "Sous-titres : Oui",
      "字幕：关": "Sous-titres : Non",
      "新建工作区": "Nouvel espace de travail",
      "翻译：开": "Traduction : Oui",
      "翻译：关": "Traduction : Non",
      "分享": "Partager",
      "精修字幕": "Affiner les sous-titres",
      "已精修": "Affiné",
      "查看原始转写": "Voir la transcription originale",
      "查看精修字幕": "Voir les sous-titres affinés",
      "精修全文": "Transcription affinée complète",
      "经过会后模型整理后的完整转写文本。由于当前模型不提供时间戳，该版本不支持逐句音频定位。": "Une transcription continue retravaillée par le modèle après la réunion. Ce modèle ne fournissant pas d’horodatage, la recherche audio par segment n’est pas prise en charge.",
      "会议中没有记录笔记。": "Aucune note n’a été prise pendant la réunion.",
      "位参与者": "participants",
      "重新精修": "Ré-affiner",
      "更换精修模型": "Changer le modèle d’affinage",
      "尚未生成": "Pas encore généré",
      "生成纪要": "Générer les notes",
      "更多": "Plus",
      "会议纪要": "Notes de réunion",
      "新建会议": "Nouvelle réunion",
      "已生成纪要": "Notes générées",
      "完成": "Terminé",
      "生成": "Générer",
      "重新生成": "Régénérer",
      "笔记已达 20000 字符上限，超出部分未保存。": "Les notes sont limitées à 20 000 caractères ; le reste n’a pas été enregistré.",
      "编辑": "Modifier",
      "搜索会议…": "Rechercher des réunions…",
      "复制会议纪要": "Copier les notes de réunion",
      "已连接": "Connecté",
      "未就绪": "Pas prêt",
      "需要麦克风权限": "Autorisation du microphone requise",
      "标准模式": "Mode standard",
      "我的笔记": "Mes notes",
      "展开字幕": "Agrandir les sous-titres",
      "返回笔记": "Retour aux notes",
      "预览": "Aperçu",
      "记录笔记（支持 Markdown）": "Prenez des notes ici. Markdown pris en charge.",
      "纪要生成失败：模型未返回有效内容，请稍后重试。": "Échec de la génération des notes : le modèle n’a renvoyé aucun contenu. Réessayez plus tard.",
      "富文本": "Texte enrichi",
      "加粗": "Gras",
      "斜体": "Italique",
      "标题 1": "Titre 1",
      "标题 2": "Titre 2",
      "标题 3": "Titre 3",
      "列表": "Liste",
      "编号列表": "Liste numérotée",
      "引用": "Citation",
      "插入链接": "Insérer un lien",
      "插入图片": "Insérer une image",
      "行内代码": "Code en ligne",
      "代码": "Code",
      "会议总结": "Résumé de la réunion",
      "管理会议总结": "Gérer le résumé de la réunion",
      "AI 笔记与会议总结": "Notes IA et résumé de réunion",
      "配置用于生成会议总结和 AI 笔记的服务。所有配置信息仅保存在本地，不会上传。": "Configurez le service utilisé pour les résumés de réunion et les notes IA. La configuration reste sur cet appareil.",
      "配置 AI 笔记与会议总结": "Configurer les notes IA et le résumé",
      "管理语言识别模型的下载、删除与版本信息。": "Gérez les téléchargements, la suppression et les versions des modèles de reconnaissance vocale.",
      "VAD 模型": "Modèle VAD",
      "查看完整内容": "Voir le contenu complet",
      "会议人数": "Participants",
      "继续精修": "Continuer l’affinage",
      "留空自动识别": "Laisser vide pour auto-détection",
      "选择导出格式": "Choisir le format d’export",
      "播放进度": "Progression de lecture",
      "暂停播放": "Mettre la lecture en pause",
      "关闭播放": "Fermer la lecture",
      "清空搜索": "Effacer la recherche",
      "搜索结果": "Résultats de recherche",
      "最近会议": "Réunions récentes",
      "展开会议纪要": "Développer les notes de réunion",
      "请求建议": "Demander une suggestion",
      "还没有下载内置 AI 模型。": "Aucun modèle d’IA intégré n’est encore installé.",
      "本次会议无法生成实时字幕": "Sous-titres en direct indisponibles pour cette réunion",
      "识别模型未能加载，录音仍在正常保存。会议结束后可在详情页生成完整逐字稿。": "Le modèle de reconnaissance n’a pas pu être chargé. L’audio est toujours enregistré ; vous pourrez générer la transcription complète depuis les détails de la réunion à la fin.",
      "实时字幕模型": "Modèle de sous-titres en direct",
      "说话人分离模型": "Modèle de séparation des locuteurs",
      "会后精修模型": "Modèle d’affinage après réunion",
      "模型与设置": "Modèles et réglages",
      "实时识别模型": "Modèle de reconnaissance en direct",
      "精修模型": "Modèle d’affinage",
      "从文件夹打开": "Ouvrir dans le dossier",
      "清空数据": "Effacer les données",
      "此操作不可恢复。": "Cette action est irréversible.",
      "已清空": "Données effacées",
      "未找到录音文件": "Fichier d’enregistrement introuvable",
      "未找到模型文件": "Fichiers du modèle introuvables",
      "需要下载以下模型": "Téléchargez les modèles requis :",
      "模型下载队列": "File de téléchargement des modèles",
      "下载失败": "Échec du téléchargement. Vérifiez la connexion.",
      "重试": "Réessayer",
      "正在下载会议所需模型，完成后会自动开始录制": "Téléchargement des modèles requis pour cette réunion. L’enregistrement démarrera automatiquement une fois prêt.",
      "正在下载模型，完成后会自动切换": "Téléchargement du modèle. Le basculement se fera automatiquement une fois prêt.",
      "当前系统不支持直接录制系统音频，请仅使用麦克风": "L’enregistrement direct de l’audio système n’est pas pris en charge sur ce système. Utilisez uniquement le microphone.",
      "预期说话人数": "Nombre d’intervenants prévu",
      "留空自动匹配": "Laisser vide pour la sélection automatique",
      "工作区": "Espace de travail",
      "自动匹配": "Sélection automatique",
      "音量": "Volume",
      "请先在\"模型与设置\"中选择译文目标语言": "Choisissez d’abord une langue cible dans « Modèles et réglages ».",
      "未知工作区": "Espace de travail inconnu",
      "工作区会议": "Réunions de l’espace de travail",
      "创建一个新的工作区来组织会议": "Créez un espace de travail pour organiser vos réunions.",
      "工作区名称": "Nom de l’espace de travail",
      "描述": "Description",
      "（可选）": "(Facultatif)",
      "创建工作区": "Créer un espace de travail",
      "工作区已创建": "Espace de travail créé",
      "编辑工作区": "Modifier l’espace de travail",
      "保存更改": "Enregistrer les modifications",
      "删除工作区": "Supprimer l’espace de travail",
      "工作区内的会议将移至最近删除。恢复会议时将还原原工作区。此操作不能撤销。": "Les réunions de cet espace seront déplacées vers les éléments supprimés récemment. Les restaurer rétablit aussi leur espace d’origine. Cette action est irréversible.",
      "工作区已删除": "Espace de travail supprimé",
      "工作区已更新": "Espace de travail mis à jour",
      "调整识别、端点检测、说话人分离和本地模型运行参数。": "Ajustez la reconnaissance, la détection de fin, la séparation des locuteurs et les paramètres locaux des modèles.",
      "下载": "Téléchargement",
      "下载中": "Téléchargement",
      "内置": "Intégré",
      "查看录音": "Voir les enregistrements",
      "收起": "Réduire",
      "选择录音并添加": "Choisir un enregistrement et ajouter",
      "播放录音": "Lire l’enregistrement",
      "已复制到剪贴板": "Copié dans le presse-papiers",
      "暂无可分享的内容": "Rien à partager pour le moment",
      "进阶设置": "Paramètres avancés",
      "配置进阶设置": "Configurer les paramètres avancés",
      "恢复默认": "Rétablir les valeurs par défaut",
      "确定": "Confirmer",
      "已保存": "Enregistré",
      "标记说话人": "Attribuer un locuteur",
      "选择已注册声纹或新建说话人。": "Choisissez une empreinte vocale enregistrée ou créez un locuteur.",
      "已注册声纹": "Empreinte vocale enregistrée",
      "新建说话人": "Nouveau locuteur",
      "说话人名称": "Nom du locuteur",
      "可修改模型、端点静音、说话人分离及 sherpa-onnx 运行参数。": "Configurez les modèles, le silence de fin, la séparation des locuteurs et les paramètres sherpa-onnx.",
      "修改后会立即应用于下一次会议与精修。": "Les modifications s’appliquent à la prochaine réunion et à l’affinage.",
      "添加录音到声纹库": "Ajouter l’enregistrement à l’empreinte vocale",
      "暂无已注册声纹": "Aucune empreinte vocale enregistrée",
      "已添加录音到声纹库": "Enregistrement ajouté à l’empreinte vocale",
      "新增声纹": "Créer une empreinte vocale",
      "声纹名称": "Nom de l’empreinte vocale",
      "已创建声纹并添加录音": "Empreinte vocale créée et enregistrement ajouté",
      "确认": "Confirmer",
      "重叠说话": "Parole superposée",
      "请先选择或填写纪要模型。": "Sélectionnez ou saisissez d’abord un modèle de résumé.",
      "请填写请求地址。": "Saisissez l’URL de requête.",
      "请填写 API Key。": "Saisissez la clé API.",
      "纪要模型已保存": "Modèle de résumé enregistré",
      "主导航": "Navigation principale",
      "Brevia 首页": "Accueil Brevia",
      "在 GitHub 上查看 Brevia": "Voir Brevia sur GitHub",
      "对齐音频": "Alignement audio",
      "准备精修": "Préparation de l’affinage",
      "分析说话人": "Analyse des locuteurs",
      "转写中": "Transcription",
      "整理结果": "Finalisation des résultats",
      "未检测到麦克风设备，请在系统设置中开启麦克风访问权限": "Aucun microphone détecté. Autorisez l’accès au microphone dans Réglages Système.",
      "麦克风访问被拒绝，请在系统设置中允许应用使用麦克风后重试": "L’accès au microphone a été refusé. Autorisez l’application à utiliser le microphone dans Réglages Système, puis réessayez.",
      "麦克风被其他程序占用，请关闭占用麦克风的程序后重试": "Le microphone est utilisé par un autre programme. Fermez ce programme, puis réessayez.",
      "无法获取麦克风": "Impossible d’accéder au microphone",
      "无法获取系统音频，请检查系统权限后重试": "Impossible de capturer l’audio système. Vérifiez les autorisations système, puis réessayez.",
      "未检测到系统音频，请在系统设置中允许屏幕与系统音频录制后重试": "Aucun audio système détecté. Autorisez l’enregistrement de l’écran et de l’audio système dans Réglages Système, puis réessayez.",
      "麦克风没有可用的音频轨道": "Le microphone n’a aucune piste audio disponible",
      "至少选择一个音频输入": "Sélectionnez au moins une entrée audio",
      "系统音频未产生音频数据": "L’audio système n’a produit aucune donnée audio",
      "麦克风未产生音频数据": "Le microphone n’a produit aucune donnée audio",
      "加入笔记": "Ajouter aux notes",
      "标记当前时间点": "Insérer l’horodatage",
      "已加入笔记": "Ajouté aux notes",
      "暂无字幕可插入": "Aucun sous-titre à insérer pour le moment",
      "无法获取字幕内容": "Texte du sous-titre indisponible",
      "数字": "Nombre",
      "日期": "Date",
      "问句": "Question",
      "可能是一个结论": "Conclusion possible",
      "可能的决策": "Décision possible",
      "可能的待办": "Tâche possible",
      "重要数字": "Chiffre clé",
      "重要日期": "Date clé",
      "待确认事项": "À confirmer",
      "可能的风险": "Risque possible",
      "新话题": "Nouveau sujet",
      "补充": "Compléter",
      "忽略": "Ignorer",
      "1 条建议": "1 suggestion",
      "AI 检测到新话题：": "L’IA a détecté un nouveau sujet : ",
      "整理笔记": "Organiser les notes",
      "校对": "Vérifier",
      "关联历史": "Historique lié",
      "整理一下？": "Organiser les notes ?",
      "替换原内容": "Remplacer",
      "插入整理版": "Insérer la version organisée",
      "修正": "Corriger",
      "保持原文": "Conserver",
      "查看原会议": "Ouvrir la réunion",
      "和之前内容有关": "Lié à un contenu antérieur",
      "和会议原文可能存在差异": "Possible différence avec la transcription",
      "字幕中说的是：": "La transcription indique :",
      "问 AI": "Demander à l’IA",
      "问当前会议": "Demander sur cette réunion",
      "输入你的问题": "Saisissez votre question",
      "提问": "Demander",
      "搜索字幕…": "Rechercher les sous-titres…",
      "重点": "Important",
      "插入表格": "Insérer un tableau",
      "切换到富文本": "Passer au texte enrichi",
      "切换到 Markdown": "Passer à Markdown",
      "列 1": "Colonne 1",
      "列 2": "Colonne 2",
      "内容": "Contenu",
      "重点：": "À souligner : ",
      "原始转写": "Transcription originale",
      "列 {n}": "Colonne {n}",
      "选择行列数": "Choisir la taille du tableau",
      "行数": "Lignes",
      "列数": "Colonnes",
      "插入": "Insérer",
      "已暂停": "En pause",
      "系统默认": "Par défaut",
      "麦克风设备": "Microphone",
      "刷新设备": "Actualiser les périphériques",
      "笔记已达容量上限，超出部分未保存。": "Les notes ont atteint la limite de taille ; le reste n’a pas été enregistré.",
      "导出会议资料": "Exporter les fichiers de réunion",
      "笔记": "Notes",
      "会议录音": "Enregistrement de réunion",
      "混音录音": "Enregistrement mixé",
      "传送到应用": "Envoyer vers une app",
      "在文件夹中显示": "Afficher dans le dossier",
      "暂无笔记可导出": "Aucune note à exporter",
      "查找": "Rechercher",
      "替换为": "Remplacer par",
      "上一个": "Précédent",
      "下一个": "Suivant",
      "全部替换": "Tout remplacer",
      "导出与分享": "Exporter et partager",
      "请先选择要导出的内容": "Sélectionnez d’abord ce qu’il faut exporter",
      "依据 {count} 段字幕": "Basé sur {count} sous-titres",
      "图片必须是 PNG、JPEG、GIF 或 WebP，且不超过 10 MB。": "L’image doit être au format PNG, JPEG, GIF ou WebP et faire moins de 10 Mo.",
      "未找到匹配的会议": "Aucune réunion correspondante",
      "{count} 条结果": "{count} résultats",
      "标题匹配": "Correspond au titre",
      "搜索会议、字幕或说话人…": "Rechercher réunions, sous-titres ou locuteurs…",
      "该会议已有逐句修改。用新模型重新精修会按新模型重新分段，这些修改可能无法保留。": "Cette réunion contient des modifications phrase par phrase. Un nouvel affinage avec un autre modèle re-segmente la transcription ; ces modifications risquent de ne pas être conservées.",
      "开始精修": "Lancer le raffinage",
      "录制方式": "Mode d’enregistrement",
      "自动（记住上次）": "Auto (mémoriser le dernier)",
      "仅麦克风": "Microphone uniquement",
      "仅系统音频": "Audio système uniquement",
      "麦克风 + 系统音频": "Microphone + audio système",
      "适合线下会议场景": "Pour les réunions en personne",
      "适合网课、视频场景": "Pour les cours et vidéos",
      "适合线上会议场景": "Pour les réunions en ligne",
      "录制来源": "Sources d’enregistrement",
      "采集模式": "Mode de capture",
      "沿用上次成功录制的方式": "Utiliser le dernier mode réussi",
      "未启用": "Non activé",
      "多语言混说": "Langues mixtes",
      "翻译": "Traduire",
      "正在翻译字幕": "Traduction des sous-titres",
      "字幕文本": "Texte du sous-titre",
      "字幕已保存": "Sous-titres enregistrés",
      "字幕内容不能为空": "Le texte du sous-titre ne peut pas être vide",
      "保存失败": "Échec de l’enregistrement",
      "占用": "Sur disque",
      "内存": "Mémoire",
      "随应用安装": "Inclus",
      "必需": "Obligatoire",
      "磁盘空间不足，请先清理空间再下载。": "Espace disque insuffisant. Libérez de la place, puis relancez le téléchargement.",
      "文件校验未通过，下载可能已损坏，请删除后重试。": "Le téléchargement a échoué au contrôle d’intégrité et est peut-être corrompu. Supprimez-le et réessayez.",
      "网络中断导致下载失败，请检查网络后重试。": "Le téléchargement a été interrompu. Vérifiez votre connexion et réessayez.",
      "模型不可用，请刷新模型库后重试。": "Ce modèle est indisponible. Rouvrez la bibliothèque de modèles.",
      "已安装": "Installés",
      "后退 15 秒": "Reculer de 15 secondes",
      "前进 15 秒": "Avancer de 15 secondes",
      "请选择空文件夹。": "Choisissez un dossier vide.",
      "请先结束会议、精修和模型下载，再更改文件夹。": "Terminez les réunions, la transcription affinée et les téléchargements de modèles avant de changer de dossier.",
      "模型和录音文件夹必须相互独立，且不能包含原数据文件夹。": "Les dossiers des modèles et des enregistrements doivent être séparés et ne pas contenir les dossiers de données existants.",
      "此文件夹由环境变量指定，无法在应用内更改。": "Ce dossier est défini par une variable d’environnement et ne peut pas être modifié dans l’application.",
      "文件夹更改失败，请检查路径、磁盘连接和写入权限。": "Impossible de changer les dossiers. Vérifiez le chemin, la connexion du disque et les droits d’écriture.",
      "error.operation_failed": "L’opération a échoué. Réessayez.",
      "error.audio_backpressure": "Le traitement audio prend du retard. L’enregistrement s’arrête ; l’audio capturé sera conservé.",
      "error.worker_exited": "Le processus de transcription s’est arrêté.",
      "error.worker_recovery": "L’enregistrement est conservé localement, mais la transcription n’a pas pu reprendre.",
      "error.storage_recovery": "Restauration du dossier de données requise",
      "error.storage_recovery_hint": "Vérifiez les disques et le fichier de configuration. Les données originales et les journaux de migration sont conservés. Relancez Brevia après correction.",
      "error.storage_unavailable": "Le dossier de données est indisponible. Connectez le disque puis relancez Brevia.",
      "error.summary.no_transcript": "Transcrivez cette réunion avant de générer les notes.",
      "error.voice_sample_owned": "Cet enregistrement appartient déjà à une autre empreinte vocale.",
      "error.voice_sample_short": "L’enregistrement est trop court. Choisissez un extrait plus long.",
      "error.audio_not_found": "Fichier audio introuvable. Vérifiez qu’il existe encore.",
      "error.audio_too_long": "L’enregistrement dépasse la durée maximale pour cette opération. Choisissez un enregistrement plus court.",
      "error.refinement.no_audio": "Cette réunion n’a aucun enregistrement à affiner.",
      "error.tasks.running": "Attendez la fin des tâches en arrière-plan.",
      "error.meeting.active": "Terminez d’abord la réunion en cours.",
      "error.sharing_not_confirmed": "Confirmez d’abord le partage de la transcription.",
      "error.segment_not_found": "Sous-titre introuvable. Actualisez et réessayez.",
      "error.command_too_large": "Le contenu dépasse la limite. Réduisez-le et réessayez.",
      "error.summary.failed": "Impossible de générer les notes. Vérifiez la configuration ou réessayez plus tard.",
      "error.timeout": "L’opération a expiré. Réessayez plus tard.",
      "error.summary.live_meeting": "Réunion en direct en cours. Terminez-la avant de générer les notes de la réunion.",
      "error.summary.empty_response": "Échec de la génération des notes : le modèle n’a renvoyé aucun contenu. Réessayez plus tard.",
      "error.summary.authentication": "La clé API est absente, invalide ou refusée par ce fournisseur."
    },
    "messages": {
      "recordingSaved": "Enregistrement sauvegardé. Préparation de la transcription.",
      "located": "Positionné sur le segment audio lié",
      "playing": "Lecture de la piste mixée",
      "paused": "Lecture en pause"
    }
  },
  "de": {
    "views": {
      "home": "Alle Besprechungen",
      "prepare": "Aufnahme vorbereiten",
      "live": "Aufnahme läuft",
      "detail": "Besprechungsdetails",
      "settings": "Einstellungen"
    },
    "labels": {
      "所有会议": "Alle Besprechungen",
      "最近删除": "Kürzlich gelöscht",
      "设置": "Einstellungen",
      "开始会议": "Besprechung starten",
      "会议库": "Besprechungsbibliothek",
      "准备录制": "Aufnahme vorbereiten",
      "实时字幕": "Live-Transkript",
      "会议详情": "Besprechungsdetails",
      "本地优先": "Lokal zuerst",
      "音频与文本仅保存在此设备": "Audio und Text bleiben auf diesem Gerät",
      "每一场对话，都留有依据。": "Jedes Gespräch hinterlässt eine nachvollziehbare Aufzeichnung.",
      "录音、逐字稿和纪要只在你明确操作时导出或发送。": "Audio, Transkripte und Notizen werden nur auf Ihre ausdrückliche Anweisung exportiert oder gesendet.",
      "搜索会议、逐字稿或标签": "Besprechungen, Transkripte oder Tags suchen",
      "所有分类": "Alle Kategorien",
      "最近 30 天": "Letzte 30 Tage",
      "返回会议库": "Zurück zur Bibliothek",
      "开始一场会议": "Besprechung starten",
      "先确认语言与音频输入。模型会在开始前加载，录制过程不会因网络状态中断。": "Prüfen Sie Sprache und Audioeingang. Das Modell wird vor der Aufnahme geladen; die Aufnahme läuft auch ohne Netzwerk weiter.",
      "录制音频": "Audio aufnehmen",
      "会议名称": "Besprechungsname",
      "会议语言": "Besprechungssprache",
      "译文目标": "Zielsprache",
      "我的麦克风": "Mein Mikrofon",
      "系统音频": "Systemaudio",
      "输入良好": "Eingang bereit",
      "已就绪": "Bereit",
      "当前模型": "Aktuelles Modell",
      "中文确认文本与说话人分离": "Chinesische Transkription und Sprechertrennung",
      "管理模型与术语": "Modelle und Begriffe verwalten",
      "正在录制": "Aufnahme läuft",
      "暂停": "Pausieren",
      "继续": "Fortsetzen",
      "结束会议": "Besprechung beenden",
      "保持在当下": "Bleiben Sie beim Gespräch",
      "译文: 开": "Übersetzung: Ein",
      "译文: 关": "Übersetzung: Aus",
      "回到最新": "Zurück zum Neuesten",
      "参与者": "Teilnehmende",
      "本场状态": "Sitzungsstatus",
      "我": "Ich",
      "麦克风": "Mikrofon",
      "打开会议面板": "Besprechungsbereich öffnen",
      "导出": "Exportieren",
      "逐字稿": "Transkript",
      "摘要": "Zusammenfassung",
      "纪要与待办": "Notizen und Aufgaben",
      "播放此段": "Wiedergabe",
      "生成完整会议纪要": "Besprechungsnotizen erstellen",
      "模型与本地数据": "Modelle und lokale Daten",
      "已安装模型": "Installierte Modelle",
      "术语库": "Terminologie",
      "12 个词条可用于会议准备、搜索和纪要。仅支持的模型会将其用于转写。": "12 Begriffe stehen für Vorbereitung, Suche und Notizen bereit. Nur unterstützte Modelle nutzen sie zur Transkription.",
      "管理术语库": "Terminologie verwalten",
      "存储与隐私": "Speicher und Datenschutz",
      "会议资料保存在此 Mac。外部 LLM 需要在发送逐字稿前明确确认。": "Besprechungsdaten bleiben auf diesem Mac. Externe LLMs erfordern eine ausdrückliche Bestätigung.",
      "查看本地存储": "Lokalen Speicher anzeigen",
      "中文": "Chinesisch",
      "英语": "Englisch",
      "不需要翻译": "Keine Übersetzung",
      "自动 · 仅麦克风": "Auto · Nur Mikrofon",
      "自动 · 仅系统音频": "Auto · Nur Systemaudio",
      "自动音源": "Auto-Quelle",
      "自动检测": "Automatisch erkennen",
      "切换语言": "Sprache wechseln",
      "切换主题": "Design wechseln",
      "Brevia": "Brevia",
      "向量数据库": "Vektordatenbank",
      "ERes2Net": "ERes2Net",
      "最小化": "Minimieren",
      "关闭": "Schließen",
      "取消": "Abbrechen",
      "返回": "Zurück",
      "开始录制": "Aufnahme starten",
      "继续会议": "Besprechung fortsetzen",
      "我 · 麦克风": "Ich · Mikrofon",
      "计算设备": "Rechengerät",
      "预计空间": "Geschätzter Speicherbedarf",
      "识别模型": "Erkennungsmodell",
      "已应用术语": "Angewendete Begriffe",
      "12 个词条": "12 Begriffe",
      "可用": "Verfügbar",
      "已完成精修": "Überarbeitung abgeschlossen",
      "中文确认文本 · 1.2 GB": "Chinesische Transkription · 1,2 GB",
      "英文与其他语言 · 466 MB": "Englisch und weitere Sprachen · 466 MB",
      "+ 9": "+ 9",
      "模型库": "Modellbibliothek",
      "管理模型库": "Modellbibliothek verwalten",
      "纪要模型": "Zusammenfassungsmodelle",
      "配置用于生成会议纪要的 API。所有配置信息仅保存在本地，不会上传。": "APIs für Besprechungsnotizen konfigurieren. Alle Einstellungen bleiben lokal.",
      "管理纪要模型": "Zusammenfassungsmodelle verwalten",
      "总结提示词": "Zusammenfassungsanweisung",
      "编辑提示词": "Anweisung bearbeiten",
      "配置 JSON": "JSON-Konfiguration",
      "当前启用的纪要模型配置。": "Konfiguration des aktuell verwendeten Zusammenfassungsmodells.",
      "分钟": "min",
      "本地录音": "Lokale Aufnahme",
      "本地保存": "Lokal gespeichert",
      "本地会议": "Lokale Besprechung",
      "检查音频": "Audio wird geprüft",
      "检测语音": "Sprache wird erkannt",
      "识别说话人": "Sprechende werden erkannt",
      "重新聚类说话人": "Sprechende werden neu gruppiert",
      "匹配声纹": "Stimmabdrücke werden abgeglichen",
      "整理说话人": "Sprecher-Zeitleiste wird vorbereitet",
      "← 返回会议库": "← Zurück zur Bibliothek",
      "说话人分离": "Sprechertrennung",
      "自定义术语": "Eigener Begriff",
      "暂无术语": "Keine Begriffe",
      "说话人": "Sprecher",
      "等待识别说话人": "Warten auf Sprechererkennung",
      "会议摘要": "Besprechungszusammenfassung",
      "尚未生成会议摘要": "Noch keine Zusammenfassung",
      "转发": "Teilen",
      "会后精修": "Nachbearbeitung",
      "精修": "Verfeinern",
      "精修字稿": "Überarbeitetes Transkript",
      "完成精修后，这里会显示不带时间戳的校对稿。": "Nach der Überarbeitung erscheint hier das korrigierte Transkript ohne Zeitstempel.",
      "正在精修…": "Überarbeitung läuft…",
      "会后精修已完成": "Überarbeitung nach der Besprechung abgeschlossen",
      "已整理": "Abgeschlossen",
      "决定": "Entscheidung",
      "待办": "Aufgabe",
      "悬浮字幕": "Schwebende Untertitel",
      "悬浮字幕：开": "Schwebende Untertitel: Ein",
      "⌖ 开": "⌖ Ein",
      "最近 7 天": "Letzte 7 Tage",
      "最近 90 天": "Letzte 90 Tage",
      "全部时间": "Gesamter Zeitraum",
      "系统默认麦克风": "Standardmikrofon des Systems",
      "需要授予屏幕与系统音频权限": "Berechtigung für Bildschirm und Systemaudio erforderlich",
      "中文 / 英语": "Chinesisch / Englisch",
      "更多操作": "Weitere Aktionen",
      "恢复": "Wiederherstellen",
      "重命名": "Umbenennen",
      "删除": "Löschen",
      "保存": "Speichern",
      "添加": "Hinzufügen",
      "公开工作区": "Öffentlicher Arbeitsbereich",
      "导入录音": "Aufnahme importieren",
      "语音对话": "Sprachchat",
      "请先在声纹库注册可用声音": "Registrieren Sie vor dem Senden eine Stimmprobe",
      "录制权限": "Aufnahmeberechtigungen",
      "首次使用时完成设置": "Einrichtung bei der ersten Verwendung abschließen",
      "录制你的发言。": "Zeichnet Ihre Sprache auf.",
      "录制屏幕共享中的系统声音。": "Zeichnet Systemaudio bei der Bildschirmfreigabe auf.",
      "稍后": "Später",
      "言录需要以下系统权限以提供服务": "Brevia benötigt die folgenden Systemberechtigungen, um seine Dienste bereitzustellen.",
      "应用设置": "App-Einstellungen",
      "纪要不能为空": "Besprechungsnotizen dürfen nicht leer sein.",
      "当前没有正在进行的会议": "Keine Besprechung läuft.",
      "移至工作区": "In Arbeitsbereich verschieben",
      "已移至": "Verschoben nach",
      "展开": "Erweitern",
      "屏幕与系统音频": "Bildschirm und Systemaudio",
      "允许": "Erlauben",
      "已允许": "Erlaubt",
      "请在系统设置中允许": "Erlauben Sie Brevia in den Systemeinstellungen den Zugriff auf Bildschirm und Systemaudio.",
      "已准备就绪": "Bereit",
      "系统权限": "Systemberechtigungen",
      "打开系统设置": "Systemeinstellungen öffnen",
      "请在系统设置中开启此权限": "Verweigert. Aktivieren Sie diese Berechtigung in den Systemeinstellungen.",
      "结束中": "Besprechung wird beendet…",
      "正在精修": "Wird verfeinert",
      "原版逐字稿仍可查看": "Das ursprüngliche Transkript bleibt verfügbar",
      "准备中": "Wird vorbereitet",
      "全选": "Alle auswählen",
      "取消全选": "Auswahl aufheben",
      "校正说话人": "Sprecher korrigieren",
      "正在取消": "Wird abgebrochen",
      "软件更新": "Softwareupdates",
      "检查更新": "Nach Updates suchen",
      "会议纪要已生成": "Besprechungsnotizen erstellt",
      "正在播放": "Wiedergabe läuft",
      "操作失败": "Aktion fehlgeschlagen",
      "应用错误": "Anwendungsfehler",
      "会后精修失败": "Nachbearbeitung fehlgeschlagen",
      "发现可恢复录音": "{count} wiederherstellbare Aufnahme(n) gefunden",
      "离线功能": "Offline-Funktionen",
      "请选择声音": "Wählen Sie zuerst eine Stimme aus",
      "请先配置翻译模型": "Konfigurieren Sie zuerst ein Übersetzungsmodell",
      "纪要服务拒绝了请求": "Der Zusammenfassungsanbieter hat die Anfrage abgelehnt",
      "纪要模型需要配置": "Zusammenfassungsmodell konfigurieren",
      "请检查 API 地址、密钥和服务商访问策略。": "Prüfen Sie API-Adresse, Schlüssel und Zugriffsrichtlinie des Anbieters.",
      "API Key 未配置、已失效或不匹配当前服务。": "Der API-Schlüssel fehlt, ist ungültig oder wurde von diesem Anbieter abgelehnt.",
      "配置纪要模型": "Modell konfigurieren",
      "内置纪要模型未配置": "Integriertes Zusammenfassungsmodell nicht konfiguriert",
      "请选择并下载一个内置纪要模型，之后即可完全离线生成纪要。": "Wählen und laden Sie ein integriertes Zusammenfassungsmodell, um Besprechungsnotizen vollständig offline zu erstellen.",
      "选择纪要模型": "Modell wählen",
      "刚刚": "Gerade eben",
      "请先选择译文目标并配置纪要模型": "Wählen Sie zuerst eine Übersetzungssprache und konfigurieren Sie ein Zusammenfassungsmodell",
      "将确认字幕发送到 {provider} 生成译文。是否继续？": "Bestätigte Untertitel zur Übersetzung an {provider} senden?",
      "选择格式：md / txt / json / srt / docx / pdf / flac / wav / m4a": "Format auswählen: md / txt / json / srt / docx / pdf / flac / wav / m4a",
      "已导出「{title}」": "„{title}“ exportiert",
      "示例会议及录音已删除": "Beispielbesprechung und Aufnahme gelöscht",
      "会议已移至最近删除": "Besprechung in „Zuletzt gelöscht“ verschoben",
      "暂停录音": "Aufnahme anhalten",
      "这场会议没有可播放的录音": "Diese Besprechung hat keine abspielbare Aufnahme",
      "纪要配置加载失败": "Zusammenfassungskonfiguration konnte nicht geladen werden",
      "配置或后端启动失败": "Konfiguration oder Backend-Start fehlgeschlagen",
      "翻译失败": "Übersetzung fehlgeschlagen",
      "压缩包已导出": "Archiv exportiert",
      "未找到录音，已导出逐字稿压缩包": "Keine Aufnahme gefunden; Transkriptarchiv exportiert",
      "请前往「设置」>「AI 会议总结」，选择并下载内置纪要模型。": "Gehen Sie zu Einstellungen > KI-Besprechungszusammenfassung, um ein integriertes Modell auszuwählen und herunterzuladen.",
      "前往 AI 会议总结": "Zur KI-Zusammenfassung",
      "操作超时，请稍后重试": "Der Vorgang ist abgelaufen. Bitte versuchen Sie es erneut.",
      "实时会议中，结束后再生成会议纪要。": "Live-Besprechung läuft. Beenden Sie sie, bevor Sie die Besprechungsnotizen erstellen.",
      "已有会议纪要正在生成，请稍候。": "Eine Besprechungsnotiz wird bereits erstellt. Bitte warten Sie.",
      "字幕": "Untertitel",
      "字幕：开": "Untertitel: An",
      "字幕：关": "Untertitel: Aus",
      "新建工作区": "Neuer Arbeitsbereich",
      "翻译：开": "Übersetzung: An",
      "翻译：关": "Übersetzung: Aus",
      "分享": "Teilen",
      "精修字幕": "Untertitel nachbearbeiten",
      "已精修": "Nachbearbeitet",
      "查看原始转写": "Originaltranskript anzeigen",
      "查看精修字幕": "Nachbearbeitete Untertitel anzeigen",
      "精修全文": "Vollständiges nachbearbeitetes Transkript",
      "经过会后模型整理后的完整转写文本。由于当前模型不提供时间戳，该版本不支持逐句音频定位。": "Ein fortlaufendes Transkript, das vom Modell nach der Besprechung überarbeitet wurde. Da dieses Modell keine Zeitstempel liefert, ist die Audio-Suche pro Segment nicht möglich.",
      "会议中没有记录笔记。": "Während der Besprechung wurden keine Notizen erfasst.",
      "位参与者": "Teilnehmer",
      "重新精修": "Erneut nachbearbeiten",
      "更换精修模型": "Nachbearbeitungsmodell ändern",
      "尚未生成": "Noch nicht erstellt",
      "生成纪要": "Notizen erstellen",
      "更多": "Mehr",
      "会议纪要": "Besprechungsnotizen",
      "新建会议": "Neue Besprechung",
      "已生成纪要": "Notizen erstellt",
      "完成": "Fertig",
      "生成": "Erstellen",
      "重新生成": "Neu erstellen",
      "笔记已达 20000 字符上限，超出部分未保存。": "Notizen sind auf 20.000 Zeichen begrenzt; der Rest wurde nicht gespeichert.",
      "编辑": "Bearbeiten",
      "搜索会议…": "Besprechungen suchen…",
      "复制会议纪要": "Besprechungsnotizen kopieren",
      "已连接": "Verbunden",
      "未就绪": "Nicht bereit",
      "需要麦克风权限": "Mikrofonberechtigung erforderlich",
      "标准模式": "Standardmodus",
      "我的笔记": "Meine Notizen",
      "展开字幕": "Untertitel vergrößern",
      "返回笔记": "Zurück zu Notizen",
      "预览": "Vorschau",
      "记录笔记（支持 Markdown）": "Notizen hier erfassen. Markdown unterstützt.",
      "纪要生成失败：模型未返回有效内容，请稍后重试。": "Notizen konnten nicht erstellt werden: das Modell lieferte keine Inhalte. Bitte erneut versuchen.",
      "富文本": "Rich-Text",
      "加粗": "Fett",
      "斜体": "Kursiv",
      "标题 1": "Überschrift 1",
      "标题 2": "Überschrift 2",
      "标题 3": "Überschrift 3",
      "列表": "Liste",
      "编号列表": "Nummerierte Liste",
      "引用": "Zitat",
      "插入链接": "Link einfügen",
      "插入图片": "Bild einfügen",
      "行内代码": "Inline-Code",
      "代码": "Code",
      "会议总结": "Besprechungszusammenfassung",
      "管理会议总结": "Besprechungszusammenfassung verwalten",
      "AI 笔记与会议总结": "KI-Notizen und Besprechungszusammenfassung",
      "配置用于生成会议总结和 AI 笔记的服务。所有配置信息仅保存在本地，不会上传。": "Konfigurieren Sie den Dienst für Besprechungszusammenfassungen und KI-Notizen. Alle Einstellungen bleiben auf diesem Gerät.",
      "配置 AI 笔记与会议总结": "KI-Notizen und Zusammenfassung konfigurieren",
      "管理语言识别模型的下载、删除与版本信息。": "Verwalten Sie Downloads, Löschungen und Versionsinformationen von Spracherkennungsmodellen.",
      "VAD 模型": "VAD-Modell",
      "查看完整内容": "Vollständigen Inhalt anzeigen",
      "会议人数": "Teilnehmer",
      "继续精修": "Nachbearbeitung fortsetzen",
      "留空自动识别": "Leer lassen für automatische Erkennung",
      "选择导出格式": "Exportformat wählen",
      "播放进度": "Wiedergabefortschritt",
      "暂停播放": "Wiedergabe pausieren",
      "关闭播放": "Wiedergabe schließen",
      "清空搜索": "Suche löschen",
      "搜索结果": "Suchergebnisse",
      "最近会议": "Letzte Besprechungen",
      "展开会议纪要": "Besprechungsnotizen erweitern",
      "请求建议": "Vorschlag anfordern",
      "还没有下载内置 AI 模型。": "Es ist noch kein integriertes KI-Modell installiert.",
      "本次会议无法生成实时字幕": "Für diese Besprechung sind keine Live-Untertitel verfügbar",
      "识别模型未能加载，录音仍在正常保存。会议结束后可在详情页生成完整逐字稿。": "Das Erkennungsmodell konnte nicht geladen werden. Die Aufnahme läuft weiter — das vollständige Transkript lässt sich nach dem Ende in den Besprechungsdetails erzeugen.",
      "实时字幕模型": "Live-Untertitelmodell",
      "说话人分离模型": "Sprechertrennungsmodell",
      "会后精修模型": "Nachbearbeitungsmodell",
      "模型与设置": "Modelle & Einstellungen",
      "实时识别模型": "Echtzeit-Erkennungsmodell",
      "精修模型": "Verfeinerungsmodell",
      "从文件夹打开": "Im Ordner öffnen",
      "清空数据": "Daten löschen",
      "此操作不可恢复。": "Diese Aktion kann nicht rückgängig gemacht werden.",
      "已清空": "Daten gelöscht",
      "未找到录音文件": "Aufnahmedatei nicht gefunden",
      "未找到模型文件": "Modelldateien nicht gefunden",
      "需要下载以下模型": "Erforderliche Modelle herunterladen:",
      "模型下载队列": "Modell-Download-Warteschlange",
      "下载失败": "Download fehlgeschlagen. Verbindung prüfen.",
      "重试": "Erneut versuchen",
      "正在下载会议所需模型，完成后会自动开始录制": "Die für diese Besprechung benötigten Modelle werden heruntergeladen. Die Aufnahme beginnt automatisch, sobald alles bereit ist.",
      "正在下载模型，完成后会自动切换": "Das Modell wird heruntergeladen. Die Umschaltung erfolgt automatisch, sobald es bereit ist.",
      "当前系统不支持直接录制系统音频，请仅使用麦克风": "Direkte Systemaudio-Aufnahme wird auf diesem System nicht unterstützt. Verwenden Sie nur das Mikrofon.",
      "预期说话人数": "Erwartete Sprecherzahl",
      "留空自动匹配": "Leer lassen für automatische Auswahl",
      "工作区": "Arbeitsbereich",
      "自动匹配": "Automatisch auswählen",
      "音量": "Lautstärke",
      "请先在\"模型与设置\"中选择译文目标语言": "Wählen Sie zuerst unter „Modelle und Einstellungen“ eine Zielsprache.",
      "未知工作区": "Unbekannter Arbeitsbereich",
      "工作区会议": "Besprechungen im Arbeitsbereich",
      "创建一个新的工作区来组织会议": "Erstellen Sie einen Arbeitsbereich, um Besprechungen zu organisieren.",
      "工作区名称": "Name des Arbeitsbereichs",
      "描述": "Beschreibung",
      "（可选）": "(Optional)",
      "创建工作区": "Arbeitsbereich erstellen",
      "工作区已创建": "Arbeitsbereich erstellt",
      "编辑工作区": "Arbeitsbereich bearbeiten",
      "保存更改": "Änderungen speichern",
      "删除工作区": "Arbeitsbereich löschen",
      "工作区内的会议将移至最近删除。恢复会议时将还原原工作区。此操作不能撤销。": "Besprechungen in diesem Arbeitsbereich werden in „Zuletzt gelöscht“ verschoben. Beim Wiederherstellen wird auch ihr ursprünglicher Arbeitsbereich wiederhergestellt. Diese Aktion kann nicht rückgängig gemacht werden.",
      "工作区已删除": "Arbeitsbereich gelöscht",
      "工作区已更新": "Arbeitsbereich aktualisiert",
      "调整识别、端点检测、说话人分离和本地模型运行参数。": "Passen Sie Erkennung, Endpunkterkennung, Sprechertrennung und lokale Modelllaufzeitparameter an.",
      "下载": "Download",
      "下载中": "Wird heruntergeladen",
      "内置": "Integriert",
      "查看录音": "Aufnahmen anzeigen",
      "收起": "Einklappen",
      "选择录音并添加": "Aufnahme auswählen und hinzufügen",
      "播放录音": "Aufnahme abspielen",
      "已复制到剪贴板": "In die Zwischenablage kopiert",
      "暂无可分享的内容": "Noch nichts zu teilen",
      "进阶设置": "Erweiterte Einstellungen",
      "配置进阶设置": "Erweiterte Einstellungen konfigurieren",
      "恢复默认": "Standardwerte wiederherstellen",
      "确定": "Bestätigen",
      "已保存": "Gespeichert",
      "标记说话人": "Sprecher zuordnen",
      "选择已注册声纹或新建说话人。": "Wählen Sie einen registrierten Stimmabdruck oder erstellen Sie einen Sprecher.",
      "已注册声纹": "Registrierter Stimmabdruck",
      "新建说话人": "Neuer Sprecher",
      "说话人名称": "Sprechername",
      "可修改模型、端点静音、说话人分离及 sherpa-onnx 运行参数。": "Konfigurieren Sie Modelle, Endpunktstille, Sprechertrennung und sherpa-onnx-Laufzeitparameter.",
      "修改后会立即应用于下一次会议与精修。": "Änderungen gelten für die nächste Besprechung und Nachbearbeitung.",
      "添加录音到声纹库": "Aufnahme zum Stimmabdruck hinzufügen",
      "暂无已注册声纹": "Keine registrierten Stimmabdrücke",
      "已添加录音到声纹库": "Aufnahme zum Stimmabdruck hinzugefügt",
      "新增声纹": "Stimmabdruck erstellen",
      "声纹名称": "Name des Stimmabdrucks",
      "已创建声纹并添加录音": "Stimmabdruck erstellt und Aufnahme hinzugefügt",
      "确认": "Bestätigen",
      "重叠说话": "Überlappende Sprache",
      "请先选择或填写纪要模型。": "Wählen oder geben Sie zuerst ein Zusammenfassungsmodell an.",
      "请填写请求地址。": "Geben Sie die Anfrage-URL ein.",
      "请填写 API Key。": "Geben Sie den API-Schlüssel ein.",
      "纪要模型已保存": "Zusammenfassungsmodell gespeichert",
      "主导航": "Hauptnavigation",
      "Brevia 首页": "Brevia-Startseite",
      "在 GitHub 上查看 Brevia": "Brevia auf GitHub ansehen",
      "对齐音频": "Audio wird ausgerichtet",
      "准备精修": "Nachbearbeitung wird vorbereitet",
      "分析说话人": "Sprecher werden analysiert",
      "转写中": "Transkribieren",
      "整理结果": "Ergebnisse werden finalisiert",
      "未检测到麦克风设备，请在系统设置中开启麦克风访问权限": "Kein Mikrofon erkannt. Erlauben Sie in den Systemeinstellungen den Mikrofonzugriff.",
      "麦克风访问被拒绝，请在系统设置中允许应用使用麦克风后重试": "Der Mikrofonzugriff wurde verweigert. Erlauben Sie der App in den Systemeinstellungen die Verwendung des Mikrofons und versuchen Sie es erneut.",
      "麦克风被其他程序占用，请关闭占用麦克风的程序后重试": "Das Mikrofon wird von einem anderen Programm verwendet. Schließen Sie dieses Programm und versuchen Sie es erneut.",
      "无法获取麦克风": "Mikrofon nicht verfügbar",
      "无法获取系统音频，请检查系统权限后重试": "Systemaudio konnte nicht erfasst werden. Prüfen Sie die Systemberechtigungen und versuchen Sie es erneut.",
      "未检测到系统音频，请在系统设置中允许屏幕与系统音频录制后重试": "Kein Systemaudio erkannt. Erlauben Sie in den Systemeinstellungen die Aufnahme von Bildschirm und Systemaudio und versuchen Sie es erneut.",
      "麦克风没有可用的音频轨道": "Das Mikrofon hat keine verfügbare Audiospur",
      "至少选择一个音频输入": "Wählen Sie mindestens eine Audioeingabe aus",
      "系统音频未产生音频数据": "Systemaudio hat keine Audiodaten erzeugt",
      "麦克风未产生音频数据": "Das Mikrofon hat keine Audiodaten erzeugt",
      "加入笔记": "Zu Notizen hinzufügen",
      "标记当前时间点": "Zeitstempel einfügen",
      "已加入笔记": "Zu den Notizen hinzugefügt",
      "暂无字幕可插入": "Noch keine Untertitel zum Einfügen",
      "无法获取字幕内容": "Untertiteltext nicht verfügbar",
      "数字": "Zahl",
      "日期": "Datum",
      "问句": "Frage",
      "可能是一个结论": "Mögliche Schlussfolgerung",
      "可能的决策": "Mögliche Entscheidung",
      "可能的待办": "Mögliche Aufgabe",
      "重要数字": "Wichtige Zahl",
      "重要日期": "Wichtiges Datum",
      "待确认事项": "Zu bestätigen",
      "可能的风险": "Mögliches Risiko",
      "新话题": "Neues Thema",
      "补充": "Ergänzen",
      "忽略": "Ignorieren",
      "1 条建议": "1 Vorschlag",
      "AI 检测到新话题：": "KI hat ein neues Thema erkannt: ",
      "整理笔记": "Notizen ordnen",
      "校对": "Prüfen",
      "关联历史": "Verknüpfter Verlauf",
      "整理一下？": "Notizen ordnen?",
      "替换原内容": "Ersetzen",
      "插入整理版": "Geordnete Version einfügen",
      "修正": "Korrigieren",
      "保持原文": "Beibehalten",
      "查看原会议": "Besprechung öffnen",
      "和之前内容有关": "Bezug zu früherem Inhalt",
      "和会议原文可能存在差异": "Mögliche Abweichung vom Transkript",
      "字幕中说的是：": "Im Transkript steht:",
      "问 AI": "KI fragen",
      "问当前会议": "Zu dieser Besprechung fragen",
      "输入你的问题": "Frage eingeben",
      "提问": "Fragen",
      "搜索字幕…": "Untertitel durchsuchen…",
      "重点": "Wichtig",
      "插入表格": "Tabelle einfügen",
      "切换到富文本": "Zu Rich-Text wechseln",
      "切换到 Markdown": "Zu Markdown wechseln",
      "列 1": "Spalte 1",
      "列 2": "Spalte 2",
      "内容": "Inhalt",
      "重点：": "Hervorheben: ",
      "原始转写": "Originaltranskript",
      "列 {n}": "Spalte {n}",
      "选择行列数": "Tabellengröße wählen",
      "行数": "Zeilen",
      "列数": "Spalten",
      "插入": "Einfügen",
      "已暂停": "Pausiert",
      "系统默认": "Systemstandard",
      "麦克风设备": "Mikrofon",
      "刷新设备": "Geräte aktualisieren",
      "笔记已达容量上限，超出部分未保存。": "Die Notizen haben das Größenlimit erreicht; der Rest wurde nicht gespeichert.",
      "导出会议资料": "Besprechungsdateien exportieren",
      "笔记": "Notizen",
      "会议录音": "Besprechungsaufnahme",
      "混音录音": "Gemischte Aufnahme",
      "传送到应用": "An App senden",
      "在文件夹中显示": "Im Ordner anzeigen",
      "暂无笔记可导出": "Keine Notizen zum Exportieren",
      "查找": "Suchen",
      "替换为": "Ersetzen durch",
      "上一个": "Zurück",
      "下一个": "Weiter",
      "全部替换": "Alle ersetzen",
      "导出与分享": "Exportieren und teilen",
      "请先选择要导出的内容": "Wählen Sie zuerst aus, was exportiert werden soll",
      "依据 {count} 段字幕": "Basiert auf {count} Untertiteln",
      "图片必须是 PNG、JPEG、GIF 或 WebP，且不超过 10 MB。": "Das Bild muss PNG, JPEG, GIF oder WebP sein und kleiner als 10 MB sein.",
      "未找到匹配的会议": "Keine passenden Besprechungen",
      "{count} 条结果": "{count} Ergebnisse",
      "标题匹配": "Titeltreffer",
      "搜索会议、字幕或说话人…": "Besprechungen, Untertitel oder Sprecher suchen…",
      "该会议已有逐句修改。用新模型重新精修会按新模型重新分段，这些修改可能无法保留。": "Diese Besprechung enthält satzweise Änderungen. Eine erneute Nachbearbeitung mit einem anderen Modell segmentiert das Transkript neu; diese Änderungen bleiben möglicherweise nicht erhalten.",
      "开始精修": "Verfeinerung starten",
      "录制方式": "Aufnahmemodus",
      "自动（记住上次）": "Automatisch (letzte Auswahl merken)",
      "仅麦克风": "Nur Mikrofon",
      "仅系统音频": "Nur Systemaudio",
      "麦克风 + 系统音频": "Mikrofon + Systemaudio",
      "适合线下会议场景": "Für Präsenzbesprechungen",
      "适合网课、视频场景": "Für Unterricht und Videos",
      "适合线上会议场景": "Für Online-Besprechungen",
      "录制来源": "Aufnahmequellen",
      "采集模式": "Erfassungsmodus",
      "沿用上次成功录制的方式": "Letzten erfolgreichen Modus verwenden",
      "未启用": "Nicht aktiviert",
      "多语言混说": "Gemischte Sprachen",
      "翻译": "Übersetzen",
      "正在翻译字幕": "Untertitel werden übersetzt",
      "字幕文本": "Untertiteltext",
      "字幕已保存": "Untertitel gespeichert",
      "字幕内容不能为空": "Untertiteltext darf nicht leer sein",
      "保存失败": "Speichern fehlgeschlagen",
      "占用": "Auf Datenträger",
      "内存": "Speicher",
      "随应用安装": "Enthalten",
      "必需": "Erforderlich",
      "磁盘空间不足，请先清理空间再下载。": "Nicht genügend Speicherplatz. Schaffen Sie Platz und laden Sie erneut.",
      "文件校验未通过，下载可能已损坏，请删除后重试。": "Die Integritätsprüfung ist fehlgeschlagen; der Download ist möglicherweise beschädigt. Löschen und erneut versuchen.",
      "网络中断导致下载失败，请检查网络后重试。": "Der Download wurde unterbrochen. Prüfen Sie die Verbindung und versuchen Sie es erneut.",
      "模型不可用，请刷新模型库后重试。": "Dieses Modell ist nicht verfügbar. Öffnen Sie die Modellbibliothek erneut.",
      "已安装": "Installiert",
      "后退 15 秒": "15 Sekunden zurück",
      "前进 15 秒": "15 Sekunden vor",
      "请选择空文件夹。": "Wählen Sie einen leeren Ordner.",
      "请先结束会议、精修和模型下载，再更改文件夹。": "Beenden Sie Besprechungen, Nachbearbeitung und Modell-Downloads, bevor Sie Ordner ändern.",
      "模型和录音文件夹必须相互独立，且不能包含原数据文件夹。": "Modell- und Aufnahmeordner müssen getrennt sein und dürfen die bestehenden Datenordner nicht enthalten.",
      "此文件夹由环境变量指定，无法在应用内更改。": "Dieser Ordner wird durch eine Umgebungsvariable festgelegt und kann nicht in der App geändert werden.",
      "文件夹更改失败，请检查路径、磁盘连接和写入权限。": "Ordner konnten nicht geändert werden. Prüfen Sie Pfad, Laufwerksverbindung und Schreibrechte.",
      "error.operation_failed": "Der Vorgang ist fehlgeschlagen. Bitte versuchen Sie es erneut.",
      "error.audio_backpressure": "Die Audioverarbeitung kommt nicht nach. Die Aufnahme wird beendet; erfasstes Audio wird gespeichert.",
      "error.worker_exited": "Der Transkriptionsprozess wurde beendet.",
      "error.worker_recovery": "Die Aufnahme ist lokal gespeichert, aber die Transkription konnte nicht wiederhergestellt werden.",
      "error.storage_recovery": "Datenordner muss wiederhergestellt werden",
      "error.storage_recovery_hint": "Prüfen Sie die Datenträger und die Konfigurationsdatei. Originaldaten und Migrationsprotokolle bleiben erhalten. Starten Sie Brevia nach der Korrektur neu.",
      "error.storage_unavailable": "Der Datenordner ist nicht verfügbar. Verbinden Sie den Datenträger und starten Sie Brevia neu.",
      "error.summary.no_transcript": "Transkribieren Sie die Besprechung, bevor Sie Notizen erstellen.",
      "error.voice_sample_owned": "Diese Aufnahme gehört bereits zu einem anderen Stimmprofil.",
      "error.voice_sample_short": "Die Aufnahme ist zu kurz. Wählen Sie eine längere Sprachprobe.",
      "error.audio_not_found": "Audiodatei nicht gefunden. Prüfen Sie, ob sie noch vorhanden ist.",
      "error.audio_too_long": "Die Aufnahme überschreitet die zulässige Dauer für diesen Vorgang. Wählen Sie eine kürzere Aufnahme.",
      "error.refinement.no_audio": "Diese Besprechung hat keine Aufnahme zur Nachbearbeitung.",
      "error.tasks.running": "Warten Sie, bis die Hintergrundaufgaben abgeschlossen sind.",
      "error.meeting.active": "Beenden Sie zuerst die aktuelle Besprechung.",
      "error.sharing_not_confirmed": "Bestätigen Sie zuerst die Freigabe des Transkripts.",
      "error.segment_not_found": "Untertitel nicht gefunden. Aktualisieren Sie und versuchen Sie es erneut.",
      "error.command_too_large": "Der Inhalt überschreitet das Limit. Kürzen Sie ihn und versuchen Sie es erneut.",
      "error.summary.failed": "Notizen konnten nicht erstellt werden. Prüfen Sie die Einstellungen oder versuchen Sie es später erneut.",
      "error.timeout": "Der Vorgang ist abgelaufen. Bitte versuchen Sie es erneut.",
      "error.summary.live_meeting": "Live-Besprechung läuft. Beenden Sie sie, bevor Sie die Besprechungsnotizen erstellen.",
      "error.summary.empty_response": "Notizen konnten nicht erstellt werden: das Modell lieferte keine Inhalte. Bitte erneut versuchen.",
      "error.summary.authentication": "Der API-Schlüssel fehlt, ist ungültig oder wurde von diesem Anbieter abgelehnt."
    },
    "messages": {
      "recordingSaved": "Aufnahme gespeichert. Transkript wird vorbereitet.",
      "located": "Zum verknüpften Audiosegment gesprungen",
      "playing": "Gemischte Spur wird wiedergegeben",
      "paused": "Wiedergabe pausiert"
    }
  },
  "ru": {
    "views": {
      "home": "Все встречи",
      "prepare": "Подготовка записи",
      "live": "Идёт запись",
      "detail": "Сведения о встрече",
      "settings": "Настройки"
    },
    "labels": {
      "所有会议": "Все встречи",
      "最近删除": "Недавно удалённые",
      "设置": "Настройки",
      "开始会议": "Начать встречу",
      "会议库": "Библиотека встреч",
      "准备录制": "Подготовка записи",
      "实时字幕": "Субтитры в реальном времени",
      "会议详情": "Сведения о встрече",
      "本地优先": "Локальное хранение",
      "音频与文本仅保存在此设备": "Аудио и текст хранятся только на этом устройстве",
      "每一场对话，都留有依据。": "Каждый разговор оставляет проверяемую запись.",
      "录音、逐字稿和纪要只在你明确操作时导出或发送。": "Аудио, транскрипции и заметки экспортируются или отправляются только по вашему явному действию.",
      "搜索会议、逐字稿或标签": "Поиск встреч, расшифровок или тегов",
      "所有分类": "Все категории",
      "最近 30 天": "Последние 30 дней",
      "返回会议库": "Вернуться в библиотеку",
      "开始一场会议": "Начать встречу",
      "先确认语言与音频输入。模型会在开始前加载，录制过程不会因网络状态中断。": "Сначала выберите язык и источник аудио. Модель загружается до записи и работает независимо от сети.",
      "录制音频": "Запись аудио",
      "会议名称": "Название встречи",
      "会议语言": "Язык встречи",
      "译文目标": "Язык перевода",
      "我的麦克风": "Мой микрофон",
      "系统音频": "Системный звук",
      "输入良好": "Вход готов",
      "已就绪": "Готово",
      "当前模型": "Текущая модель",
      "中文确认文本与说话人分离": "Итоговая транскрипция на китайском и разделение говорящих",
      "管理模型与术语": "Управление моделями и терминами",
      "正在录制": "Идёт запись",
      "暂停": "Пауза",
      "继续": "Продолжить",
      "结束会议": "Завершить встречу",
      "保持在当下": "Сосредоточьтесь на разговоре",
      "译文: 开": "Перевод: вкл.",
      "译文: 关": "Перевод: выкл.",
      "回到最新": "К последним",
      "参与者": "Участники",
      "本场状态": "Статус сеанса",
      "我": "Я",
      "麦克风": "Микрофон",
      "打开会议面板": "Открыть панель встречи",
      "导出": "Экспорт",
      "逐字稿": "Расшифровка",
      "摘要": "Сводка",
      "纪要与待办": "Заметки и задачи",
      "播放此段": "Воспроизвести",
      "生成完整会议纪要": "Создать заметки встречи",
      "模型与本地数据": "Модели и локальные данные",
      "已安装模型": "Установленные модели",
      "术语库": "Глоссарий",
      "12 个词条可用于会议准备、搜索和纪要。仅支持的模型会将其用于转写。": "12 терминов доступны для подготовки встреч, поиска и заметок. При транскрипции их используют только совместимые модели.",
      "管理术语库": "Управление глоссарием",
      "存储与隐私": "Хранилище и конфиденциальность",
      "会议资料保存在此 Mac。外部 LLM 需要在发送逐字稿前明确确认。": "Данные встречи хранятся на этом Mac. Для внешних LLM требуется явное подтверждение.",
      "查看本地存储": "Открыть локальное хранилище",
      "中文": "Китайский",
      "英语": "Английский",
      "不需要翻译": "Без перевода",
      "自动 · 仅麦克风": "Авто · только микрофон",
      "自动 · 仅系统音频": "Авто · только системный звук",
      "自动音源": "Автоисточник",
      "自动检测": "Автоопределение",
      "切换语言": "Сменить язык",
      "切换主题": "Сменить тему",
      "Brevia": "Brevia",
      "向量数据库": "Векторная база данных",
      "ERes2Net": "ERes2Net",
      "最小化": "Свернуть",
      "关闭": "Закрыть",
      "取消": "Отмена",
      "返回": "Назад",
      "开始录制": "Начать запись",
      "继续会议": "Продолжить встречу",
      "我 · 麦克风": "Я · Микрофон",
      "计算设备": "Вычислительное устройство",
      "预计空间": "Ожидаемый объём",
      "识别模型": "Модель распознавания",
      "已应用术语": "Применённые термины",
      "12 个词条": "12 терминов",
      "可用": "Доступно",
      "已完成精修": "Уточнение завершено",
      "中文确认文本 · 1.2 GB": "Итоговая транскрипция на китайском · 1,2 ГБ",
      "英文与其他语言 · 466 MB": "Английский и другие языки · 466 МБ",
      "+ 9": "+ 9",
      "模型库": "Библиотека моделей",
      "管理模型库": "Управление библиотекой моделей",
      "纪要模型": "Модели сводки",
      "配置用于生成会议纪要的 API。所有配置信息仅保存在本地，不会上传。": "Настройте API для заметок встречи. Все настройки хранятся локально.",
      "管理纪要模型": "Управление моделями сводки",
      "总结提示词": "Инструкция для сводки",
      "编辑提示词": "Изменить инструкцию",
      "配置 JSON": "Конфигурация JSON",
      "当前启用的纪要模型配置。": "Конфигурация активной модели для сводки встречи.",
      "分钟": "мин",
      "本地录音": "Локальная запись",
      "本地保存": "Сохранено локально",
      "本地会议": "Локальная встреча",
      "检查音频": "Проверка аудио",
      "检测语音": "Обнаружение речи",
      "识别说话人": "Определение говорящих",
      "重新聚类说话人": "Повторная кластеризация говорящих",
      "匹配声纹": "Сопоставление голосовых отпечатков",
      "整理说话人": "Подготовка временной шкалы говорящих",
      "← 返回会议库": "← Вернуться в библиотеку",
      "说话人分离": "Разделение говорящих",
      "自定义术语": "Пользовательский термин",
      "暂无术语": "Нет терминов",
      "说话人": "Говорящий",
      "等待识别说话人": "Ожидание определения говорящего",
      "会议摘要": "Сводка встречи",
      "尚未生成会议摘要": "Сводки встречи пока нет",
      "转发": "Поделиться",
      "会后精修": "Обработка после встречи",
      "精修": "Уточнить",
      "精修字稿": "Уточнённая транскрипция",
      "完成精修后，这里会显示不带时间戳的校对稿。": "После уточнения здесь появится исправленный текст без временных меток.",
      "正在精修…": "Уточнение…",
      "会后精修已完成": "Уточнение после встречи завершено",
      "已整理": "Готово",
      "决定": "Решение",
      "待办": "Задача",
      "悬浮字幕": "Плавающие субтитры",
      "悬浮字幕：开": "Плавающие субтитры: вкл.",
      "⌖ 开": "⌖ Вкл.",
      "最近 7 天": "Последние 7 дней",
      "最近 90 天": "Последние 90 дней",
      "全部时间": "За всё время",
      "系统默认麦克风": "Системный микрофон по умолчанию",
      "需要授予屏幕与系统音频权限": "Требуется доступ к экрану и системному звуку",
      "中文 / 英语": "Китайский / английский",
      "更多操作": "Другие действия",
      "恢复": "Восстановить",
      "重命名": "Переименовать",
      "删除": "Удалить",
      "保存": "Сохранить",
      "添加": "Добавить",
      "公开工作区": "Общее рабочее пространство",
      "导入录音": "Импортировать запись",
      "语音对话": "Голосовой чат",
      "请先在声纹库注册可用声音": "Перед отправкой речи зарегистрируйте голосовой отпечаток",
      "录制权限": "Разрешения на запись",
      "首次使用时完成设置": "Завершите настройку при первом использовании",
      "录制你的发言。": "Записывает вашу речь.",
      "录制屏幕共享中的系统声音。": "Записывает системный звук при демонстрации экрана.",
      "稍后": "Позже",
      "言录需要以下系统权限以提供服务": "Для работы Brevia требуются следующие системные разрешения.",
      "应用设置": "Настройки приложения",
      "纪要不能为空": "Заметки встречи не могут быть пустыми.",
      "当前没有正在进行的会议": "Нет активной встречи.",
      "移至工作区": "Переместить в рабочее пространство",
      "已移至": "Перемещено в",
      "展开": "Развернуть",
      "屏幕与系统音频": "Экран и системный звук",
      "允许": "Разрешить",
      "已允许": "Разрешено",
      "请在系统设置中允许": "Разрешите Brevia доступ к экрану и системному звуку в системных настройках.",
      "已准备就绪": "Готово",
      "系统权限": "Системные разрешения",
      "打开系统设置": "Открыть системные настройки",
      "请在系统设置中开启此权限": "Отклонено. Включите это разрешение в системных настройках.",
      "结束中": "Завершение встречи…",
      "正在精修": "Обработка",
      "原版逐字稿仍可查看": "Исходная расшифровка остаётся доступна",
      "准备中": "Подготовка",
      "全选": "Выбрать все",
      "取消全选": "Снять выделение",
      "校正说话人": "Корректировка говорящих",
      "正在取消": "Отмена",
      "软件更新": "Обновления ПО",
      "检查更新": "Проверить обновления",
      "会议纪要已生成": "Заметки встречи созданы",
      "正在播放": "Воспроизведение",
      "操作失败": "Не удалось выполнить действие",
      "应用错误": "Ошибка приложения",
      "会后精修失败": "Не удалось обработать запись встречи",
      "发现可恢复录音": "Найдено восстанавливаемых записей: {count}",
      "离线功能": "Автономные функции",
      "请选择声音": "Сначала выберите голос",
      "请先配置翻译模型": "Сначала настройте модель перевода",
      "纪要服务拒绝了请求": "Поставщик сводки отклонил запрос",
      "纪要模型需要配置": "Настройте модель сводки",
      "请检查 API 地址、密钥和服务商访问策略。": "Проверьте URL API, ключ и политику доступа поставщика.",
      "API Key 未配置、已失效或不匹配当前服务。": "Ключ API отсутствует, недействителен или отклонён этим поставщиком.",
      "配置纪要模型": "Настроить модель",
      "内置纪要模型未配置": "Встроенная модель сводки не настроена",
      "请选择并下载一个内置纪要模型，之后即可完全离线生成纪要。": "Выберите и загрузите встроенную модель сводки, чтобы создавать заметки встречи полностью офлайн.",
      "选择纪要模型": "Выбрать модель",
      "刚刚": "Только что",
      "请先选择译文目标并配置纪要模型": "Сначала выберите язык перевода и настройте модель сводки",
      "将确认字幕发送到 {provider} 生成译文。是否继续？": "Отправить подтверждённые субтитры в {provider} для перевода?",
      "选择格式：md / txt / json / srt / docx / pdf / flac / wav / m4a": "Выберите формат: md / txt / json / srt / docx / pdf / flac / wav / m4a",
      "已导出「{title}」": "«{title}» экспортировано",
      "示例会议及录音已删除": "Пример встречи и запись удалены",
      "会议已移至最近删除": "Встреча перемещена в Недавно удалённые",
      "暂停录音": "Приостановить запись",
      "这场会议没有可播放的录音": "У этой встречи нет доступной для воспроизведения записи",
      "纪要配置加载失败": "Не удалось загрузить конфигурацию сводки",
      "配置或后端启动失败": "Не удалось запустить конфигурацию или серверную часть",
      "翻译失败": "Не удалось перевести",
      "压缩包已导出": "Архив экспортирован",
      "未找到录音，已导出逐字稿压缩包": "Запись не найдена; архив расшифровки экспортирован",
      "请前往「设置」>「AI 会议总结」，选择并下载内置纪要模型。": "Перейдите в «Настройки» > «ИИ-сводка встречи», чтобы выбрать и скачать встроенную модель.",
      "前往 AI 会议总结": "К ИИ-сводке встречи",
      "操作超时，请稍后重试": "Время ожидания операции истекло. Повторите попытку.",
      "实时会议中，结束后再生成会议纪要。": "Идёт встреча в реальном времени. Завершите её перед созданием заметок встречи.",
      "已有会议纪要正在生成，请稍候。": "Заметки для другой встречи уже создаются. Пожалуйста, подождите.",
      "字幕": "Субтитры",
      "字幕：开": "Субтитры: Вкл.",
      "字幕：关": "Субтитры: Выкл.",
      "新建工作区": "Новое рабочее пространство",
      "翻译：开": "Перевод: Вкл.",
      "翻译：关": "Перевод: Выкл.",
      "分享": "Поделиться",
      "精修字幕": "Уточнить субтитры",
      "已精修": "Обработано",
      "查看原始转写": "Показать исходную расшифровку",
      "查看精修字幕": "Показать обработанные субтитры",
      "精修全文": "Полный обработанный текст",
      "经过会后模型整理后的完整转写文本。由于当前模型不提供时间戳，该版本不支持逐句音频定位。": "Сплошной текст расшифровки, обработанный моделью после встречи. Поскольку эта модель не даёт временных меток, поиск по аудио по фрагментам не поддерживается.",
      "会议中没有记录笔记。": "Во время встречи заметки не велись.",
      "位参与者": "участников",
      "重新精修": "Обработать заново",
      "更换精修模型": "Сменить модель обработки",
      "尚未生成": "Ещё не создано",
      "生成纪要": "Создать заметки",
      "更多": "Ещё",
      "会议纪要": "Протокол встречи",
      "新建会议": "Новая встреча",
      "已生成纪要": "Заметки созданы",
      "完成": "Готово",
      "生成": "Создать",
      "重新生成": "Пересоздать",
      "笔记已达 20000 字符上限，超出部分未保存。": "Заметки ограничены 20 000 символами; остальное не сохранено.",
      "编辑": "Изменить",
      "搜索会议…": "Поиск встреч…",
      "复制会议纪要": "Скопировать заметки встречи",
      "已连接": "Подключено",
      "未就绪": "Не готово",
      "需要麦克风权限": "Требуется доступ к микрофону",
      "标准模式": "Стандартный режим",
      "我的笔记": "Мои заметки",
      "展开字幕": "Развернуть субтитры",
      "返回笔记": "К заметкам",
      "预览": "Предпросмотр",
      "记录笔记（支持 Markdown）": "Записывайте заметки здесь. Поддерживается Markdown.",
      "纪要生成失败：模型未返回有效内容，请稍后重试。": "Не удалось создать заметки: модель не вернула содержимое. Повторите попытку позже.",
      "富文本": "Форматированный текст",
      "加粗": "Жирный",
      "斜体": "Курсив",
      "标题 1": "Заголовок 1",
      "标题 2": "Заголовок 2",
      "标题 3": "Заголовок 3",
      "列表": "Список",
      "编号列表": "Нумерованный список",
      "引用": "Цитата",
      "插入链接": "Вставить ссылку",
      "插入图片": "Вставить изображение",
      "行内代码": "Встроенный код",
      "代码": "Код",
      "会议总结": "Сводка встречи",
      "管理会议总结": "Управление сводкой встречи",
      "AI 笔记与会议总结": "ИИ-заметки и сводка встречи",
      "配置用于生成会议总结和 AI 笔记的服务。所有配置信息仅保存在本地，不会上传。": "Настройте сервис для сводок встреч и ИИ-заметок. Все настройки хранятся только на этом устройстве.",
      "配置 AI 笔记与会议总结": "Настроить ИИ-заметки и сводку",
      "管理语言识别模型的下载、删除与版本信息。": "Управляйте загрузкой, удалением и сведениями о версиях моделей распознавания речи.",
      "VAD 模型": "Модель VAD",
      "查看完整内容": "Показать полностью",
      "会议人数": "Участники",
      "继续精修": "Продолжить обработку",
      "留空自动识别": "Оставьте пустым для автоопределения",
      "选择导出格式": "Выбрать формат экспорта",
      "播放进度": "Ход воспроизведения",
      "暂停播放": "Приостановить воспроизведение",
      "关闭播放": "Закрыть воспроизведение",
      "清空搜索": "Очистить поиск",
      "搜索结果": "Результаты поиска",
      "最近会议": "Недавние встречи",
      "展开会议纪要": "Развернуть заметки встречи",
      "请求建议": "Запросить подсказку",
      "还没有下载内置 AI 模型。": "Встроенная модель ИИ ещё не установлена.",
      "本次会议无法生成实时字幕": "Для этой встречи живые субтитры недоступны",
      "识别模型未能加载，录音仍在正常保存。会议结束后可在详情页生成完整逐字稿。": "Не удалось загрузить модель распознавания. Запись продолжается — полную расшифровку можно создать в деталях встречи после её завершения.",
      "实时字幕模型": "Модель субтитров в реальном времени",
      "说话人分离模型": "Модель разделения говорящих",
      "会后精修模型": "Модель обработки после встречи",
      "模型与设置": "Модели и настройки",
      "实时识别模型": "Модель распознавания в реальном времени",
      "精修模型": "Модель обработки",
      "从文件夹打开": "Открыть в папке",
      "清空数据": "Очистить данные",
      "此操作不可恢复。": "Это действие нельзя отменить.",
      "已清空": "Данные очищены",
      "未找到录音文件": "Файл записи не найден",
      "未找到模型文件": "Файлы модели не найдены",
      "需要下载以下模型": "Скачайте необходимые модели:",
      "模型下载队列": "Очередь загрузки моделей",
      "下载失败": "Не удалось скачать. Проверьте подключение.",
      "重试": "Повторить",
      "正在下载会议所需模型，完成后会自动开始录制": "Загружаются модели для этой встречи. Запись начнётся автоматически, когда всё будет готово.",
      "正在下载模型，完成后会自动切换": "Модель загружается. Переключение произойдёт автоматически, когда она будет готова.",
      "当前系统不支持直接录制系统音频，请仅使用麦克风": "Прямая запись системного аудио не поддерживается на этом устройстве. Используйте только микрофон.",
      "预期说话人数": "Ожидаемое число говорящих",
      "留空自动匹配": "Оставьте пустым для автоматического выбора",
      "工作区": "Рабочее пространство",
      "自动匹配": "Автоматический выбор",
      "音量": "Громкость",
      "请先在\"模型与设置\"中选择译文目标语言": "Сначала выберите целевой язык в разделе «Модели и настройки».",
      "未知工作区": "Неизвестное рабочее пространство",
      "工作区会议": "Встречи рабочего пространства",
      "创建一个新的工作区来组织会议": "Создайте рабочее пространство для организации встреч.",
      "工作区名称": "Название рабочего пространства",
      "描述": "Описание",
      "（可选）": "(Необязательно)",
      "创建工作区": "Создать рабочее пространство",
      "工作区已创建": "Рабочее пространство создано",
      "编辑工作区": "Изменить рабочее пространство",
      "保存更改": "Сохранить изменения",
      "删除工作区": "Удалить рабочее пространство",
      "工作区内的会议将移至最近删除。恢复会议时将还原原工作区。此操作不能撤销。": "Встречи из этого рабочего пространства будут перемещены в «Недавно удалённые». При восстановлении вернётся и исходное рабочее пространство. Это действие нельзя отменить.",
      "工作区已删除": "Рабочее пространство удалено",
      "工作区已更新": "Рабочее пространство обновлено",
      "调整识别、端点检测、说话人分离和本地模型运行参数。": "Настройте распознавание, определение конца фразы, разделение говорящих и параметры локальных моделей.",
      "下载": "Загрузка",
      "下载中": "Скачивание",
      "内置": "Встроено",
      "查看录音": "Просмотреть записи",
      "收起": "Свернуть",
      "选择录音并添加": "Выбрать и добавить запись",
      "播放录音": "Воспроизвести запись",
      "已复制到剪贴板": "Скопировано в буфер обмена",
      "暂无可分享的内容": "Пока нечем поделиться",
      "进阶设置": "Расширенные настройки",
      "配置进阶设置": "Настроить расширенные параметры",
      "恢复默认": "Восстановить значения по умолчанию",
      "确定": "Подтвердить",
      "已保存": "Сохранено",
      "标记说话人": "Назначить говорящего",
      "选择已注册声纹或新建说话人。": "Выберите зарегистрированный голосовой отпечаток или создайте говорящего.",
      "已注册声纹": "Зарегистрированный голосовой отпечаток",
      "新建说话人": "Новый говорящий",
      "说话人名称": "Имя говорящего",
      "可修改模型、端点静音、说话人分离及 sherpa-onnx 运行参数。": "Настройте модели, тишину конца фразы, разделение говорящих и параметры sherpa-onnx.",
      "修改后会立即应用于下一次会议与精修。": "Изменения применяются к следующей встрече и обработке.",
      "添加录音到声纹库": "Добавить запись в голосовой отпечаток",
      "暂无已注册声纹": "Нет зарегистрированных голосовых отпечатков",
      "已添加录音到声纹库": "Запись добавлена в голосовой отпечаток",
      "新增声纹": "Создать голосовой отпечаток",
      "声纹名称": "Имя голосового отпечатка",
      "已创建声纹并添加录音": "Голосовой отпечаток создан, запись добавлена",
      "确认": "Подтвердить",
      "重叠说话": "Перекрывающаяся речь",
      "请先选择或填写纪要模型。": "Сначала выберите или укажите модель сводки.",
      "请填写请求地址。": "Укажите URL запроса.",
      "请填写 API Key。": "Укажите ключ API.",
      "纪要模型已保存": "Модель сводки сохранена",
      "主导航": "Основная навигация",
      "Brevia 首页": "Главная Brevia",
      "在 GitHub 上查看 Brevia": "Посмотреть Brevia на GitHub",
      "对齐音频": "Выравнивание аудио",
      "准备精修": "Подготовка обработки",
      "分析说话人": "Анализ говорящих",
      "转写中": "Расшифровка",
      "整理结果": "Подготовка результатов",
      "未检测到麦克风设备，请在系统设置中开启麦克风访问权限": "Микрофон не обнаружен. Разрешите доступ к микрофону в системных настройках.",
      "麦克风访问被拒绝，请在系统设置中允许应用使用麦克风后重试": "Доступ к микрофону отклонён. Разрешите приложению использовать микрофон в системных настройках и повторите попытку.",
      "麦克风被其他程序占用，请关闭占用麦克风的程序后重试": "Микрофон занят другой программой. Закройте её и повторите попытку.",
      "无法获取麦克风": "Не удалось получить доступ к микрофону",
      "无法获取系统音频，请检查系统权限后重试": "Не удалось получить системный звук. Проверьте системные разрешения и повторите попытку.",
      "未检测到系统音频，请在系统设置中允许屏幕与系统音频录制后重试": "Системный звук не обнаружен. Разрешите запись экрана и системного звука в системных настройках и повторите попытку.",
      "麦克风没有可用的音频轨道": "У микрофона нет доступной звуковой дорожки",
      "至少选择一个音频输入": "Выберите хотя бы один источник звука",
      "系统音频未产生音频数据": "Системный звук не дал аудиоданных",
      "麦克风未产生音频数据": "Микрофон не дал аудиоданных",
      "加入笔记": "Добавить в заметки",
      "标记当前时间点": "Вставить время",
      "已加入笔记": "Добавлено в заметки",
      "暂无字幕可插入": "Пока нет субтитров для вставки",
      "无法获取字幕内容": "Текст субтитров недоступен",
      "数字": "Число",
      "日期": "Дата",
      "问句": "Вопрос",
      "可能是一个结论": "Возможный вывод",
      "可能的决策": "Возможное решение",
      "可能的待办": "Возможная задача",
      "重要数字": "Важная цифра",
      "重要日期": "Важная дата",
      "待确认事项": "Уточнить",
      "可能的风险": "Возможный риск",
      "新话题": "Новая тема",
      "补充": "Дополнить",
      "忽略": "Игнорировать",
      "1 条建议": "1 предложение",
      "AI 检测到新话题：": "ИИ обнаружил новую тему: ",
      "整理笔记": "Упорядочить заметки",
      "校对": "Проверить",
      "关联历史": "Связанная история",
      "整理一下？": "Упорядочить заметки?",
      "替换原内容": "Заменить",
      "插入整理版": "Вставить упорядоченную версию",
      "修正": "Исправить",
      "保持原文": "Оставить как есть",
      "查看原会议": "Открыть встречу",
      "和之前内容有关": "Связано с прошлым",
      "和会议原文可能存在差异": "Возможное расхождение с расшифровкой",
      "字幕中说的是：": "В расшифровке сказано:",
      "问 AI": "Спросить ИИ",
      "问当前会议": "Спросить об этой встрече",
      "输入你的问题": "Введите вопрос",
      "提问": "Спросить",
      "搜索字幕…": "Поиск субтитров…",
      "重点": "Важно",
      "插入表格": "Вставить таблицу",
      "切换到富文本": "Переключить на форматированный текст",
      "切换到 Markdown": "Переключить на Markdown",
      "列 1": "Столбец 1",
      "列 2": "Столбец 2",
      "内容": "Содержимое",
      "重点：": "Важно: ",
      "原始转写": "Исходная расшифровка",
      "列 {n}": "Столбец {n}",
      "选择行列数": "Выбрать размер таблицы",
      "行数": "Строк",
      "列数": "Столбцов",
      "插入": "Вставить",
      "已暂停": "Пауза",
      "系统默认": "По умолчанию",
      "麦克风设备": "Микрофон",
      "刷新设备": "Обновить устройства",
      "笔记已达容量上限，超出部分未保存。": "Заметки достигли лимита размера; остальное не сохранено.",
      "导出会议资料": "Экспорт файлов встречи",
      "笔记": "Заметки",
      "会议录音": "Запись встречи",
      "混音录音": "Смешанная запись",
      "传送到应用": "Отправить в приложение",
      "在文件夹中显示": "Показать в папке",
      "暂无笔记可导出": "Нет заметок для экспорта",
      "查找": "Найти",
      "替换为": "Заменить на",
      "上一个": "Предыдущее",
      "下一个": "Следующее",
      "全部替换": "Заменить всё",
      "导出与分享": "Экспорт и отправка",
      "请先选择要导出的内容": "Сначала выберите, что экспортировать",
      "依据 {count} 段字幕": "На основе {count} субтитров",
      "图片必须是 PNG、JPEG、GIF 或 WebP，且不超过 10 MB。": "Изображение должно быть в формате PNG, JPEG, GIF или WebP и меньше 10 МБ.",
      "未找到匹配的会议": "Совпадений не найдено",
      "{count} 条结果": "{count} результатов",
      "标题匹配": "Совпадение по названию",
      "搜索会议、字幕或说话人…": "Поиск встреч, субтитров или говорящих…",
      "该会议已有逐句修改。用新模型重新精修会按新模型重新分段，这些修改可能无法保留。": "В этой встрече есть построчные правки. Повторная обработка другой моделью заново разобьёт транскрипт, поэтому эти правки могут не сохраниться.",
      "开始精修": "Начать обработку",
      "录制方式": "Режим записи",
      "自动（记住上次）": "Авто (запомнить последнее)",
      "仅麦克风": "Только микрофон",
      "仅系统音频": "Только системный звук",
      "麦克风 + 系统音频": "Микрофон + системный звук",
      "适合线下会议场景": "Для очных встреч",
      "适合网课、视频场景": "Для занятий и видео",
      "适合线上会议场景": "Для онлайн-встреч",
      "录制来源": "Источники записи",
      "采集模式": "Режим захвата",
      "沿用上次成功录制的方式": "Использовать последний успешный режим",
      "未启用": "Не включено",
      "多语言混说": "Смешанные языки",
      "翻译": "Перевод",
      "正在翻译字幕": "Перевод субтитров",
      "字幕文本": "Текст субтитра",
      "字幕已保存": "Субтитры сохранены",
      "字幕内容不能为空": "Текст субтитра не может быть пустым",
      "保存失败": "Не удалось сохранить",
      "占用": "На диске",
      "内存": "Память",
      "随应用安装": "В комплекте",
      "必需": "Обязательно",
      "磁盘空间不足，请先清理空间再下载。": "Недостаточно места на диске. Освободите место и повторите загрузку.",
      "文件校验未通过，下载可能已损坏，请删除后重试。": "Проверка целостности не пройдена — файл может быть повреждён. Удалите его и повторите.",
      "网络中断导致下载失败，请检查网络后重试。": "Загрузка прервана. Проверьте соединение и повторите.",
      "模型不可用，请刷新模型库后重试。": "Эта модель недоступна. Откройте библиотеку моделей заново.",
      "已安装": "Установлено",
      "后退 15 秒": "Назад на 15 секунд",
      "前进 15 秒": "Вперёд на 15 секунд",
      "请选择空文件夹。": "Выберите пустую папку.",
      "请先结束会议、精修和模型下载，再更改文件夹。": "Завершите встречи, уточнение расшифровки и загрузку моделей перед сменой папок.",
      "模型和录音文件夹必须相互独立，且不能包含原数据文件夹。": "Папки моделей и записей должны быть отдельными и не содержать существующие папки данных.",
      "此文件夹由环境变量指定，无法在应用内更改。": "Эта папка задана переменной окружения и не может быть изменена в приложении.",
      "文件夹更改失败，请检查路径、磁盘连接和写入权限。": "Не удалось изменить папки. Проверьте путь, подключение диска и права записи.",
      "error.operation_failed": "Не удалось выполнить действие. Повторите попытку.",
      "error.audio_backpressure": "Обработка аудио отстаёт. Запись останавливается; записанное аудио будет сохранено.",
      "error.worker_exited": "Процесс транскрипции завершился.",
      "error.worker_recovery": "Запись сохранена локально, но транскрипцию восстановить не удалось.",
      "error.storage_recovery": "Требуется восстановление папки данных",
      "error.storage_recovery_hint": "Проверьте накопители и файл конфигурации. Исходные данные и журнал переноса сохранены. После исправления перезапустите Brevia.",
      "error.storage_unavailable": "Папка данных недоступна. Подключите накопитель и перезапустите Brevia.",
      "error.summary.no_transcript": "Сначала расшифруйте встречу, затем создайте заметки.",
      "error.voice_sample_owned": "Эта запись уже принадлежит другому голосовому профилю.",
      "error.voice_sample_short": "Запись слишком короткая. Выберите более длинный образец голоса.",
      "error.audio_not_found": "Аудиофайл не найден. Проверьте, существует ли он.",
      "error.audio_too_long": "Запись превышает допустимую длительность для этой операции. Выберите более короткую запись.",
      "error.refinement.no_audio": "У этой встречи нет записи для обработки.",
      "error.tasks.running": "Дождитесь завершения фоновых задач.",
      "error.meeting.active": "Сначала завершите текущую встречу.",
      "error.sharing_not_confirmed": "Сначала подтвердите передачу расшифровки.",
      "error.segment_not_found": "Фрагмент субтитров не найден. Обновите и повторите попытку.",
      "error.command_too_large": "Содержимое превышает лимит. Сократите его и повторите попытку.",
      "error.summary.failed": "Не удалось создать заметки. Проверьте настройки или повторите попытку позже.",
      "error.timeout": "Время ожидания операции истекло. Повторите попытку.",
      "error.summary.live_meeting": "Идёт встреча в реальном времени. Завершите её перед созданием заметок встречи.",
      "error.summary.empty_response": "Не удалось создать заметки: модель не вернула содержимое. Повторите попытку позже.",
      "error.summary.authentication": "Ключ API отсутствует, недействителен или отклонён этим поставщиком."
    },
    "messages": {
      "recordingSaved": "Запись сохранена. Подготавливается расшифровка.",
      "located": "Переход к связанному фрагменту аудио",
      "playing": "Воспроизводится смешанная дорожка",
      "paused": "Воспроизведение приостановлено"
    }
  }
};

const appCopy = {
  "stageLabels": {
    "AI 功能": {"zh": "AI 功能", "en": "AI features", "es": "Funciones de IA", "ja": "AI 機能", "ko": "AI 기능", "fr": "Fonctions IA", "de": "KI-Funktionen", "ru": "Функции ИИ"},
    "配置 AI 功能": {"zh": "配置 AI 功能", "en": "Configure AI features", "es": "Configurar funciones de IA", "ja": "AI 機能を設定", "ko": "AI 기능 설정", "fr": "Configurer les fonctions IA", "de": "KI-Funktionen konfigurieren", "ru": "Настроить функции ИИ"},
    "配置 AI 模型会议纪要，以及智能笔记。": {"zh": "配置 AI 模型会议纪要，以及智能笔记。", "en": "Configure AI models for meeting notes and smart notes.", "es": "Configura modelos de IA para actas de reuniones y notas inteligentes.", "ja": "議事録とスマートメモに使う AI モデルを設定します。", "ko": "회의록과 스마트 노트에 사용할 AI 모델을 설정하세요.", "fr": "Configurez les modèles IA pour les comptes rendus et les notes intelligentes.", "de": "KI-Modelle für Besprechungsprotokolle und intelligente Notizen konfigurieren.", "ru": "Настройте ИИ-модели для протоколов встреч и умных заметок."},
    "性能": {
      "zh": "性能",
      "en": "Performance",
      "es": "Rendimiento",
      "ja": "パフォーマンス",
      "ko": "성능",
      "fr": "Performance",
      "de": "Leistung",
      "ru": "Производительность"
    },
    "本机用户": {
      "zh": "本机用户",
      "en": "Local user",
      "es": "Usuario local",
      "ja": "ローカルユーザー",
      "ko": "로컬 사용자",
      "fr": "Utilisateur local",
      "de": "Lokaler Benutzer",
      "ru": "Локальный пользователь"
    },
    "本机": {
      "zh": "本机",
      "en": "Local",
      "es": "Local",
      "ja": "ローカル",
      "ko": "로컬",
      "fr": "Local",
      "de": "Lokal",
      "ru": "Локальный"
    },
    "远端": {
      "zh": "远端",
      "en": "Remote",
      "es": "Remoto",
      "ja": "リモート",
      "ko": "원격",
      "fr": "Distant",
      "de": "Remote",
      "ru": "Удалённый"
    },
    "标准模式": {
      "zh": "标准模式",
      "en": "Standard",
      "es": "Estándar",
      "ja": "標準",
      "ko": "표준",
      "fr": "Standard",
      "de": "Standard",
      "ru": "Стандартный"
    },
    "本机性能有限，建议使用更小的内置模型（如 2B）或在线 LLM API，以获得更流畅的实时体验。": {
      "zh": "本机性能有限，建议使用更小的内置模型（如 2B）或在线 LLM API，以获得更流畅的实时体验。",
      "en": "This device has limited performance. Consider a smaller built-in model (e.g. 2B) or an online LLM API for a smoother real-time experience.",
      "es": "Este equipo tiene rendimiento limitado. Considera un modelo integrado más pequeño (p. ej. 2B) o una API LLM en línea.",
      "ja": "この端末は性能が限られています。より小さい内蔵モデル（例：2B）やオンライン LLM API の利用をお勧めします。",
      "ko": "이 기기의 성능이 제한적입니다. 더 작은 내장 모델(예: 2B)이나 온라인 LLM API를 권장합니다.",
      "fr": "Appareil aux performances limitées. Envisagez un modèle intégré plus petit (ex. 2B) ou une API LLM en ligne.",
      "de": "Dieses Gerät hat begrenzte Leistung. Erwägen Sie ein kleineres integriertes Modell (z. B. 2B) oder eine Online-LLM-API.",
      "ru": "Ограниченная производительность устройства. Рекомендуется меньшая встроенная модель (напр. 2B) или онлайн-LLM API."
    },
    "改用 2B AI 笔记模型": {
      "zh": "改用 2B AI 笔记模型",
      "en": "Use the 2B AI-notes model",
      "es": "Usar el modelo 2B para notas IA",
      "ja": "2B AIメモモデルを使用",
      "ko": "2B AI 메모 모델 사용",
      "fr": "Utiliser le modèle 2B pour les notes IA",
      "de": "2B-Modell für KI-Notizen verwenden",
      "ru": "Использовать 2B-модель для ИИ-заметок"
    },
    "请先下载 2B AI 模型。": {
      "zh": "请先下载 2B AI 模型。",
      "en": "Download the 2B AI model first.",
      "es": "Primero descarga el modelo IA 2B.",
      "ja": "先に2B AIモデルをダウンロードしてください。",
      "ko": "먼저 2B AI 모델을 다운로드하세요.",
      "fr": "Téléchargez d’abord le modèle IA 2B.",
      "de": "Laden Sie zuerst das 2B-KI-Modell herunter.",
      "ru": "Сначала загрузите ИИ-модель 2B."
    },
    "AI 笔记已切换为 2B 模型。": {
      "zh": "AI 笔记已切换为 2B 模型。",
      "en": "AI notes now use the 2B model.",
      "es": "Las notas IA ahora usan el modelo 2B.",
      "ja": "AIメモを2Bモデルに切り替えました。",
      "ko": "AI 메모를 2B 모델로 전환했습니다.",
      "fr": "Les notes IA utilisent maintenant le modèle 2B.",
      "de": "KI-Notizen verwenden jetzt das 2B-Modell.",
      "ru": "ИИ-заметки теперь используют 2B-модель."
    },
    "暂时停用 AI 笔记": {
      "zh": "暂时停用 AI 笔记",
      "en": "Temporarily disable AI notes",
      "es": "Desactivar temporalmente las notas IA",
      "ja": "AIメモを一時停止",
      "ko": "AI 메모 일시 중지",
      "fr": "Désactiver temporairement les notes IA",
      "de": "KI-Notizen vorübergehend deaktivieren",
      "ru": "Временно отключить ИИ-заметки"
    },
    "AI 笔记已暂时停用。": {
      "zh": "AI 笔记已暂时停用。",
      "en": "AI notes are temporarily disabled.",
      "es": "Las notas IA se desactivaron temporalmente.",
      "ja": "AIメモを一時停止しました。",
      "ko": "AI 메모를 일시 중지했습니다.",
      "fr": "Les notes IA sont temporairement désactivées.",
      "de": "KI-Notizen sind vorübergehend deaktiviert.",
      "ru": "ИИ-заметки временно отключены."
    },
    "AI 笔记已保存": {
      "zh": "AI 笔记已保存",
      "en": "AI notes saved",
      "es": "Notas IA guardadas",
      "ja": "AIメモを保存しました",
      "ko": "AI 메모를 저장했습니다",
      "fr": "Notes IA enregistrées",
      "de": "KI-Notizen gespeichert",
      "ru": "ИИ-заметки сохранены"
    },
    "AI 笔记配置加载失败": {
      "zh": "AI 笔记配置加载失败",
      "en": "Failed to load AI-notes configuration",
      "es": "No se pudo cargar la configuración de notas IA",
      "ja": "AIメモ設定を読み込めませんでした",
      "ko": "AI 메모 설정을 불러오지 못했습니다",
      "fr": "Échec du chargement de la configuration des notes IA",
      "de": "KI-Notizkonfiguration konnte nicht geladen werden",
      "ru": "Не удалось загрузить настройки ИИ-заметок"
    },
    "保存配置": {
      "zh": "保存配置",
      "en": "Save configuration",
      "es": "Guardar configuración",
      "ja": "設定を保存",
      "ko": "설정 저장",
      "fr": "Enregistrer la configuration",
      "de": "Konfiguration speichern",
      "ru": "Сохранить настройки"
    },
    "AI 笔记模型已保存": {
      "zh": "AI 笔记模型已保存",
      "en": "AI-notes model saved",
      "es": "Modelo de notas IA guardado",
      "ja": "AIメモモデルを保存しました",
      "ko": "AI 메모 모델을 저장했습니다",
      "fr": "Modèle de notes IA enregistré",
      "de": "KI-Notizmodell gespeichert",
      "ru": "Модель ИИ-заметок сохранена"
    },
    "AI 笔记模型": {
      "zh": "AI 笔记模型",
      "en": "AI-notes model",
      "es": "Modelo de notas IA",
      "ja": "AIメモモデル",
      "ko": "AI 메모 모델",
      "fr": "Modèle de notes IA",
      "de": "KI-Notizmodell",
      "ru": "Модель ИИ-заметок"
    },
    "请先选择或填写 AI 笔记模型。": {
      "zh": "请先选择或填写 AI 笔记模型。",
      "en": "Choose or enter an AI-notes model first.",
      "es": "Elige o introduce primero un modelo de notas IA.",
      "ja": "先に AIメモモデルを選択または入力してください。",
      "ko": "먼저 AI 메모 모델을 선택하거나 입력하세요.",
      "fr": "Choisissez ou saisissez d’abord un modèle de notes IA.",
      "de": "Wählen oder geben Sie zuerst ein KI-Notizmodell ein.",
      "ru": "Сначала выберите или укажите модель ИИ-заметок."
    },
    "模型": {
      "zh": "模型",
      "en": "Model",
      "es": "Modelo",
      "ja": "モデル",
      "ko": "모델",
      "fr": "Modèle",
      "de": "Modell",
      "ru": "Модель"
    },
    "AI 笔记": {
      "zh": "AI 笔记",
      "en": "AI notes",
      "es": "Notas de IA",
      "ja": "AI メモ",
      "ko": "AI 메모",
      "fr": "Notes IA",
      "de": "KI-Notizen",
      "ru": "ИИ-заметки"
    },
    "AI 会议总结": {
      "zh": "AI 会议总结",
      "en": "AI meeting summary",
      "es": "Resumen de reunión con IA",
      "ja": "AI 会議要約",
      "ko": "AI 회의 요약",
      "fr": "Résumé de réunion IA",
      "de": "KI-Besprechungszusammenfassung",
      "ru": "ИИ-сводка встречи"
    },
    "配置会中的 AI 建议、模型与 API Key。所有配置信息仅保存在本地。": {
      "zh": "配置会中的 AI 建议、模型与 API Key。所有配置信息仅保存在本地。",
      "en": "Configure in-meeting AI suggestions, the model, and API key. All configuration stays on this device.",
      "es": "Configura sugerencias de IA durante la reunión, el modelo y la clave API. Todo permanece en este dispositivo.",
      "ja": "会議中の AI 提案、モデル、API キーを設定します。すべての設定はこの端末に保存されます。",
      "ko": "회의 중 AI 제안, 모델 및 API 키를 구성합니다. 모든 설정은 이 기기에만 저장됩니다.",
      "fr": "Configurez les suggestions IA en réunion, le modèle et la clé API. Tout reste sur cet appareil.",
      "de": "Konfigurieren Sie KI-Vorschläge in Besprechungen, Modell und API-Key. Alle Einstellungen bleiben auf diesem Gerät.",
      "ru": "Настройте ИИ-подсказки в ходе встречи, модель и API-ключ. Все настройки хранятся на этом устройстве."
    },
    "配置 AI 笔记": {
      "zh": "配置 AI 笔记",
      "en": "Configure AI notes",
      "es": "Configurar notas de IA",
      "ja": "AIメモを設定",
      "ko": "AI 메모 구성",
      "fr": "Configurer les notes IA",
      "de": "KI-Notizen konfigurieren",
      "ru": "Настроить ИИ-заметки"
    },
    "配置 AI 会议总结": {
      "zh": "配置 AI 会议总结",
      "en": "Configure AI meeting summary",
      "es": "Configurar resumen de reunión con IA",
      "ja": "AI会議要約を設定",
      "ko": "AI 회의 요약 구성",
      "fr": "Configurer le résumé de réunion IA",
      "de": "KI-Besprechungszusammenfassung konfigurieren",
      "ru": "Настроить ИИ-сводку встречи"
    },
    "配置会后会议总结的模型与 API Key，不影响实时字幕。": {
      "zh": "配置会后会议总结的模型与 API Key，不影响实时字幕。",
      "en": "Configure the model and API key for post-meeting summaries; it does not affect live captions.",
      "es": "Configura el modelo y la clave API para resúmenes posteriores; no afecta los subtítulos en vivo.",
      "ja": "会議後の要約用モデルと API キーを設定します。ライブ字幕には影響しません。",
      "ko": "회의 후 요약의 모델과 API 키를 구성하며 실시간 자막에는 영향을 주지 않습니다.",
      "fr": "Configurez le modèle et la clé API des résumés après réunion ; sans effet sur les sous-titres en direct.",
      "de": "Konfigurieren Sie Modell und API-Key für Zusammenfassungen nach Besprechungen; Live-Untertitel bleiben unbeeinflusst.",
      "ru": "Настройте модель и API-ключ для итогов после встречи; это не влияет на субтитры."
    },
    "仅用于会中的实时建议；切换后立即生效。": {
      "zh": "仅用于会中的实时建议；切换后立即生效。",
      "en": "Used only for live suggestions during a meeting; changes apply immediately.",
      "es": "Solo se usa para sugerencias en vivo; los cambios se aplican de inmediato.",
      "ja": "会議中のリアルタイム提案にのみ使用します。変更はすぐに反映されます。",
      "ko": "회의 중 실시간 제안에만 사용하며 변경 사항은 즉시 적용됩니다.",
      "fr": "Utilisé uniquement pour les suggestions en direct ; les changements sont immédiats.",
      "de": "Nur für Live-Vorschläge in Besprechungen; Änderungen wirken sofort.",
      "ru": "Используется только для подсказок в ходе встречи; изменения применяются сразу."
    },
    "仅用于会后生成总结，不影响实时字幕。": {
      "zh": "仅用于会后生成总结，不影响实时字幕。",
      "en": "Used only for post-meeting summaries; it does not affect live captions.",
      "es": "Solo se usa para resúmenes posteriores; no afecta los subtítulos en vivo.",
      "ja": "会議後の要約にのみ使用し、ライブ字幕には影響しません。",
      "ko": "회의 후 요약에만 사용하며 실시간 자막에는 영향을 주지 않습니다.",
      "fr": "Utilisé uniquement pour les résumés après la réunion ; sans effet sur les sous-titres en direct.",
      "de": "Nur für Zusammenfassungen nach der Besprechung; Live-Untertitel bleiben unbeeinflusst.",
      "ru": "Используется только для итогов после встречи и не влияет на субтитры."
    },
    "尚未配置": {
      "zh": "尚未配置",
      "en": "Not configured",
      "es": "Sin configurar",
      "ja": "未設定",
      "ko": "구성되지 않음",
      "fr": "Non configuré",
      "de": "Nicht konfiguriert",
      "ru": "Не настроено"
    },
    "下载和管理本地语音识别模型，为字幕、精修和说话人识别提供能力。": {
      "zh": "下载和管理本地语音识别模型，为字幕、精修和说话人识别提供能力。",
      "en": "Download and manage local speech models for captions, refinement, and speaker recognition.",
      "es": "Descarga y gestiona modelos locales para subtítulos, refinamiento y reconocimiento de hablantes.",
      "ja": "字幕・高精度化・話者認識に使うローカル音声モデルをダウンロード・管理します。",
      "ko": "자막, 정교화, 화자 인식에 쓰는 로컬 음성 모델을 다운로드하고 관리합니다.",
      "fr": "Téléchargez et gérez les modèles vocaux locaux pour les sous-titres, l’affinage et la reconnaissance des locuteurs.",
      "de": "Lokale Sprachmodelle für Untertitel, Nachbearbeitung und Sprechererkennung herunterladen und verwalten.",
      "ru": "Скачивайте и управляйте локальными речевыми моделями для субтитров, обработки и распознавания говорящих."
    },
    "让 AI 在会议中帮你发现重点、提取待办并整理笔记。": {
      "zh": "让 AI 在会议中帮你发现重点、提取待办并整理笔记。",
      "en": "Let AI surface key points, extract action items, and organize notes during a meeting.",
      "es": "Deja que la IA detecte puntos clave, extraiga tareas y organice notas durante la reunión.",
      "ja": "会議中に AI が要点の発見、ToDo の抽出、メモ整理を支援します。",
      "ko": "회의 중 AI가 핵심 포인트를 찾고 할 일을 추출해 메모를 정리합니다.",
      "fr": "L’IA repère les points clés, extrait les actions et organise les notes pendant la réunion.",
      "de": "KI erkennt in der Besprechung Kernpunkte, extrahiert Aufgaben und ordnet Notizen.",
      "ru": "ИИ выделяет ключевые моменты, извлекает задачи и упорядочивает заметки во время встречи."
    },
    "会议结束后，AI 自动把整场对话整理成会议纪要及待办事项。": {
      "zh": "会议结束后，AI 自动把整场对话整理成会议纪要及待办事项。",
      "en": "After a meeting, AI turns the transcript into structured notes and action items.",
      "es": "Al terminar la reunión, la IA convierte la transcripción en notas y tareas estructuradas.",
      "ja": "会議後、AI が文字起こしを構造化された議事録と ToDo にまとめます。",
      "ko": "회의가 끝나면 AI가 녹취를 구조화된 회의록과 할 일로 정리합니다.",
      "fr": "Après la réunion, l’IA transforme la transcription en notes structurées et actions.",
      "de": "Nach der Besprechung erstellt KI aus dem Transkript strukturierte Notizen und Aufgaben.",
      "ru": "После встречи ИИ превращает расшифровку в структурированные заметки и задачи."
    },
    "为特定会议环境微调识别、端点检测、说话人分离和本地模型。": {
      "zh": "为特定会议环境微调识别、端点检测、说话人分离和本地模型。",
      "en": "Fine-tune recognition, endpoint detection, diarization, and local models for your meeting environment.",
      "es": "Ajusta reconocimiento, detección de final, separación de hablantes y modelos locales.",
      "ja": "会議環境に合わせて認識、終端検出、話者分離、ローカルモデルを調整します。",
      "ko": "회의 환경에 맞춰 인식, 끝점 감지, 화자 분리 및 로컬 모델을 미세 조정합니다.",
      "fr": "Ajustez la reconnaissance, la détection de fin, la séparation des locuteurs et les modèles locaux.",
      "de": "Erkennung, Endpunkterkennung, Sprechertrennung und lokale Modelle an Ihre Umgebung anpassen.",
      "ru": "Настройте распознавание, определение конца фразы, разделение говорящих и локальные модели."
    },
    "查看和管理保存在此设备上的会议录音、会议纪要与模型。": {
      "zh": "查看和管理保存在此设备上的会议录音、会议纪要与模型。",
      "en": "View and manage meeting recordings, meeting notes, and models stored on this device.",
      "es": "Consulta y gestiona las grabaciones, actas de reuniones y modelos guardados en este dispositivo.",
      "ja": "このデバイスに保存された会議の録音、議事録、モデルを確認・管理します。",
      "ko": "이 기기에 저장된 회의 녹음, 회의록 및 모델을 확인하고 관리합니다.",
      "fr": "Consultez et gérez les enregistrements, comptes rendus de réunion et modèles stockés sur cet appareil.",
      "de": "Auf diesem Gerät gespeicherte Besprechungsaufnahmen, Protokolle und Modelle anzeigen und verwalten.",
      "ru": "Просматривайте записи встреч, протоколы и модели, сохранённые на этом устройстве, и управляйте ими."
    },
    "推荐": {
      "zh": "推荐",
      "en": "Recommended",
      "es": "Recomendado",
      "ja": "おすすめ",
      "ko": "추천",
      "fr": "Recommandé",
      "de": "Empfohlen",
      "ru": "Рекомендуется"
    },
    "当前机器的推荐设置": {
      "zh": "当前机器的推荐设置",
      "en": "Recommended for this device",
      "es": "Recomendado para este equipo",
      "ja": "この端末に合わせたおすすめ設定",
      "ko": "이 기기에 맞는 추천 설정",
      "fr": "Recommandé pour cet appareil",
      "de": "Für dieses Gerät empfohlen",
      "ru": "Рекомендовано для этого устройства"
    }
  },
  "themeLabels": {
    "zh": {
      "light": "切换至浅色主题",
      "dark": "切换至深色主题"
    },
    "en": {
      "light": "Switch to light theme",
      "dark": "Switch to dark theme"
    },
    "es": {
      "light": "Cambiar al tema claro",
      "dark": "Cambiar al tema oscuro"
    },
    "ja": {
      "light": "ライトテーマに切り替え",
      "dark": "ダークテーマに切り替え"
    },
    "ko": {
      "light": "라이트 테마로 전환",
      "dark": "다크 테마로 전환"
    },
    "fr": {
      "light": "Passer au thème clair",
      "dark": "Passer au thème sombre"
    },
    "de": {
      "light": "Zum hellen Design wechseln",
      "dark": "Zum dunklen Design wechseln"
    },
    "ru": {
      "light": "Светлая тема",
      "dark": "Тёмная тема"
    }
  },
  "updateLabels": {
    "zh": {
      "title": "软件更新",
      "description": "当前版本 0.1.0",
      "action": "检查更新",
      "checking": "正在检查…",
      "available": "发现新版本 0.2.0",
      "update": "更新至 0.2.0",
      "floating": "更新言录",
      "updating": "正在更新…",
      "downloading": "正在下载",
      "current": "已是最新版本"
    },
    "en": {
      "title": "Software updates",
      "description": "Current version 0.1.0",
      "action": "Check for updates",
      "checking": "Checking…",
      "available": "Version 0.2.0 is available",
      "update": "Update to 0.2.0",
      "floating": "Update Brevia",
      "updating": "Updating…",
      "downloading": "Downloading",
      "current": "Up to date"
    },
    "es": {
      "title": "Actualizaciones",
      "description": "Versión actual 0.1.0",
      "action": "Buscar actualizaciones",
      "checking": "Comprobando…",
      "available": "La versión 0.2.0 está disponible",
      "update": "Actualizar a 0.2.0",
      "floating": "Actualizar Brevia",
      "updating": "Actualizando…",
      "downloading": "Descargando",
      "current": "Ya está actualizado"
    },
    "ja": {
      "title": "ソフトウェアアップデート",
      "description": "現在のバージョン 0.1.0",
      "action": "アップデートを確認",
      "checking": "確認中…",
      "available": "バージョン 0.2.0 を利用できます",
      "update": "0.2.0 に更新",
      "floating": "Brevia を更新",
      "updating": "更新中…",
      "downloading": "ダウンロード中",
      "current": "最新です"
    },
    "ko": {
      "title": "소프트웨어 업데이트",
      "description": "현재 버전 0.1.0",
      "action": "업데이트 확인",
      "checking": "확인 중…",
      "available": "버전 0.2.0을 사용할 수 있습니다",
      "update": "0.2.0으로 업데이트",
      "floating": "Brevia 업데이트",
      "updating": "업데이트 중…",
      "downloading": "다운로드 중",
      "current": "최신 버전입니다"
    },
    "fr": {
      "title": "Mises à jour logicielles",
      "description": "Version actuelle 0.1.0",
      "action": "Rechercher des mises à jour",
      "checking": "Recherche…",
      "available": "La version 0.2.0 est disponible",
      "update": "Mettre à jour vers 0.2.0",
      "floating": "Mettre à jour Brevia",
      "updating": "Mise à jour…",
      "downloading": "Téléchargement…",
      "current": "À jour"
    },
    "de": {
      "title": "Softwareupdates",
      "description": "Aktuelle Version 0.1.0",
      "action": "Nach Updates suchen",
      "checking": "Suche läuft…",
      "available": "Version 0.2.0 ist verfügbar",
      "update": "Auf 0.2.0 aktualisieren",
      "floating": "Brevia aktualisieren",
      "updating": "Aktualisierung läuft…",
      "downloading": "Wird heruntergeladen…",
      "current": "Aktuell"
    },
    "ru": {
      "title": "Обновления ПО",
      "description": "Текущая версия 0.1.0",
      "action": "Проверить обновления",
      "checking": "Проверка…",
      "available": "Доступна версия 0.2.0",
      "update": "Обновить до 0.2.0",
      "floating": "Обновить Brevia",
      "updating": "Обновление…",
      "downloading": "Скачивание…",
      "current": "Установлена последняя версия"
    }
  },
  "modelLabels": {
    "zh": {
      "manage": "管理模型库",
      "download": "下载",
      "downloading": "下载中…",
      "installed": "已安装",
      "remove": "删除"
    },
    "en": {
      "manage": "Manage model library",
      "download": "Download",
      "downloading": "Downloading…",
      "installed": "Installed",
      "remove": "Delete"
    },
    "es": {
      "manage": "Gestionar biblioteca de modelos",
      "download": "Descargar",
      "downloading": "Descargando…",
      "installed": "Instalado",
      "remove": "Eliminar"
    },
    "ja": {
      "manage": "モデルライブラリを管理",
      "download": "ダウンロード",
      "downloading": "ダウンロード中…",
      "installed": "インストール済み",
      "remove": "削除"
    },
    "ko": {
      "manage": "모델 라이브러리 관리",
      "download": "다운로드",
      "downloading": "다운로드 중…",
      "installed": "설치됨",
      "remove": "삭제"
    },
    "fr": {
      "manage": "Gérer la bibliothèque de modèles",
      "download": "Télécharger",
      "downloading": "Téléchargement…",
      "installed": "Installé",
      "remove": "Supprimer"
    },
    "de": {
      "manage": "Modellbibliothek verwalten",
      "download": "Herunterladen",
      "downloading": "Wird heruntergeladen…",
      "installed": "Installiert",
      "remove": "Löschen"
    },
    "ru": {
      "manage": "Управление библиотекой моделей",
      "download": "Скачать",
      "downloading": "Скачивание…",
      "installed": "Установлено",
      "remove": "Удалить"
    }
  },
  "summaryModelCopy": {
    "zh": {
      "title": "AI 会议纪要",
      "intro": "所有配置信息仅保存在本地，不会上传。",
      "featureIntro": "会议结束后，AI 自动把整场对话整理成会议纪要及待办事项。",
      "provider": "供应商",
      "key": "API Key",
      "endpoint": "请求地址",
      "model": "模型",
      "save": "保存配置",
      "builtinHint": "选择这个功能使用的内置模型。安装或删除请前往模型库。",
      "endpointPlaceholder": "https://example.com/v1/chat/completions",
      "providers": {
        "built-in": "内置 AI",
        "claude": "Claude",
        "openai": "OpenAI",
        "openrouter": "OpenRouter",
        "custom-openai": "自定义服务（OpenAI 格式）",
        "custom-claude": "自定义服务（Claude 格式）"
      }
    },
    "en": {
      "title": "Manage meeting summary",
      "intro": "All configuration stays on this device and is never uploaded.",
      "featureIntro": "After a meeting, AI turns the transcript into structured notes and action items.",
      "provider": "Provider",
      "key": "API Key",
      "endpoint": "Request URL",
      "model": "Model",
      "save": "Save configuration",
      "builtinHint": "Choose which built-in model this feature uses. To install or remove models, open the model library.",
      "endpointPlaceholder": "https://example.com/v1/chat/completions",
      "providers": {
        "built-in": "Built-in AI",
        "claude": "Claude",
        "openai": "OpenAI",
        "openrouter": "OpenRouter",
        "custom-openai": "Custom service (OpenAI format)",
        "custom-claude": "Custom service (Claude format)"
      }
    },
    "es": {
      "title": "Gestionar el resumen de la reunión",
      "intro": "Toda la configuración se guarda en este dispositivo y no se carga.",
      "featureIntro": "Al terminar la reunión, la IA convierte la transcripción en notas y tareas estructuradas.",
      "provider": "Proveedor",
      "key": "API Key",
      "endpoint": "URL de solicitud",
      "model": "Modelo",
      "save": "Guardar configuración",
      "builtinHint": "Elige qué modelo integrado usa esta función. Para instalar o eliminar modelos, abre la biblioteca de modelos.",
      "endpointPlaceholder": "https://example.com/v1/chat/completions",
      "providers": {
        "built-in": "IA integrada",
        "claude": "Claude",
        "openai": "OpenAI",
        "openrouter": "OpenRouter",
        "custom-openai": "Servicio personalizado (formato OpenAI)",
        "custom-claude": "Servicio personalizado (formato Claude)"
      }
    },
    "ja": {
      "title": "会議の要約を管理",
      "intro": "すべての設定はこのデバイスにのみ保存され、アップロードされません。",
      "provider": "プロバイダー",
      "key": "API キー",
      "endpoint": "リクエスト URL",
      "model": "モデル",
      "save": "設定を保存",
      "builtinHint": "この機能で使う内蔵モデルを選択します。モデルの追加・削除はモデルライブラリで行います。",
      "endpointPlaceholder": "https://example.com/v1/chat/completions",
      "providers": {
        "built-in": "内蔵 AI",
        "claude": "Claude",
        "openai": "OpenAI",
        "openrouter": "OpenRouter",
        "custom-openai": "カスタムサービス（OpenAI 形式）",
        "custom-claude": "カスタムサービス（Claude 形式）"
      },
      "featureIntro": "会議後、AI が文字起こしを構造化された議事録とタスクに整理します。"
    },
    "ko": {
      "title": "회의 요약 관리",
      "intro": "모든 설정은 이 기기에만 저장되며 업로드되지 않습니다.",
      "provider": "제공자",
      "key": "API 키",
      "endpoint": "요청 URL",
      "model": "모델",
      "save": "구성 저장",
      "builtinHint": "이 기능에서 사용할 내장 모델을 선택하세요. 모델 설치·삭제는 모델 라이브러리에서 합니다.",
      "endpointPlaceholder": "https://example.com/v1/chat/completions",
      "providers": {
        "built-in": "내장 AI",
        "claude": "Claude",
        "openai": "OpenAI",
        "openrouter": "OpenRouter",
        "custom-openai": "사용자 지정 서비스(OpenAI 형식)",
        "custom-claude": "사용자 지정 서비스(Claude 형식)"
      },
      "featureIntro": "회의가 끝나면 AI가 전사를 구조화된 회의록과 할 일로 정리합니다."
    },
    "fr": {
      "title": "Gérer le résumé de la réunion",
      "intro": "Toute la configuration reste sur cet appareil et n’est jamais envoyée.",
      "provider": "Fournisseur",
      "key": "Clé API",
      "endpoint": "URL de requête",
      "model": "Modèle",
      "save": "Enregistrer la configuration",
      "builtinHint": "Choisissez le modèle intégré utilisé par cette fonction. Pour installer ou supprimer des modèles, ouvrez la bibliothèque de modèles.",
      "endpointPlaceholder": "https://example.com/v1/chat/completions",
      "providers": {
        "built-in": "IA intégrée",
        "claude": "Claude",
        "openai": "OpenAI",
        "openrouter": "OpenRouter",
        "custom-openai": "Service personnalisé (format OpenAI)",
        "custom-claude": "Service personnalisé (format Claude)"
      },
      "featureIntro": "Après la réunion, l’IA transforme la transcription en notes structurées et tâches à accomplir."
    },
    "de": {
      "title": "Besprechungszusammenfassung verwalten",
      "intro": "Alle Einstellungen bleiben auf diesem Gerät und werden nie hochgeladen.",
      "provider": "Anbieter",
      "key": "API-Schlüssel",
      "endpoint": "Anfrage-URL",
      "model": "Modell",
      "save": "Konfiguration speichern",
      "builtinHint": "Wählen Sie, welches integrierte Modell diese Funktion nutzt. Installation und Löschen erfolgen in der Modellbibliothek.",
      "endpointPlaceholder": "https://example.com/v1/chat/completions",
      "providers": {
        "built-in": "Integrierte KI",
        "claude": "Claude",
        "openai": "OpenAI",
        "openrouter": "OpenRouter",
        "custom-openai": "Eigener Dienst (OpenAI-Format)",
        "custom-claude": "Eigener Dienst (Claude-Format)"
      },
      "featureIntro": "Nach der Besprechung erstellt die KI aus dem Transkript strukturierte Notizen und Aufgaben."
    },
    "ru": {
      "title": "Управление сводкой встречи",
      "intro": "Все настройки хранятся только на этом устройстве и не загружаются.",
      "provider": "Поставщик",
      "key": "Ключ API",
      "endpoint": "URL запроса",
      "model": "Модель",
      "save": "Сохранить конфигурацию",
      "builtinHint": "Выберите встроенную модель для этой функции. Установка и удаление моделей — в библиотеке моделей.",
      "endpointPlaceholder": "https://example.com/v1/chat/completions",
      "providers": {
        "built-in": "Встроенный ИИ",
        "claude": "Claude",
        "openai": "OpenAI",
        "openrouter": "OpenRouter",
        "custom-openai": "Свой сервис (формат OpenAI)",
        "custom-claude": "Свой сервис (формат Claude)"
      },
      "featureIntro": "После встречи ИИ преобразует транскрипцию в структурированные заметки и задачи."
    }
  },
  "aiAssistCopy": {
    "zh": {
      "toggleOn": "AI 笔记 开",
      "toggleOff": "AI 笔记",
      "settings": {
        "title": "AI 笔记",
        "description": "让 AI 在会议中帮你发现重点、提取待办并整理笔记。",
        "action": "配置 AI 笔记"
      },
      "modal": {
        "title": "AI 笔记",
        "intro": "让 AI 在会议过程中帮你发现重点、提取待办并整理笔记。所有配置信息仅保存在本地。",
        "enable": "启用 AI 笔记",
        "proactivityLabel": "你希望 AI 怎样协助记录？",
        "levels": [
          [
            "quiet",
            "只在我需要时",
            "只有你点击 AI、选中文字或主动要求时才出现。"
          ],
          [
            "assist",
            "发现重点时提醒我",
            "发现结论、决策、待办、重要数字时适度提醒。"
          ],
          [
            "auto",
            "自动帮我整理",
            "自动归纳结论、收集待办并整理会议内容。"
          ]
        ],
        "save": "保存配置"
      },
      "emptyEnabledTitle": "开始记录吧",
      "emptyEnabledBody": "AI 会自动发现关键结论、待办和重要信息。",
      "emptyEnabledTags": [
        "记录重点",
        "自动整理",
        "关联工作区"
      ],
      "emptyDisabledTitle": "开始记录会议重点",
      "emptyDisabledBody": "你可以直接输入，也可以从右侧实时字幕中将重要内容加入笔记。",
      "emptyDisabledTags": [
        "插入当前字幕",
        "记录当前时间点"
      ],
      "popover": {
        "title": "启用 AI 笔记",
        "body": "配置 AI 服务后，可自动发现会议重点、提取待办，并关联当前工作区的历史内容。",
        "configure": "配置 AI 笔记",
        "later": "暂不"
      },
      "request": "请求建议"
    },
    "en": {
      "toggleOn": "AI notes on",
      "toggleOff": "AI notes",
      "settings": {
        "title": "AI notes",
        "description": "Let AI surface key points, extract action items, and organize your notes during a meeting.",
        "action": "Configure AI notes"
      },
      "modal": {
        "title": "AI notes",
        "intro": "Let AI surface key points, extract action items, and organize your notes during a meeting.",
        "enable": "Enable AI notes",
        "proactivityLabel": "How should AI help you take notes?",
        "levels": [
          [
            "quiet",
            "Only when I ask",
            "Appears only when you click AI, select text, or request it directly."
          ],
          [
            "assist",
            "Notify me of key points",
            "Lightly notifies you about conclusions, decisions, actions, and important figures."
          ],
          [
            "auto",
            "Organize for me automatically",
            "Automatically summarizes conclusions, collects actions, and organizes the meeting."
          ]
        ],
        "save": "Save"
      },
      "emptyEnabledTitle": "Start taking notes",
      "emptyEnabledBody": "AI will automatically surface key conclusions, action items, and important information.",
      "emptyEnabledTags": [
        "Capture key points",
        "Organize automatically",
        "Link workspace"
      ],
      "emptyDisabledTitle": "Start taking meeting notes",
      "emptyDisabledBody": "Type directly, or add important moments from the live transcript on the right.",
      "emptyDisabledTags": [
        "Insert current caption",
        "Insert timestamp"
      ],
      "popover": {
        "title": "Enable AI-assisted notes",
        "body": "After you configure an AI service, it can automatically surface key points, extract action items, and link history from the current workspace.",
        "configure": "Configure AI",
        "later": "Not now"
      },
      "request": "Request suggestion"
    },
    "es": {
      "toggleOn": "Notas IA activadas",
      "toggleOff": "Notas IA",
      "settings": {
        "title": "Notas IA",
        "description": "Deja que la IA detecte puntos clave, extraiga tareas y organice tus notas durante la reunión.",
        "action": "Configurar notas IA"
      },
      "modal": {
        "title": "Notas IA",
        "intro": "Deja que la IA detecte puntos clave, extraiga tareas y organice tus notas durante la reunión.",
        "enable": "Activar notas IA",
        "proactivityLabel": "¿Cómo quieres que la IA te ayude a tomar notas?",
        "levels": [
          [
            "quiet",
            "Solo cuando lo pida",
            "Aparece solo cuando haces clic en IA, seleccionas texto o lo pides directamente."
          ],
          [
            "assist",
            "Avisarme de puntos clave",
            "Avisa de conclusiones, decisiones, tareas y cifras importantes."
          ],
          [
            "auto",
            "Organizar por mí automáticamente",
            "Resume conclusiones, recopila tareas y organiza la reunión de forma automática."
          ]
        ],
        "save": "Guardar"
      },
      "emptyEnabledTitle": "Empieza a tomar notas",
      "emptyEnabledBody": "La IA detectará automáticamente conclusiones clave, tareas e información importante.",
      "emptyEnabledTags": [
        "Capturar lo importante",
        "Organizar automáticamente",
        "Vincular al espacio de trabajo"
      ],
      "emptyDisabledTitle": "Empieza a tomar notas de la reunión",
      "emptyDisabledBody": "Escribe directamente o añade momentos importantes desde la transcripción en vivo de la derecha.",
      "emptyDisabledTags": [
        "Insertar subtítulo actual",
        "Insertar marca de tiempo"
      ],
      "popover": {
        "title": "Activar notas asistidas por IA",
        "body": "Tras configurar un servicio de IA, detectará automáticamente puntos clave, extraerá tareas y vinculará el historial del espacio de trabajo.",
        "configure": "Configurar IA",
        "later": "Ahora no"
      },
      "request": "Pedir sugerencia"
    },
    "ja": {
      "toggleOn": "AIメモ オン",
      "toggleOff": "AIメモ",
      "settings": {
        "title": "AIメモ",
        "description": "会議中に AI が要点の発見・ToDo の抽出・メモ整理を支援します。",
        "action": "AIメモを設定"
      },
      "modal": {
        "title": "AIメモ",
        "intro": "会議中に AI が要点の発見・ToDo の抽出・メモ整理を支援します。",
        "enable": "AIメモを有効にする",
        "proactivityLabel": "AI にどのようにメモを手伝ってほしいですか？",
        "levels": [
          [
            "quiet",
            "必要なときだけ",
            "AI をクリック、文字を選択、または直接依頼したときだけ表示します。"
          ],
          [
            "assist",
            "要点を知らせる",
            "結論・決定・ToDo・重要な数字を適度に知らせます。"
          ],
          [
            "auto",
            "自動で整理する",
            "結論をまとめ、ToDo を収集し、会議内容を自動整理します。"
          ]
        ],
        "save": "保存"
      },
      "emptyEnabledTitle": "メモを始めましょう",
      "emptyEnabledBody": "AI が重要な結論・ToDo・重要情報を自動で見つけます。",
      "emptyEnabledTags": [
        "要点を記録",
        "自動整理",
        "ワークスペース連携"
      ],
      "emptyDisabledTitle": "会議の要点を記録しましょう",
      "emptyDisabledBody": "直接入力するか、右側のリアルタイム字幕から重要内容を追加できます。",
      "emptyDisabledTags": [
        "現在の字幕を挿入",
        "現在時刻を記録"
      ],
      "popover": {
        "title": "AI アシストメモを有効にする",
        "body": "AI サービスを設定すると、会議の要点を自動発見し、ToDo を抽出して現在のワークスペースの履歴を関連付けられます。",
        "configure": "AI を設定",
        "later": "あとで"
      },
      "request": "提案を求める"
    },
    "ko": {
      "toggleOn": "AI 메모 켬",
      "toggleOff": "AI 메모",
      "settings": {
        "title": "AI 메모",
        "description": "회의 중 AI가 핵심 포인트 발견, 할 일 추출, 메모 정리를 돕습니다.",
        "action": "AI 메모 구성"
      },
      "modal": {
        "title": "AI 메모",
        "intro": "회의 중 AI가 핵심 포인트 발견, 할 일 추출, 메모 정리를 돕습니다.",
        "enable": "AI 메모 사용",
        "proactivityLabel": "AI가 메모를 어떻게 도와주길 원하시나요?",
        "levels": [
          [
            "quiet",
            "필요할 때만",
            "AI를 클릭하거나 텍스트를 선택하거나 직접 요청할 때만 표시됩니다."
          ],
          [
            "assist",
            "핵심 포인트 알림",
            "결론·결정·할 일·중요 수치를 적절히 알려줍니다."
          ],
          [
            "auto",
            "자동으로 정리",
            "결론을 요약하고 할 일을 수집하며 회의를 자동 정리합니다."
          ]
        ],
        "save": "저장"
      },
      "emptyEnabledTitle": "메모를 시작하세요",
      "emptyEnabledBody": "AI가 핵심 결론·할 일·중요 정보를 자동으로 찾아냅니다.",
      "emptyEnabledTags": [
        "핵심 포인트 기록",
        "자동 정리",
        "워크스페이스 연결"
      ],
      "emptyDisabledTitle": "회의 핵심 기록을 시작하세요",
      "emptyDisabledBody": "직접 입력하거나 오른쪽 실시간 자막에서 중요한 내용을 추가하세요.",
      "emptyDisabledTags": [
        "현재 자막 삽입",
        "현재 시각 기록"
      ],
      "popover": {
        "title": "AI 지원 메모 활성화",
        "body": "AI 서비스를 구성하면 회의 핵심 포인트를 자동 발견하고 할 일을 추출하며 현재 워크스페이스의 이력을 연결합니다.",
        "configure": "AI 구성",
        "later": "나중에"
      },
      "request": "제안 요청"
    },
    "fr": {
      "toggleOn": "Notes IA activées",
      "toggleOff": "Notes IA",
      "settings": {
        "title": "Notes IA",
        "description": "Laissez l'IA repérer les points clés, extraire les tâches et organiser vos notes pendant la réunion.",
        "action": "Configurer les notes IA"
      },
      "modal": {
        "title": "Notes IA",
        "intro": "Laissez l'IA repérer les points clés, extraire les tâches et organiser vos notes pendant la réunion.",
        "enable": "Activer les notes IA",
        "proactivityLabel": "Comment l'IA doit-elle vous aider à prendre des notes ?",
        "levels": [
          [
            "quiet",
            "Seulement quand je demande",
            "N'apparaît que lorsque vous cliquez sur l'IA, sélectionnez du texte ou le demandez."
          ],
          [
            "assist",
            "M'alerter des points clés",
            "Alerte sur les conclusions, décisions, tâches et chiffres importants."
          ],
          [
            "auto",
            "Organiser pour moi automatiquement",
            "Résume les conclusions, collecte les tâches et organise la réunion."
          ]
        ],
        "save": "Enregistrer"
      },
      "emptyEnabledTitle": "Commencez à prendre des notes",
      "emptyEnabledBody": "L'IA détectera automatiquement les conclusions clés, les tâches et les informations importantes.",
      "emptyEnabledTags": [
        "Capturer les points clés",
        "Organiser automatiquement",
        "Lier l’espace de travail"
      ],
      "emptyDisabledTitle": "Commencez à noter les points clés",
      "emptyDisabledBody": "Saisissez directement, ou ajoutez les moments importants depuis la transcription en direct à droite.",
      "emptyDisabledTags": [
        "Insérer le sous-titre actuel",
        "Insérer l’horodatage"
      ],
      "popover": {
        "title": "Activer les notes assistées par l'IA",
        "body": "Une fois le service d'IA configuré, il repère automatiquement les points clés, extrait les tâches et relie l'historique de l'espace de travail.",
        "configure": "Configurer l'IA",
        "later": "Pas maintenant"
      },
      "request": "Demander une suggestion"
    },
    "de": {
      "toggleOn": "KI-Notizen an",
      "toggleOff": "KI-Notizen",
      "settings": {
        "title": "KI-Notizen",
        "description": "Lassen Sie die KI während der Besprechung Kernpunkte finden, Aufgaben extrahieren und Notizen ordnen.",
        "action": "KI-Notizen konfigurieren"
      },
      "modal": {
        "title": "KI-Notizen",
        "intro": "Lassen Sie die KI während der Besprechung Kernpunkte finden, Aufgaben extrahieren und Notizen ordnen.",
        "enable": "KI-Notizen aktivieren",
        "proactivityLabel": "Wie soll die KI Ihnen beim Mitschreiben helfen?",
        "levels": [
          [
            "quiet",
            "Nur wenn ich frage",
            "Erscheint nur, wenn Sie die KI anklicken, Text auswählen oder direkt anfragen."
          ],
          [
            "assist",
            "Mich über Kernpunkte informieren",
            "Hinweise auf Schlussfolgerungen, Entscheidungen, Aufgaben und wichtige Zahlen."
          ],
          [
            "auto",
            "Automatisch für mich ordnen",
            "Fasst Schlussfolgerungen zusammen, sammelt Aufgaben und ordnet die Besprechung."
          ]
        ],
        "save": "Speichern"
      },
      "emptyEnabledTitle": "Notizen beginnen",
      "emptyEnabledBody": "Die KI findet automatisch wichtige Schlussfolgerungen, Aufgaben und Informationen.",
      "emptyEnabledTags": [
        "Kernpunkte festhalten",
        "Automatisch ordnen",
        "Arbeitsbereich verknüpfen"
      ],
      "emptyDisabledTitle": "Besprechungspunkte festhalten",
      "emptyDisabledBody": "Tippen Sie direkt oder übernehmen Sie wichtige Momente aus dem Live-Transkript rechts.",
      "emptyDisabledTags": [
        "Aktuellen Untertitel einfügen",
        "Zeitstempel einfügen"
      ],
      "popover": {
        "title": "KI-unterstützte Notizen aktivieren",
        "body": "Nach der Einrichtung eines KI-Dienstes werden Kernpunkte automatisch erkannt, Aufgaben extrahiert und der Verlauf des Arbeitsbereichs verknüpft.",
        "configure": "KI konfigurieren",
        "later": "Später"
      },
      "request": "Vorschlag anfordern"
    },
    "ru": {
      "toggleOn": "ИИ-заметки вкл.",
      "toggleOff": "ИИ-заметки",
      "settings": {
        "title": "ИИ-заметки",
        "description": "Позвольте ИИ находить ключевые моменты, извлекать задачи и упорядочивать заметки во время встречи.",
        "action": "Настроить ИИ-заметки"
      },
      "modal": {
        "title": "ИИ-заметки",
        "intro": "Позвольте ИИ находить ключевые моменты, извлекать задачи и упорядочивать заметки во время встречи.",
        "enable": "Включить ИИ-заметки",
        "proactivityLabel": "Как ИИ должен помогать вам вести заметки?",
        "levels": [
          [
            "quiet",
            "Только когда попрошу",
            "Появляется только когда вы нажимаете на ИИ, выделяете текст или просите напрямую."
          ],
          [
            "assist",
            "Сообщать о ключевых моментах",
            "Мягко сообщает о выводах, решениях, задачах и важных цифрах."
          ],
          [
            "auto",
            "Упорядочивать автоматически",
            "Автоматически резюмирует выводы, собирает задачи и упорядочивает встречу."
          ]
        ],
        "save": "Сохранить"
      },
      "emptyEnabledTitle": "Начните вести заметки",
      "emptyEnabledBody": "ИИ автоматически найдёт ключевые выводы, задачи и важную информацию.",
      "emptyEnabledTags": [
        "Записывать главное",
        "Упорядочивать автоматически",
        "Связать с рабочим пространством"
      ],
      "emptyDisabledTitle": "Начните записывать ключевые моменты",
      "emptyDisabledBody": "Пишите напрямую или добавляйте важные моменты из живого транскрипта справа.",
      "emptyDisabledTags": [
        "Вставить текущий субтитр",
        "Записать время"
      ],
      "popover": {
        "title": "Включить заметки с ИИ",
        "body": "После настройки ИИ-сервиса он автоматически найдёт ключевые моменты, извлечёт задачи и свяжет историю рабочего пространства.",
        "configure": "Настроить ИИ",
        "later": "Не сейчас"
      },
      "request": "Запросить предложение"
    }
  },
  "speakerProfileCopy": {
    "zh": {
      "title": "说话人识别",
      "intro": "录入不同说话人的声音片段，以在会议后识别不同的说话人片段。",
      "name": "人员姓名",
      "add": "从语音添加",
      "addSample": "补充语音样本",
      "remove": "删除",
      "samples": "条样本",
      "empty": "还没有已识别人员。上传一段清晰的单人语音开始识别。"
    },
    "en": {
      "title": "Speaker recognition",
      "intro": "Add voice samples from different speakers to identify their segments after the meeting.",
      "name": "Name",
      "add": "Add from audio",
      "addSample": "Add voice sample",
      "remove": "Delete",
      "samples": "samples",
      "empty": "No identified speakers yet. Upload a clear recording of one person to begin."
    },
    "es": {
      "title": "Reconocimiento de hablantes",
      "intro": "Añade muestras de voz de distintos hablantes para identificar sus intervenciones después de la reunión.",
      "name": "Nombre",
      "add": "Añadir desde audio",
      "addSample": "Añadir muestra de voz",
      "remove": "Eliminar",
      "samples": "muestras",
      "empty": "Aún no hay hablantes identificados. Sube una grabación clara de una persona para empezar."
    },
    "ja": {
      "title": "話者認識",
      "intro": "複数の話者の音声サンプルを登録し、会議後に各話者の発言区間を識別します。",
      "name": "名前",
      "add": "音声から追加",
      "addSample": "音声サンプルを追加",
      "remove": "削除",
      "samples": "サンプル",
      "empty": "識別済みの話者はいません。1 人だけの明瞭な音声をアップロードしてください。"
    },
    "ko": {
      "title": "화자 인식",
      "intro": "여러 화자의 음성 샘플을 등록하여 회의 후 각 화자의 발언 구간을 식별합니다.",
      "name": "이름",
      "add": "오디오에서 추가",
      "addSample": "음성 샘플 추가",
      "remove": "삭제",
      "samples": "개 샘플",
      "empty": "식별된 화자가 없습니다. 한 사람의 선명한 음성을 업로드하세요."
    },
    "fr": {
      "title": "Reconnaissance du locuteur",
      "intro": "Ajoutez des échantillons vocaux de différents intervenants pour identifier leurs passages après la réunion.",
      "name": "Nom",
      "add": "Ajouter depuis un audio",
      "addSample": "Ajouter un échantillon vocal",
      "remove": "Supprimer",
      "samples": "échantillons",
      "empty": "Aucun locuteur identifié. Importez un enregistrement clair d’une personne pour commencer."
    },
    "de": {
      "title": "Sprechererkennung",
      "intro": "Stimmproben verschiedener Sprecher hinzufügen, um ihre Abschnitte nach der Besprechung zu erkennen.",
      "name": "Name",
      "add": "Aus Audio hinzufügen",
      "addSample": "Sprachprobe hinzufügen",
      "remove": "Löschen",
      "samples": "Proben",
      "empty": "Noch keine Sprecher erkannt. Laden Sie eine klare Aufnahme einer Person hoch."
    },
    "ru": {
      "title": "Распознавание говорящих",
      "intro": "Добавьте образцы голоса разных участников, чтобы определять их фрагменты после встречи.",
      "name": "Имя",
      "add": "Добавить из аудио",
      "addSample": "Добавить образец голоса",
      "remove": "Удалить",
      "samples": "образцов",
      "empty": "Пока нет распознанных говорящих. Загрузите чистую запись одного человека, чтобы начать."
    }
  },
  "modalCopy": {
    "zh": {
      "models": {
        "title": "模型库"
      },
      "terms": {
        "title": "管理术语库",
        "intro": "术语用于会议准备、搜索和纪要。仅支持的模型会在转写中使用它们。",
        "items": [
          [
            "Brevia",
            "产品名称"
          ],
          [
            "向量数据库",
            "技术术语"
          ],
          [
            "ERes2Net",
            "说话人模型"
          ]
        ],
        "add": "添加术语",
        "edit": "编辑",
        "save": "保存",
        "cancel": "取消",
        "remove": "删除",
        "placeholder": "输入术语或短语"
      },
      "storage": {
        "title": "本地存储",
        "intro": "所有会议资料均保存在此设备。",
        "items": [
          [
            "会议与录音",
            "8.4 GB"
          ],
          [
            "模型文件",
            "1.7 GB"
          ]
        ]
      },
      "close": "关闭",
      "download": "下载"
    },
    "en": {
      "models": {
        "title": "Model library"
      },
      "terms": {
        "title": "Manage terms",
        "intro": "Terms support meeting preparation, search, and notes. Only supported models use them in transcription.",
        "items": [
          [
            "Brevia",
            "Product name"
          ],
          [
            "Vector database",
            "Technical term"
          ],
          [
            "ERes2Net",
            "Speaker model"
          ]
        ],
        "add": "Add term",
        "edit": "Edit",
        "save": "Save",
        "cancel": "Cancel",
        "remove": "Delete",
        "placeholder": "Enter a term or phrase"
      },
      "storage": {
        "title": "Local storage",
        "intro": "All meeting data stays on this device.",
        "items": [
          [
            "Meetings and recordings",
            "8.4 GB"
          ],
          [
            "Model files",
            "1.7 GB"
          ]
        ]
      },
      "close": "Close",
      "download": "Download"
    },
    "es": {
      "models": {
        "title": "Biblioteca de modelos"
      },
      "terms": {
        "title": "Gestionar términos",
        "intro": "Los términos sirven para preparar reuniones, buscar y crear notas. Solo los modelos compatibles los usan al transcribir.",
        "items": [
          [
            "Brevia",
            "Nombre del producto"
          ],
          [
            "Base de datos vectorial",
            "Término técnico"
          ],
          [
            "ERes2Net",
            "Modelo de hablantes"
          ]
        ],
        "add": "Añadir término",
        "edit": "Editar",
        "save": "Guardar",
        "cancel": "Cancelar",
        "remove": "Eliminar",
        "placeholder": "Escribe un término o frase"
      },
      "storage": {
        "title": "Almacenamiento local",
        "intro": "Todos los datos de reuniones permanecen en este dispositivo.",
        "items": [
          [
            "Reuniones y grabaciones",
            "8.4 GB"
          ],
          [
            "Archivos de modelos",
            "1.7 GB"
          ]
        ]
      },
      "close": "Cerrar",
      "download": "Descargar"
    },
    "ja": {
      "models": {
        "title": "モデルライブラリ"
      },
      "terms": {
        "title": "用語集を管理",
        "intro": "用語は会議準備、検索、メモに使用されます。対応モデルだけが文字起こしに利用します。",
        "items": [
          [
            "Brevia",
            "Product name"
          ],
          [
            "Vector database",
            "Technical term"
          ],
          [
            "ERes2Net",
            "Speaker model"
          ]
        ],
        "add": "用語を追加",
        "edit": "編集",
        "save": "保存",
        "cancel": "キャンセル",
        "remove": "削除",
        "placeholder": "用語またはフレーズを入力"
      },
      "storage": {
        "title": "ローカルストレージ",
        "intro": "すべての会議データはこのデバイスに保存されます。",
        "items": [
          [
            "会議と録音",
            "8.4 GB"
          ],
          [
            "モデルファイル",
            "1.7 GB"
          ]
        ]
      },
      "close": "閉じる",
      "download": "ダウンロード"
    },
    "ko": {
      "models": {
        "title": "모델 라이브러리"
      },
      "terms": {
        "title": "용어집 관리",
        "intro": "용어는 회의 준비, 검색 및 회의록에 사용됩니다. 지원 모델만 전사에 사용합니다.",
        "items": [
          [
            "Brevia",
            "Product name"
          ],
          [
            "Vector database",
            "Technical term"
          ],
          [
            "ERes2Net",
            "Speaker model"
          ]
        ],
        "add": "용어 추가",
        "edit": "편집",
        "save": "저장",
        "cancel": "취소",
        "remove": "삭제",
        "placeholder": "용어 또는 문구 입력"
      },
      "storage": {
        "title": "로컬 저장소",
        "intro": "모든 회의 데이터는 이 기기에 저장됩니다.",
        "items": [
          [
            "회의 및 녹음",
            "8.4 GB"
          ],
          [
            "모델 파일",
            "1.7 GB"
          ]
        ]
      },
      "close": "닫기",
      "download": "다운로드"
    },
    "fr": {
      "models": {
        "title": "Bibliothèque de modèles"
      },
      "terms": {
        "title": "Gérer le glossaire",
        "intro": "Les termes servent à préparer les réunions, rechercher et créer des notes. Seuls les modèles compatibles les utilisent.",
        "items": [
          [
            "Brevia",
            "Product name"
          ],
          [
            "Vector database",
            "Technical term"
          ],
          [
            "ERes2Net",
            "Speaker model"
          ]
        ],
        "add": "Ajouter un terme",
        "edit": "Modifier",
        "save": "Enregistrer",
        "cancel": "Annuler",
        "remove": "Supprimer",
        "placeholder": "Saisir un terme ou une expression"
      },
      "storage": {
        "title": "Stockage local",
        "intro": "Toutes les données de réunion restent sur cet appareil.",
        "items": [
          [
            "Réunions et enregistrements",
            "8.4 GB"
          ],
          [
            "Fichiers de modèles",
            "1.7 GB"
          ]
        ]
      },
      "close": "Fermer",
      "download": "Télécharger"
    },
    "de": {
      "models": {
        "title": "Modellbibliothek"
      },
      "terms": {
        "title": "Glossar verwalten",
        "intro": "Begriffe werden für Besprechungsvorbereitung, Suche und Notizen verwendet. Nur unterstützte Modelle verwenden sie bei der Transkription.",
        "items": [
          [
            "Brevia",
            "Product name"
          ],
          [
            "Vector database",
            "Technical term"
          ],
          [
            "ERes2Net",
            "Speaker model"
          ]
        ],
        "add": "Begriff hinzufügen",
        "edit": "Bearbeiten",
        "save": "Speichern",
        "cancel": "Abbrechen",
        "remove": "Löschen",
        "placeholder": "Begriff oder Ausdruck eingeben"
      },
      "storage": {
        "title": "Lokaler Speicher",
        "intro": "Alle Besprechungsdaten bleiben auf diesem Gerät.",
        "items": [
          [
            "Besprechungen und Aufnahmen",
            "8.4 GB"
          ],
          [
            "Modelldateien",
            "1.7 GB"
          ]
        ]
      },
      "close": "Schließen",
      "download": "Herunterladen"
    },
    "ru": {
      "models": {
        "title": "Библиотека моделей"
      },
      "terms": {
        "title": "Управление глоссарием",
        "intro": "Термины используются для подготовки встреч, поиска и заметок. При расшифровке их используют только поддерживаемые модели.",
        "items": [
          [
            "Brevia",
            "Product name"
          ],
          [
            "Vector database",
            "Technical term"
          ],
          [
            "ERes2Net",
            "Speaker model"
          ]
        ],
        "add": "Добавить термин",
        "edit": "Изменить",
        "save": "Сохранить",
        "cancel": "Отмена",
        "remove": "Удалить",
        "placeholder": "Введите термин или фразу"
      },
      "storage": {
        "title": "Локальное хранилище",
        "intro": "Все данные встреч остаются на этом устройстве.",
        "items": [
          [
            "Встречи и записи",
            "8.4 GB"
          ],
          [
            "Файлы моделей",
            "1.7 GB"
          ]
        ]
      },
      "close": "Закрыть",
      "download": "Скачать"
    }
  },
  "whatsNewCopy": {
    "zh": {
      "title": "更新日志",
      "intro": "每次版本更新，这里会记录言录的变化。",
      "view": "查看更新日志",
      "what": "新增",
      "fixed": "修复",
      "improved": "改进",
      "changes": "其他",
      "date": "日期",
      "current": "当前版本",
      "empty": "暂无更新日志",
      "security": "安全",
      "contributors": "新贡献者",
      "fullChangelog": "完整更新记录"
    },
    "en": {
      "title": "What’s new",
      "intro": "See what changed in each release of Brevia.",
      "view": "View changelog",
      "what": "New",
      "fixed": "Fixed",
      "improved": "Improved",
      "changes": "Other",
      "date": "Date",
      "current": "Current version",
      "empty": "No changelog yet",
      "security": "Security",
      "contributors": "New Contributors",
      "fullChangelog": "Full Changelog"
    },
    "es": {
      "title": "Novedades",
      "intro": "Consulta qué cambió en cada versión de Brevia.",
      "view": "Ver historial de cambios",
      "what": "Novedades",
      "fixed": "Correcciones",
      "improved": "Mejoras",
      "changes": "Otros",
      "date": "Fecha",
      "current": "Versión actual",
      "empty": "Aún no hay historial de cambios",
      "security": "Seguridad",
      "contributors": "Nuevos colaboradores",
      "fullChangelog": "Historial completo"
    },
    "ja": {
      "title": "更新履歴",
      "intro": "各バージョンの変更点を確認できます。",
      "view": "更新履歴を見る",
      "what": "新機能",
      "fixed": "修正",
      "improved": "改善",
      "changes": "その他",
      "date": "日付",
      "current": "現在のバージョン",
      "empty": "更新履歴はまだありません",
      "security": "セキュリティ",
      "contributors": "新しい貢献者",
      "fullChangelog": "すべての変更"
    },
    "ko": {
      "title": "새로운 기능",
      "intro": "각 버전에서 변경된 사항을 확인할 수 있습니다.",
      "view": "업데이트 기록 보기",
      "what": "새 기능",
      "fixed": "수정",
      "improved": "개선",
      "changes": "기타",
      "date": "날짜",
      "current": "현재 버전",
      "empty": "아직 업데이트 기록이 없습니다",
      "security": "보안",
      "contributors": "새 기여자",
      "fullChangelog": "전체 변경 내역"
    },
    "fr": {
      "title": "Nouveautés",
      "intro": "Découvrez ce qui a changé dans chaque version de Brevia.",
      "view": "Voir le journal des versions",
      "what": "Nouveautés",
      "fixed": "Correctifs",
      "improved": "Améliorations",
      "changes": "Autres",
      "date": "Date",
      "current": "Version actuelle",
      "empty": "Pas encore de journal des versions",
      "security": "Sécurité",
      "contributors": "Nouveaux contributeurs",
      "fullChangelog": "Journal complet"
    },
    "de": {
      "title": "Neuerungen",
      "intro": "Erfahren Sie, was sich in jeder Version von Brevia geändert hat.",
      "view": "Änderungsprotokoll ansehen",
      "what": "Neu",
      "fixed": "Behoben",
      "improved": "Verbessert",
      "changes": "Sonstiges",
      "date": "Datum",
      "current": "Aktuelle Version",
      "empty": "Noch kein Änderungsprotokoll",
      "security": "Sicherheit",
      "contributors": "Neue Mitwirkende",
      "fullChangelog": "Vollständiges Änderungsprotokoll"
    },
    "ru": {
      "title": "Что нового",
      "intro": "Узнайте, что изменилось в каждой версии Brevia.",
      "view": "Просмотреть журнал версий",
      "what": "Новое",
      "fixed": "Исправлено",
      "improved": "Улучшено",
      "changes": "Прочее",
      "date": "Дата",
      "current": "Текущая версия",
      "empty": "Журнал версий пока пуст",
      "security": "Безопасность",
      "contributors": "Новые участники",
      "fullChangelog": "Полный список изменений"
    }
  },
  "voiceFeaturesCopy": {
    "zh": {
      "verify": "验证声音"
    },
    "en": {
      "verify": "Verify voice"
    },
    "es": {
      "verify": "Verificar voz"
    },
    "ja": {
      "verify": "音声を確認"
    },
    "ko": {
      "verify": "음성 확인"
    },
    "fr": {
      "verify": "Vérifier la voix"
    },
    "de": {
      "verify": "Stimme prüfen"
    },
    "ru": {
      "verify": "Проверить голос"
    }
  },
  "modelLibraryMetaCopy": {
    "zh": {
      "download": "下载",
      "quality": "质量",
      "speed": "速度",
      "qualityTiers": [
        "标准",
        "高",
        "极高"
      ],
      "speedTiers": [
        "较慢",
        "均衡",
        "快"
      ],
      "refined": "语音识别",
      "vad": "语音检测",
      "diarization": "说话人分离",
      "voiceprint": "声纹识别",
      "summary": "会议纪要",
      "translation": "字幕翻译"
    },
    "en": {
      "download": "Download",
      "quality": "Quality",
      "speed": "Speed",
      "qualityTiers": [
        "Standard",
        "High",
        "Very high"
      ],
      "speedTiers": [
        "Slower",
        "Balanced",
        "Fast"
      ],
      "refined": "Speech recognition",
      "vad": "Voice detection",
      "diarization": "Speaker diarization",
      "voiceprint": "Voiceprint recognition",
      "summary": "Meeting notes",
      "translation": "Caption translation"
    },
    "es": {
      "download": "Descarga",
      "quality": "Calidad",
      "speed": "Velocidad",
      "qualityTiers": [
        "Estándar",
        "Alta",
        "Muy alta"
      ],
      "speedTiers": [
        "Más lento",
        "Equilibrado",
        "Rápido"
      ],
      "refined": "Reconocimiento de voz",
      "vad": "Detección de voz",
      "diarization": "Separación de hablantes",
      "voiceprint": "Reconocimiento de voz",
      "summary": "Notas de reunión",
      "translation": "Traducción de subtítulos"
    },
    "ja": {
      "download": "ダウンロード",
      "quality": "品質",
      "speed": "速度",
      "qualityTiers": [
        "標準",
        "高",
        "最高"
      ],
      "speedTiers": [
        "やや遅い",
        "バランス",
        "高速"
      ],
      "refined": "音声認識",
      "vad": "音声検出",
      "diarization": "話者分離",
      "voiceprint": "声紋認識",
      "summary": "議事録",
      "translation": "字幕翻訳"
    },
    "ko": {
      "download": "다운로드",
      "quality": "품질",
      "speed": "속도",
      "qualityTiers": [
        "표준",
        "높음",
        "최고"
      ],
      "speedTiers": [
        "다소 느림",
        "균형",
        "빠름"
      ],
      "refined": "음성 인식",
      "vad": "음성 감지",
      "diarization": "화자 분리",
      "voiceprint": "음성 지문 인식",
      "summary": "회의록",
      "translation": "자막 번역"
    },
    "fr": {
      "download": "Téléchargement",
      "quality": "Qualité",
      "speed": "Vitesse",
      "qualityTiers": [
        "Standard",
        "Élevée",
        "Très élevée"
      ],
      "speedTiers": [
        "Plus lent",
        "Équilibré",
        "Rapide"
      ],
      "refined": "Reconnaissance vocale",
      "vad": "Détection vocale",
      "diarization": "Séparation des locuteurs",
      "voiceprint": "Reconnaissance vocale",
      "summary": "Notes de réunion",
      "translation": "Traduction des sous-titres"
    },
    "de": {
      "download": "Download",
      "quality": "Qualität",
      "speed": "Geschwindigkeit",
      "qualityTiers": [
        "Standard",
        "Hoch",
        "Sehr hoch"
      ],
      "speedTiers": [
        "Langsamer",
        "Ausgewogen",
        "Schnell"
      ],
      "refined": "Spracherkennung",
      "vad": "Spracherkennung",
      "diarization": "Sprechertrennung",
      "voiceprint": "Stimmabdruck-Erkennung",
      "summary": "Besprechungsnotizen",
      "translation": "Untertitelübersetzung"
    },
    "ru": {
      "download": "Загрузка",
      "quality": "Качество",
      "speed": "Скорость",
      "qualityTiers": [
        "Стандарт",
        "Высокое",
        "Очень высокое"
      ],
      "speedTiers": [
        "Медленнее",
        "Сбалансированно",
        "Быстро"
      ],
      "refined": "Распознавание речи",
      "vad": "Обнаружение речи",
      "diarization": "Разделение говорящих",
      "voiceprint": "Распознавание голоса",
      "summary": "Протокол встречи",
      "translation": "Перевод субтитров"
    }
  },
  "advancedSettingCopy": {
    "zh": {
      "sections": {
        "audio": "音频",
        "asr": "识别与端点检测",
        "live_asr": "实时识别",
        "diarization": "说话人分离",
        "refinement": "会后精修",
        "vad": "语音检测（VAD）",
        "voice_profiles": "声纹库",
        "meetings": "会议",
        "llm": "纪要模型"
      },
      "subgroups": {
        "default": "默认（其他语言）",
        "zh": "中文"
      },
      "fields": {
        "sample_rate": "采样率（Hz）",
        "chunk_seconds": "音频分块时长（秒）",
        "refined_window_seconds": "精修窗口时长（秒）",
        "max_speech_seconds": "整句识别段长上限（秒，仅在低于语言/模型上限时生效）",
        "mix_max_delay_ms": "最大混音对齐延迟（毫秒）",
        "quiet_speech_recovery": "安静语音兜底识别（0 关 1 开）",
        "quiet_speech_min_seconds": "安静语音最短时长（秒）",
        "quiet_speech_max_seconds": "安静语音最长时长（秒）",
        "quiet_speech_level_ratio": "安静语音相对响度阈值（0–1）",
        "microphone_target_rms": "麦克风目标响度",
        "microphone_minimum_rms": "麦克风最小响度",
        "microphone_max_gain": "麦克风最大增益",
        "microphone_peak": "麦克风峰值限制",
        "segmentation_model_id": "说话区间模型",
        "cluster_threshold": "聚类阈值",
        "online_similarity_threshold": "在线匹配阈值",
        "voiceprint_similarity_threshold": "声纹匹配阈值",
        "minimum_embedding_seconds": "最短声纹语音（秒）",
        "boundary_tail_seconds": "边界回补时长（秒）",
        "speaker_change_detection": "说话人切换检测",
        "num_speakers": "固定说话人数（-1 为自动）",
        "min_duration_on": "最短说话时长（秒）",
        "min_duration_off": "最短静音间隔（秒）",
        "max_refine_seconds": "最长精修时长（秒）",
        "diarization_chunk_ms": "说话人分块时长（毫秒）",
        "diarization_timeout_seconds": "说话人分块处理超时（秒）",
        "diarization_overlap_ms": "说话人分块重叠（毫秒）",
        "embedding_window_ms": "声纹窗口时长（毫秒）",
        "max_auto_speakers": "自动聚类最多说话人",
        "min_auto_speaker_windows": "自动聚类最少窗口数",
        "min_auto_speaker_duration_ms": "自动聚类最短语音（毫秒）",
        "auto_cluster_score_tolerance": "自动聚类分数容差",
        "threshold": "语音检测阈值",
        "min_silence_duration": "最小静音时长（秒）",
        "min_speech_duration": "最短语音时长（秒）",
        "max_speech_duration": "最长语音时长（秒）",
        "max_samples": "每人最大录音条数",
        "max_total_seconds": "每人最大录音时长（秒）",
        "deleted_retention_days": "删除记录保留天数",
        "timeout_seconds": "模型请求超时（秒）"
      },
      "hint": "用于本地运行配置。"
    },
    "en": {
      "sections": {
        "audio": "Audio",
        "asr": "Recognition and endpointing",
        "live_asr": "Live recognition",
        "diarization": "Speaker diarization",
        "refinement": "Post-meeting refinement",
        "vad": "Voice detection (VAD)",
        "voice_profiles": "Voiceprints",
        "meetings": "Meetings",
        "llm": "Summary model"
      },
      "subgroups": {
        "default": "Default (other languages)",
        "zh": "Chinese"
      },
      "fields": {
        "sample_rate": "Sample rate (Hz)",
        "chunk_seconds": "Audio chunk duration (s)",
        "refined_window_seconds": "Refinement window (s)",
        "max_speech_seconds": "Sentence segment cap (s; only lowers the language/model cap)",
        "mix_max_delay_ms": "Maximum mixing alignment delay (ms)",
        "quiet_speech_recovery": "Quiet-speech fallback recognition (0 off, 1 on)",
        "quiet_speech_min_seconds": "Quiet speech minimum duration (s)",
        "quiet_speech_max_seconds": "Quiet speech maximum duration (s)",
        "quiet_speech_level_ratio": "Quiet speech relative level threshold (0–1)",
        "microphone_target_rms": "Microphone target loudness",
        "microphone_minimum_rms": "Microphone minimum loudness",
        "microphone_max_gain": "Microphone maximum gain",
        "microphone_peak": "Microphone peak limit",
        "segmentation_model_id": "Speech-segmentation model",
        "cluster_threshold": "Clustering threshold",
        "online_similarity_threshold": "Online matching threshold",
        "voiceprint_similarity_threshold": "Voiceprint matching threshold",
        "minimum_embedding_seconds": "Minimum voiceprint audio (s)",
        "boundary_tail_seconds": "Boundary tail (s)",
        "speaker_change_detection": "Speaker-change detection",
        "num_speakers": "Fixed speaker count (-1 = auto)",
        "min_duration_on": "Minimum speech duration (s)",
        "min_duration_off": "Minimum silence gap (s)",
        "max_refine_seconds": "Maximum refinement duration (s)",
        "diarization_chunk_ms": "Diarization chunk (ms)",
        "diarization_timeout_seconds": "Diarization chunk timeout (s)",
        "diarization_overlap_ms": "Diarization chunk overlap (ms)",
        "embedding_window_ms": "Voiceprint window (ms)",
        "max_auto_speakers": "Maximum speakers when auto-clustering",
        "min_auto_speaker_windows": "Minimum windows when auto-clustering",
        "min_auto_speaker_duration_ms": "Minimum speech for auto-clustering (ms)",
        "auto_cluster_score_tolerance": "Auto-clustering score tolerance",
        "threshold": "Voice detection threshold",
        "min_silence_duration": "Minimum silence duration (s)",
        "min_speech_duration": "Minimum speech duration (s)",
        "max_speech_duration": "Maximum speech duration (s)",
        "max_samples": "Maximum recordings per person",
        "max_total_seconds": "Maximum recording duration per person (s)",
        "deleted_retention_days": "Deleted-record retention (days)",
        "timeout_seconds": "Model request timeout (s)"
      },
      "hint": "Used by the local runtime."
    },
    "es": {
      "sections": {
        "audio": "Audio",
        "asr": "Reconocimiento y detección de final",
        "live_asr": "Reconocimiento en vivo",
        "diarization": "Separación de hablantes",
        "refinement": "Refinamiento posterior",
        "vad": "Detección de voz (VAD)",
        "voice_profiles": "Huellas de voz",
        "meetings": "Reuniones",
        "llm": "Modelo de resumen"
      },
      "subgroups": {
        "default": "Predeterminado (otros idiomas)",
        "zh": "Chino"
      },
      "fields": {
        "sample_rate": "Frecuencia de muestreo (Hz)",
        "chunk_seconds": "Duración del bloque de audio (s)",
        "refined_window_seconds": "Ventana de refinamiento (s)",
        "max_speech_seconds": "Límite de segmento (s; solo reduce el límite de idioma/modelo)",
        "mix_max_delay_ms": "Retardo máximo de alineación de mezcla (ms)",
        "quiet_speech_recovery": "Reconocimiento de reserva para voz baja (0 no, 1 sí)",
        "quiet_speech_min_seconds": "Duración mínima de voz baja (s)",
        "quiet_speech_max_seconds": "Duración máxima de voz baja (s)",
        "quiet_speech_level_ratio": "Umbral de nivel relativo para voz baja (0–1)",
        "microphone_target_rms": "Volumen objetivo del micrófono",
        "microphone_minimum_rms": "Volumen mínimo del micrófono",
        "microphone_max_gain": "Ganancia máxima del micrófono",
        "microphone_peak": "Límite de pico del micrófono",
        "segmentation_model_id": "Modelo de segmentación de voz",
        "cluster_threshold": "Umbral de agrupación",
        "online_similarity_threshold": "Umbral de coincidencia en línea",
        "voiceprint_similarity_threshold": "Umbral de coincidencia de huella",
        "minimum_embedding_seconds": "Audio mínimo para huella de voz (s)",
        "boundary_tail_seconds": "Cola de frontera (s)",
        "speaker_change_detection": "Detección de cambio de hablante",
        "num_speakers": "Número fijo de hablantes (-1 = auto)",
        "min_duration_on": "Duración mínima de habla (s)",
        "min_duration_off": "Pausa mínima (s)",
        "max_refine_seconds": "Duración máxima de refinamiento (s)",
        "diarization_chunk_ms": "Bloque de separación (ms)",
        "diarization_timeout_seconds": "Tiempo máximo por bloque de hablantes (s)",
        "diarization_overlap_ms": "Solape de bloques (ms)",
        "embedding_window_ms": "Ventana de huella de voz (ms)",
        "max_auto_speakers": "Máximo de hablantes al agrupar",
        "min_auto_speaker_windows": "Mínimo de ventanas al agrupar",
        "min_auto_speaker_duration_ms": "Habla mínima para agrupar (ms)",
        "auto_cluster_score_tolerance": "Tolerancia de puntuación al agrupar",
        "threshold": "Umbral de detección de voz",
        "min_silence_duration": "Silencio mínimo (s)",
        "min_speech_duration": "Duración mínima de habla (s)",
        "max_speech_duration": "Duración máxima de habla (s)",
        "max_samples": "Máximas grabaciones por persona",
        "max_total_seconds": "Duración máxima por persona (s)",
        "deleted_retention_days": "Retención de eliminados (días)",
        "timeout_seconds": "Tiempo de espera de solicitud (s)"
      },
      "hint": "Se usa en la ejecución local."
    },
    "ja": {
      "sections": {
        "audio": "音声",
        "asr": "認識と終端検出",
        "live_asr": "ライブ認識",
        "diarization": "話者分離",
        "refinement": "会議後の高精度化",
        "vad": "音声検出（VAD）",
        "voice_profiles": "声紋",
        "meetings": "会議",
        "llm": "要約モデル"
      },
      "subgroups": {
        "default": "既定（その他の言語）",
        "zh": "中国語"
      },
      "fields": {
        "sample_rate": "サンプリングレート（Hz）",
        "chunk_seconds": "音声チャンク長（秒）",
        "refined_window_seconds": "高精度化ウィンドウ（秒）",
        "max_speech_seconds": "発話セグメント上限（秒。言語・モデル上限を下げる方向にのみ作用）",
        "mix_max_delay_ms": "ミックスの最大整列遅延（ミリ秒）",
        "quiet_speech_recovery": "小さな声の補助認識（0 オフ 1 オン）",
        "quiet_speech_min_seconds": "小さな声の最短長（秒）",
        "quiet_speech_max_seconds": "小さな声の最長長（秒）",
        "quiet_speech_level_ratio": "小さな声の相対レベル閾値（0–1）",
        "microphone_target_rms": "マイク目標音量",
        "microphone_minimum_rms": "マイク最小音量",
        "microphone_max_gain": "マイク最大ゲイン",
        "microphone_peak": "マイクピーク上限",
        "segmentation_model_id": "音声区間モデル",
        "cluster_threshold": "クラスタリング閾値",
        "online_similarity_threshold": "オンライン一致閾値",
        "voiceprint_similarity_threshold": "声紋一致閾値",
        "minimum_embedding_seconds": "声紋用の最短音声（秒）",
        "boundary_tail_seconds": "境界の余韻（秒）",
        "speaker_change_detection": "話者切替の検出",
        "num_speakers": "固定話者数（-1 = 自動）",
        "min_duration_on": "最短発話時間（秒）",
        "min_duration_off": "最短無音間隔（秒）",
        "max_refine_seconds": "高精度化の最長時間（秒）",
        "diarization_chunk_ms": "話者分離チャンク（ミリ秒）",
        "diarization_timeout_seconds": "話者分離チャンクのタイムアウト（秒）",
        "diarization_overlap_ms": "話者分離の重複（ミリ秒）",
        "embedding_window_ms": "声紋ウィンドウ（ミリ秒）",
        "max_auto_speakers": "自動クラスタリングの最大話者数",
        "min_auto_speaker_windows": "自動クラスタリングの最小ウィンドウ数",
        "min_auto_speaker_duration_ms": "自動クラスタリングの最短音声（ミリ秒）",
        "auto_cluster_score_tolerance": "自動クラスタリングのスコア許容差",
        "threshold": "音声検出の閾値",
        "min_silence_duration": "最小無音時間（秒）",
        "min_speech_duration": "最短音声時間（秒）",
        "max_speech_duration": "最長音声時間（秒）",
        "max_samples": "1 人あたりの最大録音数",
        "max_total_seconds": "1 人あたりの最大録音時間（秒）",
        "deleted_retention_days": "削除済み記録の保持日数",
        "timeout_seconds": "モデル要求タイムアウト（秒）"
      },
      "hint": "ローカル実行に使用します。"
    },
    "ko": {
      "sections": {
        "audio": "오디오",
        "asr": "인식 및 종점 감지",
        "live_asr": "실시간 인식",
        "diarization": "화자 분리",
        "refinement": "회의 후 정제",
        "vad": "음성 감지(VAD)",
        "voice_profiles": "음성 지문",
        "meetings": "회의",
        "llm": "요약 모델"
      },
      "subgroups": {
        "default": "기본(다른 언어)",
        "zh": "중국어"
      },
      "fields": {
        "sample_rate": "샘플링 레이트(Hz)",
        "chunk_seconds": "오디오 청크 길이(초)",
        "refined_window_seconds": "정교화 창(초)",
        "max_speech_seconds": "문장 구간 상한(초, 언어/모델 상한을 낮추는 방향으로만 적용)",
        "mix_max_delay_ms": "믹싱 최대 정렬 지연(ms)",
        "quiet_speech_recovery": "작은 목소리 보조 인식(0 끔, 1 켬)",
        "quiet_speech_min_seconds": "작은 목소리 최소 길이(초)",
        "quiet_speech_max_seconds": "작은 목소리 최대 길이(초)",
        "quiet_speech_level_ratio": "작은 목소리 상대 음량 임계값(0–1)",
        "microphone_target_rms": "마이크 목표 음량",
        "microphone_minimum_rms": "마이크 최소 음량",
        "microphone_max_gain": "마이크 최대 게인",
        "microphone_peak": "마이크 피크 제한",
        "segmentation_model_id": "음성 구간 모델",
        "cluster_threshold": "클러스터링 임계값",
        "online_similarity_threshold": "온라인 일치 임계값",
        "voiceprint_similarity_threshold": "음성 지문 일치 임계값",
        "minimum_embedding_seconds": "최소 음성 지문 오디오(초)",
        "boundary_tail_seconds": "경계 꼬리(초)",
        "speaker_change_detection": "화자 전환 감지",
        "num_speakers": "고정 화자 수(-1 = 자동)",
        "min_duration_on": "최소 발화 시간(초)",
        "min_duration_off": "최소 무음 간격(초)",
        "max_refine_seconds": "최대 정제 시간(초)",
        "diarization_chunk_ms": "화자 분리 청크(ms)",
        "diarization_timeout_seconds": "화자 분리 청크 제한 시간(초)",
        "diarization_overlap_ms": "화자 분리 겹침(ms)",
        "embedding_window_ms": "음성 지문 창(ms)",
        "max_auto_speakers": "자동 클러스터링 최대 화자 수",
        "min_auto_speaker_windows": "자동 클러스터링 최소 창 수",
        "min_auto_speaker_duration_ms": "자동 클러스터링 최소 음성(ms)",
        "auto_cluster_score_tolerance": "자동 클러스터링 점수 허용 오차",
        "threshold": "음성 감지 임계값",
        "min_silence_duration": "최소 무음 시간(초)",
        "min_speech_duration": "최소 음성 시간(초)",
        "max_speech_duration": "최대 음성 시간(초)",
        "max_samples": "1인당 최대 녹음 수",
        "max_total_seconds": "1인당 최대 녹음 시간(초)",
        "deleted_retention_days": "삭제 기록 보관 기간(일)",
        "timeout_seconds": "모델 요청 시간 제한(초)"
      },
      "hint": "로컬 실행에 사용됩니다."
    },
    "fr": {
      "sections": {
        "audio": "Audio",
        "asr": "Reconnaissance et détection de fin",
        "live_asr": "Reconnaissance en direct",
        "diarization": "Séparation des locuteurs",
        "refinement": "Affinage après réunion",
        "vad": "Détection de voix (VAD)",
        "voice_profiles": "Empreintes vocales",
        "meetings": "Réunions",
        "llm": "Modèle de résumé"
      },
      "subgroups": {
        "default": "Par défaut (autres langues)",
        "zh": "Chinois"
      },
      "fields": {
        "sample_rate": "Fréquence d’échantillonnage (Hz)",
        "chunk_seconds": "Durée du bloc audio (s)",
        "refined_window_seconds": "Fenêtre d’affinage (s)",
        "max_speech_seconds": "Plafond de segment (s ; n’abaisse que la limite langue/modèle)",
        "mix_max_delay_ms": "Délai maximal d’alignement du mixage (ms)",
        "quiet_speech_recovery": "Reconnaissance de secours pour voix faible (0 off, 1 on)",
        "quiet_speech_min_seconds": "Durée minimale de voix faible (s)",
        "quiet_speech_max_seconds": "Durée maximale de voix faible (s)",
        "quiet_speech_level_ratio": "Seuil de niveau relatif pour voix faible (0–1)",
        "microphone_target_rms": "Volume cible du microphone",
        "microphone_minimum_rms": "Volume minimal du microphone",
        "microphone_max_gain": "Gain maximal du microphone",
        "microphone_peak": "Limite de crête du microphone",
        "segmentation_model_id": "Modèle de segmentation de parole",
        "cluster_threshold": "Seuil de regroupement",
        "online_similarity_threshold": "Seuil de correspondance en ligne",
        "voiceprint_similarity_threshold": "Seuil de correspondance d’empreinte",
        "minimum_embedding_seconds": "Audio minimal pour empreinte (s)",
        "boundary_tail_seconds": "Queue de frontière (s)",
        "speaker_change_detection": "Détection de changement de locuteur",
        "num_speakers": "Nombre fixe de locuteurs (-1 = auto)",
        "min_duration_on": "Durée minimale de parole (s)",
        "min_duration_off": "Pause minimale (s)",
        "max_refine_seconds": "Durée maximale d’affinage (s)",
        "diarization_chunk_ms": "Bloc de séparation (ms)",
        "diarization_timeout_seconds": "Délai maximal par segment de locuteur (s)",
        "diarization_overlap_ms": "Chevauchement des blocs (ms)",
        "embedding_window_ms": "Fenêtre d’empreinte (ms)",
        "max_auto_speakers": "Nombre maximal de locuteurs au regroupement",
        "min_auto_speaker_windows": "Fenêtres minimales au regroupement",
        "min_auto_speaker_duration_ms": "Parole minimale au regroupement (ms)",
        "auto_cluster_score_tolerance": "Tolérance de score au regroupement",
        "threshold": "Seuil de détection de voix",
        "min_silence_duration": "Silence minimal (s)",
        "min_speech_duration": "Durée minimale de parole (s)",
        "max_speech_duration": "Durée maximale de parole (s)",
        "max_samples": "Enregistrements maximum par personne",
        "max_total_seconds": "Durée maximale par personne (s)",
        "deleted_retention_days": "Conservation des éléments supprimés (jours)",
        "timeout_seconds": "Délai de requête du modèle (s)"
      },
      "hint": "Utilisé par l’exécution locale."
    },
    "de": {
      "sections": {
        "audio": "Audio",
        "asr": "Erkennung und Endpunkterkennung",
        "live_asr": "Live-Erkennung",
        "diarization": "Sprechertrennung",
        "refinement": "Nachbearbeitung",
        "vad": "Spracherkennung (VAD)",
        "voice_profiles": "Stimmabdrücke",
        "meetings": "Besprechungen",
        "llm": "Zusammenfassungsmodell"
      },
      "subgroups": {
        "default": "Standard (andere Sprachen)",
        "zh": "Chinesisch"
      },
      "fields": {
        "sample_rate": "Abtastrate (Hz)",
        "chunk_seconds": "Audioblockdauer (s)",
        "refined_window_seconds": "Nachbearbeitungsfenster (s)",
        "max_speech_seconds": "Segmentobergrenze (s; senkt nur die Sprach-/Modellgrenze)",
        "mix_max_delay_ms": "Maximale Ausrichtungsverzögerung beim Mischen (ms)",
        "quiet_speech_recovery": "Ersatztranskription für leise Sprache (0 aus, 1 ein)",
        "quiet_speech_min_seconds": "Minimale Dauer leiser Sprache (s)",
        "quiet_speech_max_seconds": "Maximale Dauer leiser Sprache (s)",
        "quiet_speech_level_ratio": "Relativer Pegelschwellwert für leise Sprache (0–1)",
        "microphone_target_rms": "Mikrofon-Ziellautstärke",
        "microphone_minimum_rms": "Mikrofon-Mindestlautstärke",
        "microphone_max_gain": "Maximale Mikrofonverstärkung",
        "microphone_peak": "Mikrofon-Peakgrenze",
        "segmentation_model_id": "Sprachsegmentierungsmodell",
        "cluster_threshold": "Cluster-Schwellenwert",
        "online_similarity_threshold": "Online-Abgleichschwelle",
        "voiceprint_similarity_threshold": "Stimmabdruck-Schwelle",
        "minimum_embedding_seconds": "Minimales Stimmabdruck-Audio (s)",
        "boundary_tail_seconds": "Grenz-Nachlauf (s)",
        "speaker_change_detection": "Sprecherwechsel-Erkennung",
        "num_speakers": "Feste Sprecherzahl (-1 = auto)",
        "min_duration_on": "Minimale Sprechdauer (s)",
        "min_duration_off": "Minimale Stille (s)",
        "max_refine_seconds": "Maximale Nachbearbeitungsdauer (s)",
        "diarization_chunk_ms": "Sprechertrennungs-Block (ms)",
        "diarization_timeout_seconds": "Zeitlimit pro Sprechersegment (s)",
        "diarization_overlap_ms": "Blocküberlappung (ms)",
        "embedding_window_ms": "Stimmabdruck-Fenster (ms)",
        "max_auto_speakers": "Maximale Sprecher beim Auto-Clustering",
        "min_auto_speaker_windows": "Minimale Fenster beim Auto-Clustering",
        "min_auto_speaker_duration_ms": "Minimale Sprache beim Auto-Clustering (ms)",
        "auto_cluster_score_tolerance": "Score-Toleranz beim Auto-Clustering",
        "threshold": "Schwelle der Spracherkennung",
        "min_silence_duration": "Minimale Stille (s)",
        "min_speech_duration": "Minimale Sprechdauer (s)",
        "max_speech_duration": "Maximale Sprechdauer (s)",
        "max_samples": "Maximale Aufnahmen pro Person",
        "max_total_seconds": "Maximale Aufnahmezeit pro Person (s)",
        "deleted_retention_days": "Aufbewahrung gelöschter Einträge (Tage)",
        "timeout_seconds": "Zeitüberschreitung der Modellanfrage (s)"
      },
      "hint": "Wird von der lokalen Laufzeit verwendet."
    },
    "ru": {
      "sections": {
        "audio": "Аудио",
        "asr": "Распознавание и определение конца",
        "live_asr": "Распознавание в реальном времени",
        "diarization": "Разделение говорящих",
        "refinement": "Обработка после встречи",
        "vad": "Детекция голоса (VAD)",
        "voice_profiles": "Голосовые отпечатки",
        "meetings": "Встречи",
        "llm": "Модель сводки"
      },
      "subgroups": {
        "default": "По умолчанию (другие языки)",
        "zh": "Китайский"
      },
      "fields": {
        "sample_rate": "Частота дискретизации (Гц)",
        "chunk_seconds": "Длительность аудиоблока (с)",
        "refined_window_seconds": "Окно обработки (с)",
        "max_speech_seconds": "Предел длины сегмента (с; только понижает предел языка/модели)",
        "mix_max_delay_ms": "Максимальная задержка выравнивания микса (мс)",
        "quiet_speech_recovery": "Резервное распознавание тихой речи (0 выкл, 1 вкл)",
        "quiet_speech_min_seconds": "Минимальная длительность тихой речи (с)",
        "quiet_speech_max_seconds": "Максимальная длительность тихой речи (с)",
        "quiet_speech_level_ratio": "Порог относительного уровня тихой речи (0–1)",
        "microphone_target_rms": "Целевая громкость микрофона",
        "microphone_minimum_rms": "Минимальная громкость микрофона",
        "microphone_max_gain": "Максимальное усиление микрофона",
        "microphone_peak": "Ограничение пика микрофона",
        "segmentation_model_id": "Модель сегментации речи",
        "cluster_threshold": "Порог кластеризации",
        "online_similarity_threshold": "Порог онлайн-сопоставления",
        "voiceprint_similarity_threshold": "Порог совпадения отпечатка",
        "minimum_embedding_seconds": "Минимальное аудио для отпечатка (с)",
        "boundary_tail_seconds": "Хвост границы (с)",
        "speaker_change_detection": "Обнаружение смены говорящего",
        "num_speakers": "Фиксированное число говорящих (-1 = авто)",
        "min_duration_on": "Минимальная длительность речи (с)",
        "min_duration_off": "Минимальная пауза (с)",
        "max_refine_seconds": "Максимальная длительность обработки (с)",
        "diarization_chunk_ms": "Блок разделения (мс)",
        "diarization_timeout_seconds": "Тайм-аут обработки фрагмента говорящих (с)",
        "diarization_overlap_ms": "Перекрытие блоков (мс)",
        "embedding_window_ms": "Окно голосового отпечатка (мс)",
        "max_auto_speakers": "Максимум говорящих при авто-кластеризации",
        "min_auto_speaker_windows": "Минимум окон при авто-кластеризации",
        "min_auto_speaker_duration_ms": "Минимум речи при авто-кластеризации (мс)",
        "auto_cluster_score_tolerance": "Допуск оценки при авто-кластеризации",
        "threshold": "Порог детекции голоса",
        "min_silence_duration": "Минимальная тишина (с)",
        "min_speech_duration": "Минимальная длительность речи (с)",
        "max_speech_duration": "Максимальная длительность речи (с)",
        "max_samples": "Максимум записей на человека",
        "max_total_seconds": "Максимальная длительность на человека (с)",
        "deleted_retention_days": "Хранение удалённых записей (дни)",
        "timeout_seconds": "Тайм-аут запроса модели (с)"
      },
      "hint": "Используется локальным запуском."
    }
  },
  "summaryTaskCopy": {
    "zh": [
      "正在生成会议纪要",
      "准备生成纪要",
      "正在生成摘要",
      "正在保存纪要",
      "纪要已生成"
    ],
    "en": [
      "Generating meeting notes",
      "Preparing meeting notes",
      "Generating summary",
      "Saving meeting notes",
      "Meeting notes generated"
    ],
    "es": [
      "Generando notas de reunión",
      "Preparando las notas de reunión",
      "Generando el resumen",
      "Guardando las notas",
      "Notas de reunión generadas"
    ],
    "ja": [
      "会議メモを生成中",
      "会議メモを準備中",
      "要約を生成中",
      "会議メモを保存中",
      "会議メモを生成しました"
    ],
    "ko": [
      "회의록 생성 중",
      "회의록 준비 중",
      "요약 생성 중",
      "회의록 저장 중",
      "회의록이 생성되었습니다"
    ],
    "fr": [
      "Génération des notes de réunion",
      "Préparation des notes de réunion",
      "Génération du résumé",
      "Enregistrement des notes",
      "Notes de réunion générées"
    ],
    "de": [
      "Besprechungsnotizen werden erstellt",
      "Besprechungsnotizen werden vorbereitet",
      "Zusammenfassung wird erstellt",
      "Besprechungsnotizen werden gespeichert",
      "Besprechungsnotizen erstellt"
    ],
    "ru": [
      "Создание заметок встречи",
      "Подготовка заметок встречи",
      "Создание сводки",
      "Сохранение заметок встречи",
      "Заметки встречи созданы"
    ]
  },
  "onboardingCopy": {
    "zh": {
      "languageHint": "",
      "later": "稍后设置",
      "ready": "功能已准备就绪"
    },
    "en": {
      "languageHint": "You can change the interface language any time.",
      "later": "Set up later",
      "ready": "All set"
    },
    "es": {
      "languageHint": "Puedes cambiar el idioma de la interfaz en cualquier momento.",
      "later": "Configurar más tarde",
      "ready": "Funciones listas"
    },
    "ja": {
      "languageHint": "表示言語はいつでも変更できます。",
      "later": "あとで設定",
      "ready": "機能の準備ができました"
    },
    "ko": {
      "languageHint": "인터페이스 언어는 언제든 변경할 수 있습니다.",
      "later": "나중에 설정",
      "ready": "기능이 준비되었습니다"
    },
    "fr": {
      "languageHint": "Vous pourrez modifier la langue de l’interface à tout moment.",
      "later": "Configurer plus tard",
      "ready": "Fonctions prêtes"
    },
    "de": {
      "languageHint": "Sie können die Sprache der Oberfläche jederzeit ändern.",
      "later": "Später einrichten",
      "ready": "Alles bereit"
    },
    "ru": {
      "languageHint": "Язык интерфейса можно изменить в любое время.",
      "later": "Настроить позже",
      "ready": "Функции готовы"
    }
  },
  "onboardingSecurityCopy": {
    "zh": "模型资源来自可信来源，您的音频数据不会上传。",
    "en": "Models come from trusted sources and pass integrity checks.\nYour audio is never uploaded to the cloud.",
    "es": "Los modelos provienen de fuentes confiables y pasan comprobaciones de integridad.\nTu audio nunca se sube a la nube.",
    "ja": "モデルは信頼できる提供元から取得し、完全性を検証しています。\n音声データがクラウドにアップロードされることはありません。",
    "ko": "모델은 신뢰할 수 있는 출처에서 제공되며 무결성 검사를 거칩니다.\n오디오 데이터는 클라우드에 업로드되지 않습니다.",
    "fr": "Les modèles proviennent de sources fiables et leur intégrité est vérifiée.\nVos données audio ne sont jamais envoyées dans le cloud.",
    "de": "Modelle stammen aus vertrauenswürdigen Quellen und werden auf Integrität geprüft.\nIhre Audiodaten werden nie in die Cloud hochgeladen.",
    "ru": "Модели получены из надёжных источников и проходят проверку целостности.\nВаши аудиоданные никогда не загружаются в облако."
  },
  "onboardingLanguageCopy": {
    "zh": [
      "选择你的语言",
      "选择言录的界面语言。",
      "继续"
    ],
    "en": [
      "Choose your language",
      "Choose the language for Brevia.",
      "Continue"
    ],
    "es": [
      "Elige tu idioma",
      "Elige el idioma para Brevia.",
      "Continuar"
    ],
    "ja": [
      "言語を選択",
      "Brevia で使用する言語を選択してください。",
      "続ける"
    ],
    "ko": [
      "언어를 선택하세요",
      "Brevia에서 사용할 언어를 선택하세요.",
      "계속"
    ],
    "fr": [
      "Choisissez votre langue",
      "Choisissez la langue de Brevia.",
      "Continuer"
    ],
    "de": [
      "Sprache auswählen",
      "Wählen Sie die Sprache für Brevia.",
      "Fortfahren"
    ],
    "ru": [
      "Выберите язык",
      "Выберите язык для Brevia.",
      "Продолжить"
    ]
  },
  "aiOnboardingCopy": {
    "zh": {
      "title": "启用 AI 功能",
      "intro": "",
      "meetingNotesTitle": "AI 会议纪要",
      "meetingNotesDesc": "会议结束后，AI 自动把整场对话整理成会议纪要及待办事项。",
      "meetingNotesConsequence": "不生成纪要也能正常录制与出字幕；之后可在「AI 会议总结」设置里随时开启。",
      "wayTitle": "会议纪要使用哪种 AI？",
      "builtin": "内置 AI",
      "builtinHint": "使用本地部署的 AI 模型进行分析，首次使用需要下载模型，将会占用一定的电脑性能。",
      "online": "在线 AI 供应商",
      "onlineHint": "使用 AI 云供应商的 API Key 进行分析，对电脑性能占用更小，消耗的 token 数量取决于会议长度。",
      "configureOnline": "配置在线服务",
      "liveNotesTitle": "AI 笔记",
      "liveNotesDesc": "在会议中，AI 实时提示重点、决策与待办，辅助记录笔记。",
      "liveNotesConsequence": "不开 AI 笔记，仍会得到 AI 会议纪要；只是会中没有实时建议。",
      "enableLiveNotes": "启用 AI 笔记",
      "proactivityTitle": "AI 笔记如何协助记录笔记？",
      "proactivityHint": "",
      "offEmpty": "已选择暂不开启 AI 笔记，会中不会出现实时建议；会议结束后仍会生成 AI 会议纪要。",
      "levels": [
        [
          "off",
          "暂不开启 AI 笔记",
          "仅使用会后 AI 会议纪要，会中不产生实时建议。"
        ],
        [
          "quiet",
          "只在我需要时",
          "只有你点击 AI、选中文字或主动要求时才出现。"
        ],
        [
          "assist",
          "发现重点时提醒我",
          "发现结论、决策、待办、重要数字时适度提醒。"
        ],
        [
          "auto",
          "自动帮我整理",
          "自动归纳结论、收集待办并整理会议内容。"
        ]
      ],
      "finish": "完成",
      "skip": "暂不启用"
    },
    "en": {
      "title": "Set up AI features",
      "intro": "Brevia has two AI features for different purposes. You can turn each on or off:",
      "meetingNotesTitle": "AI meeting summary",
      "meetingNotesDesc": "After the meeting, AI automatically distills the whole conversation into a summary (conclusions, actions, risks). It runs once, so it works smoothly even on low-end devices.",
      "meetingNotesConsequence": "Recording and captions work fine without a summary; you can turn it on anytime in the AI meeting summary settings.",
      "wayTitle": "Which AI for the meeting summary?",
      "builtin": "Built-in AI",
      "builtinHint": "Free, offline, most private. Downloads about 1–2 GB once.",
      "online": "Online AI",
      "onlineHint": "Uses your own API key online, faster, may cost money; only text is sent.",
      "configureOnline": "Configure online service",
      "liveNotesTitle": "AI notes (real-time suggestions)",
      "liveNotesDesc": "During the meeting, AI suggests key points, decisions, and actions in real time. It keeps using resources, so we suggest turning it off on low-end devices.",
      "liveNotesConsequence": "Without AI notes you still get the AI meeting summary; you just won’t get in-meeting suggestions.",
      "enableLiveNotes": "Enable AI notes",
      "proactivityTitle": "How should AI notes help?",
      "proactivityHint": "The more proactive, the more AI chimes in. You can adjust this anytime in the AI notes settings.",
      "offEmpty": "AI notes are off for now, so you won’t see in-meeting suggestions; you’ll still get the post-meeting AI summary.",
      "levels": [
        [
          "off",
          "Don’t enable AI notes yet",
          "Only use the post-meeting AI summary; no in-meeting suggestions."
        ],
        [
          "quiet",
          "Only when I ask",
          "Appears only when you click AI, select text, or ask directly."
        ],
        [
          "assist",
          "Notify me of key points",
          "Lightly notifies you about conclusions, decisions, actions, and key figures."
        ],
        [
          "auto",
          "Organize for me automatically",
          "Automatically summarizes conclusions and organizes the meeting."
        ]
      ],
      "finish": "Done",
      "skip": "Not now"
    },
    "es": {
      "title": "Activar funciones de IA",
      "intro": "Brevia tiene dos funciones de IA con distintos fines. Puedes activar cada una por separado:",
      "meetingNotesTitle": "Resumen de reunión con IA",
      "meetingNotesDesc": "Tras la reunión, la IA resume toda la conversación en una nota de reunión.",
      "meetingNotesConsequence": "La grabación y los subtítulos funcionan sin resumen; puedes activarlo cuando quieras en los ajustes de resumen.",
      "wayTitle": "¿Qué IA para el resumen?",
      "builtin": "IA integrada",
      "builtinHint": "Gratis, sin conexión, más privada. Descarga una vez ~1–2 GB.",
      "online": "IA en línea",
      "onlineHint": "Usa tu clave API en línea, más rápida, puede costar; solo texto.",
      "configureOnline": "Configurar servicio en línea",
      "liveNotesTitle": "Notas IA",
      "liveNotesDesc": "Durante la reunión, la IA sugiere puntos clave, decisiones y tareas en tiempo real para ayudarte a tomar notas.",
      "liveNotesConsequence": "Sin notas IA sigues teniendo el resumen de la reunión; solo pierdes las sugerencias en directo.",
      "enableLiveNotes": "Activar notas IA",
      "proactivityTitle": "¿Cómo deben ayudar las notas IA?",
      "proactivityHint": "Cuanto más proactiva, más interviene la IA. Puedes ajustarlo cuando quieras en los ajustes de notas IA.",
      "offEmpty": "Has elegido no activar las notas IA por ahora; no verás sugerencias en tiempo real y seguirás teniendo el resumen tras la reunión.",
      "levels": [
        [
          "off",
          "No activar notas IA todavía",
          "Usar solo el resumen con IA; sin sugerencias en la reunión."
        ],
        [
          "quiet",
          "Solo cuando lo pida",
          "Aparece solo cuando haces clic en IA, seleccionas texto o lo pides."
        ],
        [
          "assist",
          "Avisarme de puntos clave",
          "Avisa de conclusiones, decisiones, tareas y cifras clave."
        ],
        [
          "auto",
          "Organizar automáticamente",
          "Resume conclusiones y organiza la reunión automáticamente."
        ]
      ],
      "finish": "Listo",
      "skip": "Ahora no"
    },
    "ja": {
      "title": "AI 機能を有効にする",
      "intro": "Brevia には用途の異なる 2 つの AI 機能があります。それぞれ個別にオン/オフできます：",
      "meetingNotesTitle": "AI 会議要約",
      "meetingNotesDesc": "会議後に AI が会話全体を会議メモにまとめます。",
      "meetingNotesConsequence": "要約なしでも録音・字幕は正常に動作します。後からいつでも「AI 会議要約」設定で有効にできます。",
      "wayTitle": "会議要約にはどの AI を使いますか？",
      "builtin": "内蔵 AI",
      "builtinHint": "無料・オフライン・よりプライベート。初回約 1〜2 GB。",
      "online": "オンライン AI",
      "onlineHint": "自分の API キーで接続。より速いが費用の可能性。テキストのみ送信。",
      "configureOnline": "オンラインサービスを設定",
      "liveNotesTitle": "AI メモ",
      "liveNotesDesc": "会議中に AI が要点・決定・タスクをリアルタイムで提示し、メモ取りを支援します。",
      "liveNotesConsequence": "AI メモをオフにしても AI 会議要約は得られます。会議中のリアルタイム提案だけがなくなります。",
      "enableLiveNotes": "AI メモを有効にする",
      "proactivityTitle": "AI メモはどのように手伝いますか？",
      "proactivityHint": "より積極的に設定するほど、AI の介入が増えます。あとでいつでも「AIメモ」設定で変更できます。",
      "offEmpty": "AI メモをまだ有効にしていないため、会議中のリアルタイム提案はありません。会議後も AI 会議要約は生成されます。",
      "levels": [
        [
          "off",
          "AI メモはまだ使わない",
          "会後の AI 会議要約のみ使用。会議中の提案はありません。"
        ],
        [
          "quiet",
          "必要なときだけ",
          "クリックや選択、直接依頼したときだけ表示。"
        ],
        [
          "assist",
          "要点を知らせる",
          "結論・決定・ToDo・重要な数字を適度に知らせます。"
        ],
        [
          "auto",
          "自動で整理する",
          "結論をまとめ、会議内容を自動整理します。"
        ]
      ],
      "finish": "完了",
      "skip": "あとで"
    },
    "ko": {
      "title": "AI 기능 사용",
      "intro": "Brevia에는 용도가 다른 두 가지 AI 기능이 있습니다. 각각 따로 켜고 끌 수 있습니다:",
      "meetingNotesTitle": "AI 회의 요약",
      "meetingNotesDesc": "회의가 끝나면 AI가 전체 대화를 회의 요약으로 정리합니다.",
      "meetingNotesConsequence": "요약이 없어도 녹음과 자막은 정상 작동합니다. 나중에 언제든 \"AI 회의 요약\" 설정에서 켤 수 있습니다.",
      "wayTitle": "회의 요약에 어떤 AI를 쓸까요?",
      "builtin": "내장 AI",
      "builtinHint": "무료·오프라인·더 사적. 처음 약 1~2GB.",
      "online": "온라인 AI",
      "onlineHint": "자신의 API 키로 연결. 더 빠르고 비용 가능. 텍스트만 전송.",
      "configureOnline": "온라인 서비스 구성",
      "liveNotesTitle": "AI 메모",
      "liveNotesDesc": "회의 중 AI가 핵심·결정·할 일을 실시간으로 제안해 메모 작성을 돕습니다.",
      "liveNotesConsequence": "AI 메모를 꺼도 AI 회의 요약은 받습니다. 회의 중 실시간 제안만 사라집니다.",
      "enableLiveNotes": "AI 메모 사용",
      "proactivityTitle": "AI 메모는 어떻게 도와줄까요?",
      "offEmpty": "AI 메모를 아직 켜지 않아 회의 중 실시간 제안이 없습니다. 회의 후에도 AI 회의 요약은 생성됩니다.",
      "levels": [
        [
          "off",
          "AI 메모 아직 사용 안 함",
          "회의 후 AI 요약만 사용합니다. 회의 중 제안은 없습니다."
        ],
        [
          "quiet",
          "필요할 때만",
          "클릭, 선택 또는 직접 요청할 때만 표시됩니다."
        ],
        [
          "assist",
          "핵심 포인트 알림",
          "결론·결정·할 일·중요 수치를 적절히 알립니다."
        ],
        [
          "auto",
          "자동으로 정리",
          "결론을 요약하고 회의를 자동 정리합니다."
        ]
      ],
      "finish": "완료",
      "skip": "나중에",
      "proactivityHint": "더 적극적으로 설정할수록 AI가 더 자주 개입합니다. 언제든 AI 메모 설정에서 조정할 수 있습니다."
    },
    "fr": {
      "title": "Activer les fonctions IA",
      "intro": "Brevia a deux fonctions IA à des fins différentes. Vous pouvez activer chacune séparément :",
      "meetingNotesTitle": "Résumé de réunion IA",
      "meetingNotesDesc": "Après la réunion, l'IA résume toute la conversation en une note de réunion.",
      "meetingNotesConsequence": "L'enregistrement et les sous-titres fonctionnent sans résumé ; vous pourrez l'activer à tout moment dans les réglages du résumé.",
      "wayTitle": "Quelle IA pour le résumé ?",
      "builtin": "IA intégrée",
      "builtinHint": "Gratuite, hors ligne, plus privée. ~1–2 Go une fois.",
      "online": "IA en ligne",
      "onlineHint": "Votre clé API en ligne, plus rapide, peut coûter ; texte seul.",
      "configureOnline": "Configurer le service en ligne",
      "liveNotesTitle": "Notes IA",
      "liveNotesDesc": "Pendant la réunion, l'IA suggère points clés, décisions et tâches en temps réel pour vous aider à prendre des notes.",
      "liveNotesConsequence": "Sans notes IA, vous avez toujours le résumé de réunion ; seules les suggestions en direct disparaissent.",
      "enableLiveNotes": "Activer les notes IA",
      "proactivityTitle": "Comment les notes IA doivent-elles aider ?",
      "proactivityHint": "Plus c'est proactif, plus l'IA intervient. Ajustable à tout moment dans les réglages des notes IA.",
      "offEmpty": "Vous avez choisi de ne pas activer les notes IA pour l'instant : aucune suggestion en temps réel, mais vous aurez toujours le résumé IA après la réunion.",
      "levels": [
        [
          "off",
          "Ne pas activer les notes IA pour l'instant",
          "Utiliser uniquement le résumé IA après réunion ; aucune suggestion en direct."
        ],
        [
          "quiet",
          "Seulement quand je demande",
          "N'apparaît que lorsque vous cliquez, sélectionnez du texte ou demandez."
        ],
        [
          "assist",
          "M'alerter des points clés",
          "Alerte sur les conclusions, décisions, tâches et chiffres clés."
        ],
        [
          "auto",
          "Organiser automatiquement",
          "Résume les conclusions et organise la réunion automatiquement."
        ]
      ],
      "finish": "Terminé",
      "skip": "Pas maintenant"
    },
    "de": {
      "title": "KI-Funktionen aktivieren",
      "intro": "Brevia hat zwei KI-Funktionen für unterschiedliche Zwecke. Sie können jede einzeln an- oder ausschalten:",
      "meetingNotesTitle": "KI-Besprechungszusammenfassung",
      "meetingNotesDesc": "Nach der Besprechung fasst die KI das ganze Gespräch in einer Zusammenfassung zusammen.",
      "meetingNotesConsequence": "Aufnahme und Untertitel funktionieren auch ohne Zusammenfassung; Sie können sie jederzeit in den Einstellungen aktivieren.",
      "wayTitle": "Welche KI für die Zusammenfassung?",
      "builtin": "Integrierte KI",
      "builtinHint": "Kostenlos, offline, am privatesten. Einmal ca. 1–2 GB.",
      "online": "Online-KI",
      "onlineHint": "Eigener API-Schlüssel online, schneller, kann kosten; nur Text.",
      "configureOnline": "Onlinedienst konfigurieren",
      "liveNotesTitle": "KI-Notizen",
      "liveNotesDesc": "Während der Besprechung schlägt die KI Punkte, Entscheidungen und Aufgaben in Echtzeit vor und hilft beim Mitschreiben.",
      "liveNotesConsequence": "Ohne KI-Notizen erhalten Sie weiterhin die Zusammenfassung; nur die Echtzeit-Vorschläge entfallen.",
      "enableLiveNotes": "KI-Notizen aktivieren",
      "proactivityTitle": "Wie sollen KI-Notizen helfen?",
      "proactivityHint": "Je proaktiver, desto mehr greift die KI ein. Sie können dies jederzeit in den KI-Notizen-Einstellungen anpassen.",
      "offEmpty": "KI-Notizen sind vorerst deaktiviert, daher keine Echtzeit-Vorschläge; die KI-Zusammenfassung nach der Besprechung erhalten Sie trotzdem.",
      "levels": [
        [
          "off",
          "KI-Notizen noch nicht aktivieren",
          "Nur die KI-Zusammenfassung nach der Besprechung; keine Echtzeit-Vorschläge."
        ],
        [
          "quiet",
          "Nur wenn ich frage",
          "Erscheint nur beim Klicken, Auswählen oder direkter Anfrage."
        ],
        [
          "assist",
          "Über Kernpunkte informieren",
          "Hinweise auf Schlussfolgerungen, Entscheidungen, Aufgaben und Zahlen."
        ],
        [
          "auto",
          "Automatisch ordnen",
          "Fasst Schlussfolgerungen zusammen und ordnet die Besprechung automatisch."
        ]
      ],
      "finish": "Fertig",
      "skip": "Später"
    },
    "ru": {
      "title": "Включить функции ИИ",
      "intro": "В Brevia есть две функции ИИ для разных целей. Каждую можно включать отдельно:",
      "meetingNotesTitle": "ИИ-сводка встречи",
      "meetingNotesDesc": "После встречи ИИ сводит весь разговор в сводку встречи.",
      "meetingNotesConsequence": "Запись и субтитры работают и без сводки; её можно включить в любой момент в настройках ИИ-сводки.",
      "wayTitle": "Какой ИИ для сводки?",
      "builtin": "Встроенный ИИ",
      "builtinHint": "Бесплатно, офлайн, приватно. Один раз ~1–2 ГБ.",
      "online": "Онлайн-ИИ",
      "onlineHint": "Свой ключ API онлайн, быстрее, может стоить; только текст.",
      "configureOnline": "Настроить онлайн-сервис",
      "liveNotesTitle": "ИИ-заметки",
      "liveNotesDesc": "Во время встречи ИИ в реальном времени подсказывает ключевые моменты, решения и задачи, помогая вести заметки.",
      "liveNotesConsequence": "Без ИИ-заметок вы всё равно получите ИИ-сводку встречи; пропадут лишь подсказки во время встречи.",
      "enableLiveNotes": "Включить ИИ-заметки",
      "proactivityTitle": "Как ИИ-заметки должны помогать?",
      "proactivityHint": "Чем активнее, тем больше вмешивается ИИ. Это можно изменить в любой момент в настройках ИИ-заметок.",
      "offEmpty": "Вы пока не включили ИИ-заметки, поэтому во время встречи подсказок не будет; ИИ-сводку после встречи вы всё равно получите.",
      "levels": [
        [
          "off",
          "Пока не включать ИИ-заметки",
          "Только ИИ-сводка после встречи; без подсказок во время встречи."
        ],
        [
          "quiet",
          "Только когда попрошу",
          "Появляется только при клике, выборе текста или прямой просьбе."
        ],
        [
          "assist",
          "Сообщать о ключевых моментах",
          "Сообщает о выводах, решениях, задачах и важных цифрах."
        ],
        [
          "auto",
          "Упорядочивать автоматически",
          "Автоматически резюмирует выводы и упорядочивает встречу."
        ]
      ],
      "finish": "Готово",
      "skip": "Не сейчас"
    }
  },
  "aiOnboardingDemoCopy": {
    "zh": {
      "recording": "正在录制",
      "meeting": "会议 ",
      "transcript": "实时字幕",
      "transcriptText": "“我们周五完成验收。”",
      "notes": "我的笔记",
      "scenes": {
        "quiet": [
          [
            "仅在需要时",
            "✦ AI 建议：确认截止时间",
            "• 周五前完成内部验收"
          ],
          [
            "仅在需要时",
            "✦ AI 建议：记录待办",
            "• 产品团队跟进验收"
          ]
        ],
        "assist": [
          [
            "发现重点",
            "✦ AI 建议：重要决策",
            "• 下周一开始小范围发布"
          ],
          [
            "发现重点",
            "✦ AI 建议：行动项",
            "• 开发团队周四交付测试版"
          ]
        ],
        "auto": [
          [
            "自动整理",
            "✦ AI 正在整理会议内容",
            "会议结论\n周五完成验收"
          ],
          [
            "自动整理",
            "✦ AI 正在归纳待办",
            "下一步\n准备测试版本"
          ]
        ]
      }
    },
    "en": {
      "recording": "Recording",
      "meeting": "Meeting ",
      "transcript": "Live transcript",
      "transcriptText": "“We’ll complete acceptance on Friday.”",
      "notes": "My notes",
      "scenes": {
        "quiet": [
          [
            "When needed",
            "✦ AI suggestion: confirm deadline",
            "• Finish internal acceptance by Friday"
          ],
          [
            "When needed",
            "✦ AI suggestion: capture action",
            "• Product team follows up on acceptance"
          ]
        ],
        "assist": [
          [
            "Key point found",
            "✦ AI suggestion: key decision",
            "• Start a limited rollout next Monday"
          ],
          [
            "Key point found",
            "✦ AI suggestion: action item",
            "• Engineering delivers a test build Thursday"
          ]
        ],
        "auto": [
          [
            "Auto organize",
            "✦ AI is organizing the meeting",
            "## Decision\n- Complete acceptance Friday"
          ],
          [
            "Auto organize",
            "✦ AI is grouping actions",
            "## Next step\n- Prepare a test build"
          ]
        ]
      }
    },
    "es": {
      "recording": "Grabando",
      "meeting": "Reunión ",
      "transcript": "Transcripción en vivo",
      "transcriptText": "“Terminaremos la aceptación el viernes.”",
      "notes": "Mis notas",
      "scenes": {
        "quiet": [
          [
            "Cuando sea necesario",
            "✦ Sugerencia de IA: confirmar plazo",
            "• Terminar la aceptación interna el viernes"
          ],
          [
            "Cuando sea necesario",
            "✦ Sugerencia de IA: registrar tarea",
            "• Producto da seguimiento a la aceptación"
          ]
        ],
        "assist": [
          [
            "Punto clave detectado",
            "✦ Sugerencia de IA: decisión clave",
            "• Iniciar despliegue limitado el lunes"
          ],
          [
            "Punto clave detectado",
            "✦ Sugerencia de IA: tarea",
            "• Ingeniería entrega una versión de prueba el jueves"
          ]
        ],
        "auto": [
          [
            "Organización automática",
            "✦ La IA organiza la reunión",
            "## Decisión\n- Completar la aceptación el viernes"
          ],
          [
            "Organización automática",
            "✦ La IA agrupa las tareas",
            "## Siguiente paso\n- Preparar una versión de prueba"
          ]
        ]
      }
    },
    "ja": {
      "recording": "録音中",
      "meeting": "会議 ",
      "transcript": "ライブ字幕",
      "transcriptText": "「金曜日に受け入れを完了します。」",
      "notes": "自分のメモ",
      "scenes": {
        "quiet": [
          [
            "必要なとき",
            "✦ AI の提案：期限を確認",
            "• 金曜日までに社内受け入れを完了"
          ],
          [
            "必要なとき",
            "✦ AI の提案：タスクを記録",
            "• プロダクトチームが受け入れをフォロー"
          ]
        ],
        "assist": [
          [
            "要点を発見",
            "✦ AI の提案：重要な決定",
            "• 来週月曜に限定公開を開始"
          ],
          [
            "要点を発見",
            "✦ AI の提案：アクション",
            "• 開発チームが木曜にテスト版を納品"
          ]
        ],
        "auto": [
          [
            "自動整理",
            "✦ AI が会議を整理中",
            "## 決定事項\n- 金曜日に受け入れを完了"
          ],
          [
            "自動整理",
            "✦ AI がタスクを整理中",
            "## 次の手順\n- テスト版を準備"
          ]
        ]
      }
    },
    "ko": {
      "recording": "녹음 중",
      "meeting": "회의 ",
      "transcript": "실시간 자막",
      "transcriptText": "“금요일에 검수를 완료하겠습니다.”",
      "notes": "내 메모",
      "scenes": {
        "quiet": [
          [
            "필요할 때",
            "✦ AI 제안: 마감일 확인",
            "• 금요일까지 내부 검수 완료"
          ],
          [
            "필요할 때",
            "✦ AI 제안: 할 일 기록",
            "• 제품팀이 검수를 후속 처리"
          ]
        ],
        "assist": [
          [
            "핵심 포인트 발견",
            "✦ AI 제안: 주요 결정",
            "• 다음 주 월요일 제한 배포 시작"
          ],
          [
            "핵심 포인트 발견",
            "✦ AI 제안: 실행 항목",
            "• 개발팀이 목요일 테스트 빌드 제공"
          ]
        ],
        "auto": [
          [
            "자동 정리",
            "✦ AI가 회의를 정리 중",
            "## 결정\n- 금요일에 검수 완료"
          ],
          [
            "자동 정리",
            "✦ AI가 할 일을 정리 중",
            "## 다음 단계\n- 테스트 빌드 준비"
          ]
        ]
      }
    },
    "fr": {
      "recording": "Enregistrement",
      "meeting": "Réunion ",
      "transcript": "Transcription en direct",
      "transcriptText": "« Nous terminerons la recette vendredi. »",
      "notes": "Mes notes",
      "scenes": {
        "quiet": [
          [
            "Au besoin",
            "✦ Suggestion IA : confirmer l’échéance",
            "• Terminer la recette interne vendredi"
          ],
          [
            "Au besoin",
            "✦ Suggestion IA : noter une tâche",
            "• L’équipe produit suit la recette"
          ]
        ],
        "assist": [
          [
            "Point clé détecté",
            "✦ Suggestion IA : décision clé",
            "• Lancement limité lundi prochain"
          ],
          [
            "Point clé détecté",
            "✦ Suggestion IA : action",
            "• L’équipe technique livre une version de test jeudi"
          ]
        ],
        "auto": [
          [
            "Organisation auto",
            "✦ L’IA organise la réunion",
            "## Décision\n- Terminer la recette vendredi"
          ],
          [
            "Organisation auto",
            "✦ L’IA regroupe les actions",
            "## Prochaine étape\n- Préparer une version de test"
          ]
        ]
      }
    },
    "de": {
      "recording": "Aufnahme läuft",
      "meeting": "Besprechung ",
      "transcript": "Live-Transkript",
      "transcriptText": "„Wir schließen die Abnahme am Freitag ab.“",
      "notes": "Meine Notizen",
      "scenes": {
        "quiet": [
          [
            "Bei Bedarf",
            "✦ KI-Vorschlag: Frist bestätigen",
            "• Interne Abnahme bis Freitag abschließen"
          ],
          [
            "Bei Bedarf",
            "✦ KI-Vorschlag: Aufgabe erfassen",
            "• Produktteam begleitet die Abnahme"
          ]
        ],
        "assist": [
          [
            "Kernpunkt erkannt",
            "✦ KI-Vorschlag: wichtige Entscheidung",
            "• Begrenzten Rollout nächsten Montag starten"
          ],
          [
            "Kernpunkt erkannt",
            "✦ KI-Vorschlag: Aktion",
            "• Entwicklung liefert Donnerstag einen Test-Build"
          ]
        ],
        "auto": [
          [
            "Automatisch ordnen",
            "✦ KI ordnet die Besprechung",
            "## Entscheidung\n- Abnahme am Freitag abschließen"
          ],
          [
            "Automatisch ordnen",
            "✦ KI bündelt Aufgaben",
            "## Nächster Schritt\n- Test-Build vorbereiten"
          ]
        ]
      }
    },
    "ru": {
      "recording": "Идёт запись",
      "meeting": "Встреча ",
      "transcript": "Субтитры в реальном времени",
      "transcriptText": "«Мы завершим приёмку в пятницу.»",
      "notes": "Мои заметки",
      "scenes": {
        "quiet": [
          [
            "По запросу",
            "✦ Совет ИИ: подтвердить срок",
            "• Завершить внутреннюю приёмку к пятнице"
          ],
          [
            "По запросу",
            "✦ Совет ИИ: записать задачу",
            "• Команда продукта сопровождает приёмку"
          ]
        ],
        "assist": [
          [
            "Найден ключевой момент",
            "✦ Совет ИИ: важное решение",
            "• Начать ограниченный запуск в следующий понедельник"
          ],
          [
            "Найден ключевой момент",
            "✦ Совет ИИ: задача",
            "• Разработка сдаёт тестовую сборку в четверг"
          ]
        ],
        "auto": [
          [
            "Автоупорядочивание",
            "✦ ИИ упорядочивает встречу",
            "## Решение\n- Завершить приёмку в пятницу"
          ],
          [
            "Автоупорядочивание",
            "✦ ИИ группирует задачи",
            "## Следующий шаг\n- Подготовить тестовую сборку"
          ]
        ]
      }
    }
  },
  "aiOnboardingSummaryDemoCopy": {
    "zh": {
      "windowTitle": "会议",
      "task": "生成会议纪要",
      "progress": "正在整理结论与待办…",
      "heading": "AI 会议纪要",
      "decision": "本周五前完成内部验收，风险点由李娜统一整理。",
      "actions": [
        "产品团队跟进验收",
        "开发下周一同步进展"
      ]
    },
    "en": {
      "windowTitle": "Meeting",
      "task": "Generating meeting summary",
      "progress": "Distilling conclusions and to-dos…",
      "heading": "AI meeting summary",
      "decision": "Complete internal acceptance by Friday; Mia consolidates the risks.",
      "actions": [
        "Product team to follow up on acceptance",
        "Engineering syncs progress Monday"
      ]
    },
    "es": {
      "windowTitle": "Reunión",
      "task": "Generando resumen de reunión",
      "progress": "Resumiendo conclusiones y tareas…",
      "heading": "Resumen de reunión con IA",
      "decision": "Completar la aceptación interna el viernes; Mía consolida los riesgos.",
      "actions": [
        "El equipo de producto da seguimiento",
        "Ingeniería sincroniza el lunes"
      ]
    },
    "ja": {
      "windowTitle": "会議",
      "task": "会議要約を生成中",
      "progress": "結論とタスクを整理中…",
      "heading": "AI 会議要約",
      "decision": "金曜までに社内受け入れを完了し、リスクは鈴木が整理します。",
      "actions": [
        "プロダクトチームが受け入れをフォロー",
        "開発は月曜に同期"
      ]
    },
    "ko": {
      "windowTitle": "회의",
      "task": "회의 요약 생성 중",
      "progress": "결론과 할 일을 정리 중…",
      "heading": "AI 회의 요약",
      "decision": "금요일까지 내부 검수를 완료하고 리스크는 이나가 정리합니다.",
      "actions": [
        "제품팀이 검수를 후속 처리",
        "개발팀은 월요일 동기화"
      ]
    },
    "fr": {
      "windowTitle": "Réunion",
      "task": "Génération du résumé",
      "progress": "Synthèse des conclusions…",
      "heading": "Résumé de réunion IA",
      "decision": "Terminer la recette interne vendredi ; Mía consolide les risques.",
      "actions": [
        "L'équipe produit suit la recette",
        "L’ingénierie synchronise lundi"
      ]
    },
    "de": {
      "windowTitle": "Besprechung",
      "task": "Zusammenfassung wird erstellt",
      "progress": "Schlussfolgerungen werden zusammengefasst…",
      "heading": "KI-Besprechungszusammenfassung",
      "decision": "Interne Abnahme bis Freitag abschließen; Mia bündelt die Risiken.",
      "actions": [
        "Produktteam begleitet die Abnahme",
        "Entwicklung synchronisiert Montag"
      ]
    },
    "ru": {
      "windowTitle": "Встреча",
      "task": "Создание сводки встречи",
      "progress": "Собираем выводы и задачи…",
      "heading": "ИИ-сводка встречи",
      "decision": "Завершить внутреннюю приёмку к пятнице; Миа собирает риски.",
      "actions": [
        "Команда продукта сопровождает приёмку",
        "Разработка синхронизируется в понедельник"
      ]
    }
  },
  "tourCopy": {
    "zh": {
      "title": "三分钟了解言录",
      "intro": "把每一场对话，变成可回看、可检索、可分享的记录。",
      "start": "开始使用",
      "next": "下一步",
      "back": "上一步",
      "skip": "跳过演示",
      "steps": [
        {
          "label": "会议库",
          "heading": "可检索的会议库",
          "body": "所有会议按时间归档。你随时可以按名称、逐字稿或标签，快速找回某一场对话。",
          "points": [
            "搜索会议、逐字稿与标签",
            "日期范围筛选",
            "删除后 30 天内可恢复"
          ],
          "callout": "search",
          "demo": {
            "meetings": [
              [
                "产品周会 · 2026-08-19",
                "04:23 · 中文 · 12 位参与者",
                [
                  "发布计划",
                  "风险"
                ]
              ],
              [
                "需求评审 · 2026-08-17",
                "01:48 · 中文 · 6 位参与者",
                [
                  "评审"
                ]
              ]
            ]
          }
        },
        {
          "label": "准备会议",
          "heading": "三秒开始一场会议",
          "body": "只需起个名字、选好语言与音频来源，点一下就能开始。",
          "points": [
            "选择会议语言与翻译目标",
            "麦克风 + 系统音频双轨录制",
            "录制前自动加载模型，不依赖网络"
          ],
          "callout": "form",
          "demo": {
            "name": "会议",
            "language": "中文",
            "device": "CPU",
            "mode": "标准模式"
          }
        },
        {
          "label": "实时字幕",
          "heading": "边开会，边出字幕",
          "body": "低延迟实时转写持续更新当前发言，还能区分不同说话人。",
          "points": [
            "毫秒级实时字幕",
            "说话人识别与区分",
            "可开启悬浮字幕窗口"
          ],
          "callout": "transcript",
          "demo": {
            "segments": [
              [
                "张伟",
                "我们周五前要完成内部验收。"
              ],
              [
                "李娜",
                "好，我把风险点整理出来。"
              ],
              [
                "张伟",
                "那下周一同步进展。"
              ]
            ]
          }
        },
        {
          "label": "AI 纪要",
          "heading": "AI 自动提炼结论与待办",
          "body": "会议过程中 AI 帮你记录重点、提取决策与待办，不遗漏任何行动项。",
          "points": [
            "自动提炼结论、风险与待办",
            "支持内置离线 AI 或在线服务",
            "文本才会发送，音频永远留在本机"
          ],
          "callout": "notes",
          "demo": {
            "decision": "周五前完成内部验收",
            "actions": [
              "产品团队跟进验收",
              "开发下周一同步进展"
            ]
          }
        },
        {
          "label": "会议详情",
          "heading": "回放、精修与分享",
          "body": "结束后可回听录音、查看精修后的逐字稿，并导出或分享纪要。",
          "points": [
            "回放录音并跳转到对应字幕",
            "会后精修，提升正式记录可读性",
            "导出与分享会议纪要"
          ],
          "callout": "player",
          "demo": {
            "refined": "我们确定周五前完成内部验收，风险点由李娜统一整理，下周一同步进展。",
            "summary": "周五前完成内部验收"
          }
        }
      ]
    },
    "en": {
      "title": "Meet Brevia in three minutes",
      "intro": "Turn every conversation into a record you can revisit, search, and share.",
      "start": "Start using",
      "next": "Next",
      "back": "Back",
      "skip": "Skip tour",
      "steps": [
        {
          "label": "Library",
          "heading": "A searchable meeting library",
          "body": "Every meeting is archived by time. Return to any conversation by name, transcript, or tag.",
          "points": [
            "Search meetings, transcripts, and tags",
            "Filter by date range",
            "Restore within 30 days of deletion"
          ],
          "callout": "search",
          "demo": {
            "meetings": [
              [
                "Product weekly · 2026-08-19",
                "04:23 · Chinese · 12 participants",
                [
                  "Launch",
                  "Risks"
                ]
              ],
              [
                "Requirements review · 2026-08-17",
                "01:48 · Chinese · 6 participants",
                [
                  "Review"
                ]
              ]
            ]
          }
        },
        {
          "label": "Prepare",
          "heading": "Start a meeting in seconds",
          "body": "Give it a name, pick a language and audio source, then hit record.",
          "points": [
            "Choose the meeting language and translation target",
            "Record mic and system audio together",
            "Models load before recording, so it works offline"
          ],
          "callout": "form",
          "demo": {
            "name": "Meeting",
            "language": "Chinese",
            "device": "CPU",
            "mode": "Standard mode"
          }
        },
        {
          "label": "Live captions",
          "heading": "Captions as you speak",
          "body": "Low-latency live transcription tracks the current speaker and separates voices.",
          "points": [
            "Millisecond-level live captions",
            "Speaker recognition and separation",
            "Optional floating caption window"
          ],
          "callout": "transcript",
          "demo": {
            "segments": [
              [
                "Alex",
                "We need to complete acceptance by Friday."
              ],
              [
                "Mia",
                "Got it, I’ll list the risks."
              ],
              [
                "Alex",
                "We’ll sync progress Monday."
              ]
            ]
          }
        },
        {
          "label": "AI notes",
          "heading": "Key points and actions, automatically",
          "body": "AI captures decisions and to-dos while you talk, so no action is missed.",
          "points": [
            "Derive conclusions, risks, and to-dos",
            "Built-in offline or online AI",
            "Only text is sent; audio stays on device"
          ],
          "callout": "notes",
          "demo": {
            "decision": "Complete acceptance by Friday",
            "actions": [
              "Product team to follow up on acceptance",
              "Engineering syncs progress Monday"
            ]
          }
        },
        {
          "label": "Details",
          "heading": "Play back, refine, and share",
          "body": "Afterward, replay the audio, read the refined transcript, and export or share notes.",
          "points": [
            "Replay audio and jump to matching captions",
            "Post-meeting refinement for polished records",
            "Export and share meeting notes"
          ],
          "callout": "player",
          "demo": {
            "refined": "We agreed to complete acceptance by Friday. Mia will consolidate the risks, and we will sync progress on Monday.",
            "summary": "Complete acceptance by Friday"
          }
        }
      ]
    },
    "es": {
      "title": "Conoce Brevia en tres minutos",
      "intro": "Convierte cada conversación en un registro que puedes revisar, buscar y compartir.",
      "start": "Comenzar",
      "next": "Siguiente",
      "back": "Atrás",
      "skip": "Saltar la guía",
      "steps": [
        {
          "label": "Biblioteca",
          "heading": "Una biblioteca de reuniones consultable",
          "body": "Cada reunión queda archivada por fecha. Vuelve a cualquier conversación por nombre, transcripción o etiqueta.",
          "points": [
            "Busca reuniones, transcripciones y etiquetas",
            "Filtra por rango de fechas",
            "Restaura hasta 30 días después de eliminar"
          ],
          "callout": "search",
          "demo": {
            "meetings": [
              [
                "Reunión semanal de producto · 2026-08-19",
                "04:23 · Chino · 12 participantes",
                [
                  "Lanzamiento",
                  "Riesgos"
                ]
              ],
              [
                "Revisión de requisitos · 2026-08-17",
                "01:48 · Chino · 6 participantes",
                [
                  "Revisión"
                ]
              ]
            ]
          }
        },
        {
          "label": "Preparar",
          "heading": "Empieza una reunión en segundos",
          "body": "Dale un nombre, elige el idioma y la fuente de audio, y pulsa grabar.",
          "points": [
            "Elige idioma y traducción",
            "Graba micrófono y audio del sistema",
            "Los modelos cargan antes, sin depender de la red"
          ],
          "callout": "form",
          "demo": {
            "name": "Reunión",
            "language": "Chino",
            "device": "CPU",
            "mode": "Modo estándar"
          }
        },
        {
          "label": "Subtítulos en vivo",
          "heading": "Subtítulos mientras hablas",
          "body": "La transcripción en vivo de baja latencia sigue al hablante y separa las voces.",
          "points": [
            "Subtítulos en vivo con baja latencia",
            "Reconocimiento y separación de hablantes",
            "Ventana de subtítulos flotante opcional"
          ],
          "callout": "transcript",
          "demo": {
            "segments": [
              [
                "Álex",
                "Debemos completar la aceptación el viernes."
              ],
              [
                "Mía",
                "Entendido, ordenaré los riesgos."
              ],
              [
                "Álex",
                "Sincronizamos el progreso el lunes."
              ]
            ]
          }
        },
        {
          "label": "Notas IA",
          "heading": "Puntos clave y tareas, automáticamente",
          "body": "La IA captura decisiones y pendientes mientras hablas, para que nada se pierda.",
          "points": [
            "Deriva conclusiones, riesgos y tareas",
            "IA integrada sin conexión o en línea",
            "Solo se envía texto; el audio queda en el dispositivo"
          ],
          "callout": "notes",
          "demo": {
            "decision": "Completar la aceptación el viernes",
            "actions": [
              "El equipo de producto da seguimiento",
              "Ingeniería sincroniza el lunes"
            ]
          }
        },
        {
          "label": "Detalles",
          "heading": "Reproduce, refina y comparte",
          "body": "Después, reproduce el audio, lee la transcripción refinada y exporta o comparte las notas.",
          "points": [
            "Reproduce y salta a los subtítulos",
            "Refinamiento posterior para registros pulidos",
            "Exporta y comparte las notas"
          ],
          "callout": "player",
          "demo": {
            "refined": "Acordamos completar la aceptación el viernes. Mía ordenará los riesgos y sincronizaremos el lunes.",
            "summary": "Completar la aceptación el viernes"
          }
        }
      ]
    },
    "ja": {
      "title": "Brevia を 3 分で知る",
      "intro": "すべての会話を、見返して検索・共有できる記録に。",
      "start": "はじめる",
      "next": "次へ",
      "back": "戻る",
      "skip": "ガイドをスキップ",
      "steps": [
        {
          "label": "ライブラリ",
          "heading": "検索できる会議ライブラリ",
          "body": "すべての会議が日時で整理されます。名前・文字起こし・タグでいつでも検索。",
          "points": [
            "会議・文字起こし・タグを検索",
            "期間で絞り込み",
            "削除後 30 日以内に復元"
          ],
          "callout": "search",
          "demo": {
            "meetings": [
              [
                "プロダクト定例会 · 2026-08-19",
                "04:23 · 中国語 · 12 名",
                [
                  "リリース",
                  "リスク"
                ]
              ],
              [
                "要件レビュー · 2026-08-17",
                "01:48 · 中国語 · 6 名",
                [
                  "レビュー"
                ]
              ]
            ]
          }
        },
        {
          "label": "準備",
          "heading": "数秒で会議を開始",
          "body": "名前を付け、言語と音声ソースを選んで録音を始めるだけ。",
          "points": [
            "会議言語と翻訳先を選択",
            "マイク＋システム音声で録音",
            "開始前にモデルを読み込み、オフライン対応"
          ],
          "callout": "form",
          "demo": {
            "name": "会議",
            "language": "中国語",
            "device": "CPU",
            "mode": "標準モード"
          }
        },
        {
          "label": "ライブ字幕",
          "heading": "話すそばから字幕",
          "body": "低遅延のリアルタイム文字起こしが発言を追い、話者を区別します。",
          "points": [
            "低遅延のライブ字幕",
            "話者認識と分離",
            "フローティング字幕も可能"
          ],
          "callout": "transcript",
          "demo": {
            "segments": [
              [
                "佐藤",
                "金曜までに内部受け入れを完了しましょう。"
              ],
              [
                "鈴木",
                "わかりました。リスクを整理します。"
              ],
              [
                "佐藤",
                "月曜に進捗を共有しましょう。"
              ]
            ]
          }
        },
        {
          "label": "AI メモ",
          "heading": "結論と ToDo を自動で抽出",
          "body": "AI が話しながら決定やタスクを記録し、行動項目を逃しません。",
          "points": [
            "結論・リスク・ToDo を抽出",
            "内蔵オフライン AI またはオンライン",
            "送信されるのはテキストのみ。音声は端末内"
          ],
          "callout": "notes",
          "demo": {
            "decision": "金曜までに内部受け入れを完了",
            "actions": [
              "プロダクトチームが受け入れをフォロー",
              "エンジニアリングは月曜に同期"
            ]
          }
        },
        {
          "label": "詳細",
          "heading": "再生・精修・共有",
          "body": "終了後は音声を再生し、精修済みの文字起こしを確認して共有できます。",
          "points": [
            "音声を再生し字幕へジャンプ",
            "会議後の精修で読みやすく",
            "議事録をエクスポート・共有"
          ],
          "callout": "player",
          "demo": {
            "refined": "金曜までに内部受け入れを完了することで合意。リスクは鈴木が整理し、月曜に進捗を共有します。",
            "summary": "金曜までに内部受け入れを完了"
          }
        }
      ]
    },
    "ko": {
      "title": "Brevia를 3분 만에 알아보기",
      "intro": "모든 대화를 다시 보고 검색하고 공유할 수 있는 기록으로.",
      "start": "시작하기",
      "next": "다음",
      "back": "뒤로",
      "skip": "둘러보기 건너뛰기",
      "steps": [
        {
          "label": "라이브러리",
          "heading": "검색 가능한 회의 라이브러리",
          "body": "모든 회의가 날짜별로 보관됩니다. 이름·녹취·태그로 언제든 다시 찾아보세요.",
          "points": [
            "회의·녹취·태그 검색",
            "기간으로 필터링",
            "삭제 후 30일 이내 복원"
          ],
          "callout": "search",
          "demo": {
            "meetings": [
              [
                "제품 주간회의 · 2026-08-19",
                "04:23 · 한국어 · 참가자 12명",
                [
                  "출시",
                  "리스크"
                ]
              ],
              [
                "요구사항 검토 · 2026-08-17",
                "01:48 · 한국어 · 참가자 6명",
                [
                  "검토"
                ]
              ]
            ]
          }
        },
        {
          "label": "준비",
          "heading": "몇 초 만에 회의 시작",
          "body": "이름을 정하고 언어와 오디오 소스를 선택한 뒤 녹음을 시작하세요.",
          "points": [
            "회의 언어와 번역 대상 선택",
            "마이크 + 시스템 오디오 녹음",
            "시작 전 모델 로드, 오프라인 대응"
          ],
          "callout": "form",
          "demo": {
            "name": "회의",
            "language": "한국어",
            "device": "CPU",
            "mode": "표준 모드"
          }
        },
        {
          "label": "실시간 자막",
          "heading": "말하는 즉시 자막",
          "body": "저지연 실시간 전사가 발언을 따라가며 화자를 구분합니다.",
          "points": [
            "밀리초 수준의 실시간 자막",
            "화자 인식 및 구분",
            "플로팅 자막 창 가능"
          ],
          "callout": "transcript",
          "demo": {
            "segments": [
              [
                "김민수",
                "금요일까지 내부 검수를 마칩시다."
              ],
              [
                "이지은",
                "네, 리스크를 정리할게요."
              ],
              [
                "김민수",
                "월요일에 진행 상황을 공유하죠."
              ]
            ]
          }
        },
        {
          "label": "AI 메모",
          "heading": "결론과 할 일을 자동으로",
          "body": "말하는 동안 AI가 결정과 작업을 기록해 놓치는 일이 없습니다.",
          "points": [
            "결론·리스크·할 일 추출",
            "내장 오프라인 또는 온라인 AI",
            "텍스트만 전송, 오디오는 기기에 유지"
          ],
          "callout": "notes",
          "demo": {
            "decision": "금요일까지 내부 검수 완료",
            "actions": [
              "제품팀이 검수 후속 처리",
              "엔지니어링 월요일 동기화"
            ]
          }
        },
        {
          "label": "상세",
          "heading": "재생·정제·공유",
          "body": "종료 후 오디오를 재생하고 정제된 녹취를 확인하며 메모를 내보낼 수 있습니다.",
          "points": [
            "오디오 재생 및 자막 이동",
            "회의 후 정제로 다듬기",
            "회의록 내보내기 및 공유"
          ],
          "callout": "player",
          "demo": {
            "refined": "금요일까지 내부 검수를 완료하기로 합의했습니다. 리스크는 이지은이 정리하고 월요일에 진행 상황을 공유합니다.",
            "summary": "금요일까지 내부 검수 완료"
          }
        }
      ]
    },
    "fr": {
      "title": "Découvrez Brevia en trois minutes",
      "intro": "Transformez chaque conversation en un enregistrement à relire, chercher et partager.",
      "start": "Commencer",
      "next": "Suivant",
      "back": "Retour",
      "skip": "Passer la démo",
      "steps": [
        {
          "label": "Bibliothèque",
          "heading": "Une bibliothèque de réunions consultable",
          "body": "Chaque réunion est archivée par date. Retrouvez toute conversation par nom, transcription ou étiquette.",
          "points": [
            "Rechercher réunions, transcriptions et étiquettes",
            "Filtrer par période",
            "Restaurer sous 30 jours après suppression"
          ],
          "callout": "search",
          "demo": {
            "meetings": [
              [
                "Réunion produit hebdo · 2026-08-19",
                "04:23 · Chinois · 12 participants",
                [
                  "Lancement",
                  "Risques"
                ]
              ],
              [
                "Revue des exigences · 2026-08-17",
                "01:48 · Chinois · 6 participants",
                [
                  "Revue"
                ]
              ]
            ]
          }
        },
        {
          "label": "Préparer",
          "heading": "Lancez une réunion en quelques secondes",
          "body": "Donnez-lui un nom, choisissez la langue et la source audio, puis enregistrez.",
          "points": [
            "Choisir langue et traduction",
            "Enregistrer micro et audio système",
            "Modèles chargés avant, fonctionne hors ligne"
          ],
          "callout": "form",
          "demo": {
            "name": "Réunion",
            "language": "Chinois",
            "device": "CPU",
            "mode": "Mode standard"
          }
        },
        {
          "label": "Sous-titres en direct",
          "heading": "Des sous-titres pendant que vous parlez",
          "body": "La transcription en direct à faible latence suit l’intervenant et sépare les voix.",
          "points": [
            "Sous-titres en direct à faible latence",
            "Reconnaissance et séparation des locuteurs",
            "Fenêtre de sous-titres flottante optionnelle"
          ],
          "callout": "transcript",
          "demo": {
            "segments": [
              [
                "Paul",
                "Nous devons finaliser la recette vendredi."
              ],
              [
                "Marie",
                "D’accord, je liste les risques."
              ],
              [
                "Paul",
                "Nous synchroniserons lundi."
              ]
            ]
          }
        },
        {
          "label": "Notes IA",
          "heading": "Points clés et actions, automatiquement",
          "body": "L’IA capture décisions et tâches pendant que vous parlez, sans rien manquer.",
          "points": [
            "Déduire conclusions, risques et tâches",
            "IA intégrée hors ligne ou en ligne",
            "Seul le texte est envoyé ; l’audio reste local"
          ],
          "callout": "notes",
          "demo": {
            "decision": "Finaliser la recette vendredi",
            "actions": [
              "L’équipe produit suit la recette",
              "L’équipe technique synchronise lundi"
            ]
          }
        },
        {
          "label": "Détails",
          "heading": "Relire, affiner et partager",
          "body": "Après coup, écoutez l’audio, lisez la transcription affinée et exportez ou partagez les notes.",
          "points": [
            "Écouter et sauter aux sous-titres",
            "Affinage après réunion",
            "Exporter et partager les notes"
          ],
          "callout": "player",
          "demo": {
            "refined": "Nous avons convenu de finaliser la recette vendredi. Marie consolidera les risques et nous synchroniserons lundi.",
            "summary": "Finaliser la recette vendredi"
          }
        }
      ]
    },
    "de": {
      "title": "Brevia in drei Minuten kennenlernen",
      "intro": "Machen Sie aus jedem Gespräch eine Aufzeichnung, die Sie nachschlagen, durchsuchen und teilen können.",
      "start": "Starten",
      "next": "Weiter",
      "back": "Zurück",
      "skip": "Tour überspringen",
      "steps": [
        {
          "label": "Bibliothek",
          "heading": "Eine durchsuchbare Besprechungsbibliothek",
          "body": "Jede Besprechung wird nach Datum archiviert. Finden Sie jede Unterhaltung über Name, Transkript oder Tag wieder.",
          "points": [
            "Besprechungen, Transkripte und Tags durchsuchen",
            "Nach Zeitraum filtern",
            "Innerhalb von 30 Tagen nach Löschung wiederherstellen"
          ],
          "callout": "search",
          "demo": {
            "meetings": [
              [
                "Produktwochenmeeting · 2026-08-19",
                "04:23 · Chinesisch · 12 Teilnehmer",
                [
                  "Launch",
                  "Risiken"
                ]
              ],
              [
                "Anforderungsreview · 2026-08-17",
                "01:48 · Chinesisch · 6 Teilnehmer",
                [
                  "Review"
                ]
              ]
            ]
          }
        },
        {
          "label": "Vorbereiten",
          "heading": "In Sekunden eine Besprechung starten",
          "body": "Geben Sie einen Namen ein, wählen Sie Sprache und Audioquelle und drücken Sie Aufnahme.",
          "points": [
            "Sprache und Übersetzungsziel wählen",
            "Mikrofon und Systemaudio aufnehmen",
            "Modelle laden vor dem Start, offline-tauglich"
          ],
          "callout": "form",
          "demo": {
            "name": "Besprechung",
            "language": "Chinesisch",
            "device": "CPU",
            "mode": "Standardmodus"
          }
        },
        {
          "label": "Live-Untertitel",
          "heading": "Untertitel, während Sie sprechen",
          "body": "Die latenzarme Live-Transkription verfolgt den Sprecher und trennt die Stimmen.",
          "points": [
            "Latenzarme Live-Untertitel",
            "Sprechererkennung und -trennung",
            "Optional schwebendes Untertitelfenster"
          ],
          "callout": "transcript",
          "demo": {
            "segments": [
              [
                "Alex",
                "Wir müssen die Abnahme bis Freitag abschließen."
              ],
              [
                "Mia",
                "Verstanden, ich liste die Risiken."
              ],
              [
                "Alex",
                "Wir stimmen uns Montag ab."
              ]
            ]
          }
        },
        {
          "label": "KI-Notizen",
          "heading": "Kernpunkte und Aufgaben, automatisch",
          "body": "Die KI erfasst Entscheidungen und Aufgaben, während Sie sprechen – nichts wird übersehen.",
          "points": [
            "Schlussfolgerungen, Risiken und Aufgaben ableiten",
            "Integrierte Offline- oder Online-KI",
            "Nur Text wird gesendet; Audio bleibt lokal"
          ],
          "callout": "notes",
          "demo": {
            "decision": "Abnahme bis Freitag abschließen",
            "actions": [
              "Produktteam begleitet die Abnahme",
              "Entwicklung stimmt sich Montag ab"
            ]
          }
        },
        {
          "label": "Details",
          "heading": "Abspielen, nachbearbeiten und teilen",
          "body": "Danach können Sie das Audio abspielen, das bearbeitete Transkript lesen und Notizen exportieren oder teilen.",
          "points": [
            "Audio abspielen und zu Untertiteln springen",
            "Nachbearbeitung für saubere Aufzeichnungen",
            "Notizen exportieren und teilen"
          ],
          "callout": "player",
          "demo": {
            "refined": "Wir haben vereinbart, die Abnahme bis Freitag abzuschließen. Mia konsolidiert die Risiken, und wir stimmen uns Montag ab.",
            "summary": "Abnahme bis Freitag abschließen"
          }
        }
      ]
    },
    "ru": {
      "title": "Познакомьтесь с Brevia за три минуты",
      "intro": "Превратите любой разговор в запись, которую можно пересмотреть, найти и поделиться.",
      "start": "Начать",
      "next": "Далее",
      "back": "Назад",
      "skip": "Пропустить обзор",
      "steps": [
        {
          "label": "Библиотека",
          "heading": "Поисковая библиотека встреч",
          "body": "Каждая встреча архивируется по дате. Вернитесь к любому разговору по названию, расшифровке или тегу.",
          "points": [
            "Поиск встреч, расшифровок и тегов",
            "Фильтр по периоду",
            "Восстановление в течение 30 дней"
          ],
          "callout": "search",
          "demo": {
            "meetings": [
              [
                "Еженедельная встреча продукта · 2026-08-19",
                "04:23 · Китайский · 12 участников",
                [
                  "Запуск",
                  "Риски"
                ]
              ],
              [
                "Ревью требований · 2026-08-17",
                "01:48 · Китайский · 6 участников",
                [
                  "Ревью"
                ]
              ]
            ]
          }
        },
        {
          "label": "Подготовка",
          "heading": "Начните встречу за секунды",
          "body": "Дайте название, выберите язык и источник звука — и нажмите запись.",
          "points": [
            "Выбор языка и перевода",
            "Запись микрофона и системного звука",
            "Модели загружаются заранее, работает офлайн"
          ],
          "callout": "form",
          "demo": {
            "name": "Встреча",
            "language": "Китайский",
            "device": "CPU",
            "mode": "Стандартный режим"
          }
        },
        {
          "label": "Субтитры",
          "heading": "Субтитры, пока вы говорите",
          "body": "Низколатентная расшифровка в реальном времени следит за говорящим и разделяет голоса.",
          "points": [
            "Субтитры в реальном времени",
            "Распознавание и разделение говорящих",
            "Опциональное плавающее окно субтитров"
          ],
          "callout": "transcript",
          "demo": {
            "segments": [
              [
                "Алекс",
                "Нам нужно завершить приёмку к пятнице."
              ],
              [
                "Мия",
                "Понял, я сведу риски."
              ],
              [
                "Алекс",
                "Синхронизируемся в понедельник."
              ]
            ]
          }
        },
        {
          "label": "Заметки ИИ",
          "heading": "Ключевые моменты и задачи автоматически",
          "body": "ИИ фиксирует решения и задачи, пока вы говорите, чтобы ничего не упустить.",
          "points": [
            "Вывод выводов, рисков и задач",
            "Встроенный офлайн или онлайн-ИИ",
            "Отправляется только текст; звук остаётся локально"
          ],
          "callout": "notes",
          "demo": {
            "decision": "Завершить приёмку к пятнице",
            "actions": [
              "Команда продукта сопровождает приёмку",
              "Разработка синхронизируется в понедельник"
            ]
          }
        },
        {
          "label": "Детали",
          "heading": "Воспроизводите, обрабатывайте и делитесь",
          "body": "После завершения прослушайте звук, прочитайте обработанную расшифровку и экспортируйте или поделитесь заметками.",
          "points": [
            "Прослушивание и переход к субтитрам",
            "Обработка после встречи",
            "Экспорт и обмен заметками"
          ],
          "callout": "player",
          "demo": {
            "refined": "Мы договорились завершить приёмку к пятнице. Мия сведёт риски, и мы синхронизируемся в понедельник.",
            "summary": "Завершить приёмку к пятнице"
          }
        }
      ]
    }
  }
};

const aiNotePromptCopy = {
  "zh": {
    "instructions": "你是会议实时笔记助手。从 <recent_transcript> 和 <meeting_state> 中挑最多3条值得记录的短信息，输出极短 JSON。\n只使用明确说出的内容，不补全、不推测、不重复已有状态。text 必须使用中文。\n类型：conclusion观点 | decision决定 | action待办 | number关键数据 | date关键日期 | question待确认 | risk风险 | topic新议题/标题 | supplement重点。整体议题明确时优先给具体 topic 标题；number/date 必须原文出现，number 要有主语和背景。\n输出 {\"suggestions\":[{\"type\":\"...\",\"text\":\"8-40字\",\"importance\":\"high|medium\"}]}；无价值则输出 {\"suggestions\":[]}。只输出 JSON。\n每条 text 只能是一个可独立验证的观点、决定或行动；不要用“以及”“并且”等串联多个观点。先检查 <accepted_claims>：相同观点不再输出。每项 evidence 必须从 <recent_transcript> 中方括号内的时间原样选择 1–2 个。输出 {\"suggestions\":[{\"type\":\"...\",\"text\":\"...\",\"evidence\":[\"00:00\"],\"importance\":\"high|medium\"}]}。\nReturn at most one suggestion.",
    "state_labels": [
      "当前议题",
      "事实",
      "已确认决定",
      "行动项",
      "待确认"
    ]
  },
  "en": {
    "instructions": "You are a realtime meeting-notes assistant. From <recent_transcript> and <meeting_state>, select up to 3 short items worth recording; output compact JSON.\nUse only explicitly stated information; do not infer, pad, or repeat state items. The text value must be in English.\nTypes: conclusion | decision | action | number | date | question | risk | topic | supplement. Prefer a specific topic title when clear; number/date must be explicit, and a number needs subject and context.\nOutput {\"suggestions\":[{\"type\":\"...\",\"text\":\"one short sentence\",\"importance\":\"high|medium\"}]}; output {\"suggestions\":[]} if nothing is valuable. Output only JSON.\nEach text must contain one independently verifiable claim, decision, or action; do not join multiple ideas. Check <accepted_claims> first and do not output the same claim again. For each evidence, copy one or two timestamps exactly from brackets in <recent_transcript>. Output {\"suggestions\":[{\"type\":\"...\",\"text\":\"...\",\"evidence\":[\"00:00\"],\"importance\":\"high|medium\"}]}.\nReturn at most one suggestion.",
    "state_labels": [
      "Current topic",
      "Facts",
      "Confirmed decisions",
      "Actions",
      "Open questions"
    ]
  },
  "es": {
    "instructions": "Eres un asistente de notas de reunión en tiempo real. A partir de <recent_transcript> y <meeting_state>, selecciona hasta 3 datos breves que valga la pena registrar y devuelve JSON compacto.\nUsa solo información dicha explícitamente; no infieras, rellenes ni repitas elementos del estado. El valor text debe estar en español.\nTipos: conclusion | decision | action | number | date | question | risk | topic | supplement. Prioriza un título topic específico cuando el tema esté claro; number/date deben aparecer explícitamente y number debe incluir sujeto y contexto.\nDevuelve {\"suggestions\":[{\"type\":\"...\",\"text\":\"una frase breve\",\"importance\":\"high|medium\"}]}; si no hay nada valioso, devuelve {\"suggestions\":[]}. Devuelve solo JSON.\nCada text debe contener una sola afirmación, decisión o acción verificable; no unas varias ideas. Revisa primero <accepted_claims> y no repitas la misma afirmación. En evidence copia uno o dos tiempos exactamente de los corchetes de <recent_transcript>. Devuelve {\"suggestions\":[{\"type\":\"...\",\"text\":\"...\",\"evidence\":[\"00:00\"],\"importance\":\"high|medium\"}]}.\nReturn at most one suggestion.",
    "state_labels": [
      "Tema actual",
      "Hechos",
      "Decisiones confirmadas",
      "Acciones",
      "Preguntas pendientes"
    ]
  },
  "ja": {
    "instructions": "あなたはリアルタイム会議ノートのアシスタントです。<recent_transcript> と <meeting_state> から、記録する価値のある短い情報を最大3件選び、簡潔な JSON を出力してください。\n明示的に発言された内容だけを使い、推測・水増し・既存状態の繰り返しはしないでください。text の値は日本語にしてください。\n種類：conclusion（見解） | decision（決定） | action（タスク） | number（重要な数値） | date（重要な日付） | question（要確認） | risk（リスク） | topic（新しい議題/タイトル） | supplement（重要な補足）。議題が明確なら具体的な topic タイトルを優先し、number/date は原文に明示してください。\n{\"suggestions\":[{\"type\":\"...\",\"text\":\"短い一文\",\"importance\":\"high|medium\"}]} を出力し、価値がなければ {\"suggestions\":[]} を出力してください。JSON だけを出力してください。\n各 text は、検証可能な見解・決定・行動を一つだけ含め、複数の考えを結合しないでください。まず <accepted_claims> を確認し、同じ見解は出力しません。evidence には <recent_transcript> の角括弧内の時刻をそのまま 1～2 件入れてください。{\"suggestions\":[{\"type\":\"...\",\"text\":\"...\",\"evidence\":[\"00:00\"],\"importance\":\"high|medium\"}]} を出力してください。\nReturn at most one suggestion.",
    "state_labels": [
      "現在の議題",
      "事実",
      "確定した決定",
      "アクション",
      "未確認事項"
    ]
  },
  "ko": {
    "instructions": "당신은 실시간 회의 노트 도우미입니다. <recent_transcript>와 <meeting_state>에서 기록할 가치가 있는 짧은 정보를 최대 3개 골라 간결한 JSON으로 출력하세요.\n명시적으로 말한 내용만 사용하고 추론, 부연, 기존 상태의 반복은 하지 마세요. text 값은 한국어여야 합니다.\n유형: conclusion(관점) | decision(결정) | action(할 일) | number(핵심 수치) | date(핵심 날짜) | question(확인 필요) | risk(위험) | topic(새 주제/제목) | supplement(주목할 보충). 주제가 분명하면 구체적인 topic 제목을 우선하고 number/date는 원문에 명시하세요.\n{\"suggestions\":[{\"type\":\"...\",\"text\":\"짧은 한 문장\",\"importance\":\"high|medium\"}]}을 출력하고, 가치 있는 내용이 없으면 {\"suggestions\":[]}을 출력하세요. JSON만 출력하세요.\n각 text에는 검증 가능한 관점·결정·행동 하나만 담고 여러 생각을 합치지 마세요. 먼저 <accepted_claims>를 확인하고 같은 관점은 다시 출력하지 마세요. evidence에는 <recent_transcript> 대괄호 안의 시간을 그대로 1~2개 넣으세요. {\"suggestions\":[{\"type\":\"...\",\"text\":\"...\",\"evidence\":[\"00:00\"],\"importance\":\"high|medium\"}]}을 출력하세요.\nReturn at most one suggestion.",
    "state_labels": [
      "현재 주제",
      "사실",
      "확정된 결정",
      "실행 항목",
      "확인 필요 사항"
    ]
  },
  "fr": {
    "instructions": "Vous êtes un assistant de prise de notes de réunion en temps réel. À partir de <recent_transcript> et <meeting_state>, sélectionnez jusqu’à 3 informations courtes utiles à noter et renvoyez du JSON compact.\nUtilisez uniquement les informations explicitement dites ; n’inférez rien, ne brodez pas et ne répétez pas l’état existant. La valeur text doit être en français.\nTypes : conclusion | decision | action | number | date | question | risk | topic | supplement. Privilégiez un titre topic précis quand le sujet est clair ; number/date doivent être explicites et number doit inclure sujet et contexte.\nRenvoyez {\"suggestions\":[{\"type\":\"...\",\"text\":\"une phrase courte\",\"importance\":\"high|medium\"}]} ; s’il n’y a rien d’utile, renvoyez {\"suggestions\":[]}. Renvoyez uniquement du JSON.\nChaque text doit contenir une seule affirmation, décision ou action vérifiable ; ne fusionnez pas plusieurs idées. Vérifiez d’abord <accepted_claims> et ne répétez pas la même affirmation. Dans evidence, copiez exactement un ou deux horodatages entre crochets de <recent_transcript>. Renvoyez {\"suggestions\":[{\"type\":\"...\",\"text\":\"...\",\"evidence\":[\"00:00\"],\"importance\":\"high|medium\"}]}.\nReturn at most one suggestion.",
    "state_labels": [
      "Sujet actuel",
      "Faits",
      "Décisions confirmées",
      "Actions",
      "Questions en suspens"
    ]
  },
  "de": {
    "instructions": "Du bist ein Assistent für Echtzeit-Meetingnotizen. Wähle aus <recent_transcript> und <meeting_state> bis zu 3 kurze, notierenswerte Informationen und gib kompaktes JSON aus.\nVerwende nur ausdrücklich Gesagtes; erfinde nichts, fülle nichts auf und wiederhole keine bestehenden Statuspunkte. Der Wert text muss auf Deutsch sein.\nTypen: conclusion | decision | action | number | date | question | risk | topic | supplement. Bevorzuge bei klarem Thema einen konkreten topic-Titel; number/date müssen ausdrücklich vorkommen und number braucht Thema und Kontext.\nGib {\"suggestions\":[{\"type\":\"...\",\"text\":\"ein kurzer Satz\",\"importance\":\"high|medium\"}]} aus; wenn nichts wertvoll ist, gib {\"suggestions\":[]} aus. Gib nur JSON aus.\nJeder text darf nur eine eigenständig überprüfbare Aussage, Entscheidung oder Aktion enthalten; verbinde keine mehreren Ideen. Prüfe zuerst <accepted_claims> und gib dieselbe Aussage nicht erneut aus. Übernimm für evidence ein oder zwei Zeitstempel exakt aus den Klammern in <recent_transcript>. Gib {\"suggestions\":[{\"type\":\"...\",\"text\":\"...\",\"evidence\":[\"00:00\"],\"importance\":\"high|medium\"}]} aus.\nReturn at most one suggestion.",
    "state_labels": [
      "Aktuelles Thema",
      "Fakten",
      "Bestätigte Entscheidungen",
      "Aufgaben",
      "Offene Fragen"
    ]
  },
  "ru": {
    "instructions": "Вы — помощник по ведению заметок встречи в реальном времени. По <recent_transcript> и <meeting_state> выберите до 3 коротких сведений, достойных записи, и верните компактный JSON.\nИспользуйте только явно сказанное; не додумывайте, не дополняйте и не повторяйте уже имеющиеся пункты состояния. Значение text должно быть на русском языке.\nТипы: conclusion | decision | action | number | date | question | risk | topic | supplement. При ясной теме выберите конкретный заголовок topic; number/date должны быть явно произнесены, а number должен включать предмет и контекст.\nВерните {\"suggestions\":[{\"type\":\"...\",\"text\":\"одно короткое предложение\",\"importance\":\"high|medium\"}]}; если ценного нет, верните {\"suggestions\":[]}. Верните только JSON.\nКаждый text должен содержать только одно проверяемое утверждение, решение или действие; не объединяйте несколько идей. Сначала проверьте <accepted_claims> и не повторяйте то же утверждение. В evidence скопируйте один или два времени точно из квадратных скобок в <recent_transcript>. Верните {\"suggestions\":[{\"type\":\"...\",\"text\":\"...\",\"evidence\":[\"00:00\"],\"importance\":\"high|medium\"}]}.\nReturn at most one suggestion.",
    "state_labels": [
      "Текущая тема",
      "Факты",
      "Подтверждённые решения",
      "Действия",
      "Открытые вопросы"
    ]
  }
};

const storageCleanupCopy = {
  "zh": {
    "button": "清理过期本地文件",
    "done": "已释放 {size}"
  },
  "en": {
    "button": "Clean expired local files",
    "done": "Freed {size}"
  },
  "es": {
    "button": "Limpiar archivos locales obsoletos",
    "done": "Se liberaron {size}"
  },
  "ja": {
    "button": "期限切れのローカルファイルを整理",
    "done": "{size} を解放しました"
  },
  "ko": {
    "button": "만료된 로컬 파일 정리",
    "done": "{size} 확보됨"
  },
  "fr": {
    "button": "Nettoyer les fichiers locaux obsolètes",
    "done": "{size} libérés"
  },
  "de": {
    "button": "Veraltete lokale Dateien bereinigen",
    "done": "{size} freigegeben"
  },
  "ru": {
    "button": "Очистить устаревшие локальные файлы",
    "done": "Освобождено {size}"
  }
};

const exportHubCopy = {
  "zh": {
    "title": "导出与分享",
    "what": "选择内容",
    "files": "导出文件",
    "shareTo": "分享到",
    "save": "导出所选",
    "txt": "纯文本",
    "shareHint": "文字渠道只能携带标题与摘要；文件请用「导出所选」或系统分享面板。",
    "empty": "没有可导出的内容",
    "emptySummary": "尚未选择任何内容",
    "summaryOne": "将导出 1 个文件",
    "summaryMany": "将选中的内容打包为压缩包。",
    "savedBundle": "已导出打包文件",
    "revealed": "文件已导出并在文件夹中显示",
    "desc": {
      "notes": "完整结构化会议纪要",
      "mynotes": "会议中手动记录的笔记",
      "transcript": "带时间轴与说话人的逐字稿",
      "audio": "未修改的会议混音"
    },
    "platform": {
      "system": [
        "系统分享面板",
        "转发到 AirDrop、微信、邮件等"
      ],
      "copy": [
        "复制到剪贴板",
        "复制所选内容"
      ],
      "email": [
        "邮件",
        "打开默认邮件客户端"
      ],
      "whatsapp": [
        "WhatsApp",
        "打开网页分享"
      ],
      "telegram": [
        "Telegram",
        "打开网页分享"
      ],
      "x": [
        "X",
        "打开网页分享"
      ],
      "weibo": [
        "微博",
        "打开网页分享"
      ]
    }
  },
  "en": {
    "title": "Export & share",
    "what": "What to include",
    "files": "Export files",
    "shareTo": "Share to",
    "save": "Export selected",
    "txt": "Plain text",
    "shareHint": "Text channels carry only the title and an excerpt; use “Export selected” or the system share sheet for files.",
    "empty": "Nothing to export",
    "emptySummary": "Nothing selected yet",
    "summaryOne": "Will export 1 file",
    "summaryMany": "Selected items will be packaged into a ZIP archive.",
    "savedBundle": "Bundle exported",
    "revealed": "Files exported and revealed in folder",
    "desc": {
      "notes": "Complete structured meeting notes",
      "mynotes": "Notes you took during the meeting",
      "transcript": "Transcript with timeline and speakers",
      "audio": "Unmodified meeting mix"
    },
    "platform": {
      "system": [
        "Share sheet",
        "Forward to AirDrop, WeChat, email…"
      ],
      "copy": [
        "Copy to clipboard",
        "Copy selected text"
      ],
      "email": [
        "Email",
        "Open your mail client"
      ],
      "whatsapp": [
        "WhatsApp",
        "Open web share"
      ],
      "telegram": [
        "Telegram",
        "Open web share"
      ],
      "x": [
        "X",
        "Open web share"
      ],
      "weibo": [
        "Weibo",
        "Open web share"
      ]
    }
  },
  "es": {
    "title": "Exportar y compartir",
    "what": "Qué incluir",
    "files": "Exportar archivos",
    "shareTo": "Compartir en",
    "save": "Exportar selección",
    "txt": "Texto sin formato",
    "shareHint": "Los canales de texto solo llevan el título y un extracto; usa «Exportar selección» o el panel del sistema para archivos.",
    "empty": "Nada que exportar",
    "emptySummary": "Aún no hay nada seleccionado",
    "summaryOne": "Se exportará 1 archivo",
    "summaryMany": "El contenido seleccionado se empaquetará en un archivo ZIP.",
    "savedBundle": "Paquete exportado",
    "revealed": "Archivos exportados y mostrados en la carpeta",
    "desc": {
      "notes": "Notas de reunión estructuradas completas",
      "mynotes": "Notas tomadas durante la reunión",
      "transcript": "Transcripción con línea temporal y hablantes",
      "audio": "Mezcla de reunión sin modificar"
    },
    "platform": {
      "system": [
        "Panel de compartir",
        "Reenviar a AirDrop, WeChat, correo…"
      ],
      "copy": [
        "Copiar al portapapeles",
        "Copiar el texto seleccionado"
      ],
      "email": [
        "Correo",
        "Abrir tu cliente de correo"
      ],
      "whatsapp": [
        "WhatsApp",
        "Abrir compartir web"
      ],
      "telegram": [
        "Telegram",
        "Abrir compartir web"
      ],
      "x": [
        "X",
        "Abrir compartir web"
      ],
      "weibo": [
        "Weibo",
        "Abrir compartir web"
      ]
    }
  },
  "ja": {
    "title": "エクスポートと共有",
    "what": "含める内容",
    "files": "ファイルを書き出す",
    "shareTo": "共有先",
    "save": "選択分を書き出し",
    "txt": "プレーンテキスト",
    "shareHint": "テキスト系の共有先にはタイトルと抜粋のみ送れます。ファイルは「選択分を書き出し」かシステム共有パネルで。",
    "empty": "書き出せる内容がありません",
    "emptySummary": "まだ選択されていません",
    "summaryOne": "1 ファイルを書き出します",
    "summaryMany": "選択した内容を圧縮ファイルにまとめます。",
    "savedBundle": "パッケージを書き出しました",
    "revealed": "ファイルを書き出してフォルダに表示しました",
    "desc": {
      "notes": "完全な構造化会議メモ",
      "mynotes": "会議中に記録したメモ",
      "transcript": "時刻と話者付きの文字起こし",
      "audio": "未変更の会議ミックス"
    },
    "platform": {
      "system": [
        "共有パネル",
        "AirDrop・WeChat・メールなどに転送"
      ],
      "copy": [
        "クリップボードにコピー",
        "選択したテキストをコピー"
      ],
      "email": [
        "メール",
        "既定のメールアプリを開く"
      ],
      "whatsapp": [
        "WhatsApp",
        "ウェブ共有を開く"
      ],
      "telegram": [
        "Telegram",
        "ウェブ共有を開く"
      ],
      "x": [
        "X",
        "ウェブ共有を開く"
      ],
      "weibo": [
        "Weibo",
        "ウェブ共有を開く"
      ]
    }
  },
  "ko": {
    "title": "내보내기 및 공유",
    "what": "포함할 내용",
    "files": "파일 내보내기",
    "shareTo": "공유 대상",
    "save": "선택 항목 내보내기",
    "txt": "일반 텍스트",
    "shareHint": "텍스트 채널에는 제목과 발췌만 담을 수 있습니다. 파일은 「선택 항목 내보내기」나 시스템 공유 패널을 이용하세요.",
    "empty": "내보낼 내용이 없습니다",
    "emptySummary": "아직 선택되지 않았습니다",
    "summaryOne": "파일 1개를 내보냅니다",
    "summaryMany": "선택한 내용을 압축 파일로 묶습니다.",
    "savedBundle": "패키지 내보냄",
    "revealed": "파일을 내보내고 폴더에 표시했습니다",
    "desc": {
      "notes": "완전한 구조화 회의록",
      "mynotes": "회의 중 작성한 메모",
      "transcript": "시간과 화자가 포함된 녹취",
      "audio": "수정하지 않은 회의 믹스"
    },
    "platform": {
      "system": [
        "공유 패널",
        "AirDrop·WeChat·메일 등으로 전달"
      ],
      "copy": [
        "클립보드에 복사",
        "선택한 텍스트 복사"
      ],
      "email": [
        "이메일",
        "기본 메일 앱 열기"
      ],
      "whatsapp": [
        "WhatsApp",
        "웹 공유 열기"
      ],
      "telegram": [
        "Telegram",
        "웹 공유 열기"
      ],
      "x": [
        "X",
        "웹 공유 열기"
      ],
      "weibo": [
        "웨이보",
        "웹 공유 열기"
      ]
    }
  },
  "fr": {
    "title": "Exporter et partager",
    "what": "Contenu à inclure",
    "files": "Exporter des fichiers",
    "shareTo": "Partager vers",
    "save": "Exporter la sélection",
    "txt": "Texte brut",
    "shareHint": "Les canaux de texte ne portent que le titre et un extrait ; utilisez « Exporter la sélection » ou le panneau système pour les fichiers.",
    "empty": "Rien à exporter",
    "emptySummary": "Rien de sélectionné pour l’instant",
    "summaryOne": "1 fichier sera exporté",
    "summaryMany": "Le contenu sélectionné sera regroupé dans une archive ZIP.",
    "savedBundle": "Paquet exporté",
    "revealed": "Fichiers exportés et affichés dans le dossier",
    "desc": {
      "notes": "Notes de réunion structurées complètes",
      "mynotes": "Notes prises pendant la réunion",
      "transcript": "Transcription avec chronologie et locuteurs",
      "audio": "Mixage de réunion non modifié"
    },
    "platform": {
      "system": [
        "Panneau de partage",
        "Transférer vers AirDrop, WeChat, e-mail…"
      ],
      "copy": [
        "Copier dans le presse-papiers",
        "Copier le texte sélectionné"
      ],
      "email": [
        "E-mail",
        "Ouvrir votre client de messagerie"
      ],
      "whatsapp": [
        "WhatsApp",
        "Ouvrir le partage web"
      ],
      "telegram": [
        "Telegram",
        "Ouvrir le partage web"
      ],
      "x": [
        "X",
        "Ouvrir le partage web"
      ],
      "weibo": [
        "Weibo",
        "Ouvrir le partage web"
      ]
    }
  },
  "de": {
    "title": "Exportieren und teilen",
    "what": "Was einfügen",
    "files": "Dateien exportieren",
    "shareTo": "Teilen über",
    "save": "Auswahl exportieren",
    "txt": "Klartext",
    "shareHint": "Textkanäle übertragen nur Titel und Auszug; für Dateien nutzen Sie „Auswahl exportieren“ oder das Systemfreigabe-Panel.",
    "empty": "Nichts zu exportieren",
    "emptySummary": "Noch nichts ausgewählt",
    "summaryOne": "1 Datei wird exportiert",
    "summaryMany": "Die ausgewählten Inhalte werden in einem ZIP-Archiv gebündelt.",
    "savedBundle": "Paket exportiert",
    "revealed": "Dateien exportiert und im Ordner angezeigt",
    "desc": {
      "notes": "Vollständige strukturierte Besprechungsnotizen",
      "mynotes": "Notizen aus der Besprechung",
      "transcript": "Transkript mit Zeitachse und Sprechern",
      "audio": "Unveränderter Besprechungsmix"
    },
    "platform": {
      "system": [
        "Freigabe-Panel",
        "An AirDrop, WeChat, E-Mail usw. senden"
      ],
      "copy": [
        "In Zwischenablage kopieren",
        "Ausgewählten Text kopieren"
      ],
      "email": [
        "E-Mail",
        "Standard-Mailprogramm öffnen"
      ],
      "whatsapp": [
        "WhatsApp",
        "Web-Freigabe öffnen"
      ],
      "telegram": [
        "Telegram",
        "Web-Freigabe öffnen"
      ],
      "x": [
        "X",
        "Web-Freigabe öffnen"
      ],
      "weibo": [
        "Weibo",
        "Web-Freigabe öffnen"
      ]
    }
  },
  "ru": {
    "title": "Экспорт и отправка",
    "what": "Что включить",
    "files": "Экспорт файлов",
    "shareTo": "Отправить в",
    "save": "Экспортировать выбранное",
    "txt": "Простой текст",
    "shareHint": "Текстовые каналы несут только заголовок и выдержку; для файлов используйте «Экспортировать выбранное» или системную панель.",
    "empty": "Нечего экспортировать",
    "emptySummary": "Пока ничего не выбрано",
    "summaryOne": "Будет экспортирован 1 файл",
    "summaryMany": "Выбранное содержимое будет упаковано в ZIP-архив.",
    "savedBundle": "Пакет экспортирован",
    "revealed": "Файлы экспортированы и показаны в папке",
    "desc": {
      "notes": "Полные структурированные заметки встречи",
      "mynotes": "Заметки, сделанные во время встречи",
      "transcript": "Расшифровка с временной шкалой и говорящими",
      "audio": "Неизменённый микс встречи"
    },
    "platform": {
      "system": [
        "Панель отправки",
        "Переслать в AirDrop, WeChat, почту…"
      ],
      "copy": [
        "Копировать в буфер обмена",
        "Скопировать выбранный текст"
      ],
      "email": [
        "Эл. почта",
        "Открыть почтовый клиент"
      ],
      "whatsapp": [
        "WhatsApp",
        "Открыть веб-отправку"
      ],
      "telegram": [
        "Telegram",
        "Открыть веб-отправку"
      ],
      "x": [
        "X",
        "Открыть веб-отправку"
      ],
      "weibo": [
        "Weibo",
        "Открыть веб-отправку"
      ]
    }
  }
};

const whatsNewLog = [
  {
    "version": "1.2.3",
    "date": "2026-10-05",
    "current": true,
    "previousVersion": "1.2.2",
    "contributors": [],
    "zh": {
      "summary": "本次更新带来 Apple 芯片 Mac 的 MLX 本地识别、统一的 AI 功能设置，并改善双轨录音与转写稳定性。",
      "what": [
        {
          "text": "Apple 芯片 Mac 使用 mlx-audio/MLX 运行 FunASR Nano、Qwen3-ASR、Parakeet 和 Silero VAD；FunASR 与 Qwen 支持识别过程中的草稿字幕。",
          "commit": "8049d36b260e231e67e529688b04027a43553917"
        },
        {
          "text": "设置页新增统一的 AI 功能面板，集中配置实时 AI 笔记与会后总结；首次设置可直接下载所选本地总结模型。",
          "commit": "4e4015f7cbf7e212446bfd6b7ae08a546f58c857"
        }
      ],
      "improved": [
        {
          "text": "升级 MLX 后端后，本机 Apple M4 Pro 对同一批各 45 秒的中英文会议片段实测：FunASR Nano 与 Parakeet 的纯解码速度分别约为 v1.2.2 的 3.7 倍和 4.0 倍（不含模型加载时间；实际收益因设备、模型和音频而异）。",
          "commit": "8049d36b260e231e67e529688b04027a43553917"
        },
        {
          "text": "麦克风与系统音频按时间对齐后统一混音，实时字幕与会后精修复用处理逻辑，减少回声导致的重复转写。",
          "commit": "148177e01a9a199af48aec784f864fd97bdd89cf"
        },
        {
          "text": "统一模型介绍与多语言文案，简化模型库大小信息和存储设置，改善模型下载进度、失败重试与设置页交互。",
          "commit": "4e4015f7cbf7e212446bfd6b7ae08a546f58c857"
        }
      ],
      "fixed": [
        {
          "text": "修复慢 MLX 推理阻塞后续录音写入的问题；实时识别积压时保留原始录音，并正确排空暂停、模型切换和结束时的任务。",
          "commit": "4e4015f7cbf7e212446bfd6b7ae08a546f58c857"
        },
        {
          "text": "修复长时间重叠发言的说话人信息被识别窗口覆盖的问题；保留重叠标记，同时避免对同一段混音重复转写。",
          "commit": "4e4015f7cbf7e212446bfd6b7ae08a546f58c857"
        },
        {
          "text": "改善双轨缓冲、单轨暂时无数据和安静麦克风输入的处理，减少音频不同步与轻声遗漏。",
          "commit": "8049d36b260e231e67e529688b04027a43553917"
        },
        {
          "text": "校验连续语音切段上限并修复不安全的旧配置，避免过短切段造成识别异常；加强 Windows 冻结及安装包运行时检查。",
          "commit": "8049d36b260e231e67e529688b04027a43553917"
        },
        {
          "text": "修复 macOS 运行时去重破坏 Python.framework 签名结构的问题，保留 framework 内的可执行文件与元数据，并增加实际签名验证。",
          "commit": "9061a5a8f41706f5e0bc285de751409da883b10a"
        }
      ],
      "security": [
        {
          "text": "阻止外部 AI 服务请求跨来源重定向，避免 API 凭据或会议文本被转发到配置之外的服务。",
          "commit": "8049d36b260e231e67e529688b04027a43553917"
        }
      ],
      "changes": [
        {
          "text": "Mac 升级后需下载对应的 MLX 识别模型；Windows 继续使用 Sherpa ONNX。已有录音与历史逐字稿仍保留。",
          "commit": "8049d36b260e231e67e529688b04027a43553917"
        },
        {
          "text": "重新精修会生成新的当前稿；旧稿中的人工修改不会自动迁移到新稿。",
          "commit": "148177e01a9a199af48aec784f864fd97bdd89cf"
        }
      ]
    },
    "en": {
      "summary": "This release brings local MLX recognition to Apple Silicon Macs, unified AI settings, and more reliable dual-track recording and transcription.",
      "what": [
        {
          "text": "Apple Silicon Macs now run FunASR Nano, Qwen3-ASR, Parakeet and Silero VAD through mlx-audio/MLX; FunASR and Qwen show draft captions while decoding.",
          "commit": "8049d36b260e231e67e529688b04027a43553917"
        },
        {
          "text": "A unified AI features panel brings live AI notes and meeting summaries together; first-run setup can download the selected local summary model directly.",
          "commit": "4e4015f7cbf7e212446bfd6b7ae08a546f58c857"
        }
      ],
      "improved": [
        {
          "text": "With the MLX backend, tests on an Apple M4 Pro using the same 45 seconds of Chinese and 45 seconds of English meeting audio measured FunASR Nano and Parakeet decoding at about 3.7× and 4.0× their v1.2.2 speed, respectively (excluding model loading; results vary by device, model and audio).",
          "commit": "8049d36b260e231e67e529688b04027a43553917"
        },
        {
          "text": "Microphone and system audio are aligned and mixed through a shared pipeline for live captions and refinement, reducing duplicate transcription from echo.",
          "commit": "148177e01a9a199af48aec784f864fd97bdd89cf"
        },
        {
          "text": "Unified model descriptions and localized copy, simplified model-size and storage displays, and improved download progress, retry handling and settings interactions.",
          "commit": "4e4015f7cbf7e212446bfd6b7ae08a546f58c857"
        }
      ],
      "fixed": [
        {
          "text": "Fixed slow MLX inference blocking subsequent audio writes; raw recording continues when live recognition falls behind, with ordered draining on pause, model changes and stop.",
          "commit": "4e4015f7cbf7e212446bfd6b7ae08a546f58c857"
        },
        {
          "text": "Fixed sustained speaker overlap being erased by transcription windows; overlap metadata is preserved without transcribing the same mixed interval twice.",
          "commit": "4e4015f7cbf7e212446bfd6b7ae08a546f58c857"
        },
        {
          "text": "Improved dual-track buffering, temporary gaps in either input and quiet microphone handling to reduce misalignment and missed quiet speech.",
          "commit": "8049d36b260e231e67e529688b04027a43553917"
        },
        {
          "text": "Validated speech-segment limits and repaired unsafe saved settings to prevent invalid short cuts, with stronger frozen and packaged Windows runtime checks.",
          "commit": "8049d36b260e231e67e529688b04027a43553917"
        },
        {
          "text": "Fixed runtime deduplication breaking Python.framework code signing on macOS by preserving framework executables and metadata, with an actual signing regression check.",
          "commit": "9061a5a8f41706f5e0bc285de751409da883b10a"
        }
      ],
      "security": [
        {
          "text": "Blocked cross-origin redirects for external AI requests to keep API credentials and meeting text within the configured service.",
          "commit": "8049d36b260e231e67e529688b04027a43553917"
        }
      ],
      "changes": [
        {
          "text": "After upgrading a Mac, download the corresponding MLX recognition model; Windows continues to use Sherpa ONNX. Existing recordings and historical transcripts remain available.",
          "commit": "8049d36b260e231e67e529688b04027a43553917"
        },
        {
          "text": "Running refinement again creates a new current transcript; manual edits to the previous transcript are not automatically carried over.",
          "commit": "148177e01a9a199af48aec784f864fd97bdd89cf"
        }
      ]
    }
  },
  {
    "version": "1.2.2",
    "date": "2026-10-02",
    "previousVersion": "1.2.1",
    "contributors": [
      {
        "login": "anupamme",
        "pr": 2
      },
      {
        "login": "Sousukes",
        "pr": 4
      }
    ],
    "zh": {
      "summary": "本次更新聚焦录音与数据安全、长会话稳定性，以及更清晰的双语更新日志。",
      "what": [
        {
          "text": "迁移模型或录音目录时显示进度浮窗，并锁定冲突操作，迁移结束后自动恢复。",
          "commit": "4b1f51e088cf3f3f2c623e641c453a8a6f5d7724"
        },
        {
          "text": "更新日志按类别展示，支持提交链接、新贡献者致谢和完整版本对比；历史版本可折叠查看。",
          "commit": "2b36241a67c1855ae40809abdf237ec55a5f32d9"
        }
      ],
      "improved": [
        {
          "text": "统一逐字稿的展示、编辑、翻译和导出版本选择，避免历史精修结果被模型状态变化覆盖。",
          "commit": "4b1f51e088cf3f3f2c623e641c453a8a6f5d7724"
        },
        {
          "text": "声纹取样只读取所选音频片段，限制整段样本的内存加载；统一编辑器监听器、后台任务和侧车进程的生命周期。",
          "commit": "4b1f51e088cf3f3f2c623e641c453a8a6f5d7724"
        },
        {
          "text": "统一八语言文案与错误提示，保留配置表单和笔记编辑草稿，清理重复逻辑、失效样式和多余状态。",
          "commit": "4b1f51e088cf3f3f2c623e641c453a8a6f5d7724"
        }
      ],
      "fixed": [
        {
          "text": "修复批量删除与后台任务互斥冲突；部分操作失败时正确保留尚未处理的会议。",
          "commit": "4b1f51e088cf3f3f2c623e641c453a8a6f5d7724"
        },
        {
          "text": "修复结束录音失败后无法重试、恢复同名工作区返回空值，以及迁移数据目录后声纹样本路径失效的问题。",
          "commit": "4b1f51e088cf3f3f2c623e641c453a8a6f5d7724"
        },
        {
          "text": "导入、导出、翻译和声纹处理期间阻止冲突的数据清理；加强任务失败回滚与重复导出的文件名保护。",
          "commit": "4b1f51e088cf3f3f2c623e641c453a8a6f5d7724"
        },
        {
          "text": "修复快速切换页面、重复点击引导页和长会话残留监听器的问题；保留有效字幕时间戳与人工修改。",
          "commit": "4b1f51e088cf3f3f2c623e641c453a8a6f5d7724"
        },
        {
          "text": "为 IPC 请求设置有限超时并加强输入校验，避免后端无响应时操作无限等待。",
          "commit": "45adfaf"
        },
        {
          "text": "修复取消 AI 推理时关闭已断开管道可能抛出异常的问题，确保子进程和两端管道均被回收。",
          "commit": "8f6e4592dff69c9b74009a2f6def393b6d489481"
        },
        {
          "text": "修复 Windows 并发保存配置时的文件替换冲突，按请求顺序写入并保留最后一次保存结果。",
          "commit": "2c0f3bc1baec6756a8007af264b8498ce4378932"
        }
      ],
      "security": [
        {
          "text": "加强存储路径、符号链接、归档导出和 IPC 输入校验；补齐三个 GGUF 模型下载文件的 SHA-256 校验。",
          "commit": "4b1f51e088cf3f3f2c623e641c453a8a6f5d7724"
        },
        {
          "text": "升级 js-yaml 依赖以纳入安全修复。",
          "commit": "6e6acc0a85d035fecb2587433d38ecc7c1570a8f"
        }
      ],
      "changes": [
        {
          "text": "录音导出统一为 WAV，移除 FLAC/M4A 选项；逐字稿和笔记的 Markdown、TXT、JSON、SRT、DOCX、PDF 导出保持可用。",
          "commit": "4b1f51e088cf3f3f2c623e641c453a8a6f5d7724"
        }
      ]
    },
    "en": {
      "summary": "This release focuses on recording and data safety, long-session stability, and clearer bilingual release notes.",
      "what": [
        {
          "text": "Storage moves now show a progress dialog and block conflicting actions until the move finishes.",
          "commit": "4b1f51e088cf3f3f2c623e641c453a8a6f5d7724"
        },
        {
          "text": "The changelog now includes grouped changes, commit links, new contributor credits and a full comparison, with collapsible release history.",
          "commit": "2b36241a67c1855ae40809abdf237ec55a5f32d9"
        }
      ],
      "improved": [
        {
          "text": "Unified transcript selection across viewing, editing, translation and export, preserving historical refinements when model availability changes.",
          "commit": "4b1f51e088cf3f3f2c623e641c453a8a6f5d7724"
        },
        {
          "text": "Voiceprint learning reads only selected audio windows and bounds full-sample loading; editor listeners, background tasks and sidecar processes now share consistent cleanup rules.",
          "commit": "4b1f51e088cf3f3f2c623e641c453a8a6f5d7724"
        },
        {
          "text": "Consolidated copy and errors across eight languages, preserved configuration and note drafts, and removed duplicate logic, unused styles and redundant state.",
          "commit": "4b1f51e088cf3f3f2c623e641c453a8a6f5d7724"
        }
      ],
      "fixed": [
        {
          "text": "Fixed batch deletion conflicting with task safety checks; partially failed batches now retain unfinished meetings.",
          "commit": "4b1f51e088cf3f3f2c623e641c453a8a6f5d7724"
        },
        {
          "text": "Fixed retrying a failed recording stop, restoring a deleted workspace by name, and voiceprint sample paths after data migration.",
          "commit": "4b1f51e088cf3f3f2c623e641c453a8a6f5d7724"
        },
        {
          "text": "Protected imports, exports, translations and voiceprint processing from conflicting cleanup, and strengthened failure rollback and export filename reservation.",
          "commit": "4b1f51e088cf3f3f2c623e641c453a8a6f5d7724"
        },
        {
          "text": "Fixed rapid navigation, repeated onboarding clicks and stale listeners in long sessions, while preserving valid transcript timestamps and manual edits.",
          "commit": "4b1f51e088cf3f3f2c623e641c453a8a6f5d7724"
        },
        {
          "text": "Added finite IPC deadlines and stronger input validation to prevent operations from waiting indefinitely on an unresponsive worker.",
          "commit": "45adfaf"
        },
        {
          "text": "Fixed a broken-pipe race when cancelling AI inference, ensuring the child process and both pipes are released.",
          "commit": "8f6e4592dff69c9b74009a2f6def393b6d489481"
        },
        {
          "text": "Fixed conflicting file replacements during concurrent configuration saves on Windows; writes now preserve request order and the last saved value.",
          "commit": "2c0f3bc1baec6756a8007af264b8498ce4378932"
        }
      ],
      "security": [
        {
          "text": "Hardened storage paths, symlinks, archive exports and IPC validation, and added SHA-256 checks for all three GGUF model downloads.",
          "commit": "4b1f51e088cf3f3f2c623e641c453a8a6f5d7724"
        },
        {
          "text": "Updated js-yaml to include security fixes.",
          "commit": "6e6acc0a85d035fecb2587433d38ecc7c1570a8f"
        }
      ],
      "changes": [
        {
          "text": "Audio export is now WAV-only; FLAC/M4A options have been removed. Markdown, TXT, JSON, SRT, DOCX and PDF exports remain available for text content.",
          "commit": "4b1f51e088cf3f3f2c623e641c453a8a6f5d7724"
        }
      ]
    }
  },
  {
    "version": "1.2.1",
    "date": "2026-09-27",
    "zh": {
      "what": [
        "支持在首次设置和设置页选择模型、会议录音的存储目录，并迁移已有文件。",
        "会议详情支持选择精修模型；精修完成后显示实际使用的模型。",
        "AI 纪要可独立开启或关闭，首次设置中可分别配置纪要与实时 AI 笔记。"
      ],
      "improved": [
        "优化首次设置、录音导入、会议准备页和详情页布局；统一 AI 引导页的标题与卡片比例，翻译与重新精修入口更加清晰。",
        "升级语音识别引擎至 sherpa-onnx 1.13.8，Qwen3-ASR 按所选会议语言识别。",
        "统一存储设置的多语言提示，清理重复样式并改善窄窗口与暗色模式显示。"
      ],
      "fixed": [
        "修复存储目录迁移中断后的恢复与校验问题，避免错误清理文件。",
        "修复修改字幕后仍使用旧词级时间戳的问题，并保留有效的精修句子时间对齐。",
        "修复取消麦克风预览后仍占用设备，以及重复获取麦克风的问题。",
        "修复首次引导中切换语言影响会议列表、AI 演示关闭后计时器继续运行，以及未保存的供应商选择覆盖当前配置的问题。",
        "修复字幕底部被播放器遮挡，以及窄窗口下侧栏隐藏的问题。"
      ]
    },
    "en": {
      "what": [
        "Choose storage folders for models and meeting recordings during setup or in settings, and move existing files.",
        "Choose a refinement model from meeting details and see which model produced the refined transcript.",
        "Turn AI summaries on or off independently, with separate setup controls for summaries and live AI notes."
      ],
      "improved": [
        "Refined first-run setup, recording import, meeting preparation, and detail layouts; aligned AI setup heading and card sizes with other setup pages, with clearer translation and re-refinement actions.",
        "Updated the speech recognition engine to sherpa-onnx 1.13.8; Qwen3-ASR now follows the selected meeting language.",
        "Unified localized storage messages, removed redundant styles, and improved narrow-window and dark-mode layouts."
      ],
      "fixed": [
        "Fixed recovery and validation after interrupted storage moves to prevent incorrect file cleanup.",
        "Fixed stale word timestamps being reused after subtitle edits while preserving valid sentence alignment during refinement.",
        "Fixed microphone previews retaining the device after cancellation or acquiring it more than once.",
        "Fixed onboarding language changes affecting the meeting list, AI demo timers continuing after being disabled, and unsaved provider choices overwriting the active configuration.",
        "Fixed the player covering the bottom of transcripts and the sidebar disappearing in narrow windows."
      ]
    }
  },
  {
    "version": "1.2.0",
    "date": "2026-09-12",
    "zh": {
      "what": [
        "识别链路改为「VAD 分段 → 单次高精度识别」：每次说完停顿即出整句字幕，不再有半句闪烁。",
        "会议详情里的字幕支持逐句修改并保存；暂停录制时界面会明确显示已暂停。",
        "模型库完全按模型清单生成，每张卡片都显示真实名称、体积与速度/准确度刻度；清单声明了实测磁盘占用与内存需求的模型会一并显示。",
        "首启选型页用刻度表达速度与准确度，只下载你勾选的模型；随应用安装的语音检测、说话人分离、声纹模型直接标为已安装。",
        "准备页新增「识别模型」下拉，实时页也有同一个切换器，会中即可换模型。"
      ],
      "improved": [
        "字幕按段落聚合：相邻句子攒到约 110 字（拉丁 280 字符）才成一段，上限 150 字 / 380 字符，短句不再单独成段；段落边界只看真正的长停顿（≥1.2 秒），不按 VAD 端点切，超过 8 秒没有新结果也会兜底提交。",
        "精修字幕的时间戳、以及加入声纹库时保存的音频片段，改为按识别器给出的词级时间戳对齐，不再把一段时长按字数平摊，播放定位与声纹取样因此落在真正说话的那一句上。",
        "同一段样例音频的转写 CPU 时间下降约 74%–82%，进程峰值内存下降约 18%–28%。",
        "识别、翻译与 AI 笔记共用同一份已确认字幕，会中不再出现重复或互相覆盖的文本。",
        "进阶设置补齐了会后精修与语音检测的参数说明，以及实时段长上限。",
        "默认识别模型按会议语言决定，映射只写在 backend/models.json 一处；声明的默认模型未下载时改用已安装且支持该语言的模型，而不是让你再下一个。",
        "导入录音的说话人分离按预估耗时自动取舍，预估按物理核折算，超线程机器上不再晚一倍才判定。",
        "模型下载失败的提示区分磁盘空间、文件校验与网络中断，各自给出可行动的建议。",
        "下架了流式识别、标点恢复、实时降噪、效率模式与第二遍实时精修：不再下载、不再加载、不再存储。"
      ],
      "fixed": [
        "修复连续语音切点上的丢字：下一段解码会回看切点前 400 毫秒，被切在词中间的字重新带上完整上下文识别，重复部分按接缝对齐去掉。",
        "修复连续独白在硬切处丢字、接缝重复与句末标点错位的问题。",
        "修复段首回补被当成秒导致重复解码整段历史音频的问题。",
        "修复长会议逐句翻译时反复重写会议记录带来的卡顿。",
        "修复整句识别模型的精修稿被当成「无时间戳全文」展示、并因此隐藏逐句编辑入口的问题。",
        "修复下载队列把内置 AI 模型的内部 id（如 qwen3.5-2b-q4km）显示给用户的问题。",
        "修复暗色模式下首启模型卡片与实时识别模型切换器文字不可读的问题。",
        "修复恢复录音时识别链路起不来却仍报告恢复成功、结果整场没有字幕的问题。",
        "修复低音量语音被漏识的问题：两个已检测语音区间之间的音频现在也会转写（音乐下的人声、电话音、轻声发言），实时字幕与会后精修一致。",
        "修复手动修订字幕后再精修会让同一句显示两次的问题。",
        "修复精修稿把「他是。我们是。」粘成「他是我们是。」的问题：会后精修不再套用实时字幕的悬空连接词拼接规则。",
        "修复精修模型已下架/退役的会议里，逐句修改字幕会被静默丢弃的问题。",
        "修复精修字幕上右键不弹出菜单（加入笔记 / 添加录音到声纹库）的问题。",
        "修复两段字幕的音频并不重叠、只是恰好共享一个字时会被误删一个字的问题。",
        "修复进阶设置在含整数默认值（如 22 秒的段长上限）时保存必然报错「Invalid setting」的问题。",
        "修复日文、韩文界面新建会议时默认语言为「自动」的问题：「自动」的默认模型不覆盖日韩语；现在中、日、韩三种界面都默认用界面语言开会。"
      ]
    },
    "en": {
      "what": [
        "Recognition now runs as VAD segmentation → one high-accuracy decode, so a finished sentence appears right after each pause instead of a flickering half-line.",
        "Subtitles in meeting details can be edited sentence by sentence and saved; pausing a recording is now clearly shown.",
        "The model library is generated from the manifest: every card shows the real model name, its size, and its speed/accuracy rating (measured disk usage and memory floor where the manifest declares them).",
        "First-run setup puts speed and accuracy on a scale and downloads only the models you pick; bundled voice detection, diarization, and voiceprint models are marked as installed.",
        "Meeting setup gained a recognition-model selector, and the live screen has the same one, so the model can be switched mid-meeting."
      ],
      "improved": [
        "Captions are now paragraph-sized: neighbouring sentences are coalesced up to roughly 110 Chinese characters (280 Latin) with a hard ceiling of 150 / 380, instead of standing alone one sentence at a time; a paragraph breaks only on a genuine long pause, not on every voice-detection endpoint, and a paragraph is submitted anyway after 8 seconds without new results.",
        "Refined subtitle timestamps — and the audio clips saved when you add a line to a voiceprint — now follow the recognizer’s word timestamps instead of spreading each speech window evenly by character count, so a refined line starts and ends where it was actually spoken.",
        "Transcription CPU time drops by roughly 74–82% and peak memory by 18–28% on the same sample audio.",
        "Recognition, translation, and AI notes all read the same confirmed captions, so text no longer duplicates or overwrites itself mid-meeting.",
        "Advanced settings now label the post-meeting refinement and voice-detection options, plus the live segment cap.",
        "The default recognition model follows the meeting language, and that mapping is declared once in backend/models.json; when the declared default is not installed, an installed model for the same language is used instead of asking for another download.",
        "Imported recordings decide on speaker diarization automatically, from an estimate scaled by physical cores, so the call is no longer twice as late on hyperthreaded machines.",
        "Download failures now distinguish disk space, integrity, and network problems, each with a next step.",
        "Removed the streaming recognizer, punctuation models, live denoising, the efficiency-mode switch, and the second live refinement pass: no longer downloaded, loaded, or stored."
      ],
      "fixed": [
        "Fixed characters lost where continuous speech was cut: the next decode now reaches 400 ms back before the cut, so a word split across it is recognised again with full context, and the repeated part is aligned away at the seam.",
        "Fixed dropped words, duplicated seams, and misplaced sentence punctuation at hard cuts in continuous speech.",
        "Fixed speech padding being read as seconds, which re-decoded the whole audio history for every segment.",
        "Fixed repeated meeting writes that made sentence-by-sentence translation stutter on long meetings.",
        "Fixed refined transcripts from the current sentence-transcription models being shown as a plain “no timestamps” full-text view, which also hid the sentence-by-sentence editor.",
        "Fixed the download queue showing an internal model id (for example qwen3.5-2b-q4km) instead of the model name for built-in AI models.",
        "Fixed unreadable text in dark mode on the first-run model cards and the live recognition-model selector.",
        "Fixed a restored recording reporting success even when recognition could not start, which left the meeting with no captions at all.",
        "Fixed quiet speech that voice detection missed entirely: audio between two detected speech regions is now transcribed in live captions and in post-meeting refinement alike.",
        "Fixed a refined transcript showing the same sentence twice after a manual correction followed by a re-refinement.",
        "Fixed refined transcripts joining two complete sentences into one when the first ended in a connective (“他是。我们是。” became “他是我们是。”).",
        "Fixed per-sentence subtitle edits being silently discarded for a meeting whose refinement model is no longer offered.",
        "Fixed the segment context menu (add to notes, add this audio to a voiceprint) not opening on refined subtitles.",
        "Fixed a character being dropped where two captions met when they happened to share a character but their audio did not overlap.",
        "Fixed advanced settings failing to save with “Invalid setting” whenever a whole-number default (for example the 22-second segment cap) was round-tripped through the interface.",
        "Fixed Japanese and Korean interfaces defaulting a new meeting to “auto”, whose default model does not cover those languages; Chinese, Japanese, and Korean interfaces now default to the interface language."
      ]
    }
  },
  {
    "version": "1.1.8",
    "date": "2026-09-04",
    "zh": {
      "what": [
        "会议纪要支持一键复制；导出的文件会按内容类型自动命名。"
      ],
      "improved": [
        "音频采样在连续分块间保持精确时间轴，降低长时间录音出现时间漂移的可能。",
        "会议纪要会更完整地保留明确提出的后续行动项。"
      ],
      "fixed": [
        "清理已不再使用的摘要弹窗编辑逻辑，统一使用详情页内联编辑。"
      ]
    },
    "en": {
      "what": [
        "Meeting notes can now be copied with one click, and exported files are named by content type."
      ],
      "improved": [
        "Audio sampling now keeps a precise timeline across consecutive blocks, reducing the risk of drift in long recordings.",
        "Meeting notes more reliably retain explicitly stated follow-up actions."
      ],
      "fixed": [
        "Removed the unused summary-dialog editor so editing consistently happens inline in meeting details."
      ]
    }
  },
  {
    "version": "1.1.7",
    "date": "2026-09-02",
    "zh": {
      "what": [
        "会议详情中的纪要现可直接编辑，无需打开单独窗口。"
      ],
      "improved": [
        "优化长录音与导入录音的会后精修，降低内存占用并缩短准备时间。",
        "效率模式下导入录音会跳过发言者区分，以更快完成会后精修。"
      ],
      "fixed": [
        "修复 Windows 上首次加载音频处理组件可能导致精修准备长时间无响应的问题。"
      ]
    },
    "en": {
      "what": [
        "Meeting summaries can now be edited directly from the meeting details view."
      ],
      "improved": [
        "Optimized post-meeting refinement for long and imported recordings to reduce memory use and shorten preparation time.",
        "In Efficiency mode, imported recordings skip speaker distinction so post-meeting refinement finishes faster."
      ],
      "fixed": [
        "Fixed an issue where the first Windows load of audio-processing components could leave refinement preparation unresponsive for an extended time."
      ]
    }
  },
  {
    "version": "1.1.6",
    "date": "2026-08-30",
    "zh": {
      "what": [
        "新增会议资料导出与分享中心，支持逐字稿、纪要、笔记和录音按需导出或打包。",
        "支持在会议笔记中插入图片，并可保存编辑后的 AI 纪要。"
      ],
      "improved": [
        "自动音源会根据实际声音在麦克风与系统音频间切换，减少不必要的系统录音。",
        "优化会议搜索、实时字幕和精修性能，弱性能设备上会自动优先保证字幕实时性。"
      ],
      "fixed": [
        "修复 Windows 上导入音频及上传相关的兼容性问题。"
      ]
    },
    "en": {
      "what": [
        "Added an export and sharing hub for transcripts, notes, personal notes, and recordings, with optional ZIP bundles.",
        "Meeting notes can now include images, and edited AI meeting notes can be saved."
      ],
      "improved": [
        "Auto audio source now switches between microphone and system audio based on detected sound, avoiding unnecessary system recording.",
        "Improved meeting search, live-caption, and refinement performance; slower devices now prioritize keeping captions live."
      ],
      "fixed": [
        "Fixed Windows compatibility issues when importing audio and uploading audio data."
      ]
    }
  },
  {
    "version": "1.1.5",
    "date": "2026-08-26",
    "zh": {
      "improved": [
        "提升实时字幕的稳定性，降低识别过程中的中断与抖动。",
        "优化实时识别状态反馈，字幕延迟更低。"
      ],
      "fixed": [
        "修复直播转录中偶发的字幕停滞问题。"
      ]
    },
    "en": {
      "improved": [
        "Improved live-caption stability and reduced interruptions during recognition.",
        "Optimized realtime recognition feedback for lower caption latency."
      ],
      "fixed": [
        "Fixed an occasional caption stall during live transcription."
      ]
    }
  },
  {
    "version": "1.1.4",
    "date": "2026-08-22",
    "zh": {
      "improved": [
        "多项性能优化，界面操作更流畅。"
      ]
    },
    "en": {
      "improved": [
        "Multiple performance optimizations for a smoother experience."
      ]
    }
  },
  {
    "version": "1.1.3",
    "date": "2026-08-18",
    "zh": {
      "improved": [
        "改进会后精修字幕的准确度与排版。"
      ],
      "fixed": [
        "修复若干精修相关的边界问题。"
      ]
    },
    "en": {
      "improved": [
        "Better accuracy and formatting for post-meeting refined transcripts."
      ],
      "fixed": [
        "Fixed several edge cases around refinement."
      ]
    }
  },
  {
    "version": "1.1.2",
    "date": "2026-08-12",
    "zh": {
      "improved": [
        "改进应用内更新流程与发布通道，升级更顺畅。"
      ]
    },
    "en": {
      "improved": [
        "Improved the in-app update flow and release channel for smoother upgrades."
      ]
    }
  },
  {
    "version": "1.1.1",
    "date": "2026-08-05",
    "zh": {
      "what": [
        "新增 AI 会议总结与 AI 笔记，可自动发现重点、提取待办。"
      ],
      "improved": [
        "支持内置本地模型与在线 LLM 两种纪要方式。"
      ]
    },
    "en": {
      "what": [
        "Added AI meeting summaries and AI notes that surface key points and action items."
      ],
      "improved": [
        "Support both built-in local models and online LLMs for summaries."
      ]
    }
  },
  {
    "version": "1.1.0",
    "date": "2026-07-30",
    "zh": {
      "what": [
        "首个 1.1 版本：本地会议录制、实时字幕、说话人识别与工作区组织。"
      ]
    },
    "en": {
      "what": [
        "First 1.1 release: local meeting recording, live captions, speaker recognition, and workspace organization."
      ]
    }
  }
];

  const asrCopy = (() => {
    const LOCALES = ['zh', 'en', 'es', 'ja', 'ko', 'fr', 'de', 'ru'];

    // 角标：按清单里的 asr_role 枚举取值。说明「这个模型擅长什么」。
    // 三档共用同一个词根（多语种 / 多语种（欧洲）），只在地域范围上收窄——
    // 否则「多语种」和「欧洲语言」并列出现时，用户无法判断哪个覆盖更广。
    const asrRole = {
      zh: { 'zh-optimized': '中文优化', multilingual: '多语种', western: '欧洲多语种' },
      en: { 'zh-optimized': 'Chinese-optimized', multilingual: 'Multilingual', western: 'European multilingual' },
      es: { 'zh-optimized': 'Optimizado para chino', multilingual: 'Multilingüe', western: 'Multilingüe europeo' },
      ja: { 'zh-optimized': '中国語に最適化', multilingual: '多言語', western: '欧州の多言語' },
      ko: { 'zh-optimized': '중국어 최적화', multilingual: '다국어', western: '유럽 다국어' },
      fr: { 'zh-optimized': 'Optimisé pour le chinois', multilingual: 'Multilingue', western: 'Multilingue européen' },
      de: { 'zh-optimized': 'Für Chinesisch optimiert', multilingual: 'Mehrsprachig', western: 'Mehrsprachig (Europa)' },
      ru: { 'zh-optimized': 'Оптимизировано для китайского', multilingual: 'Многоязычная', western: 'Многоязычная (Европа)' },
    };

    // 三档刻度文案。speed/quality 的档位由 models.json 提供（1..3），这里只负责本地化。
    const tiers = {
      zh: { speed: ['慢', '适中', '快'], quality: ['一般', '好', '很好'], speedLabel: '速度', qualityLabel: '准确度', memoryLabel: '内存需求' },
      en: { speed: ['Slow', 'Medium', 'Fast'], quality: ['Fair', 'Good', 'Very good'], speedLabel: 'Speed', qualityLabel: 'Accuracy', memoryLabel: 'Memory needed' },
      es: { speed: ['Lenta', 'Media', 'Rápida'], quality: ['Aceptable', 'Buena', 'Muy buena'], speedLabel: 'Velocidad', qualityLabel: 'Precisión', memoryLabel: 'Memoria necesaria' },
      ja: { speed: ['遅い', '普通', '速い'], quality: ['ふつう', '高い', 'とても高い'], speedLabel: '速度', qualityLabel: '精度', memoryLabel: '必要メモリ' },
      ko: { speed: ['느림', '보통', '빠름'], quality: ['보통', '좋음', '매우 좋음'], speedLabel: '속도', qualityLabel: '정확도', memoryLabel: '필요 메모리' },
      fr: { speed: ['Lente', 'Moyenne', 'Rapide'], quality: ['Correcte', 'Bonne', 'Très bonne'], speedLabel: 'Vitesse', qualityLabel: 'Précision', memoryLabel: 'Mémoire requise' },
      de: { speed: ['Langsam', 'Mittel', 'Schnell'], quality: ['Ordentlich', 'Gut', 'Sehr gut'], speedLabel: 'Geschwindigkeit', qualityLabel: 'Genauigkeit', memoryLabel: 'Benötigter Speicher' },
      ru: { speed: ['Медленно', 'Средне', 'Быстро'], quality: ['Обычная', 'Хорошая', 'Очень хорошая'], speedLabel: 'Скорость', qualityLabel: 'Точность', memoryLabel: 'Нужная память' },
    };

    // 模型介绍：发布团队与规模、实际语言覆盖、会议用途和运行特点。
    // 首启与模型库共用；不同运行版本按清单能力描述。
    //
    // 写这几句时必须守两条：
    //  1. **不单列「不适合什么」。** 早先版本给每个模型配了一行 `caveat`
    //     （「遇到西班牙语会识别失败」「不支持中文」），等于把缺点摊到用户脸上，
    //     首启页看起来像在劝退。语言范围写进定位短句即可——「25 种欧洲语言」
    //     本身就说明了它不含中文，用户自己推得出来。
    //  2. **不写「某某混说最稳」。** 这几个模型都不是为某组混说语言专门训练的，
    //     把「中英夹杂」「英西混说」写成卖点会让人以为模型是按语言对定制的。
    //     有实测依据的差异（速度、内存）交给 speed/quality 刻度和体积去表达。
    const model = {
      zh: {
        'funasr-nano-int8': { tagline: "通义实验室推出的轻量语音识别模型，约 8 亿参数，面向中文语音场景。支持普通话、粤语和英语，可识别多种中文方言与地方口音，适合中文会议、访谈和日常讨论。采用量化版本在本机离线运行，兼顾识别效果与资源占用。" },
        'qwen3-asr-0.6b-int8': { tagline: "阿里云 Qwen 团队推出的多语种语音识别模型，约 6 亿参数。支持中、英、日、韩等 30 种语言及 22 种中文方言，覆盖多种地区口音，适合国际会议、跨语言沟通与多语种内容记录。" },
        'parakeet-tdt-0.6b-v3-int8': { tagline: "NVIDIA 推出的高效语音识别模型，约 6 亿参数，支持英语、西班牙语、法语、德语、俄语等 25 种欧洲语言。可自动识别语种，生成标点与英文大小写，适合英语及欧洲语言会议、访谈和长录音转写。" },
      },
      en: {
        'funasr-nano-int8': { tagline: "Best for Chinese meetings. High accuracy on Chinese, covering Cantonese, other Chinese dialects, regional accents, and English." },
        'qwen3-asr-0.6b-int8': { tagline: "Best for Japanese and Korean meetings. Covers 30 languages and 22 Chinese dialects." },
        'parakeet-tdt-0.6b-v3-int8': { tagline: "Best for English and other European-language meetings. Covers 25 languages including English, Spanish, French, German, and Russian." },
      },
      es: {
        'funasr-nano-int8': { tagline: "Ideal para reuniones en chino. Alta precisión en chino; cubre el cantonés, otros dialectos chinos, acentos regionales y el inglés." },
        'qwen3-asr-0.6b-int8': { tagline: "Ideal para reuniones en japonés y coreano. Cubre 30 idiomas y 22 dialectos del chino." },
        'parakeet-tdt-0.6b-v3-int8': { tagline: "Ideal para reuniones en inglés y otras lenguas europeas. Cubre 25 idiomas, entre ellos inglés, español, francés, alemán y ruso." },
      },
      ja: {
        'funasr-nano-int8': { tagline: "中国語の会議に最適。中国語の精度が高く、広東語などの中国語方言、各地のなまり、英語に対応します。" },
        'qwen3-asr-0.6b-int8': { tagline: "日本語・韓国語の会議に最適。30 言語と 22 の中国語方言に対応します。" },
        'parakeet-tdt-0.6b-v3-int8': { tagline: "英語・欧州言語の会議に最適。英語・スペイン語・フランス語・ドイツ語・ロシア語など 25 言語に対応します。" },
      },
      ko: {
        'funasr-nano-int8': { tagline: "중국어 회의에 최적. 중국어 인식 정확도가 높고 광둥어 등 중국어 방언, 지역 억양, 영어를 지원합니다." },
        'qwen3-asr-0.6b-int8': { tagline: "일본어·한국어 회의에 최적. 30개 언어와 22개 중국어 방언을 지원합니다." },
        'parakeet-tdt-0.6b-v3-int8': { tagline: "영어·유럽 언어 회의에 최적. 영어, 스페인어, 프랑스어, 독일어, 러시아어 등 25개 언어를 지원합니다." },
      },
      fr: {
        'funasr-nano-int8': { tagline: "Idéal pour les réunions en chinois. Grande précision en chinois ; couvre le cantonais, d’autres dialectes chinois, les accents régionaux et l’anglais." },
        'qwen3-asr-0.6b-int8': { tagline: "Idéal pour les réunions en japonais et en coréen. Couvre 30 langues et 22 dialectes chinois." },
        'parakeet-tdt-0.6b-v3-int8': { tagline: "Idéal pour les réunions en anglais et dans les autres langues européennes. Couvre 25 langues dont l’anglais, l’espagnol, le français, l’allemand et le russe." },
      },
      de: {
        'funasr-nano-int8': { tagline: "Ideal für chinesische Besprechungen. Hohe Genauigkeit bei Chinesisch; deckt Kantonesisch, weitere chinesische Dialekte, regionale Akzente und Englisch ab." },
        'qwen3-asr-0.6b-int8': { tagline: "Ideal für japanische und koreanische Besprechungen. Deckt 30 Sprachen und 22 chinesische Dialekte ab." },
        'parakeet-tdt-0.6b-v3-int8': { tagline: "Ideal für englische und andere europäische Besprechungen. Deckt 25 Sprachen ab, darunter Englisch, Spanisch, Französisch, Deutsch und Russisch." },
      },
      ru: {
        'funasr-nano-int8': { tagline: "Оптимально для встреч на китайском. Высокая точность для китайского; поддерживает кантонский и другие китайские диалекты, региональные акценты и английский." },
        'qwen3-asr-0.6b-int8': { tagline: "Оптимально для встреч на японском и корейском. Поддерживает 30 языков и 22 китайских диалекта." },
        'parakeet-tdt-0.6b-v3-int8': { tagline: "Оптимально для встреч на английском и других европейских языках. Поддерживает 25 языков, включая английский, испанский, французский, немецкий и русский." },
      },
    };

    const mlxDescriptions = {
      zh: ['阿里云 Qwen 团队推出的多语种语音识别模型，约 6 亿参数。支持中、英、日、韩等 30 种语言及 22 种中文方言，覆盖多种地区口音，适合国际会议、跨语言沟通与多语种内容记录。', '适合中文会议转写，也支持粤语和英语。', '通义实验室推出的轻量语音识别模型，约 8 亿参数，面向中文语音场景。支持中文、英语和日语，覆盖粤语、吴语等 7 种中文方言及 26 种地方口音，适合中文会议、访谈和日常讨论。'],
      en: ['Default for Japanese and Korean meetings. Supports multilingual transcription with automatic punctuation.', 'Suited to Chinese meeting transcription, with support for Cantonese and English.', 'Default for Mandarin and Cantonese meetings. Also supports English and Japanese.'],
      es: ['Modelo predeterminado para reuniones en japonés y coreano. Transcripción multilingüe con puntuación automática.', 'Adecuado para transcribir reuniones en chino; también admite cantonés e inglés.', 'Modelo predeterminado para reuniones en mandarín y cantonés. También admite inglés y japonés.'],
      ja: ['日本語・韓国語の会議の既定モデル。多言語の文字起こしと句読点の自動挿入に対応します。', '中国語の会議の文字起こしに適しています。広東語と英語にも対応します。', '標準中国語・広東語の会議の既定モデル。英語と日本語にも対応します。'],
      ko: ['일본어·한국어 회의의 기본 모델. 다국어 전사와 자동 문장 부호를 지원합니다.', '중국어 회의 전사에 적합하며 광둥어와 영어도 지원합니다.', '표준 중국어·광둥어 회의의 기본 모델. 영어와 일본어도 지원합니다.'],
      fr: ['Modèle par défaut pour les réunions en japonais et coréen. Transcription multilingue avec ponctuation automatique.', 'Adapté à la transcription des réunions en chinois, avec prise en charge du cantonais et de l’anglais.', 'Modèle par défaut pour les réunions en mandarin et cantonais. Prend aussi en charge l’anglais et le japonais.'],
      de: ['Standardmodell für Besprechungen auf Japanisch und Koreanisch. Mehrsprachige Transkription mit automatischer Zeichensetzung.', 'Geeignet für die Transkription chinesischer Besprechungen; unterstützt auch Kantonesisch und Englisch.', 'Standardmodell für Besprechungen auf Mandarin und Kantonesisch. Unterstützt auch Englisch und Japanisch.'],
      ru: ['Модель по умолчанию для встреч на японском и корейском. Многоязычная транскрипция с автоматической пунктуацией.', 'Подходит для транскрипции встреч на китайском; также поддерживает кантонский и английский.', 'Модель по умолчанию для встреч на путунхуа и кантонском. Также поддерживает английский и японский.'],
    };
    for (const locale of LOCALES) {
      model[locale]['funasr-nano-mlx'] = { tagline: mlxDescriptions[locale][2] };
      model[locale]['qwen3-asr-0.6b-mlx'] = { tagline: mlxDescriptions[locale][0] };
      model[locale]['fireredasr2-aed-mlx'] = { tagline: mlxDescriptions[locale][1] };
      model[locale]['parakeet-tdt-0.6b-v3-mlx'] =
        model[locale]['parakeet-tdt-0.6b-v3-int8'];
    }

    // 推荐角标。用户在首启第 ① 步刚选过界面语言，「按界面语言推荐」是自明的，
    // 所以只需要一个短角标，不需要再配一段解释文字。
    const recommended = {
      zh: '推荐', en: 'Recommended', es: 'Recomendado', ja: 'おすすめ',
      ko: '추천', fr: 'Recommandé', de: 'Empfohlen', ru: 'Рекомендуем',
    };

    // 首启第 ③ 步页面文案。
    const setup = {
      zh: {
        title: '选择语音识别模型',
        pickHint: '按需选择要下载的模型',
        bundledTitle: '已随应用安装', bundledDetail: '语音活动检测 · 说话人分离 · 声纹识别',
        atLeastOne: '至少要选一个识别模型，否则无法生成字幕。',
        download: '下载并继续', later: '稍后设置', estimate: '本次下载', total: '合计',
      },
      en: {
        title: 'Choose speech recognition models',
        pickHint: 'Pick the models you need',
        bundledTitle: 'Included with the app', bundledDetail: 'Voice activity detection · Speaker diarization · Voiceprint',
        atLeastOne: 'Pick at least one recognition model, otherwise captions cannot be generated.',
        download: 'Download and continue', later: 'Set up later', estimate: 'Download', total: 'Total',
      },
      es: {
        title: 'Elige modelos de reconocimiento de voz',
        pickHint: 'Elige los modelos que necesites',
        bundledTitle: 'Incluido con la aplicación', bundledDetail: 'Detección de voz · Separación de hablantes · Huella de voz',
        atLeastOne: 'Elige al menos un modelo de reconocimiento; si no, no se pueden generar subtítulos.',
        download: 'Descargar y continuar', later: 'Configurar más tarde', estimate: 'Descarga', total: 'Total',
      },
      ja: {
        title: '音声認識モデルを選択',
        pickHint: '必要なモデルを選んでください',
        bundledTitle: 'アプリに同梱済み', bundledDetail: '音声活動検出 · 話者分離 · 声紋',
        atLeastOne: '認識モデルを 1 つ以上選んでください。選ばないと字幕を生成できません。',
        download: 'ダウンロードして続ける', later: 'あとで設定', estimate: 'ダウンロード', total: '合計',
      },
      ko: {
        title: '음성 인식 모델 선택',
        pickHint: '필요한 모델을 선택하세요',
        bundledTitle: '앱에 포함됨', bundledDetail: '음성 활동 감지 · 화자 분리 · 성문',
        atLeastOne: '인식 모델을 하나 이상 선택하세요. 선택하지 않으면 자막을 만들 수 없습니다.',
        download: '다운로드하고 계속', later: '나중에 설정', estimate: '다운로드', total: '합계',
      },
      fr: {
        title: 'Choisir les modèles de reconnaissance vocale',
        pickHint: 'Choisissez les modèles dont vous avez besoin',
        bundledTitle: 'Inclus avec l’application', bundledDetail: 'Détection vocale · Séparation des locuteurs · Empreinte vocale',
        atLeastOne: 'Choisissez au moins un modèle de reconnaissance, sinon aucun sous-titre ne peut être généré.',
        download: 'Télécharger et continuer', later: 'Configurer plus tard', estimate: 'Téléchargement', total: 'Total',
      },
      de: {
        title: 'Spracherkennungsmodelle wählen',
        pickHint: 'Wählen Sie die Modelle, die Sie brauchen',
        bundledTitle: 'In der App enthalten', bundledDetail: 'Sprachaktivitätserkennung · Sprechertrennung · Stimmabdruck',
        atLeastOne: 'Wählen Sie mindestens ein Erkennungsmodell, sonst können keine Untertitel erzeugt werden.',
        download: 'Herunterladen und fortfahren', later: 'Später einrichten', estimate: 'Download', total: 'Gesamt',
      },
      ru: {
        title: 'Выбор моделей распознавания речи',
        pickHint: 'Выберите нужные модели',
        bundledTitle: 'Входит в приложение', bundledDetail: 'Детекция речи · Разделение говорящих · Голосовой отпечаток',
        atLeastOne: 'Выберите хотя бы одну модель распознавания, иначе субтитры создать нельзя.',
        download: 'Скачать и продолжить', later: 'Настроить позже', estimate: 'Загрузка', total: 'Всего',
      },
    };

    // 准备页标签。语言仍是显式设置（它同时影响端点检测参数与翻译目标）。
    const prepare = {
      zh: { modelLabel: '识别模型' }, en: { modelLabel: 'Recognition model' },
      es: { modelLabel: 'Modelo de reconocimiento' }, ja: { modelLabel: '認識モデル' },
      ko: { modelLabel: '인식 모델' }, fr: { modelLabel: 'Modèle de reconnaissance' },
      de: { modelLabel: 'Erkennungsmodell' }, ru: { modelLabel: 'Модель распознавания' },
    };

    return { LOCALES, asrRole, tiers, model, recommended, setup, prepare };
  })();

  const builtinModelIntro = {
    'qwen3.5-4b-q4km': {
      zh: '阿里云 Qwen 团队推出的语言模型，约 40 亿参数，定位于质量优先的会议纪要生成。可根据中英文会议内容归纳议题、串联讨论脉络，提炼关键决策与待办事项，适合内容较多、讨论较复杂的会议。采用本地量化版本，运行时需要较多内存与计算资源，适合性能较强的设备；分析过程在本机完成。',
      en: 'Flagship of the Qwen3.5 small series. At 4B it rivals much larger models, giving the best Chinese/English notes. Best on a capable machine.',
      es: 'Buque insignia de la serie Qwen3.5. Con 4B rivaliza con modelos más grandes y ofrece las mejores notas en chino/inglés. Ideal para equipos potentes.',
      ja: 'Qwen3.5 小型シリーズの旗艦。4B ながら大型モデルに匹敵し、中英の議事録品質は最高。高性能な端末向け。',
      ko: 'Qwen3.5 소형 시리즈의 플래그십. 4B로도 더 큰 모델에 필적하며 중국어/영어 회의록 품질이 가장 높습니다. 고성능 기기에 적합.',
      fr: 'Fleuron de la série Qwen3.5. À 4B, il rivalise avec des modèles bien plus grands et offre les meilleures notes en chinois/anglais. Idéal sur une machine puissante.',
      de: 'Flaggschiff der Qwen3.5-Kleinserie. Mit 4B misst es sich mit viel größeren Modellen und liefert die besten Notizen auf Chinesisch/Englisch. Ideal für leistungsstarke Geräte.',
      ru: 'Флагман малой серии Qwen3.5. При 4B соперничает с гораздо более крупными моделями и даёт лучшие заметки на китайском/английском. Лучше на мощном устройстве.',
    },
    'qwen3.5-2b-q4km': {
      zh: '阿里云 Qwen 团队推出的轻量语言模型，约 20 亿参数，是日常会议纪要的均衡选择。可根据中英文会议内容梳理议题、提炼重点与决策，并整理待办事项。采用本地量化版本，兼顾分析速度与资源占用，适合例会、项目同步和日常讨论；首次使用需下载模型，分析过程在本机完成。',
      en: 'Qwen3.5 at 2B. A balance of quality and speed with strong Chinese/English notes. A solid everyday choice for most machines.',
      es: 'Qwen3.5 de 2B. Equilibrio entre calidad y velocidad con buenas notas en chino/inglés. Buena opción diaria para la mayoría de equipos.',
      ja: 'Qwen3.5 2B。品質と速度のバランスが良く、中英の議事録も優秀。ほとんどの端末で日常使いに最適。',
      ko: 'Qwen3.5 2B. 품질과 속도의 균형이 좋고 중국어/영어 회의록이 뛰어납니다. 대부분의 기기에서 일상용으로 적합.',
      fr: 'Qwen3.5 en 2B. Équilibre entre qualité et vitesse avec de bonnes notes en chinois/anglais. Un bon choix quotidien pour la plupart des machines.',
      de: 'Qwen3.5 mit 2B. Ausgewogen zwischen Qualität und Geschwindigkeit mit starken Notizen auf Chinesisch/Englisch. Solide Alltagswahl für die meisten Geräte.',
      ru: 'Qwen3.5 на 2B. Баланс качества и скорости с хорошими заметками на китайском/английском. Надёжный повседневный выбор для большинства устройств.',
    },
  };
  appCopy.builtinModelIntro = builtinModelIntro;

  const modelLibraryBackground = {
    zh: {
      'silero-vad': 'Silero 团队于 2020 年发布、2021 年提供 ONNX 版本的语音活动检测模型。只判断“此刻是否有人说话”，用于切分句子边界。',
      'qwen3-asr-0.6b-int8': '阿里云 Qwen 团队于 2026 年 1 月发布的 Qwen3-ASR 0.6B int8 版，基于 Qwen3-Omni 的音频理解能力，覆盖 30 种语言和 22 种中文方言。',
      'funasr-nano-int8': 'FunAudioLLM 团队于 2025 年 12 月发布的 Fun-ASR-Nano int8 版，覆盖中文、英语、粤语。',
      'pyannote-segmentation-3.0': 'pyannoteAI 于 2023 年 9 月发布的说话区间分割模型，检测说话、重叠说话和非语音区间，为说话人分离提供边界。',
      'eres2net-base-3dspeaker-zh': '阿里达摩院于 2023 年 11 月发布的 3D-Speaker ERes2Net Base 声纹模型，训练于 20 万标注中文说话人数据。把语音转成可比较的说话人特征用于离线聚类，不参与语音转写。',
      'hy-mt2-1.8b-q4km': '腾讯混元团队于 2025 年 12 月开源的 Hy-MT 1.8B 翻译模型本地量化版，用于字幕翻译，覆盖 33 种语言及多种方言。',
    },
    en: {
      'silero-vad': 'Voice-activity detector released by the Silero team in 2020, with an ONNX build since 2021. It only decides whether someone is speaking right now, which is what splits caption segments.',
      'qwen3-asr-0.6b-int8': 'Qwen3-ASR 0.6B int8, released by Alibaba Cloud’s Qwen team in January 2026. Covers 30 languages and 22 Chinese dialects.',
      'funasr-nano-int8': 'Fun-ASR-Nano int8, released by FunAudioLLM in December 2025. Covers Chinese, English, and Cantonese.',
      'pyannote-segmentation-3.0': 'Speech-region segmentation model released by pyannoteAI in September 2023. It finds speech, overlap, and non-speech boundaries for speaker diarization.',
      'eres2net-base-3dspeaker-zh': '3D-Speaker ERes2Net Base voiceprint model released by Alibaba DAMO Academy in November 2023, trained on 200,000 labeled Mandarin speakers. It turns speech into comparable speaker embeddings for offline clustering and does not transcribe.',
      'hy-mt2-1.8b-q4km': 'Quantized local build of Tencent Hunyuan’s 1.8B Hy-MT translation model, open-sourced in December 2025 and used for caption translation across 33 languages.',
    },
    es: {
      'silero-vad': 'Detector de actividad de voz publicado por el equipo de Silero en 2020, con versión ONNX desde 2021. Solo decide si alguien está hablando en ese momento, que es lo que divide los segmentos de subtítulos.',
      'qwen3-asr-0.6b-int8': 'Qwen3-ASR 0.6B int8, publicado por el equipo Qwen de Alibaba Cloud en enero de 2026. Cubre 30 idiomas y 22 dialectos del chino.',
      'funasr-nano-int8': 'Fun-ASR-Nano int8, publicado por FunAudioLLM en diciembre de 2025. Cubre chino, inglés y cantonés.',
      'pyannote-segmentation-3.0': 'Modelo de segmentación de regiones de voz publicado por pyannoteAI en septiembre de 2023. Detecta los límites de voz, solapamiento y no voz para la separación de hablantes.',
      'eres2net-base-3dspeaker-zh': 'Modelo de huella de voz 3D-Speaker ERes2Net Base, publicado por Alibaba DAMO Academy en noviembre de 2023 y entrenado con 200.000 hablantes de mandarín etiquetados. Convierte la voz en representaciones comparables para la agrupación sin conexión; no transcribe.',
      'hy-mt2-1.8b-q4km': 'Versión local cuantizada del modelo de traducción Hy-MT 1.8B de Tencent Hunyuan, publicado en diciembre de 2025 y usado para traducir subtítulos en 33 idiomas.',
    },
    ja: {
      'silero-vad': 'Silero チームが 2020 年に公開し、2021 年から ONNX 版が提供されている音声活動検出モデル。その瞬間に誰かが話しているかだけを判定し、字幕の区間分割に使います。',
      'qwen3-asr-0.6b-int8': 'Alibaba Cloud の Qwen チームが 2026 年 1 月に公開した Qwen3-ASR 0.6B int8。30 言語と 22 の中国語方言に対応。',
      'funasr-nano-int8': 'FunAudioLLM が 2025 年 12 月に公開した Fun-ASR-Nano int8。中国語・英語・広東語に対応。',
      'pyannote-segmentation-3.0': 'pyannoteAI が 2023 年 9 月に公開した音声区間分割モデル。話者分離のために、発話・重なり・非発話の境界を検出します。',
      'eres2net-base-3dspeaker-zh': 'Alibaba DAMO Academy が 2023 年 11 月に公開した 3D-Speaker ERes2Net Base 声紋モデル。20 万件のラベル付き北京語話者で学習。音声を比較可能な話者埋め込みに変換し、オフラインのクラスタリングに使います（文字起こしは行いません）。',
      'hy-mt2-1.8b-q4km': 'Tencent Hunyuan の 1.8B Hy-MT 翻訳モデルのローカル量子化版。2025 年 12 月にオープンソース化され、33 言語の字幕翻訳に使います。',
    },
    ko: {
      'silero-vad': 'Silero 팀이 2020년에 공개하고 2021년부터 ONNX 버전을 제공하는 음성 활동 감지 모델입니다. 지금 말하는 사람이 있는지만 판단하며, 자막 구간을 나누는 데 사용합니다.',
      'qwen3-asr-0.6b-int8': 'Alibaba Cloud의 Qwen 팀이 2026년 1월에 공개한 Qwen3-ASR 0.6B int8입니다. 30개 언어와 22개 중국어 방언을 지원합니다.',
      'funasr-nano-int8': 'FunAudioLLM이 2025년 12월에 공개한 Fun-ASR-Nano int8입니다. 중국어, 영어, 광둥어를 지원합니다.',
      'pyannote-segmentation-3.0': 'pyannoteAI가 2023년 9월에 공개한 음성 구간 분할 모델입니다. 화자 분리를 위해 발화, 겹침, 비발화 경계를 찾습니다.',
      'eres2net-base-3dspeaker-zh': 'Alibaba DAMO Academy가 2023년 11월에 공개한 3D-Speaker ERes2Net Base 성문 모델로, 라벨이 지정된 중국어(보통화) 화자 20만 명으로 학습했습니다. 음성을 비교 가능한 화자 임베딩으로 바꿔 오프라인 군집화에 사용하며, 전사에는 관여하지 않습니다.',
      'hy-mt2-1.8b-q4km': 'Tencent Hunyuan의 1.8B Hy-MT 번역 모델을 로컬에서 양자화한 버전입니다. 2025년 12월에 오픈소스로 공개되었고 33개 언어 자막 번역에 사용합니다.',
    },
    fr: {
      'silero-vad': 'Détecteur d’activité vocale publié par l’équipe Silero en 2020, avec une version ONNX depuis 2021. Il détermine uniquement si quelqu’un parle à l’instant, ce qui sert à découper les segments de sous-titres.',
      'qwen3-asr-0.6b-int8': 'Qwen3-ASR 0.6B int8, publié par l’équipe Qwen d’Alibaba Cloud en janvier 2026. Couvre 30 langues et 22 dialectes chinois.',
      'funasr-nano-int8': 'Fun-ASR-Nano int8, publié par FunAudioLLM en décembre 2025. Couvre le chinois, l’anglais et le cantonais.',
      'pyannote-segmentation-3.0': 'Modèle de segmentation des régions vocales publié par pyannoteAI en septembre 2023. Il détecte les frontières de parole, de chevauchement et de non-parole pour la séparation des locuteurs.',
      'eres2net-base-3dspeaker-zh': 'Modèle d’empreinte vocale 3D-Speaker ERes2Net Base publié par Alibaba DAMO Academy en novembre 2023, entraîné sur 200 000 locuteurs mandarins annotés. Il transforme la parole en représentations comparables pour le regroupement hors ligne ; il ne transcrit pas.',
      'hy-mt2-1.8b-q4km': 'Version locale quantifiée du modèle de traduction Hy-MT 1,8 B de Tencent Hunyuan, open source depuis décembre 2025 et utilisée pour traduire les sous-titres en 33 langues.',
    },
    de: {
      'silero-vad': 'Sprachaktivitätsdetektor, veröffentlicht vom Silero-Team 2020, mit ONNX-Version seit 2021. Er entscheidet nur, ob gerade jemand spricht – das teilt die Untertitel in Abschnitte.',
      'qwen3-asr-0.6b-int8': 'Qwen3-ASR 0.6B int8, veröffentlicht vom Qwen-Team von Alibaba Cloud im Januar 2026. Deckt 30 Sprachen und 22 chinesische Dialekte ab.',
      'funasr-nano-int8': 'Fun-ASR-Nano int8, veröffentlicht von FunAudioLLM im Dezember 2025. Deckt Chinesisch, Englisch und Kantonesisch ab.',
      'pyannote-segmentation-3.0': 'Modell zur Segmentierung von Sprachbereichen, veröffentlicht von pyannoteAI im September 2023. Es findet Sprach-, Überlappungs- und Nicht-Sprach-Grenzen für die Sprechertrennung.',
      'eres2net-base-3dspeaker-zh': 'Stimmabdruck-Modell 3D-Speaker ERes2Net Base, veröffentlicht von Alibaba DAMO Academy im November 2023 und mit 200.000 annotierten Mandarin-Sprechern trainiert. Es wandelt Sprache in vergleichbare Sprecher-Embeddings für das Offline-Clustering um und transkribiert nicht.',
      'hy-mt2-1.8b-q4km': 'Lokal quantisierte Version des 1,8B-Hy-MT-Übersetzungsmodells von Tencent Hunyuan, seit Dezember 2025 Open Source und für die Untertitelübersetzung in 33 Sprachen.',
    },
    ru: {
      'silero-vad': 'Детектор речевой активности, выпущенный командой Silero в 2020 году; с 2021 года доступна ONNX-версия. Он лишь определяет, говорит ли кто-то в данный момент, и по нему нарезаются сегменты субтитров.',
      'qwen3-asr-0.6b-int8': 'Qwen3-ASR 0.6B int8, выпущен командой Qwen (Alibaba Cloud) в январе 2026 года. Поддерживает 30 языков и 22 китайских диалекта.',
      'funasr-nano-int8': 'Fun-ASR-Nano int8, выпущен FunAudioLLM в декабре 2025 года. Поддерживает китайский, английский и кантонский.',
      'pyannote-segmentation-3.0': 'Модель сегментации речевых областей, выпущена pyannoteAI в сентябре 2023 года. Определяет границы речи, перекрытия и отсутствия речи для разделения говорящих.',
      'eres2net-base-3dspeaker-zh': 'Модель голосового отпечатка 3D-Speaker ERes2Net Base, выпущена Alibaba DAMO Academy в ноябре 2023 года и обучена на 200 000 размеченных носителях путунхуа. Превращает речь в сравнимые эмбеддинги говорящего для офлайн-кластеризации и не выполняет транскрипцию.',
      'hy-mt2-1.8b-q4km': 'Локальная квантованная версия модели перевода Hy-MT 1.8B от Tencent Hunyuan, открытая в декабре 2025 года и используемая для перевода субтитров на 33 языка.',
    },
  };
  appCopy.modelLibraryBackground = modelLibraryBackground;

  const tourMeetingFallback = { zh: '会议', en: 'Meeting', es: 'Reunión', ja: '会議', ko: '회의', fr: 'Réunion', de: 'Besprechung', ru: 'Встреча' };
  appCopy.tourMeetingFallback = tourMeetingFallback;

  const tourAiSuggestionFallback = { zh: 'AI 建议', en: 'AI suggestion', es: 'Sugerencia de IA', ja: 'AI 提案', ko: 'AI 제안', fr: 'Suggestion IA', de: 'KI-Vorschlag', ru: 'Совет ИИ' };
  appCopy.tourAiSuggestionFallback = tourAiSuggestionFallback;

  const tourHowtoLabel = { zh: '如何使用', en: 'How to use', es: 'Cómo usarlo', ja: '使い方', ko: '사용 방법', fr: 'Comment l’utiliser', de: 'So verwenden', ru: 'Как использовать' };
  appCopy.tourHowtoLabel = tourHowtoLabel;

  const tourHowto = {
    zh: {
      0: ['在搜索框输入关键词，可搜索会议标题、字幕内容或说话人。', '搜索结果以浮窗展示，并高亮命中的关键词。', '点击某条结果即可打开该会议。'],
      1: ['输入会议名称，并选择会议语言与译文目标。', '勾选要录制的音频来源（麦克风 / 系统音频）。', '点击「开始录制」，模型加载后会自动开录。'],
      2: ['录制时，右侧实时字幕会持续滚动更新。', '每条字幕带时间与说话人，点击可回放定位。', '点击「展开字幕」，把字幕切到主视图。'],
      3: ['点击「AI 笔记」开启实时纪要。', 'AI 会自动提炼结论、风险与待办到笔记区。', '可将当前字幕片段一键加入笔记。'],
      4: ['会后自动生成精修逐字稿与纪要。', '拖动播放条回听，字幕会随之高亮。', '点击「导出」或「分享」，保存或发送纪要。'],
    },
    en: {
      0: ['Type keywords to search meeting titles, captions, or speakers.', 'Results appear in a popover with the query highlighted.', 'Click a result to open that meeting.'],
      1: ['Enter a meeting title, then choose the language and translation target.', 'Check which audio sources to record (mic / system audio).', 'Hit Start recording; models load before recording begins.'],
      2: ['Live captions scroll continuously on the right while recording.', 'Each caption carries a time and speaker; click to jump playback.', 'Expand captions to bring them to the main view.'],
      3: ['Enable AI notes to start real-time notes.', 'AI surfaces decisions, risks, and actions into your notes.', 'Add the current caption segment to your notes in one click.'],
      4: ['A refined transcript and notes are generated automatically.', 'Drag the playback bar to listen; captions highlight in sync.', 'Export or share the notes when you are done.'],
    },
    es: {
      0: ['Escribe palabras clave para buscar títulos, subtítulos o hablantes.', 'Los resultados aparecen en una ventana flotante con la búsqueda resaltada.', 'Haz clic en un resultado para abrir esa reunión.'],
      1: ['Escribe un título y elige el idioma y la traducción.', 'Marca qué fuentes de audio grabar (micrófono / sistema).', 'Pulsa Iniciar grabación; los modelos cargan antes.'],
      2: ['Los subtítulos en vivo se desplazan a la derecha al grabar.', 'Cada subtítulo tiene hora y hablante; pulsa para saltar.', 'Amplía los subtítulos para llevarlos a la vista principal.'],
      3: ['Activa la IA para notas en tiempo real.', 'La IA extrae conclusiones, riesgos y tareas a tus notas.', 'Añade el segmento actual a tus notas con un clic.'],
      4: ['Se genera automáticamente una transcripción refinada y notas.', 'Arrastra la barra para escuchar; los subtítulos se resaltan.', 'Exporta o comparte las notas al terminar.'],
    },
    ja: {
      0: ['キーワードで会議タイトル・字幕・話者を検索。', '結果は浮遊ウィンドウで表示され、キーワードがハイライト。', '結果をクリックすると会議が開きます。'],
      1: ['会議名を入力し、言語と翻訳先を選択。', '録音する音声ソース（マイク/システム）を選択。', '「録音を開始」でモデル読み込み後に開始。'],
      2: ['録音中、右側にライブ字幕が流れます。', '各字幕に時間と話者が付き、クリックで再生位置へ。', '「字幕を展開」で字幕をメイン表示に。'],
      3: ['「AIメモ」を有効にしてリアルタイムメモ。', 'AI が結論・リスク・ToDo をメモに抽出。', '現在の字幕をワンクリックでメモに追加。'],
      4: ['終了後に精修済みの文字起こしとメモを自動生成。', 'バーをドラッグして再生、字幕が連動ハイライト。', '「エクスポート」「共有」で保存・送信。'],
    },
    ko: {
      0: ['키워드로 회의 제목·자막·화자를 검색하세요.', '결과는 플로팅 창에 표시되며 키워드가 강조됩니다.', '결과를 클릭하면 회의가 열립니다.'],
      1: ['회의 이름을 입력하고 언어·번역 대상을 선택하세요.', '녹음할 오디오 소스(마이크/시스템)를 선택하세요.', '「녹음 시작」을 누르면 모델 로드 후 시작됩니다.'],
      2: ['녹음 중 오른쪽에 실시간 자막이 흐릅니다.', '각 자막에 시간·화자가 표시되며 클릭으로 이동.', '「자막 확대」로 자막을 메인 화면에.'],
      3: ['「AI 메모」를 켜서 실시간 메모를 시작하세요.', 'AI가 결론·리스크·할 일을 메모로 추출합니다.', '현재 자막을 한 번에 메모에 추가하세요.'],
      4: ['종료 후 정제된 녹취와 메모를 자동 생성합니다.', '바를 드래그해 재생하면 자막이 연동됩니다.', '「내보내기」「공유」로 저장·전송하세요.'],
    },
    fr: {
      0: ['Saisissez des mots-clés pour chercher titres, sous-titres ou locuteurs.', 'Les résultats s’affichent dans une fenêtre flottante avec la recherche surlignée.', 'Cliquez sur un résultat pour ouvrir cette réunion.'],
      1: ['Saisissez un titre, puis choisissez la langue et la traduction.', 'Cochez les sources audio à enregistrer (micro / système).', 'Cliquez sur Démarrer ; les modèles se chargent avant.'],
      2: ['Les sous-titres défilent à droite pendant l’enregistrement.', 'Chaque sous-titre a une heure et un locuteur ; cliquez pour sauter.', 'Agrandissez les sous-titres pour les mettre en premier plan.'],
      3: ['Activez les notes IA pour les notes en temps réel.', 'L’IA extrait conclusions, risques et tâches dans vos notes.', 'Ajoutez le segment courant à vos notes en un clic.'],
      4: ['Une transcription affinée et des notes sont générées automatiquement.', 'Faites glisser la barre pour écouter ; les sous-titres se surlignent.', 'Exportez ou partagez les notes à la fin.'],
    },
    de: {
      0: ['Geben Sie Schlüsselwörter ein, um Titel, Untertitel oder Sprecher zu suchen.', 'Die Ergebnisse erscheinen in einem Popover mit hervorgehobener Suche.', 'Klicken Sie auf ein Ergebnis, um die Besprechung zu öffnen.'],
      1: ['Titel eingeben, Sprache und Übersetzungsziel wählen.', 'Audioquellen (Mikrofon/System) zum Aufnehmen auswählen.', '„Aufnahme starten“; die Modelle laden vor dem Start.'],
      2: ['Live-Untertitel laufen rechts während der Aufnahme.', 'Jeder Untertitel hat Zeit und Sprecher; klicken zum Springen.', 'Untertitel vergrößern, um sie in die Hauptansicht zu bringen.'],
      3: ['KI-Notizen für Notizen in Echtzeit aktivieren.', 'KI zieht Schlussfolgerungen, Risiken und Aufgaben in Ihre Notizen.', 'Aktuelles Segment mit einem Klick zu Notizen hinzufügen.'],
      4: ['Ein bearbeitetes Transkript und Notizen werden automatisch erstellt.', 'Balken ziehen zum Anhören; Untertitel werden synchron hervorgehoben.', 'Notizen am Ende exportieren oder teilen.'],
    },
    ru: {
      0: ['Введите ключевые слова для поиска названий, субтитров или говорящих.', 'Результаты появляются во всплывающем окне с подсветкой запроса.', 'Нажмите на результат, чтобы открыть встречу.'],
      1: ['Введите название, затем выберите язык и перевод.', 'Отметьте источники звука для записи (микрофон/система).', 'Нажмите «Начать запись»; модели загрузятся заранее.'],
      2: ['Субтитры прокручиваются справа во время записи.', 'У каждого субтитра есть время и говорящий; клик для перехода.', 'Разверните субтитры, чтобы показать их на главном экране.'],
      3: ['Включите ИИ-заметки для заметок в реальном времени.', 'ИИ извлекает выводы, риски и задачи в ваши заметки.', 'Добавьте текущий фрагмент в заметки одним кликом.'],
      4: ['Обработанная расшифровка и заметки создаются автоматически.', 'Перетащите полосу для прослушивания; субтитры подсвечиваются.', 'Экспортируйте или поделитесь заметками в конце.'],
    },
  };
  appCopy.tourHowto = tourHowto;

  const currentVersionLabels = { zh: '当前版本', en: 'Current version', es: 'Versión actual', ja: '現在のバージョン', ko: '현재 버전', fr: 'Version actuelle', de: 'Aktuelle Version', ru: 'Текущая версия' };
  appCopy.currentVersionLabels = currentVersionLabels;

  const localeHelpers = (() => {
    const languageCodes = ['zh', 'en', 'es', 'ja', 'ko', 'fr', 'de', 'ru'];
    const localeTags = { zh: 'zh-CN', en: 'en-US', es: 'es-ES', ja: 'ja-JP', ko: 'ko-KR', fr: 'fr-FR', de: 'de-DE', ru: 'ru-RU' };
    const slogans = {
      zh: ['每一场对话，都留有依据。', '让重要讨论，不再散落。', '从声音开始，留下清晰结论。', '记录发生的事，推进接下来的事。', '把会议留在掌控之中。'],
      en: ['Every conversation leaves a traceable record.', 'Keep important discussions in one place.', 'Start with sound. End with clear decisions.', 'Record what happened. Move the work forward.', 'Keep every meeting within reach.'],
      es: ['Cada conversación conserva un registro verificable.', 'Mantén las conversaciones importantes en un solo lugar.', 'Empieza con la voz. Termina con decisiones claras.', 'Registra lo que ocurrió. Haz avanzar el trabajo.', 'Mantén cada reunión bajo control.'],
      ja: ['すべての会話に、確かな記録を。', '大切な議論を、一か所に。', '音声から始め、明確な決定へ。', '起きたことを記録し、仕事を前へ進める。', 'すべての会議を手の届く場所に。'],
      ko: ['모든 대화에 추적 가능한 기록을 남깁니다.', '중요한 논의를 한곳에 모으세요.', '소리로 시작해 명확한 결정으로 마무리하세요.', '일어난 일을 기록하고 업무를 앞으로 나아가게 하세요.', '모든 회의를 가까이 두세요.'],
      fr: ['Chaque conversation laisse une trace vérifiable.', 'Gardez les discussions importantes au même endroit.', 'Commencez par le son. Terminez par des décisions claires.', 'Consignez ce qui s’est passé. Faites avancer le travail.', 'Gardez chaque réunion à portée de main.'],
      de: ['Jedes Gespräch hinterlässt eine nachvollziehbare Aufzeichnung.', 'Halten Sie wichtige Gespräche an einem Ort fest.', 'Mit Ton beginnen. Mit klaren Entscheidungen enden.', 'Dokumentieren Sie das Geschehene und bringen Sie die Arbeit voran.', 'Behalten Sie jede Besprechung im Blick.'],
      ru: ['Каждый разговор оставляет проверяемую запись.', 'Храните важные обсуждения в одном месте.', 'Начните со звука. Завершите ясными решениями.', 'Записывайте произошедшее и двигайте работу вперёд.', 'Держите каждую встречу под рукой.']
    };
    const trashCopy = {
      zh: { slogan: '删除的会议将在 30 天后永久清理。', back: '← 返回会议库', purge: '永久删除' },
      en: { slogan: 'Deleted meetings are permanently removed after 30 days.', back: '← Back to library', purge: 'Delete permanently' },
      es: { slogan: 'Las reuniones eliminadas se borran permanentemente después de 30 días.', back: '← Volver a la biblioteca', purge: 'Eliminar definitivamente' },
      ja: { slogan: '削除した会議は30日後に完全に消去されます。', back: '← ライブラリに戻る', purge: '完全に削除' },
      ko: { slogan: '삭제된 회의는 30일 후 영구적으로 삭제됩니다.', back: '← 라이브러리로 돌아가기', purge: '영구 삭제' },
      fr: { slogan: 'Les réunions supprimées sont effacées définitivement après 30 jours.', back: '← Retour à la bibliothèque', purge: 'Supprimer définitivement' },
      de: { slogan: 'Gelöschte Besprechungen werden nach 30 Tagen endgültig entfernt.', back: '← Zurück zur Bibliothek', purge: 'Endgültig löschen' },
      ru: { slogan: 'Удалённые встречи безвозвратно удаляются через 30 дней.', back: '← Вернуться в библиотеку', purge: 'Удалить навсегда' }
    };
    const defaultMeetingNames = { zh: '会议', en: 'Meeting', es: 'Reunión', ja: '会議', ko: '회의', fr: 'Réunion', de: 'Meeting', ru: 'Встреча' };
    const selectionOverview = {
      zh: (count) => `已选择 ${count} 个会议`, en: (count) => `${count} meeting${count === 1 ? '' : 's'} selected`, es: (count) => `${count} ${count === 1 ? 'reunión seleccionada' : 'reuniones seleccionadas'}`,
      ja: (count) => `${count} 件の会議を選択中`, ko: (count) => `회의 ${count}개 선택됨`, fr: (count) => `${count} réunion${count === 1 ? '' : 's'} sélectionnée${count === 1 ? '' : 's'}`, de: (count) => `${count} Besprechung${count === 1 ? '' : 'en'} ausgewählt`, ru: (count) => `Выбрано встреч: ${count}`
    };

    return { languageCodes, localeTags, slogans, trashCopy, defaultMeetingNames, selectionOverview };
  })();

  const chinaModelSourceLabel = '是否使用中国大陆镜像源进行下载加速';

const data = { onboardingStorageCopy, catalog, appCopy, aiNotePromptCopy, storageCleanupCopy, exportHubCopy, whatsNewLog, asrCopy, localeHelpers, chinaModelSourceLabel };
if (typeof module === "object" && module.exports) module.exports = data;
else window.BreviaLocaleData = data;
})();
