# Cottonoha iOS

Native SwiftUI client for the existing cottonoha backend.

## What Is Included

- First-run onboarding screens with the same mecha/Japan visual language as the web landing page.
- Language setup for spoken languages and target language.
- Live chat transcript view with original text and translations.
- Session history list, load, rename, and delete.
- Native microphone capture to the existing `/ws/transcribe` backend websocket.
- Realtime mode toggle and bottom controls for speaker overdub and microphone capture.
- Backend-driven OpenAI realtime audio playback from `openai_realtime_audio` websocket events.
- Paginated history, typed translations, saved-transcript improvement, and enhanced-text/romaji controls.
- Autospeak starts at the latest box and queues English-to-local-language replies. Translations into English stay silent; opening history does not replay it.
- Stop waits for the final saved transcript and title before closing the connection.
- Consecutive phrases from the same speaker/language form a paragraph. Two compact language buttons play all available text in either language, including history and drafts; long paragraphs play in ordered chunks.
- Bulgarian readings appear inline in brackets. The Latin-only setting changes display text, never the Cyrillic speech payload. Related languages use related colors.
- Speech uses `/tts/stream` (24 kHz PCM), with MP3 fallback for an older backend. Autospeak prepares one reply ahead, including a draft stable for 150 ms, and waits for final text before playing. Completed PCM is cached for five minutes, bounded to 32 clips / 8 MiB and keyed by text, language, and voice.
- Existing translations are reused directly. A missing translation is requested once and saved; late responses cannot replace newer live translations or revive a previous chat.

## First-Run Onboarding

The app shows onboarding the first time it launches. Completion is stored with:

```swift
@AppStorage("cottonoha.hasCompletedOnboarding.v1")
```

To test onboarding again in the simulator, delete the Cottonoha app from the simulator and run it again. If you want a fully clean simulator state, use `Device -> Erase All Content and Settings...` from Simulator.

## Backend URLs

The default local URLs are:

- API: `http://localhost:8000`
For the iOS Simulator, `localhost` points to your Mac, so the defaults work.

For an iPhone on the same Wi-Fi network, `localhost` points to the phone, not your Mac. Run the backend on all interfaces and set the app URL to your Mac LAN IP:

```bash
ALLOW_AUTHLESS_INTERNAL=1 venv/bin/python -m uvicorn app.main:app --app-dir backend --host 0.0.0.0 --port 8000
```

Configure the Debug endpoint from the repository root without changing tracked project files:

```bash
COTTONOHA_API_BASE_URL=http://192.168.1.25:8000 ios/open-cottonoha-xcode.sh
```

The launcher uses the selected Xcode installation (`xcode-select -p`), or `XCODE_APP` when supplied. It writes the URL to ignored `ios/CottonohaApp/Local.xcconfig`, which is included only by Debug builds. Use `--configure-only` to save the URL without opening Xcode. Delete `Local.xcconfig` to restore the localhost default. For the simulator backend on port 8001, use `http://localhost:8001`.

The app also accepts `COTTONOHA_API_BASE_URL` in its Xcode scheme's launch environment, taking precedence over the bundled Debug setting. Native authentication is unchanged: this internal client requires the backend's existing `ALLOW_AUTHLESS_INTERNAL=1` mode.

The FastAPI CORS config affects browser requests, not native URLSession requests.

## Launch In Xcode

The repo includes a minimal runnable Xcode project at:

```bash
open ../CottonohaApp/CottonohaApp.xcodeproj
```

From the repository root:

```bash
open ios/CottonohaApp/CottonohaApp.xcodeproj
```

In Xcode:

1. Select the `Cottonoha` scheme.
2. Pick an iPhone simulator.
3. Press `Cmd+R`.

The project already links this local Swift package and includes the microphone/local-network development `Info.plist` keys.

## Xcode Toolchain

Use the currently selected full Xcode installation:

```bash
xcode-select -p
xcodebuild -version
```

If the selected directory points to Command Line Tools, select your installed Xcode before building. The launcher accepts `XCODE_APP` when you need a different installation.

