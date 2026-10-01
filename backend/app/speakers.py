"""Keep provider-local speaker estimates from becoming invented identities."""

from typing import Any


class StreamSpeakerIds:
    """A new provider connection must not reuse an earlier recording's IDs.

    There is no acoustic evidence that speaker 1 on a resumed connection is
    speaker 1 from the previous connection. Allocate new IDs; retain the raw
    provider ID for an eventual acoustic or human reconciliation.
    """

    def __init__(self, previous_tokens: list[dict[str, Any]], recording: int):
        previous_ids = [str(t.get("speaker")) for t in previous_tokens if t.get("speaker") is not None]
        self.offset = max((int(s) for s in previous_ids if s.isdecimal()), default=0)
        self.resumed = bool(previous_ids)
        self.recording = recording
        self.mapping: dict[str, str] = {}

    def apply(self, tokens: list[dict[str, Any]]) -> list[dict[str, Any]]:
        result = []
        for raw in tokens:
            token = {**raw, "recording_segment": self.recording}
            speaker = raw.get("speaker")
            if speaker is not None and str(speaker).strip():
                key = str(speaker)
                token["provider_speaker"] = key
                if key not in self.mapping:
                    # Preserve first-recording IDs and existing saved keys.
                    self.mapping[key] = key if not self.resumed else str(self.offset + len(self.mapping) + 1)
                token["speaker"] = self.mapping[key]
            else:
                token["speaker"] = None
            result.append(token)
        return result
