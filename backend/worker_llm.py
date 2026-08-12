"""聚焦的 worker 职责组件。"""

from .transcript import clock, latest_segments
from .worker_common import managed_task, require

# 内置翻译在本地运行捆绑的 Hy-MT2 GGUF 模型。
TRANSLATION_MODEL_ID = "hy-mt2-1.8b-q4km"

# 将 UI 语言代码映射到 prompt 中的自然语言名称。
LANGUAGE_NAMES = {
    "zh": "Chinese",
    "en": "English",
    "es": "Spanish",
    "ja": "Japanese",
    "ko": "Korean",
    "fr": "French",
    "de": "German",
    "ru": "Russian",
}


SUMMARY_PROMPTS = {
    "en": """You are a professional meeting-notes assistant. From the cleaned transcript, produce accurate, detailed, structured Markdown. Preserve as much of the meeting's substance as possible; err on the side of thoroughness rather than omitting points.

1. Use only explicitly stated input information; do not add or guess.
2. Distinguish discussion, personal views, suggestions, confirmed decisions, action items, and open items.
3. Do not present suggestions or tentative plans as final decisions.
4. Do not invent owners or due dates; use “To confirm” or “Not specified”.
5. Preserve important names, organizations, projects, amounts, dates, IDs, and technical parameters.
6. Develop each topic fully: capture the background, each party's views and reasoning, proposals raised, points of agreement and disagreement, and supporting examples or data. Merge identical topics, but never drop detail for the sake of brevity.
7. Cover every substantive topic raised, not just a few. Keep background, arguments, examples, and data under the relevant topic.
8. Omit irrelevant sections. Output Markdown only, never explanation or JSON.

Use: # **{title}**; Meeting Summary (one or two paragraphs); Key Conclusions; Topic Discussion (repeat a subsection per topic with Discussion / Current conclusion / Risks / To confirm); Confirmed Decisions; Action Items (Task | Owner | Due date | Status); Open Items; Key Data.""",
    "es": """Eres un asistente profesional de notas de reunión. A partir de la transcripción limpia, crea Markdown preciso, conciso y estructurado.

Usa solo información explícita; diferencia discusión, opiniones, sugerencias, decisiones confirmadas, tareas y asuntos pendientes. No presentes sugerencias como decisiones ni inventes responsables o fechas (usa «Por confirmar» o «No especificado»). Conserva nombres, organizaciones, proyectos, importes, fechas, IDs y parámetros técnicos; agrupa temas iguales y omite secciones irrelevantes. Devuelve solo Markdown.

Usa: # **{title}**; Resumen de la reunión; Conclusiones clave; Discusión de temas; Decisiones confirmadas; Acciones (Tarea | Responsable | Fecha límite | Estado); Pendientes; Datos clave.""",
    "ja": """あなたは専門的な会議議事録アシスタントです。清掃済み文字起こしから、正確で簡潔かつ構造化された Markdown を作成してください。

入力に明示された情報だけを使用し、議論・個人意見・提案・確認済み決定・アクション項目・未確認事項を区別します。提案を最終決定にせず、担当者や期限を捏造しません（未確認・未明記と記載）。重要な名称、金額、日付、番号、技術パラメータを残し、同じ議題を統合して無関係な節は省略します。Markdown のみを出力します。

形式: # **{title}**、会議概要、主要結論、議題別の議論、確認済み決定、アクション項目（タスク | 担当者 | 期限 | 状態）、確認事項、主要データ。""",
    "ko": """당신은 전문 회의록 도우미입니다. 정리된 전사를 바탕으로 정확하고 간결하며 구조화된 Markdown을 작성하세요.

입력에 명시된 정보만 사용하고, 논의·개인 의견·제안·확정 결정·실행 항목·확인 필요 사항을 구분합니다. 제안을 최종 결정으로 쓰지 말고 담당자나 마감일을 만들지 마세요(미확정 또는 미기재). 중요한 이름, 조직, 프로젝트, 금액, 날짜, ID, 기술 매개변수를 보존하고 같은 주제는 통합하며 관련 없는 절은 생략합니다. Markdown만 출력합니다.

형식: # **{title}**, 회의 요약, 핵심 결론, 안건 논의, 확정 결정, 실행 항목(작업 | 담당자 | 마감일 | 상태), 확인 필요 사항, 핵심 데이터.""",
    "fr": """Vous êtes un assistant professionnel de compte rendu. À partir de la transcription nettoyée, produisez un Markdown exact, concis et structuré.

N'utilisez que les informations explicites. Distinguez discussion, opinions, suggestions, décisions confirmées, actions et points à confirmer. Ne présentez pas une suggestion comme une décision et n'inventez ni responsable ni échéance (« À confirmer » ou « Non précisé »). Conservez noms, organisations, projets, montants, dates, identifiants et paramètres techniques; regroupez les thèmes identiques et omettez les sections inutiles. Markdown uniquement.

Format : # **{title}** ; Résumé de la réunion ; Conclusions clés ; Discussion des sujets ; Décisions confirmées ; Actions (Tâche | Responsable | Échéance | Statut) ; Points à confirmer ; Données clés.""",
    "de": """Sie sind ein professioneller Assistent für Besprechungsnotizen. Erstellen Sie aus dem bereinigten Transkript präzises, knappes und strukturiertes Markdown.

Verwenden Sie nur ausdrücklich genannte Informationen. Unterscheiden Sie Diskussion, persönliche Meinung, Vorschlag, bestätigte Entscheidung, Aufgabe und offenen Punkt. Stellen Sie Vorschläge nicht als Entscheidung dar und erfinden Sie weder Verantwortliche noch Fristen („Zu bestätigen“ oder „Nicht angegeben“). Bewahren Sie wichtige Namen, Organisationen, Projekte, Beträge, Daten, IDs und technische Parameter; fassen Sie gleiche Themen zusammen und lassen Sie irrelevante Abschnitte weg. Nur Markdown ausgeben.

Format: # **{title}**; Besprechungszusammenfassung; Kernergebnisse; Themenbesprechung; Bestätigte Entscheidungen; Aufgaben (Aufgabe | Verantwortlich | Frist | Status); Offene Punkte; Wichtige Daten.""",
    "ru": """Вы профессиональный помощник по протоколам встреч. На основе очищенной расшифровки создайте точный, краткий и структурированный Markdown.

Используйте только явно указанную информацию. Различайте обсуждение, личное мнение, предложение, подтверждённое решение, задачу и требующий уточнения вопрос. Не выдавайте предложение за решение и не придумывайте ответственного или срок («Требует уточнения» или «Не указано»). Сохраняйте важные имена, организации, проекты, суммы, даты, идентификаторы и технические параметры; объединяйте одинаковые темы и опускайте нерелевантные разделы. Выводите только Markdown.

Формат: # **{title}**; Резюме встречи; Ключевые выводы; Обсуждение тем; Подтверждённые решения; Задачи (Задача | Ответственный | Срок | Статус); Вопросы к уточнению; Ключевые данные.""",
}