The app uses native `Logger`/`OSLog` with subsystem `app.cottonoha.ios` and these categories:

- `app`
- `network`
- `realtime`
- `audio`

Useful simulator log query:

```bash
xcrun simctl spawn booted log stream \
  --info --debug \
  --predicate 'subsystem == "app.cottonoha.ios"' \
  --style compact
```

The log lines intentionally avoid user text and audio payloads.

## Recreate The Xcode Project Manually

You should not need this for normal use. If the generated project ever gets deleted, recreate it like this:

1. Open Xcode.
2. Choose `File -> New -> Project...`.
3. Pick `iOS -> App`.
4. Use:
   - Product Name: `Cottonoha`
   - Interface: `SwiftUI`
   - Language: `Swift`
   - Storage: `None`
5. Save the Xcode project as `ios/CottonohaApp/`, next to this package.
6. In Xcode, choose `File -> Add Package Dependencies...`.
7. Click `Add Local...` and select this folder: `ios/Cottonoha`.
8. Add the `CottonohaCore` package product to your app target.
9. Replace the generated app entrypoint with:

```swift
import SwiftUI
import CottonohaCore

@main
struct CottonohaIOSApp: App {
    var body: some Scene {
        WindowGroup {
            CottonohaRootView()
        }
    }
}
```

For a physical iPhone, configure the Debug URL with `ios/open-cottonoha-xcode.sh`
as shown above. Do not hardcode a LAN address in the app entrypoint. Release
archives require an explicit `COTTONOHA_API_BASE_URL` build setting; they do not
read Debug's `Local.xcconfig` or inherit Xcode's launch environment after export.

## Required App Settings

Add these keys to the app target `Info.plist`.

Microphone permission:

```xml
<key>NSMicrophoneUsageDescription</key>
<string>Cottonoha uses the microphone to translate live conversations.</string>
```

Local network explanation for testing against your Mac from a real phone:

```xml
<key>NSLocalNetworkUsageDescription</key>
<string>Cottonoha connects to your local development server for translation.</string>
```

Because local development uses plain HTTP, add an App Transport Security exception while testing:

```xml
<key>NSAppTransportSecurity</key>
<dict>
  <key>NSAllowsLocalNetworking</key>
  <true/>
  <key>NSExceptionDomains</key>
  <dict>
    <key>localhost</key>
    <dict>
      <key>NSExceptionAllowsInsecureHTTPLoads</key>
      <true/>
    </dict>
    <key>127.0.0.1</key>
    <dict>
      <key>NSExceptionAllowsInsecureHTTPLoads</key>
      <true/>
    </dict>
  </dict>
</dict>
```

If testing on a physical iPhone with a LAN IP such as `192.168.1.25`, either temporarily use:

```xml
<key>NSAppTransportSecurity</key>
<dict>
  <key>NSAllowsArbitraryLoads</key>
  <true/>
</dict>
```

or add a specific ATS exception for your Mac hostname/domain. Do not ship production builds with arbitrary HTTP loads.

If you later add social/OAuth auth callbacks, register the callback URL scheme under the app target `Info -> URL Types`.

## Test Checklist

Start the local servers first:

```bash
# Terminal 1
ALLOW_AUTHLESS_INTERNAL=1 venv/bin/python -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000

```

For physical device testing, use `--host 0.0.0.0` and configure your Mac LAN IP
with the launcher. Confirm `/health`, `/languages`, and authless `/sessions`
belong to this backend. Do not restart a backend while anyone is recording.

Then in Xcode:

1. Select an iPhone simulator or your connected iPhone.
2. Press `Cmd+R`.
3. Confirm the language rail loads `JA -> EN`.
4. Tap `Start realtime` or `Start session`.
5. Accept microphone permission.
6. Speak a short English/Japanese phrase.
7. Confirm transcript bubbles appear and the bottom mic/speaker controls respond.
8. Tap History and Profile to confirm those sheets open.

## Command-Line Verification

