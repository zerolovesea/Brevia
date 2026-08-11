"""由聚焦职责的存储库组合而成的稳定存储门面。"""

from .store_audio import AudioStoreMixin
from .store_base import StoreBase
from .store_maintenance import MaintenanceStoreMixin
from .store_meetings import MeetingStoreMixin
from .store_speakers import SpeakerProfileStoreMixin
from .store_transcripts import TranscriptStoreMixin
from .store_workspaces import WorkspaceStoreMixin


class Store(
    MeetingStoreMixin,
    TranscriptStoreMixin,
    SpeakerProfileStoreMixin,
    AudioStoreMixin,
    MaintenanceStoreMixin,
    WorkspaceStoreMixin,
    StoreBase,
):
    """公共存储 API；行为位于按职责划分的组件中。"""
