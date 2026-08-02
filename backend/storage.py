"""Stable storage facade composed from focused repositories."""

from .store_audio import AudioStoreMixin
from .store_base import StoreBase
from .store_maintenance import MaintenanceStoreMixin
from .store_meetings import MeetingStoreMixin
from .store_speakers import SpeakerProfileStoreMixin
from .store_transcripts import TranscriptStoreMixin


class Store(
    MeetingStoreMixin,
    TranscriptStoreMixin,
    SpeakerProfileStoreMixin,
    AudioStoreMixin,
    MaintenanceStoreMixin,
    StoreBase,
):
    """Public storage API; behavior lives in responsibility-specific components."""
