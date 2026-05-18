#!/usr/bin/env python3
"""
Microphone diagnostic script.
Tests if audio is actually being captured from your microphone.
"""

import pyaudio
import struct
import math
import time

SAMPLE_RATE = 16000
NUM_CHANNELS = 1
CHUNK_SIZE = 3200
DURATION_SECS = 5

def get_rms(data: bytes) -> float:
    """Calculate RMS (volume level) of audio data."""
    count = len(data) // 2
    format_str = f"{count}h"
    shorts = struct.unpack(format_str, data)
    sum_squares = sum(s * s for s in shorts)
    rms = math.sqrt(sum_squares / count) if count > 0 else 0
    return rms

def main():
    print("🎙 Microphone Diagnostic Tool")
    print("=" * 50)
    
    audio = pyaudio.PyAudio()
    
    # List all input devices
    print("\n📋 Available input devices:")
    input_devices = []
    for i in range(audio.get_device_count()):
        info = audio.get_device_info_by_index(i)
        if info.get("maxInputChannels", 0) > 0:
            input_devices.append((i, info))
            print(f"  [{i}] {info['name']}")
            print(f"      Channels: {info['maxInputChannels']}, Sample Rate: {info['defaultSampleRate']}")
    
    if not input_devices:
        print("\n❌ No input devices found!")
        print("   This might be a permission issue. Check System Settings > Privacy & Security > Microphone")
        audio.terminate()
        return
    
    # Get default device
    try:
        default_info = audio.get_default_input_device_info()
        default_idx = default_info['index']
        print(f"\n✓ Default input device: [{default_idx}] {default_info['name']}")
    except Exception as e:
        print(f"\n⚠️  Could not get default input device: {e}")
        default_idx = input_devices[0][0]
        print(f"   Using first available: [{default_idx}] {input_devices[0][1]['name']}")
    
    # Open stream and test
    print(f"\n🔊 Testing audio capture for {DURATION_SECS} seconds...")
    print("   Speak into your microphone now!\n")
    
    try:
        stream = audio.open(
            format=pyaudio.paInt16,
            channels=NUM_CHANNELS,
            rate=SAMPLE_RATE,
            input=True,
            input_device_index=default_idx,
            frames_per_buffer=CHUNK_SIZE
        )
    except Exception as e:
        print(f"❌ Failed to open audio stream: {e}")
        print("\n   Possible causes:")
        print("   1. Microphone permission denied - Check System Settings > Privacy & Security > Microphone")
        print("   2. Device is in use by another app")
        print("   3. Device is disconnected")
        audio.terminate()
        return
    
    max_rms = 0
    chunks_with_audio = 0
    total_chunks: int = 0
    
    start_time = time.time()
    
    while time.time() - start_time < DURATION_SECS:
        try:
            data = stream.read(CHUNK_SIZE, exception_on_overflow=False)
            rms = get_rms(data)
            total_chunks += 1
            
            if rms > max_rms:
                max_rms = rms
            
            if rms > 500:  # Above noise floor
                chunks_with_audio += 1
            
            # Visual meter
            bars = int(rms / 500)
            bars = min(bars, 40)
            meter = "█" * bars + "░" * (40 - bars)
            print(f"\r   Level: [{meter}] {int(rms):5d}", end="", flush=True)
            
        except Exception as e:
            print(f"\n❌ Error reading audio: {e}")
            break
    
    print("\n")
    
    stream.stop_stream()
    stream.close()
    audio.terminate()
    
    # Results
    print("=" * 50)
    print("📊 Results:")
    print(f"   Total chunks read: {total_chunks}")
    print(f"   Max volume level: {int(max_rms)}")
    print(f"   Chunks with audio: {chunks_with_audio} ({100*chunks_with_audio//(total_chunks or 1)}%)")
    
    if max_rms < 100:
        print("\n❌ NO AUDIO DETECTED!")
        print("   Possible issues:")
        print("   1. Microphone permission not granted to Terminal/Cursor")
        print("      → Go to System Settings > Privacy & Security > Microphone")
        print("      → Enable access for your terminal app")
        print("   2. Wrong microphone selected")
        print("   3. Microphone is muted or volume is too low")
        print("   4. Using a virtual/fake audio device")
    elif max_rms < 1000:
        print("\n⚠️  Audio detected but very quiet")
        print("   Try speaking louder or moving closer to the microphone")
    else:
        print("\n✓ Audio capture working correctly!")
        print("   If transcription still shows 'Waiting for speech', the issue")
        print("   might be with the Soniox API connection or API key.")

if __name__ == "__main__":
    main()