def summary_prompt(transcript, title, language):
    """构建基于规则过滤转录的 Markdown 纪要 prompt。"""
    if language == "zh":
        instructions = """你是一名专业的会议纪要助手。请根据以下已规则过滤的会议转录，生成准确、详实、结构化的 Markdown 会议纪要。纪要应尽可能完整地保留会议中的信息量，宁可详细也不要遗漏要点。

要求：

1. 只能使用输入中明确出现的信息，不得补充或猜测。
2. 区分讨论、个人观点、建议、已确认决定、行动项和待确认事项。
3. 不得把建议或暂定方案写成最终决定。
4. 不得为行动项编造负责人或截止时间；未明确时写“待确认”或“未明确”。
5. 保留重要的人名、公司名、项目名、金额、日期、编号和技术参数。
6. 每个议题都要充分展开：完整记录讨论背景、各方观点与理由、提出的方案、达成或未达成的共识，以及分歧点。相同议题合并整理，但不要为了简短而丢失细节。
7. 覆盖会议中出现的全部实质性议题，不要只挑选少数几个。逐句复述之外的信息（背景、论据、举例、数据）都应保留在相应议题下。
8. 没有相关内容的章节可以省略。
9. 只输出 Markdown，不输出解释或 JSON。

输出格式：

# **{title}**

## **会议摘要**

用一到两段话概括会议目的、主要讨论内容、结果和下一步，覆盖会议的整体脉络。

## **核心结论**

- 逐条列出重要结论，每条可附一句简要说明。
- 没有明确结论时写“本次会议未形成最终结论”。

## **议题讨论**

### **议题名称**

- 主要讨论：完整叙述该议题下的讨论过程、各方观点与理由、举例和相关数据。
- 当前结论：
- 风险或限制：
- 待确认：

（为每个实质性议题重复以上结构。）

## **已确认决定**

- 决定：
- 确认方：
- 说明：

没有明确决定时写“无明确决定”。

## **行动项**

| **任务** | **负责人** | **截止时间** | **状态** |
| -------- | ---------- | ------------ | -------- |
|          |            |              |          |

没有明确行动项时写“无明确行动项”。

## **待确认事项**

- 列出尚未解决或需要进一步确认的问题，并说明其背景。

## **关键数据**

- 列出重要日期、金额、数量、版本号、项目编号或技术参数。""".format(title=title)
    else:
        instructions = SUMMARY_PROMPTS.get(language, SUMMARY_PROMPTS["en"]).format(title=title)
    return f"{instructions}\n\nDo not reveal reasoning or a thinking process. Begin directly with the requested Markdown.\n\n<transcript>\n{transcript}\n</transcript>"


