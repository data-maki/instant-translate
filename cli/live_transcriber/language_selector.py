"""Interactive language selection UI using prompt_toolkit."""
from typing import Optional

from prompt_toolkit import Application
from prompt_toolkit.key_binding import KeyBindings
from prompt_toolkit.layout import Layout, Window, FormattedTextControl
from prompt_toolkit.styles import Style
from rich.console import Console

from .languages import SONIOX_LANGUAGES, get_language_flag, search_languages


class LanguageSelector:
    """Interactive language selector with keyboard navigation."""

    def __init__(self, title: str, multi_select: bool):
        self.title = title
        self.multi_select = multi_select
        self.all_languages = [(code, lang["name"]) for code, lang in sorted(SONIOX_LANGUAGES.items())]
        self.filtered = self.all_languages
        self.search = ""
        self.cursor = 0
        self.selected: set[str] = set()
        self.result: Optional[list[str]] = None
        self.cancelled = False

    def get_display_text(self) -> list[tuple[str, str]]:
        """Generate the display text for the selector UI."""
        lines = [("class:title", f"{self.title}\n\n")]
        lines.append(("class:dim", "Search: "))
        lines.append(("class:search", self.search or ""))
        lines.append(("class:cursor", "_\n"))
        if not self.search:
            lines.append(("class:hint", "Type to search or use arrows to scroll\n"))
        lines.append(("", "\n"))

        # Visible window (15 items)
        start = max(0, self.cursor - 7)
        end = min(len(self.filtered), start + 15)

        if start > 0:
            lines.append(("class:dim", f"  ^ {start} more above\n"))

        for i in range(start, end):
            code, name = self.filtered[i]
            flag = get_language_flag(code)
            prefix = "> " if i == self.cursor else "  "
            style = "class:selected" if i == self.cursor else ""

            if self.multi_select:
                check = "[x]" if code in self.selected else "[ ]"
            else:
                check = "(*)" if code in self.selected else "( )"

            lines.append((style, f"{prefix}{check} {code} - {name} {flag}\n"))

        if end < len(self.filtered):
            lines.append(("class:dim", f"  v {len(self.filtered) - end} more below\n"))

        lines.append(("", "\n"))
        if self.multi_select:
            lines.append(("class:hint", "arrows=scroll | space=select | enter=done | esc=cancel"))
        else:
            lines.append(("class:hint", "arrows=scroll | enter=select | esc=cancel"))

        return lines

    def create_app(self) -> Application:
        """Create the prompt_toolkit Application."""
        kb = KeyBindings()
        selector = self  # Reference for closures

        @kb.add("up")
        def handle_up(event):
            selector.cursor = max(0, selector.cursor - 1)

        @kb.add("down")
        def handle_down(event):
            selector.cursor = min(len(selector.filtered) - 1, selector.cursor + 1)

        @kb.add("space")
        def handle_space(event):
            if selector.multi_select and selector.cursor < len(selector.filtered):
                code = selector.filtered[selector.cursor][0]
                if code in selector.selected:
                    selector.selected.remove(code)
                else:
                    selector.selected.add(code)

        @kb.add("enter")
        def handle_enter(event):
            if selector.multi_select:
                if selector.selected:
                    selector.result = list(selector.selected)
                    event.app.exit()
            else:
                if selector.cursor < len(selector.filtered):
                    selector.result = [selector.filtered[selector.cursor][0]]
                    event.app.exit()

        @kb.add("escape")
        @kb.add("c-c")
        def handle_cancel(event):
            selector.cancelled = True
            event.app.exit()

        @kb.add("backspace")
        def handle_backspace(event):
            if selector.search:
                selector.search = selector.search[:-1]
                selector.filtered = search_languages(selector.search)
                selector.cursor = min(selector.cursor, max(0, len(selector.filtered) - 1))

        @kb.add("<any>")
        def handle_char(event):
            key = event.data
            if len(key) == 1 and key.isalpha():
                selector.search += key.lower()
                selector.filtered = search_languages(selector.search)
                selector.cursor = min(selector.cursor, max(0, len(selector.filtered) - 1))

        style = Style.from_dict({
            "title": "bold #165b33",  # Dark Christmas green
            "search": "#d4af37",  # Soft antique gold
            "cursor": "#d4af37",  # Soft gold cursor
            "hint": "italic #165b33",  # Dark Christmas green
            "dim": "#666666",  # Gray
            "selected": "bg:#165b33 #f0e68c bold",  # Dark green bg, cream text
        })

        layout = Layout(Window(FormattedTextControl(self.get_display_text)))
        return Application(layout=layout, key_bindings=kb, style=style, full_screen=False)


def select_languages() -> tuple[list[str], str]:
    """Interactive language selection flow.

    Source step is multi-select (press space to toggle, enter to confirm)
    so you can shortlist a few languages you might hear; the Session
    normalizes to a 2-language pair for Soniox two-way translation, with
    the target always included. Target defaults to English.
    """
    console = Console()

    # Step 1: Source languages (multi-select — space to toggle, enter to confirm)
    console.print("\n")
    selector = LanguageSelector(
        "Select SOURCE languages (space=toggle, enter=confirm)",
        multi_select=True,
    )
    selector.create_app().run()

    if selector.cancelled or not selector.result:
        console.print("\n[yellow]Selection cancelled[/yellow]\n")
        return ([], "")
    source = selector.result

    # Step 2: Target language (default English)
    target = "en"
    console.print(f"\n[cyan]Target language:[/cyan] English (default)")
    change_target = input("Change target language? [y/N] ").strip().lower()

    if change_target == "y":
        console.print("\n")
        selector = LanguageSelector("Select TARGET language (translate to)", multi_select=False)
        selector.create_app().run()

        if selector.cancelled or not selector.result:
            console.print("\n[yellow]Selection cancelled[/yellow]\n")
            return ([], "")
        target = selector.result[0]

    # If the user only picked the target language as the source, there's
    # nothing to translate — bail with a clear message.
    if all(s == target for s in source):
        console.print(
            f"[red]Source and target are both {target}; nothing to translate.[/red]\n"
        )
        return ([], "")

    # Step 3: Confirmation
    console.print(f"\n[cyan]Source:[/cyan] {', '.join(source)}")
    console.print(f"[cyan]Target:[/cyan] {target}")
    confirm = input("\nProceed with selection? [Y/n] ").strip().lower()

    if confirm and confirm != "y":
        console.print("[yellow]Selection cancelled[/yellow]\n")
        return ([], "")

    console.print("[green]Selection confirmed[/green]\n")
    return (source, target)
