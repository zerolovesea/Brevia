"""工作区管理存储组件。"""

from uuid import uuid4

from .store_base import utc_now


class WorkspaceStoreMixin:
    """工作区相关的存储操作。"""

    def list_workspaces(self):
        """列出所有工作区及其会议数量。

        Returns:
            按 position 排序的工作区列表，每个工作区包含会议数量。
        """
        with self.connect() as db:
            rows = db.execute(
                """SELECT w.*,
                   (SELECT COUNT(*) FROM meetings m
                    WHERE m.workspace_id = w.id AND m.deleted_at IS NULL) as meeting_count
                   FROM workspaces w
                   WHERE w.deleted_at IS NULL
                   ORDER BY w.position, w.created_at"""
            ).fetchall()
        return [dict(row) for row in rows]

    def get_workspace(self, workspace_id):
        """获取单个工作区详情。

        Args:
            workspace_id: 工作区 ID。

        Returns:
            工作区字典，包含会议数量；不存在时返回 None。
        """
        with self.connect() as db:
            row = db.execute(
                """SELECT w.*,
                   (SELECT COUNT(*) FROM meetings m
                    WHERE m.workspace_id = w.id AND m.deleted_at IS NULL) as meeting_count
                   FROM workspaces w
                   WHERE w.id = ? AND w.deleted_at IS NULL""",
                (workspace_id,),
            ).fetchone()
        return dict(row) if row else None

    def create_workspace(self, payload):
        """创建新工作区；同名工作区若已被软删除则直接恢复。

        Args:
            payload: 包含 name 与可选 description 的字典。

        Returns:
            创建或恢复的工作区字典。

        Raises:
            ValueError: 工作区名称已存在且未被删除。
        """
        name = payload["name"].strip()
        description = payload.get("description", "").strip()
        now = utc_now()

        with self.connect() as db:
            existing = db.execute(
                "SELECT id, deleted_at FROM workspaces WHERE name = ? COLLATE NOCASE",
                (name,),
            ).fetchone()
            if existing:
                if existing["deleted_at"] is None:
                    raise ValueError(f"Workspace '{name}' already exists")
                db.execute(
                    "UPDATE workspaces SET deleted_at = NULL, updated_at = ? WHERE id = ?",
                    (now, existing["id"]),
                )
                return self.get_workspace(existing["id"])

            max_pos = db.execute(
                "SELECT MAX(position) as max_pos FROM workspaces"
            ).fetchone()
            position = (max_pos["max_pos"] or -1) + 1
            workspace_id = str(uuid4())
            db.execute(
                """INSERT INTO workspaces (id, name, description, position, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (workspace_id, name, description, position, now, now),
            )

        return self.get_workspace(workspace_id)

    def update_workspace(self, workspace_id, updates):
        """更新工作区信息。

        Args:
            workspace_id: 工作区 ID。
            updates: 包含要更新的字段的字典 (name, description)。

        Returns:
            更新后的工作区字典。

        Raises:
            ValueError: 工作区不存在或新名称已被使用。
        """
        with self.connect() as db:
            existing = db.execute(
                "SELECT id FROM workspaces WHERE id = ?", (workspace_id,)
            ).fetchone()
            if not existing:
                raise ValueError(f"Workspace '{workspace_id}' not found")

            set_clauses = []
            params = []

            if "name" in updates:
                name = updates["name"].strip()
                conflict = db.execute(
                    "SELECT id FROM workspaces WHERE name = ? COLLATE NOCASE AND id != ?",
                    (name, workspace_id),
                ).fetchone()
                if conflict:
                    raise ValueError(f"Workspace name '{name}' already exists")
                set_clauses.append("name = ?")
                params.append(name)

            if "description" in updates:
                set_clauses.append("description = ?")
                params.append(updates["description"].strip())

            if set_clauses:
                set_clauses.append("updated_at = ?")
                params.append(utc_now())
                params.append(workspace_id)
                db.execute(
                    f"UPDATE workspaces SET {', '.join(set_clauses)} WHERE id = ?",
                    params,
                )

        return self.get_workspace(workspace_id)

    def delete_workspace(self, workspace_id):
        """软删除工作区，并将其中的会议移至最近删除。

        保留原工作区记录，恢复会议时可还原归属。

        Args:
            workspace_id: 工作区 ID。

        Raises:
            ValueError: 工作区不存在。
        """
        with self.connect() as db:
            existing = db.execute(
                "SELECT id FROM workspaces WHERE id = ?", (workspace_id,)
            ).fetchone()
            if not existing:
                raise ValueError(f"Workspace '{workspace_id}' not found")

            db.execute(
                "UPDATE meetings SET deleted_at = ?, previous_workspace_id = workspace_id, workspace_id = NULL "
                "WHERE workspace_id = ? AND deleted_at IS NULL",
                (utc_now(), workspace_id),
            )
            db.execute(
                "UPDATE workspaces SET deleted_at = ? WHERE id = ?",
                (utc_now(), workspace_id),
            )

    def reorder_workspaces(self, workspace_ids):
        """按给定顺序更新工作区排序。

        Args:
            workspace_ids: 按新顺序排列的工作区 ID 列表。
        """
        with self.connect() as db:
            for position, workspace_id in enumerate(workspace_ids):
                db.execute(
                    "UPDATE workspaces SET position = ?, updated_at = ? WHERE id = ?",
                    (position, utc_now(), workspace_id),
                )

    def assign_meeting_to_workspace(self, meeting_id, workspace_id):
        """将会议分配到工作区。

        Args:
            meeting_id: 会议 ID。
            workspace_id: 工作区 ID，空字符串表示公开工作区。

        Raises:
            ValueError: 会议或工作区不存在。
        """
        with self.connect() as db:
            meeting = db.execute(
                "SELECT id FROM meetings WHERE id = ?", (meeting_id,)
            ).fetchone()
            if not meeting:
                raise ValueError(f"Meeting '{meeting_id}' not found")

            if workspace_id:
                workspace = db.execute(
                    "SELECT id FROM workspaces WHERE id = ? AND deleted_at IS NULL",
                    (workspace_id,),
                ).fetchone()
                if not workspace:
                    raise ValueError(f"Workspace '{workspace_id}' not found")

            db.execute(
                "UPDATE meetings SET workspace_id = ? WHERE id = ?",
                (workspace_id or None, meeting_id),
            )
