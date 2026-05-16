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
from rich.text import Text
from rich.live import Live

from .session import Session
from .transcription import Transcriber
from .languages import get_language_flag

# Display settings
LIVE_VIEW_LINES = 24
SCROLL_PAGE_SIZE = 20
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

        # Status
        self._status_message = ""
        self._error_message = ""
        
        # Scroll mode
        self._scroll_mode = False
        self._scroll_offset = 0
        self._scroll_lines: list[Text] = []
        self._scroll_total_lines = 0
        
        # Keyboard (terminal-native, only captures when terminal focused)
        self._key_queue: Queue[str] = Queue()
        self._input_thread: Optional[threading.Thread] = None
        self._old_term_settings = None
    
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
        self._scroll_offset = max(0, self._scroll_total_lines - SCROLL_PAGE_SIZE)
    
    def _exit_scroll_mode(self) -> None:
        """Exit scroll mode."""
        self._scroll_mode = False
    
    def _prepare_scroll_content(self) -> None:
        """Prepare scroll content with preserved styling."""
        full_text = self._render_transcript()
        # Rich Text.split() returns list[Text], preserving all styling
        self._scroll_lines = full_text.split("\n")
        self._scroll_total_lines = len(self._scroll_lines)
    
    def _scroll_up(self, n: int = 1) -> None:
        self._scroll_offset = max(0, self._scroll_offset - n)
    
    def _scroll_down(self, n: int = 1) -> None:
        max_off = max(0, self._scroll_total_lines - SCROLL_PAGE_SIZE)
        self._scroll_offset = min(max_off, self._scroll_offset + n)
    
    def _scroll_to_top(self) -> None:
        self._scroll_offset = 0
    
    def _scroll_to_bottom(self) -> None:
        self._scroll_offset = max(0, self._scroll_total_lines - SCROLL_PAGE_SIZE)
    
    def _on_tokens(self, final_tokens: list[dict], non_final_tokens: list[dict]) -> None:
        """Callback when tokens received."""
        self._non_final_tokens = non_final_tokens
    
    def _on_error(self, error: str) -> None:
        """Callback on error."""
        self._error_message = error
    
    def _on_connected(self) -> None:
        """Callback when connected."""
        self._status_message = "Listening..."
    
    def _render_transcript_plain(self) -> str:
        """Render transcript as plain text with parenthetical translations."""
        parts: list[str] = []
        current_speaker: Optional[int] = None

        # Buffers for accumulating original + translation pairs
        original_buffer = ""
        translation_buffer = ""

        for token in self.session.final_tokens:
            text = token.get("text", "")
            speaker = token.get("speaker")
            is_translation = token.get("translation_status") == "translation"
            source_lang = token.get("source_language")

            # Skip translations when source language equals target language
            if is_translation and source_lang == self.session.target_language:
                continue

            # Speaker changed - flush buffers, start new paragraph
            if speaker is not None and speaker != current_speaker:
                # Flush pending content
                clean_orig = self._clean_display_text(original_buffer)
                clean_trans = self._clean_display_text(translation_buffer)
                if clean_orig:
                    parts.append(clean_orig)
                    if clean_trans:
                        parts.append(f" ({clean_trans.strip()})")
                original_buffer = ""
                translation_buffer = ""

                if current_speaker is not None:
                    parts.append("\n\n")
                current_speaker = speaker

                # Speaker header inline for compact readability.
                profile = self.session.get_speaker_profile(speaker)
                parts.append(f"{profile.get_label()}: ")
                text = text.lstrip()

            # Accumulate text
            if is_translation:
                translation_buffer += text
            else:
                # If we have pending translation, flush first
                if translation_buffer:
                    clean_orig = self._clean_display_text(original_buffer)
                    clean_trans = self._clean_display_text(translation_buffer)
                    parts.append(clean_orig)
                    parts.append(f" ({clean_trans.strip()})")
                    original_buffer = ""
                    translation_buffer = ""
                original_buffer += text

        # Final flush
        clean_orig = self._clean_display_text(original_buffer)
        clean_trans = self._clean_display_text(translation_buffer)
        if clean_orig:
            parts.append(clean_orig)
            if clean_trans:
                parts.append(f" ({clean_trans.strip()})")

        return "".join(parts)
    
    def _get_speaker_style(self, speaker_id: Union[int, str]) -> tuple[str, str]:
        """Get a unique emoji + color pair for a speaker."""
        sid = int(speaker_id) if isinstance(speaker_id, str) else speaker_id
        return SPEAKER_STYLES[sid % len(SPEAKER_STYLES)]

    def _get_language_color(self, language: str) -> str:
        """Get color for a language. Target language is always white."""
        if language == self.session.target_language:
            return "white"
        return LANGUAGE_COLORS.get(language, DEFAULT_LANGUAGE_COLOR)

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

    def _render_speaker_header(self, text: Text, speaker: Union[int, str]) -> None:
        """Render speaker header inline without emoji for stable alignment."""
        _, speaker_color = self._get_speaker_style(speaker)
        profile = self.session.get_speaker_profile(speaker)
        label = profile.get_label()
        text.append(f"{label}: ", style=f"bold {speaker_color}")

    def _render_transcript(self) -> Text:
        """Render transcript with inline parenthetical translations and language colors.

        Language flags are shown when:
        - A speaker starts speaking (to identify their language)
        - A speaker switches language mid-speech
        """
        text = Text()
        current_speaker: Optional[Union[int, str]] = None
        original_buffer = ""
        translation_buffer = ""
        current_lang: Optional[str] = None
        buffer_is_final = True
        should_show_flag = False

        all_tokens = self.session.final_tokens + self._non_final_tokens

        for token in all_tokens:
            token_text = token.get("text", "")
            speaker = token.get("speaker")
            language = token.get("language")
            is_translation = token.get("translation_status") == "translation"
            is_final = token.get("is_final", True)
            source_lang = token.get("source_language")

            # Skip translations when source language equals target language
            if is_translation and source_lang == self.session.target_language:
                continue

            # Handle speaker change
            if speaker is not None and speaker != current_speaker:
                # Flush pending content
                if original_buffer or translation_buffer:
                    self._flush_buffers_with_flag(
                        text, original_buffer, translation_buffer,
                        current_lang, buffer_is_final, show_flag=should_show_flag
                    )
                original_buffer = ""
                translation_buffer = ""
                buffer_is_final = True

                # Add paragraph break and speaker header
                if current_speaker is not None:
                    text.append("\n\n")
                current_speaker = speaker
                self._render_speaker_header(text, speaker)

                should_show_flag = True
                current_lang = language
                token_text = token_text.lstrip()

            # Track finality
            if not is_final:
                buffer_is_final = False

            # Accumulate text
            if is_translation:
                translation_buffer += token_text
            else:
                # Handle language change
                if language and current_lang and language != current_lang:
                    self._flush_buffers_with_flag(
                        text, original_buffer, translation_buffer,
                        current_lang, buffer_is_final, show_flag=True
                    )
                    original_buffer = ""
                    translation_buffer = ""
                    buffer_is_final = is_final
                    should_show_flag = True
                # Flush completed phrase (has translation)
                elif translation_buffer:
                    self._flush_buffers_with_flag(
                        text, original_buffer, translation_buffer,
                        current_lang, buffer_is_final, show_flag=should_show_flag
                    )
                    original_buffer = ""
                    translation_buffer = ""
                    buffer_is_final = is_final
                    should_show_flag = False

                original_buffer += token_text
                current_lang = language

        # Final flush
        self._flush_buffers_with_flag(
            text, original_buffer, translation_buffer,
            current_lang, buffer_is_final, show_flag=should_show_flag
        )
        return text

    def _flush_buffers_with_flag(
        self,
        text: Text,
        original: str,
        translation: str,
        lang: str,
        is_final: bool = True,
        show_flag: bool = False
    ) -> None:
        """Flush buffers and optionally append language flag after original text."""
        # Clean internal tokens from display
        original = self._clean_display_text(original)
        translation = self._clean_display_text(translation)

        if not original and not translation:
            return

        lang_color = self._get_language_color(lang) if lang else DEFAULT_LANGUAGE_COLOR

        # Apply styling based on finality
        if is_final:
            if original:
                text.append(original, style=lang_color)
            # Add flag after original text, before translation (only if requested)
            if show_flag and lang:
                flag = self._get_language_flag(lang)
                text.append(f" {flag}", style="dim")
            if translation:
                text.append(" (", style="dim")
                text.append(translation.strip(), style="white")
                text.append(")", style="dim")
        else:
            # Non-final (in-progress) text is dim and italic - no flag yet
            if original:
                text.append(original, style=f"dim italic {lang_color}")
            if translation:
                text.append(" (", style="dim")
                text.append(translation.strip(), style="dim italic white")
                text.append(")", style="dim")
    
    def _render_live_transcript(self) -> Text:
        """Render last N lines of transcript."""
        full = self._render_transcript()
        if not full:
            return Text("Waiting for speech...", style="dim italic")

        styled_lines = full.split("\n")
        if len(styled_lines) <= LIVE_VIEW_LINES:
            return full

        visible = styled_lines[-LIVE_VIEW_LINES:]
        result = Text()
        result.append(
            f"↑ {len(styled_lines) - LIVE_VIEW_LINES} more (v=scroll) ",
            style=f"dim {CHRISTMAS_GREEN}",
        )
        result.append("\n")
        for i, line in enumerate(visible):
            if i > 0:
                result.append("\n")
            result.append(line)
        return result
    
    def _render_status_bar(self) -> Text:
        """Render status bar with Christmas theme."""
        text = Text()

        if self._scroll_mode:
            text.append(" SCROLL ", style=f"black on {CHRISTMAS_RED}")
            start = self._scroll_offset + 1
            end = min(self._scroll_offset + SCROLL_PAGE_SIZE, self._scroll_total_lines)
            text.append(f" {start}-{end}/{self._scroll_total_lines}", style=CHRISTMAS_RED)
        else:
            text.append(" LIVE ", style=f"black on {CHRISTMAS_GREEN}")

        text.append(f" │ {self.session.name}", style="bold")
        text.append(f" │ {len(self.session.final_tokens)} tokens", style="dim")

        # Show language configuration
        source_langs = ",".join(self.session.source_languages)
        text.append(f" │ Langs: {source_langs} → {self.session.target_language}", style="dim")

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
            pairs = [("v", "scroll"), ("q", "quit")]

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

        visible = self._scroll_lines[self._scroll_offset:self._scroll_offset + SCROLL_PAGE_SIZE]
        if visible:
            # Join Text objects with newlines, preserving all styling
            content = Text()
            for i, line in enumerate(visible):
                if i > 0:
                    content.append("\n")
                content.append(line)
        else:
            content = Text("No content")

        return Group(
            Panel(header, style=CHRISTMAS_RED),
            Panel(content, border_style=CHRISTMAS_RED),
            self._render_footer_bar(),
        )
    
    def _build_display(self) -> Group:
        """Build main display with Christmas theme."""
        if self._scroll_mode:
            return self._build_scroll_display()

        parts = []

        # Header
        header = Text("🎄 Live Translator", style=f"bold {CHRISTMAS_GREEN}")
        parts.append(Panel(header, style=CHRISTMAS_GREEN))

        # Main transcript panel
        parts.append(Panel(
            self._render_live_transcript(),
            title=f"[bold {CHRISTMAS_GREEN}]Live Transcript[/]",
            border_style=CHRISTMAS_GREEN,
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
        self.console.print(f"[dim]Keys: [{CHRISTMAS_GOLD}]v[/]=scroll [{CHRISTMAS_GOLD}]q[/]=quit[/]")
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
