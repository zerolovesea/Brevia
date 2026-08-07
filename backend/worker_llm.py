"""Focused worker responsibility component."""

from .transcript import clock, latest_segments
from .worker_common import managed_task, require


CLEANING_PROMPTS = {
    "en": """You are a meeting transcript editor. Clean the ASR transcript below into readable, faithful Markdown.

1. Remove filler words, obvious repetitions, and spoken self-corrections.
2. Repair punctuation, sentence boundaries, and clear recognition errors.
3. Keep speakers, timestamps, and all meaningful information.
4. Do not summarize, substantially compress, or change meaning.
5. Do not guess names, organizations, products, amounts, dates, IDs, or technical parameters.
6. Keep uncertain content and mark it as [uncertain].
7. Do not turn suggestions into decisions or personal opinions into consensus.
8. Merge adjacent turns from the same speaker while preserving their timestamp range.
9. Output only cleaned Markdown; no explanation or JSON.""",
    "es": """Eres editor de transcripciones de reuniones. Limpia la siguiente transcripción ASR y devuelve Markdown legible y fiel.

1. Elimina muletillas, repeticiones evidentes y autocorrecciones orales.
2. Corrige puntuación, frases y errores claros de reconocimiento.
3. Conserva hablantes, marcas de tiempo e información válida.
4. No resumas, comprimas de forma sustancial ni cambies el significado.
5. No adivines nombres, organizaciones, productos, importes, fechas, IDs ni parámetros técnicos.
6. Conserva lo incierto y márcalo como [incierto].
7. No conviertas sugerencias en decisiones ni opiniones en consenso.
8. Une intervenciones adyacentes del mismo hablante manteniendo su rango temporal.
9. Devuelve solo Markdown limpio, sin explicación ni JSON.""",
    "ja": """あなたは会議文字起こしの編集者です。以下の ASR 文字起こしを、読みやすく原意に忠実な Markdown に整えてください。

1. 無意味な言いよどみ、明らかな重複、口頭での言い直しを削除します。
2. 句読点、文の区切り、明白な認識誤りを修正します。
3. 話者、タイムスタンプ、有効な情報をすべて残します。
4. 要約・大幅な圧縮・意味の変更は禁止です。
5. 人名、組織名、製品名、金額、日付、番号、技術パラメータを推測しません。
6. 不確かな内容は原文を残し [不確か] と示します。
7. 提案を決定に、個人意見を合意に変えません。
8. 同一話者の連続発話を時間範囲を保って統合します。
9. 整理済み Markdown のみを出力し、説明や JSON は出力しません。""",
    "ko": """당신은 회의 전사 편집자입니다. 다음 ASR 전사를 읽기 쉽고 원문에 충실한 Markdown으로 정리하세요.

1. 군더더기, 명백한 반복, 말로 한 자기수정을 제거합니다.
2. 문장부호, 문장 경계, 명백한 인식 오류를 수정합니다.
3. 화자, 타임스탬프, 유효한 정보를 모두 보존합니다.
4. 요약, 과도한 축약, 의미 변경을 하지 않습니다.
5. 이름, 조직, 제품, 금액, 날짜, ID, 기술 매개변수를 추측하지 않습니다.
6. 불확실한 내용은 원문을 보존하고 [불확실]로 표시합니다.
7. 제안을 결정으로, 개인 의견을 합의로 바꾸지 않습니다.
8. 같은 화자의 인접 발화를 시간 범위를 보존해 합칩니다.
9. 정리된 Markdown만 출력하고 설명이나 JSON은 출력하지 않습니다.""",
    "fr": """Vous êtes éditeur de transcriptions de réunion. Nettoyez la transcription ASR suivante en Markdown lisible et fidèle.

1. Supprimez les tics de langage, répétitions évidentes et autocorrections orales.
2. Corrigez la ponctuation, les phrases et les erreurs de reconnaissance manifestes.
3. Conservez intervenants, horodatages et toutes les informations utiles.
4. Ne résumez pas, ne compressez pas fortement et ne modifiez pas le sens.
5. Ne devinez pas noms, organisations, produits, montants, dates, identifiants ou paramètres techniques.
6. Gardez les éléments incertains et marquez-les [incertain].
7. Ne transformez ni suggestions en décisions ni opinions en consensus.
8. Fusionnez les tours adjacents du même intervenant en conservant leur plage horaire.
9. Retournez uniquement le Markdown nettoyé, sans explication ni JSON.""",
    "de": """Sie sind Redakteur für Besprechungstranskripte. Bereinigen Sie das folgende ASR-Transkript als gut lesbares, sinngetreues Markdown.

1. Entfernen Sie Füllwörter, offensichtliche Wiederholungen und mündliche Selbstkorrekturen.
2. Korrigieren Sie Zeichensetzung, Satzgrenzen und klare Erkennungsfehler.
3. Behalten Sie Sprecher, Zeitstempel und alle relevanten Informationen bei.
4. Fassen Sie nicht zusammen, kürzen Sie nicht wesentlich und ändern Sie keine Bedeutung.
5. Raten Sie keine Namen, Organisationen, Produkte, Beträge, Daten, IDs oder technischen Parameter.
6. Belassen Sie Unsicheres und kennzeichnen Sie es mit [unsicher].
7. Machen Sie aus Vorschlägen keine Entscheidungen und aus Meinungen keinen Konsens.
8. Führen Sie benachbarte Beiträge desselben Sprechers unter Erhalt des Zeitbereichs zusammen.
9. Geben Sie nur bereinigtes Markdown aus, keine Erklärung und kein JSON.""",
    "ru": """Вы редактор расшифровок встреч. Очистите следующую ASR-расшифровку и верните читаемый Markdown без искажения смысла.

1. Удалите слова-паразиты, очевидные повторы и устные самоисправления.
2. Исправьте пунктуацию, границы предложений и явные ошибки распознавания.
3. Сохраните говорящих, временные метки и всю значимую информацию.
4. Не обобщайте, не сокращайте существенно и не меняйте смысл.
5. Не угадывайте имена, организации, продукты, суммы, даты, идентификаторы или технические параметры.
6. Сохраните неясное и пометьте [неуверенно].
7. Не превращайте предложения в решения и личные мнения в консенсус.
8. Объединяйте соседние реплики одного говорящего, сохраняя их временной диапазон.
9. Выводите только очищенный Markdown, без объяснений и JSON.""",
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


def cleaning_prompt(transcript, language):
    """Build the fixed first-pass prompt in the selected UI language."""
    if language == "zh":
        instructions = """你是一名会议转录编辑。请清理以下 ASR 转录，输出易读、忠于原意的 Markdown。

要求：

1. 删除无意义语气词、明显重复和口头自我修正。
2. 修正标点、断句和明显的普通识别错误。
3. 保留说话人、时间戳和全部有效信息。
4. 不总结，不大幅压缩，不改变原意。
5. 不猜测人名、公司名、产品名、金额、日期、编号或技术参数。
6. 无法确认的内容保留原文，并标记为 [不确定]。
7. 不把建议改成决定，不把个人观点改成会议共识。
8. 合并相邻同一说话人的连续内容，并保留其时间范围。
9. 只输出清洗后的 Markdown，不输出解释或 JSON。"""
    else:
        instructions = CLEANING_PROMPTS.get(language, CLEANING_PROMPTS["en"])
    return f"{instructions}\n\n<transcript>\n{transcript}\n</transcript>"


def summary_prompt(transcript, title, language):
    """Build the fixed second-pass Markdown-notes prompt."""
    if language == "zh":
        instructions = """你是一名专业的会议纪要助手。请根据以下清洗后的会议转录，生成准确、详实、结构化的 Markdown 会议纪要。纪要应尽可能完整地保留会议中的信息量，宁可详细也不要遗漏要点。

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
    return f"{instructions}\n\n<transcript>\n{transcript}\n</transcript>"


class LLMWorkerMixin:
    @managed_task("summary.generate")
    def summarize(self, payload, control=None):
        """两次调用 LLM 清洗逐字稿并生成 Markdown 纪要。

        Args:
            payload: 会议和模型连接信息，``consent`` 必须明确为真。

        Returns:
            保存为 ``markdown`` 字段的纪要字典。
        """
        require(payload, "meeting_id", "provider", "endpoint", "model", "consent")
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
        )
        language = payload.get("language", "en")
        previous = (meeting.get("summary") or {}).get("data") or {}
        cleaned_transcript = previous.get("cleaned_transcript", "")
        # A pre-guard release stored an Anthropic tool response as the cleaned
        # transcript. It is not a usable cleanup result and must be regenerated.
        if cleaned_transcript.lstrip().startswith('{"content":'):
            cleaned_transcript = ""
        try:
            if not cleaned_transcript:
                self.wait_task(control)
                self.emit(
                    "summary.progress",
                    {
                        "meeting_id": meeting["id"],
                        "completed": 20,
                        "total": 100,
                        "stage": "summary.cleaning",
                    },
                )
                cleaned_transcript = self.llm_complete(
                    payload, cleaning_prompt(transcript, language)
                ).strip()
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
            markdown = self.llm_complete(
                payload, summary_prompt(cleaned_transcript, meeting["title"], language)
            ).strip()
            if not markdown:
                raise ValueError("Summary response was empty")
        except Exception as error:
            raw = locals().get("markdown", locals().get("cleaned_transcript", str(error)))
            self.store.save_summary(
                meeting["id"],
                {**previous, **({"cleaned_transcript": cleaned_transcript} if cleaned_transcript else {})} or None,
                raw,
            )
            raise ValueError(f"Summary response was saved but could not be generated: {error}") from error
        data = {"markdown": markdown, "cleaned_transcript": cleaned_transcript}
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
            "endpoint",
            "model",
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
        # The final event can reach the renderer before an overlapping task has
        # committed its segment; preserve that event instead of dropping translation.
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
        translation = self.llm_complete(
            payload,
            f"Translate the following text to {payload['target_language']}. "
            f"Return only the translation.\n\n{segment['text']}",
        ).strip()
        self.store.save_translation(meeting["id"], segment["id"], translation)
        event = {
            "meeting_id": meeting["id"],
            "segment_id": segment["id"],
            "translation": translation,
        }
        self.emit("translation.ready", event)
        return event