class LLMWorkerMixin:
    def _complete(self, payload, prompt):
        """将补全路由到内置 llama sidecar 或 HTTP 端点。

        提供商 ``Built-in`` 通过 llama sidecar 在本地运行；其他提供商通过共享的
        HTTP 客户端接口（``self.llm_complete``）。
        """
        if (payload.get("provider") or "").lower() in {"built-in", "builtin"}:
            return self.llama_sidecar_complete(payload, prompt)
        return self.llm_complete(payload, prompt)

    @managed_task("summary.generate")
    def summarize(self, payload, control=None):
        """基于已规则过滤的逐字稿生成 Markdown 纪要。

        Args:
            payload: 会议和模型连接信息，``consent`` 必须明确为真。

        Returns:
            保存为 ``markdown`` 字段的纪要字典。
        """
        require(payload, "meeting_id", "provider", "model", "consent")
        # Built-in 在本地运行捆绑的 GGUF；只有远程提供商需要端点。
        if (payload.get("provider") or "").lower() not in {"built-in", "builtin"}:
            require(payload, "endpoint")
        if not payload["consent"]:
            raise ValueError("Transcript sharing was not confirmed")
        meeting = self.store.get_meeting(payload["meeting_id"])
        self.emit(
            "summary.started",
            {
                "meeting_id": meeting["id"],
                "completed": 10,
                "total": 100,
                "stage": "summary.prepare",
            },
        )
        segments = latest_segments(meeting["segments"])
        transcript = "\n".join(
            f"{item['id']} [{clock(item['start_ms'])}] {item['speaker_name']}: {item['text']}"
            for item in segments
            if str(item.get("text") or "").strip()
        )
        if not transcript:
            raise ValueError("No transcript text is available for meeting notes")
        language = payload.get("language", "en")
        try:
            self.wait_task(control)
            self.emit(
                "summary.progress",
                {
                    "meeting_id": meeting["id"],
                    "completed": 60,
                    "total": 100,
                    "stage": "summary.generating",
                },
            )
            markdown = self._complete(
                payload, summary_prompt(transcript, meeting["title"], language)
            ).strip()
            if not markdown:
                raise ValueError("Summary response was empty")
        except Exception as error:
            self.store.save_summary(meeting["id"], None, locals().get("markdown", str(error)))
            raise ValueError(f"Summary response was saved but could not be generated: {error}") from error
        data = {"markdown": markdown}
        self.store.save_summary(meeting["id"], data, markdown)
        self.emit(
            "summary.progress",
            {
                "meeting_id": meeting["id"],
                "completed": 100,
                "total": 100,
                "stage": "summary.saving",
            },
        )
        self.emit("summary.ready", {"meeting_id": meeting["id"], "summary": data})
        return data

    def translate(self, payload):
        """翻译一个已落库段落，并把结果写回所有同 ID 版本。

        Returns:
            可直接作为 ``translation.ready`` 事件发送的字典。
        """
        require(
            payload,
            "meeting_id",
            "segment_id",
            "target_language",
            "consent",
        )
        if not payload["consent"]:
            raise ValueError("Transcript sharing was not confirmed")
        meeting = self.store.get_meeting(payload["meeting_id"])
        segment = next(
            (
                item
                for item in meeting["segments"]
                if item["id"] == payload["segment_id"]
            ),
            None,
        )
        # 最终事件可能在重叠任务提交其段落之前到达渲染器；保留该事件而不是丢弃翻译。
        if not segment and payload.get("segment"):
            self.store.save_segment(
                {
                    "meeting_id": meeting["id"],
                    "segment_id": payload["segment_id"],
                    **payload["segment"],
                }
            )
            meeting = self.store.get_meeting(meeting["id"])
            segment = next(
                (
                    item
                    for item in meeting["segments"]
                    if item["id"] == payload["segment_id"]
                ),
                None,
            )
        if not segment:
            raise ValueError("Transcript segment not found")
        target = LANGUAGE_NAMES.get(payload["target_language"], payload["target_language"])
        prompt = (
            f"Translate the following text into {target}. "
            f"Output only the translation, with no explanations.\n\n{segment['text']}"
        )
        translation = self.llama_generate(
            "translation",
            TRANSLATION_MODEL_ID,
            prompt,
            max_tokens=512,
            context_size=4096,
            temperature=0.3,
            stop_tokens=["<|im_end|>", "<|endoftext|>"],
        ).strip()
        self.store.save_translation(meeting["id"], segment["id"], translation)
        event = {
            "meeting_id": meeting["id"],
            "segment_id": segment["id"],
            "translation": translation,
        }
        self.emit("translation.ready", event)
        return event