With the selected Xcode toolchain, run the package regression tests:

```bash
cd ios/Cottonoha
swift test
```

From the repository root, compile the complete simulator app without signing:

```bash
xcodebuild -project ios/CottonohaApp/CottonohaApp.xcodeproj \
  -scheme Cottonoha -configuration Debug -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build
```

The automated tests cover history query parameters, backend response decoding, stale history responses, and speech queue ordering/cancellation. Live microphone, acoustic echo cancellation, and paid provider audio still require a device check.

### Paragraph playback UI check

The UI test uses synthetic English/Bulgarian history and a quiet PCM test tone. It checks full-paragraph payloads, both language buttons, playback completion, cache reuse, and reopening history without contacting a paid provider.

Start the isolated fixture server, then run the test against an available simulator:

```bash
venv/bin/python ios/tests/fixture_server.py
# In another terminal; replace the destination with an available simulator.
xcodebuild -project ios/CottonohaApp/CottonohaApp.xcodeproj \
  -scheme Cottonoha -configuration Debug \
  -destination 'platform=iOS Simulator,id=YOUR_ISOLATED_SIMULATOR_ID' \
  -derivedDataPath output/ios-qa -resultBundlePath output/ios-qa.xcresult \
  -parallel-testing-enabled NO -collect-test-diagnostics never \
  CODE_SIGNING_ALLOWED=NO test
```

The fixture server binds only `127.0.0.1:18766`; it does not write real sessions.

Use a disposable simulator for this test; its launch arguments skip onboarding.
Create one using an installed runtime from `xcrun simctl list runtimes`, and use
the ID printed by `xcrun simctl create`. No existing browser or recording session
is needed.

## Internal release artifacts

From the repository root, choose the backend URL reachable by the phone, then
archive and export locally. These commands do not upload to App Store Connect:

```bash
export COTTONOHA_API_BASE_URL=http://192.168.1.25:8000
xcodebuild -project ios/CottonohaApp/CottonohaApp.xcodeproj \
  -scheme Cottonoha -configuration Release -destination 'generic/platform=iOS' \
  -derivedDataPath output/ios-device -archivePath output/Cottonoha.xcarchive \
  COTTONOHA_API_BASE_URL="$COTTONOHA_API_BASE_URL" archive
xcodebuild -exportArchive -archivePath output/Cottonoha.xcarchive \
  -exportPath output/ios-export -exportOptionsPlist ios/ExportOptions-development.plist
```

The development IPA requires an existing signing identity/profile and a registered
device. This internal client still needs `ALLOW_AUTHLESS_INTERNAL=1`. A Release
build without an explicit URL falls back to localhost, which is the phone itself.
Inspect the archive's `Products/Applications/Cottonoha.app/Info.plist` key
`CottonohaAPIBaseURL` before handing over the IPA.

See [release handoff](../../docs/release-2026-10-01.md) for the verified
build and the remaining physical-device checks. Simulator playback state and
successful signing/export do not establish microphone, speaker, echo-cancellation,
or Bluetooth behavior on a phone.

### Physical iPhone check

Use a separate backend port while web recording is active. Start this repo's backend with `ALLOW_AUTHLESS_INTERNAL=1`, bind to `0.0.0.0`, and configure the Debug URL to the Mac's LAN IP. Keep the phone and Mac on the same network. Internal mobile history belongs to `internal-mobile`; it is separate from signed-in web history by default.

After installing the signed Debug build on an unlocked phone:

1. Allow Local Network and Microphone access. Select Bulgarian and English.
2. Record alternating speakers, enable autospeak, and confirm only English → Bulgarian replies play, in order.
3. Tap either paragraph language control. Confirm the full paragraph plays, replay works, and switching language interrupts it.
4. Stop, reopen the generated topic in History, then start New chat and confirm no old conversation reappears.
5. Check built-in speaker and Bluetooth routes, microphone echo while speech plays, and stopping/interruption. Simulator success does not establish physical acoustic echo cancellation or Bluetooth behavior.
