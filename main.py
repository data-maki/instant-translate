#!/usr/bin/env python3
"""
Live Translator
Real-time multilingual transcription and translation with interactive scroll mode.
"""

import argparse
import os
import sys

MIN_PYTHON = (3, 11)

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

from live_transcriber import (
    Session,
    Transcriber,
    LiveTranscriptUI,
    list_audio_devices,
)

# Default context for transcription
DEFAULT_CONTEXT = """This is a casual conversation between people speaking different languages. Pay attention to conversational nuances, cultural references, and emotional tone."""


def main():
    if sys.version_info < MIN_PYTHON:
        print(
            f"Error: Python {MIN_PYTHON[0]}.{MIN_PYTHON[1]}+ is required. "
            f"Current version: {sys.version.split()[0]}"
        )
        sys.exit(1)

    parser = argparse.ArgumentParser(
        description="Live transcription and translation",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Keyboard shortcuts:
  v - Enter scroll mode to view full transcript
  q - Save and quit

Scroll mode navigation:
  j/k or ↑↓ - Scroll up/down
  g/G - Jump to top/bottom
  q - Exit scroll mode
        """
    )
    parser.add_argument(
        "--session", "-s",
        type=str,
        default=None,
        help="Session name (all recordings will be grouped under this name)"
    )
    parser.add_argument(
        "--context", "-c",
        type=str,
        default=None,
        help="Context hint for better transcription accuracy"
    )
    parser.add_argument(
        "--device", "-d",
        type=int,
        default=None,
        help="Audio input device index (use --list-devices to see options)"
    )
    parser.add_argument(
        "--list-devices",
        action="store_true",
        help="List available audio input devices and exit"
    )
    parser.add_argument(
        "--source-languages",
        type=str,
        default=None,
        help="Comma-separated list of source language codes (e.g., 'zh,es,fr')"
    )
    parser.add_argument(
        "--target-language",
        type=str,
        default=None,
        help="Target translation language code (e.g., 'en')"
    )
    args = parser.parse_args()
    
    # List devices mode
    if args.list_devices:
        devices = list_audio_devices()
        print("Available audio input devices:")
        
        # Find which would be default (MacBook mic preferred)
        default_idx = None
        for idx, name in devices:
            if "macbook" in name.lower() and "microphone" in name.lower():
                default_idx = idx
                break
        
        for idx, name in devices:
            marker = " (default)" if idx == default_idx else ""
            print(f"  [{idx}] {name}{marker}")
        
        print("\nUse --device <index> to select a specific device.")
        sys.exit(0)
    
    # Require session name for normal operation
    if not args.session:
        parser.error("--session/-s is required")
    
    # Check for API keys
    soniox_key = os.environ.get("SONIOX_API_KEY")
    if not soniox_key:
        print("Error: Missing SONIOX_API_KEY. Set it in .env or environment.")
        sys.exit(1)
    
    # Type narrowing for linter
    assert soniox_key is not None

    # Set context
    context: str = args.context if args.context else DEFAULT_CONTEXT

    # Language selection
    source_languages: list[str] = []
    target_language: str = ""

    # Check if languages provided via CLI
    if args.source_languages and args.target_language:
        source_languages = [lang.strip() for lang in args.source_languages.split(',')]
        target_language = args.target_language.strip()

        # Validate language codes
        from live_transcriber.languages import get_all_language_codes
        valid_codes = get_all_language_codes()
        invalid_source = [lang for lang in source_languages if lang not in valid_codes]
        if invalid_source:
            print(f"Error: Invalid source language codes: {', '.join(invalid_source)}")
            sys.exit(1)
        if target_language not in valid_codes:
            print(f"Error: Invalid target language code: {target_language}")
            sys.exit(1)
    else:
        # Interactive mode (default)
        from live_transcriber.language_selector import select_languages
        source_languages, target_language = select_languages()
        if not source_languages or not target_language:
            print("Language selection cancelled")
            sys.exit(0)

    # Initialize base components
    base_dir = os.path.dirname(os.path.abspath(__file__))
    session = Session(
        args.session,
        base_dir,
        source_languages,
        target_language,
    )

    # Handle old sessions without language config
    if session.was_resumed and not hasattr(session, 'source_languages'):
        print("\n⚠️  This session needs language configuration\n")
        from live_transcriber.language_selector import select_languages
        source_languages, target_language = select_languages()
        if not source_languages or not target_language:
            print("Language selection cancelled")
            sys.exit(0)
        session.source_languages = source_languages
        session.target_language = target_language
        session.save_state()

    # Initialize transcriber and UI
    transcriber = Transcriber(
        api_key=soniox_key,
        session=session,
        source_languages=session.source_languages,
        target_language=session.target_language,
        context=context,
        device_index=args.device,
    )

    # Run UI
    ui = LiveTranscriptUI(
        session=session,
        transcriber=transcriber,
    )

    ui.run()


if __name__ == "__main__":
    main()
