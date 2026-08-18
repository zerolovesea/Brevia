"""聚焦存储职责的组件。"""

import json
import shutil


class MaintenanceStoreMixin:
    def usage(self):
        """统计会议、模型与导出文件占用的字节数及其根目录。"""

        def size(root):
            """累计目录内普通文件的字节数。"""
            return sum(
                path.stat().st_size for path in root.rglob("*") if path.is_file()
            )

        return {
            "meetings": size(self.meetings_dir),
            "models": size(self.models_dir),
            "exports": sum(
                path.stat().st_size
                for path in self.meetings_dir.glob("*/exports/*")
                if path.is_file()
            ),
            "root": str(self.root),
            "models_root": str(self.models_dir),
        }

    def metrics(self, app_duration_ms=0):
        """累计本地使用时长并返回会议内容统计。"""
        with self.connect() as db:
            row = db.execute(
                "SELECT value FROM app_meta WHERE key='metrics'"
            ).fetchone()
            value = json.loads(row["value"]) if row else {"app_duration_ms": 0}
            value["app_duration_ms"] += max(0, int(app_duration_ms))
            db.execute(
                "INSERT OR REPLACE INTO app_meta(key,value) VALUES('metrics',?)",
                (json.dumps(value),),
            )
            value["meeting_duration_ms"] = db.execute(
                "SELECT COALESCE(SUM(duration_ms),0) AS total FROM meetings WHERE deleted_at IS NULL"
            ).fetchone()["total"]
            value["subtitle_count"] = db.execute(
                "SELECT COUNT(*) AS total FROM segments"
            ).fetchone()["total"]
            value["subtitle_lines"] = db.execute(
                "SELECT COALESCE(SUM(LENGTH(text)-LENGTH(REPLACE(text, char(10),''))+1),0) AS total FROM segments"
            ).fetchone()["total"]
            summaries = [
                row["data"]
                for row in db.execute(
                    "SELECT data FROM summaries WHERE data IS NOT NULL"
                )
            ]
            value["summary_count"] = len(summaries)
            value["summary_characters"] = sum(
                len(json.loads(item).get("markdown", "")) for item in summaries
            )
        return value

    def clear_storage_partition(self, partition):
        """清理一个明确的本地存储分区。"""
        if partition == "meetings":
            with self.connect() as db:
                db.execute("DELETE FROM meetings")
            shutil.rmtree(self.meetings_dir, ignore_errors=True)
            self.meetings_dir.mkdir(exist_ok=True)
        elif partition == "models":
            shutil.rmtree(self.models_dir, ignore_errors=True)
            self.models_dir.mkdir(parents=True, exist_ok=True)
        elif partition == "exports":
            for directory in self.meetings_dir.glob("*/exports"):
                shutil.rmtree(directory, ignore_errors=True)
        else:
            raise ValueError("Unknown storage partition")
        return self.usage()
