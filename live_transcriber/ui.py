"""
Rich-based terminal UI for the negotiation assistant.
Terminal-native keyboard controls (only when terminal is focused).
"""

import sys
import select
import threading
import time
import tty
import termios
from typing import Optional, Union
from queue import Queue, Empty

from rich.console import Console, Group
from rich.panel import Panel
from rich.table import Table
from rich.text import Text
from rich.live import Live

from .session import Session
from .transcription import Transcriber
from .languages import get_language_flag
from .japanese import to_romaji

# Display settings (phrase-based: each phrase is one row in the transcript table)
# Minimum live-view phrase count; the real count scales with terminal height so
# the transcript panel fills the available space.
MIN_LIVE_VIEW_PHRASES = 6
# Rough lines-per-phrase used to translate terminal height into a phrase count
# (one row of text per language + a blank padding row).
LIVE_PHRASE_LINES = 3
SCROLL_PAGE_SIZE = 16
UI_REFRESH_RATE = 4  # Hz
KEY_POLL_INTERVAL = 0.05  # seconds
MAIN_LOOP_INTERVAL = 0.1  # seconds
AUTOSAVE_INTERVAL = 2.0  # seconds between background flushes of session_state.json

# Christmas colors (matching language_selector.py)
CHRISTMAS_GREEN = "#165b33"
CHRISTMAS_GOLD = "#d4af37"
CHRISTMAS_RED = "#c41e3a"

# Language colors organized by linguistic family/region
# Each family uses a spectrum of related colors for better differentiation
# English is always light grey; target language rendered white
LANGUAGE_COLORS = {
    # === ENGLISH (neutral grey) ===
    "en": "#b0b0b0",

    # === GERMANIC (ice/winter spectrum: steel → sky → silver → pale cyan) ===
    "de": "#4682b4",         # German - steel blue (darker, distinctive)
    "nl": "#7ec8e3",         # Dutch - sky blue
    "da": "#a8c8dc",         # Danish - pale steel
    "no": "#5cacee",         # Norwegian - cornflower
    "sv": "#b8d4e8",         # Swedish - ice blue

    # === ROMANCE (warm sunset spectrum: gold → amber → coral → rose → blush) ===
    "es": "#ffd700",         # Spanish - pure gold (bright, distinct)
    "fr": "#ff6b6b",         # French - coral red (stands out)
    "it": "#ffaa5e",         # Italian - warm tangerine
    "pt": "#e8b923",         # Portuguese - saffron gold
    "ro": "#db7093",         # Romanian - pale violet red (rose)
    "ca": "#ff8c42",         # Catalan - mango orange
    "gl": "#c9a227",         # Galician - antique gold

    # === EAST/WEST SLAVIC (cool purple spectrum: violet → indigo → orchid) ===
    "ru": "#9400d3",         # Russian - dark violet (bold)
    "pl": "#8a2be2",         # Polish - blue violet
    "cs": "#7b68ee",         # Czech - medium slate blue
    "sk": "#9370db",         # Slovak - medium purple
    "uk": "#ba55d3",         # Ukrainian - medium orchid

    # === SOUTH SLAVIC (warm magenta/pink spectrum: fuchsia → rose → pink) ===
    "bg": "#ff1493",         # Bulgarian - deep pink (vibrant)
    "sr": "#da70d6",         # Serbian - orchid
    "hr": "#ff69b4",         # Croatian - hot pink
    "bs": "#db7093",         # Bosnian - pale violet red
    "sl": "#dda0dd",         # Slovenian - plum
    "mk": "#ee82ee",         # Macedonian - violet

    # === BALTIC & FINNO-UGRIC (aquatic spectrum: teal → cyan → mint → seafoam) ===
    "lt": "#00ced1",         # Lithuanian - dark turquoise
    "lv": "#20b2aa",         # Latvian - light sea green
    "et": "#48d1cc",         # Estonian - medium turquoise
    "fi": "#66cdaa",         # Finnish - medium aquamarine (greener)
    "hu": "#40e0d0",         # Hungarian - turquoise (brighter)

    # === GREEK & BASQUE (unique isolates - truly distinct colors) ===
    "el": "#2e8b57",         # Greek - sea green (Mediterranean, darker than tropicals)
    "eu": "#ffea00",         # Basque - electric yellow (completely unique)

    # === MIDDLE EASTERN & TURKIC (jewel tones: sapphire → indigo → teal → jade) ===
    "ar": "#4169e1",         # Arabic - royal blue
    "he": "#6a5acd",         # Hebrew - slate blue
    "fa": "#008b8b",         # Persian - dark cyan (distinct)
    "tr": "#1e90ff",         # Turkish - dodger blue
    "ur": "#5f9ea0",         # Urdu - cadet blue

    # === SOUTH ASIAN (vibrant warm: coral → tangerine → peach → apricot → pink) ===
    "hi": "#ff6347",         # Hindi - tomato (bright)
    "gu": "#ff8c00",         # Gujarati - dark orange
    "mr": "#ffa07a",         # Marathi - light salmon
    "pa": "#f08080",         # Punjabi - light coral
    "ta": "#ff7256",         # Tamil - coral (distinct)
    "te": "#e9967a",         # Telugu - dark salmon
    "ml": "#ff69b4",         # Malayalam - hot pink (stands out)

    # === EAST ASIAN (red/crimson spectrum with more spread) ===
    "zh": "#dc143c",         # Chinese - crimson
    "ja": "#ff4500",         # Japanese - orange red (distinct)
    "ko": "#c71585",         # Korean - medium violet red (purple-red)

    # === SOUTHEAST ASIAN (tropical greens: lime → emerald → jade → chartreuse) ===
    "vi": "#32cd32",         # Vietnamese - lime green (vivid)
    "th": "#98fb98",         # Thai - pale green
    "id": "#3cb371",         # Indonesian - medium sea green (richer)
    "ms": "#00fa9a",         # Malay - medium spring green
    "tl": "#7fff00",         # Tagalog - chartreuse (yellow-green)
}
DEFAULT_LANGUAGE_COLOR = "#d4af37"  # Gold fallback

# Speaker emoji + color pairs for differentiation (high contrast colors)
# Each speaker gets a unique emoji AND color for easy identification
SPEAKER_STYLES = [
    ("🎄", "#98fb98"),  # Christmas tree - pale green
    ("🎅", "#ff6b6b"),  # Santa - coral red
    ("✨", "#ffd700"),  # Star - gold
    ("🎁", "#ff69b4"),  # Gift box - hot pink
    ("🔔", "#ffb347"),  # Bell - pastel orange
    ("🕯️", "#dda0dd"),  # Candle - plum
    ("🧦", "#87ceeb"),  # Stocking - sky blue
    ("🍪", "#deb887"),  # Cookie - burlywood
    ("☃️", "#e0ffff"),  # Snowman - light cyan
    ("❄️", "#b0e0e6"),  # Snowflake - powder blue
    ("🦌", "#cd853f"),  # Reindeer - peru
    ("👵", "#f0e68c"),  # Grandma - khaki
    ("🎀", "#ffb6c1"),  # Ribbon - light pink
    ("🧣", "#20b2aa"),  # Scarf - light sea green
]

# Language flags are now handled by the languages module


class LiveTranscriptUI:
    """Rich-based terminal UI for live transcription with real-time keyboard controls."""
    
    def __init__(
        self,
        session: Session,
        transcriber: Transcriber,
    ):
        self.session = session
        self.transcriber = transcriber
        self.console = Console()
        
        self._running = threading.Event()
        self._non_final_tokens: list[dict] = []

        # Per-speaker language tracking (for detecting language changes)
        self._speaker_last_language: dict[int, str] = {}

        # Stable A/B/C labels assigned in first-seen order, independent of
        # Soniox's internal speaker IDs (which often start at 2 or 3).
        self._speaker_letters: dict[int, str] = {}

        # Status
        self._status_message = ""
        self._error_message = ""
        
        # Scroll mode
        self._scroll_mode = False
        self._scroll_offset = 0
        self._scroll_phrases: list[dict] = []
        self._scroll_total = 0
        
        # Keyboard (terminal-native, only captures when terminal focused)
        self._key_queue: Queue[str] = Queue()
        self._input_thread: Optional[threading.Thread] = None
        self._old_term_settings = None

        # Pending UI action triggered from a key handler but executed in the
        # main loop (which holds the Live reference needed to suspend output).
        self._rename_requested = False
    
    def _read_key(self) -> Optional[str]:
        """Read a single key from terminal (non-blocking)."""
        if select.select([sys.stdin], [], [], 0)[0]:
            ch = sys.stdin.read(1)
            if ch == '\x1b':  # Escape sequence
                if select.select([sys.stdin], [], [], 0.05)[0]:
                    ch2 = sys.stdin.read(1)
                    if ch2 == '[':
                        if select.select([sys.stdin], [], [], 0.05)[0]:
                            ch3 = sys.stdin.read(1)
                            if ch3 == 'A':
                                return 'UP'
                            elif ch3 == 'B':
                                return 'DOWN'
                            elif ch3 == '5':
                                sys.stdin.read(1)  # consume ~
                                return 'PAGEUP'
                            elif ch3 == '6':
                                sys.stdin.read(1)  # consume ~
                                return 'PAGEDOWN'
                return 'ESC'
            return ch.lower()
        return None
    
    def _input_thread_func(self) -> None:
        """Background thread to read terminal input."""
        while self._running.is_set():
            try:
                key = self._read_key()
                if key:
                    self._key_queue.put(key)
                else:
                    time.sleep(KEY_POLL_INTERVAL)
            except (OSError, termios.error):
                time.sleep(MAIN_LOOP_INTERVAL)

    def _start_keyboard_listener(self) -> None:
        """Start terminal keyboard listener."""
        try:
            # Set terminal to raw mode (no echo, char-by-char input)
            self._old_term_settings = termios.tcgetattr(sys.stdin)
            tty.setcbreak(sys.stdin.fileno())

            self._input_thread = threading.Thread(target=self._input_thread_func, daemon=True)
            self._input_thread.start()
        except (OSError, termios.error):
            pass

    def _stop_keyboard_listener(self) -> None:
        """Restore terminal settings."""
        if self._old_term_settings:
            try:
                termios.tcsetattr(sys.stdin, termios.TCSADRAIN, self._old_term_settings)
            except (OSError, termios.error):
                pass
    
    def _handle_key(self, key: str) -> None:
        """Handle a key press."""
        if self._scroll_mode:
            self._handle_scroll_key(key)
        else:
            self._handle_live_key(key)
    
    def _handle_live_key(self, key: str) -> None:
        """Handle key in live mode."""
        if key == 'v':
            self._enter_scroll_mode()
        elif key == 'r':
            # The actual prompt has to run from the main loop so it can stop
            # the Rich Live display and restore cooked terminal mode.
            self._rename_requested = True
        elif key == 'q':
            self._running.clear()
    
    def _handle_scroll_key(self, key: str) -> None:
        """Handle key in scroll mode."""
        if key in ('q', 'ESC', 'v'):
            self._exit_scroll_mode()
        elif key in ('j', 'DOWN'):
            self._scroll_down()
        elif key in ('k', 'UP'):
            self._scroll_up()
        elif key in ('d', 'PAGEDOWN'):
            self._scroll_down(SCROLL_PAGE_SIZE - 2)
        elif key in ('u', 'PAGEUP'):
            self._scroll_up(SCROLL_PAGE_SIZE - 2)
        elif key == 'g':
            self._scroll_to_top()
        elif key == 'G':
            self._scroll_to_bottom()
    
    def _enter_scroll_mode(self) -> None:
        """Enter scroll mode."""
        if not self.session.final_tokens:
            self._error_message = "No transcript yet"
            return
        self._scroll_mode = True
        self._prepare_scroll_content()
        self._scroll_offset = max(0, self._scroll_total - SCROLL_PAGE_SIZE)

    def _exit_scroll_mode(self) -> None:
        """Exit scroll mode."""
        self._scroll_mode = False

    def _prepare_scroll_content(self) -> None:
        """Refresh the phrase list used by scroll mode."""
        self._scroll_phrases = self._collect_phrases(include_non_final=False)
        self._scroll_total = len(self._scroll_phrases)

    def _scroll_up(self, n: int = 1) -> None:
        self._scroll_offset = max(0, self._scroll_offset - n)

    def _scroll_down(self, n: int = 1) -> None:
        max_off = max(0, self._scroll_total - SCROLL_PAGE_SIZE)
        self._scroll_offset = min(max_off, self._scroll_offset + n)

    def _scroll_to_top(self) -> None:
        self._scroll_offset = 0

    def _scroll_to_bottom(self) -> None:
        self._scroll_offset = max(0, self._scroll_total - SCROLL_PAGE_SIZE)
    
    def _on_tokens(self, final_tokens: list[dict], non_final_tokens: list[dict]) -> None:
        """Callback when tokens received."""
        self._non_final_tokens = non_final_tokens
    
    def _on_error(self, error: str) -> None:
        """Callback on error."""
        self._error_message = error
    
    def _on_connected(self) -> None:
        """Callback when connected."""
        self._status_message = "Listening..."
    
    def _get_speaker_style(self, speaker_id: Union[int, str]) -> tuple[str, str]:
        """Get a unique emoji + color pair for a speaker."""
        sid = int(speaker_id) if isinstance(speaker_id, str) else speaker_id
        return SPEAKER_STYLES[sid % len(SPEAKER_STYLES)]

    def _get_language_flag(self, language: str) -> str:
        """Get flag emoji or text code for a language."""
        # Languages without official country flags use text codes
        TEXT_CODES = {
            "ca": "[CAT]",  # Catalan
            "eu": "[BAS]",  # Basque
            "gl": "[GAL]",  # Galician
        }
        if language in TEXT_CODES:
            return TEXT_CODES[language]
        return get_language_flag(language)

    def _clean_display_text(self, text: str) -> str:
        """Remove internal tokens like <end> that shouldn't be displayed."""
        return text.replace("<end>", "").replace("<END>", "")

    def _collect_phrases(self, include_non_final: bool = True) -> list[dict]:
        """Walk tokens, group them into phrase records.

        In two-way translation each utterance produces tokens in both
        languages, distinguished by translation_status. A phrase tracks the
        text in each language separately so the UI can render them in
        fixed-position columns. The phrase also remembers source_lang —
        the language the speaker actually spoke — for styling.

        Phrase boundaries: speaker change, or a new original-language
        utterance after the prior one has been mirrored.
        """
        phrases: list[dict] = []
        current_speaker: Optional[Union[int, str]] = None
        current_source_lang: Optional[str] = None
        texts: dict[str, str] = {}
        seen_translation = False
        buffer_is_final = True
        show_flag_for_buffer = False

        all_tokens = list(self.session.final_tokens)
        if include_non_final:
            all_tokens = all_tokens + self._non_final_tokens

        def flush():
            nonlocal texts, buffer_is_final, show_flag_for_buffer, seen_translation
            cleaned = {
                lang: self._clean_display_text(t).strip()
                for lang, t in texts.items()
            }
            cleaned = {lang: t for lang, t in cleaned.items() if t}
            if cleaned:
                phrases.append({
                    "speaker": current_speaker,
                    "source_lang": current_source_lang,
                    "texts": cleaned,
                    "is_final": buffer_is_final,
                    "show_flag": show_flag_for_buffer,
                })
            texts = {}
            seen_translation = False
            buffer_is_final = True
            show_flag_for_buffer = False

        for token in all_tokens:
            token_text = token.get("text", "")
            speaker = token.get("speaker")
            language = token.get("language")
            is_translation = token.get("translation_status") == "translation"
            is_final = token.get("is_final", True)
            source_lang = token.get("source_language")

            # In two-way mode each utterance has two source_languages — the
            # one the speaker spoke. For non-translation tokens it's the
            # token's own language; for translation tokens it's source_language.
            utterance_source = source_lang if is_translation else language

            if speaker is not None and speaker != current_speaker:
                flush()
                current_speaker = speaker
                current_source_lang = utterance_source
                show_flag_for_buffer = True
                token_text = token_text.lstrip()

            # A new original-language utterance after we've already collected
            # a translation for the previous phrase = phrase boundary.
            if (
                not is_translation
                and seen_translation
                and utterance_source
                and current_source_lang
                and utterance_source == current_source_lang
            ):
                flush()
                current_source_lang = utterance_source
                show_flag_for_buffer = True

            # Original-language switched (different speaker line interpreted
            # as the same speaker by diarization, or genuine code switch).
            if (
                not is_translation
                and utterance_source
                and current_source_lang
                and utterance_source != current_source_lang
            ):
                flush()
                current_source_lang = utterance_source
                show_flag_for_buffer = True

            if current_source_lang is None:
                current_source_lang = utterance_source

            if not is_final:
                buffer_is_final = False

            if language:
                texts[language] = texts.get(language, "") + token_text
            if is_translation:
                seen_translation = True

        flush()
        return phrases

    def _phrase_speaker_color(self, speaker: Optional[Union[int, str]]) -> str:
        if speaker is None:
            return DEFAULT_LANGUAGE_COLOR
        _, color = self._get_speaker_style(speaker)
        return color

    def _speaker_letter(self, speaker: Optional[Union[int, str]]) -> Optional[str]:
        """Stable letter label (A, B, C, ...) by first-seen order. Falls
        back to a numeric tag once we exhaust the alphabet."""
        if speaker is None:
            return None
        sid = int(speaker) if isinstance(speaker, str) else speaker
        if sid not in self._speaker_letters:
            idx = len(self._speaker_letters)
            if idx < 26:
                self._speaker_letters[sid] = chr(ord("A") + idx)
            else:
                self._speaker_letters[sid] = f"#{idx + 1}"
        return self._speaker_letters[sid]

    def _render_phrases_text(self, phrases: list[dict]) -> Table:
        """Render phrases as a 2-column table, fixed-position by language.

        Column order follows session.source_languages: the first language
        is always the left column, the second is always the right. The
        cell for the language the speaker actually spoke is styled in the
        speaker's color; the mirrored translation stays white. Romaji is
        added inline whenever a column is Japanese.
        """
        # Convention: target language (the reader's language) on the right,
        # the other source language on the left. Falls back to declared
        # order if the session is misconfigured.
        langs = list(self.session.source_languages)
        while len(langs) < 2:
            langs.append("ja" if "ja" not in langs else "en")
        target = self.session.target_language
        if target in langs:
            right_lang = target
            left_lang = next(l for l in langs if l != target)
        else:
            left_lang, right_lang = langs[0], langs[1]

        table = Table(
            show_header=False,
            show_edge=False,
            show_lines=False,
            box=None,
            padding=(0, 2, 1, 0),  # 1 blank row of padding below each phrase
            expand=True,
        )
        table.add_column(left_lang, ratio=1, overflow="fold")
        table.add_column(right_lang, ratio=1, overflow="fold")

        for ph in phrases:
            speaker = ph["speaker"]
            source_lang = ph["source_lang"]
            texts = ph["texts"]
            is_final = ph["is_final"]
            show_flag = ph["show_flag"]

            left_text = texts.get(left_lang, "")
            right_text = texts.get(right_lang, "")
            if not left_text and not right_text:
                continue

            speaker_color = self._phrase_speaker_color(speaker)

            def style_for(lang: str) -> str:
                base = speaker_color if lang == source_lang else "white"
                return base if is_final else f"dim italic {base}"

            def render_cell(lang: str, body: str) -> Text:
                cell = Text()
                if not body:
                    return cell
                if lang == source_lang:
                    letter = self._speaker_letter(speaker)
                    if letter:
                        cell.append(f"{letter} ", style=f"bold {speaker_color}")
                cell.append(body, style=style_for(lang))
                if lang == "ja":
                    romaji = to_romaji(body)
                    if romaji:
                        tint = speaker_color if lang == source_lang else "white"
                        cell.append(f"  ({romaji})", style=f"dim italic {tint}")
                if show_flag and lang == source_lang:
                    cell.append(f" {self._get_language_flag(lang)}", style="dim")
                return cell

            table.add_row(render_cell(left_lang, left_text), render_cell(right_lang, right_text))

        return table

    def _render_transcript(self) -> Text:
        """Render the full transcript as stacked phrase blocks."""
        return self._render_phrases_text(self._collect_phrases())

    def _live_view_phrase_count(self) -> int:
        """How many phrases to show in live view, sized to terminal height."""
        # Reserve: 2 panel borders + 1 footer + 1 overflow header = 4 lines.
        usable = max(LIVE_PHRASE_LINES, self.console.size.height - 4)
        return max(MIN_LIVE_VIEW_PHRASES, usable // LIVE_PHRASE_LINES)

    def _render_live_transcript(self):
        """Render the most recent phrases for the live view."""
        phrases = self._collect_phrases()
        if not phrases:
            return Text("Waiting for speech...", style="dim italic")

        capacity = self._live_view_phrase_count()
        if len(phrases) <= capacity:
            return self._render_phrases_text(phrases)

        overflow = len(phrases) - capacity
        visible = phrases[-capacity:]
        return Group(
            Text(f"↑ {overflow} more (v=scroll)", style=f"dim {CHRISTMAS_GREEN}"),
            self._render_phrases_text(visible),
        )
    
    def _render_status_bar(self) -> Text:
        """Render status bar with Christmas theme."""
        text = Text()

        if self._scroll_mode:
            text.append(" SCROLL ", style=f"black on {CHRISTMAS_RED}")
            start = self._scroll_offset + 1
            end = min(self._scroll_offset + SCROLL_PAGE_SIZE, self._scroll_total)
            text.append(f" {start}-{end}/{self._scroll_total}", style=CHRISTMAS_RED)
        else:
            text.append(" LIVE ", style=f"black on {CHRISTMAS_GREEN}")

        text.append(f" │ {self.session.name}", style="bold")
        text.append(f" │ {len(self.session.final_tokens)} tokens", style="dim")

        # Show language configuration (two-way translation pair)
        if len(self.session.source_languages) >= 2:
            pair = f"{self.session.source_languages[0]} ↔ {self.session.source_languages[1]}"
        else:
            pair = ",".join(self.session.source_languages)
        text.append(f" │ Langs: {pair}", style="dim")

        if self._error_message:
            text.append(f" │ {self._error_message}", style=CHRISTMAS_RED)
            self._error_message = ""
        elif self._status_message:
            text.append(f" │ {self._status_message}", style="dim")

        return text
    
    def _render_hotkey_bar(self) -> Text:
        """Render hotkey hints with Christmas theme."""
        text = Text()
        if self._scroll_mode:
            pairs = [("j↓k↑", "scroll"), ("du", "page"), ("gG", "ends"), ("q", "exit")]
        else:
            pairs = [("v", "scroll"), ("r", "rename"), ("q", "quit")]

        for i, (k, d) in enumerate(pairs):
            if i > 0:
                text.append("  ", style="dim")
            text.append(k, style=CHRISTMAS_GOLD)
            text.append(f"={d}", style="dim")
        return text

    def _render_footer_bar(self) -> Text:
        """Render a single clean footer line (status + hotkeys)."""
        footer = self._render_status_bar()
        footer.append(" │ ", style="dim")
        footer.append(self._render_hotkey_bar())
        return footer
    
    def _build_scroll_display(self) -> Group:
        """Build scroll display with Christmas theme."""
        header = Text("🎙 SCROLL MODE ", style=f"bold {CHRISTMAS_RED}")
        header.append("(j/k=scroll, q=exit)", style="dim")

        visible = self._scroll_phrases[
            self._scroll_offset:self._scroll_offset + SCROLL_PAGE_SIZE
        ]
        content = self._render_phrases_text(visible) if visible else Text("No content")

        return Group(
            Panel(header, style=CHRISTMAS_RED),
            Panel(content, border_style=CHRISTMAS_RED),
            self._render_footer_bar(),
        )
    
    def _prompt_rename_speaker(self, live: Live) -> None:
        """Suspend the Live display and prompt for speaker rename via stdin.

        Has to suspend Rich Live + restore cooked terminal mode, because the
        ambient setup is raw cbreak with a 4Hz repaint loop on top.
        """
        # Pause the live region so input() doesn't fight the repaint.
        live.stop()
        self._stop_keyboard_listener()
        try:
            print()
            if not self.session.speaker_profiles:
                print("  No speakers detected yet.")
                time.sleep(1.0)
                return

            print(f"  [{CHRISTMAS_GOLD}] Rename speaker [/]")
            for sid in sorted(self.session.speaker_profiles.keys()):
                profile = self.session.speaker_profiles[sid]
                tag = f" (already named)" if profile.display_name else ""
                print(f"    {sid}: {profile.get_label()}{tag}")
            raw = input("  Speaker # (blank to cancel): ").strip()
            if not raw:
                return
            try:
                sid = int(raw)
            except ValueError:
                print("  Not a number, cancelled.")
                time.sleep(0.8)
                return
            if sid not in self.session.speaker_profiles:
                print("  No such speaker, cancelled.")
                time.sleep(0.8)
                return
            new_name = input(f"  New name for speaker {sid} (blank to clear): ").strip()
            profile = self.session.get_speaker_profile(sid)
            profile.display_name = new_name or None
            try:
                self.session.save_state()
            except OSError as exc:
                print(f"  Saved to memory but failed to persist: {exc}")
                time.sleep(0.8)
        except (KeyboardInterrupt, EOFError):
            print("\n  Cancelled.")
            time.sleep(0.4)
        finally:
            self._start_keyboard_listener()
            # Clear the scrollback noise we just printed before Live takes over.
            self.console.clear()
            live.start()

    def _build_display(self) -> Group:
        """Build main display with Christmas theme."""
        if self._scroll_mode:
            return self._build_scroll_display()

        # Fill the terminal: panel takes all rows except the 1-line footer.
        panel_h = max(6, self.console.size.height - 1)

        parts = []

        # Main transcript panel
        parts.append(Panel(
            self._render_live_transcript(),
            title=f"[bold {CHRISTMAS_GREEN}]Live Transcript[/]",
            border_style=CHRISTMAS_GREEN,
            height=panel_h,
        ))

        # Status and hotkeys
        parts.append(self._render_footer_bar())

        return Group(*parts)
    
    def run(self) -> None:
        """Run the UI."""
        self._running.set()
        
        # Setup callbacks
        self.transcriber.on_tokens = self._on_tokens
        self.transcriber.on_error = self._on_error
        self.transcriber.on_connected = self._on_connected
        
        # Initial display
        self.console.clear()
        self.console.print(f"[bold {CHRISTMAS_GREEN}]🎄 Live Translator[/]")

        if self.session.was_resumed:
            info = self.session.get_resume_info()
            if info:
                self.console.print(f"[{CHRISTMAS_GOLD}]🎁 Resuming ({info['token_count']} tokens)[/]")

        self.console.print("[dim]Connecting...[/]")
        if not self.transcriber.start():
            self.console.print(f"[{CHRISTMAS_RED}]Failed to start[/]")
            return

        self.console.print(f"[{CHRISTMAS_GREEN}]✓[/] {self.transcriber.device_name}")
        self.console.print(
            f"[dim]Keys: [{CHRISTMAS_GOLD}]v[/]=scroll "
            f"[{CHRISTMAS_GOLD}]r[/]=rename [{CHRISTMAS_GOLD}]q[/]=quit[/]"
        )
        self.console.print()
        
        self._start_keyboard_listener()

        last_autosave = time.monotonic()

        try:
            with Live(self._build_display(), console=self.console, refresh_per_second=UI_REFRESH_RATE, vertical_overflow="crop") as live:
                while self._running.is_set() and self.transcriber.is_running:
                    # Process keypresses
                    try:
                        while True:
                            key = self._key_queue.get_nowait()
                            self._handle_key(key)
                    except Empty:
                        pass

                    # Update scroll content
                    if self._scroll_mode:
                        self._prepare_scroll_content()

                    # Rename flow: pulled out of the key handler so it can
                    # safely stop/restart the Live display.
                    if self._rename_requested:
                        self._rename_requested = False
                        self._prompt_rename_speaker(live)

                    live.update(self._build_display())

                    # Autosave: flush session_state.json if there are unsaved
                    # tokens and the throttle interval has elapsed. Atomic write
                    # in save_state() means a concurrent Ctrl+C is safe.
                    now = time.monotonic()
                    if self.session.is_dirty and (now - last_autosave) >= AUTOSAVE_INTERVAL:
                        try:
                            self.session.save_state()
                        except OSError:
                            # Don't crash the UI on a transient disk error;
                            # we'll try again on the next tick.
                            pass
                        last_autosave = now

                    time.sleep(MAIN_LOOP_INTERVAL)

        except KeyboardInterrupt:
            pass
        finally:
            self._stop_keyboard_listener()
            self._running.clear()
            self.transcriber.stop()

            self.console.print()
            if self.session.final_tokens:
                # Transcript state is already (or almost already) on disk
                # thanks to autosave; this final save_segment() writes the
                # snapshot files and audio. A second Ctrl+C here at worst
                # skips MP3 conversion.
                self.console.print(
                    f"[{CHRISTMAS_GOLD}]Saving...[/] "
                    f"[dim]transcript is safe; press Ctrl+C again to skip MP3 conversion[/]"
                )
                path = self.session.save_segment()
                self.console.print(f"[{CHRISTMAS_GREEN}]✓[/] {path}")
