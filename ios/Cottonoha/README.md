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
uvicorn app.main:app --app-dir backend --host 0.0.0.0 --port 8000 --reload
```

Then configure the app like this:

```swift
AppConfiguration(
    apiBaseURL: URL(string: "http://192.168.1.25:8000")!
)
```

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

## Codex iOS Debugging Setup

The Codex Build iOS Apps plugin is enabled in `~/.codex/config.toml` as:

```toml
[plugins."build-ios-apps@openai-plugins"]
enabled = true
```

It points at the official OpenAI plugins checkout under `~/.codex/.tmp/plugins` and wires `xcodebuildmcp` with these workflows:

```json
{
  "DEVELOPER_DIR": "/Users/jcarbs/Downloads/Xcode.app/Contents/Developer",
  "XCODEBUILDMCP_ENABLED_WORKFLOWS": "simulator,ui-automation,debugging,logging"
}
```

That covers simulator discovery, build/run, UI snapshots, screenshots, logs, and LLDB attachment. It still requires a full Xcode install. This machine currently has Xcode at `/Users/jcarbs/Downloads/Xcode.app`, so the plugin is pinned to that developer directory. If Xcode moves to `/Applications`, update the plugin MCP env or switch the global developer directory:

```bash
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
xcodebuild -version
```

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

For a physical iPhone, pass your Mac LAN IP in the app entrypoint:

```swift
import SwiftUI
import CottonohaCore

@main
struct CottonohaIOSApp: App {
    var body: some Scene {
        WindowGroup {
            CottonohaRootView(
                configuration: AppConfiguration(
                    apiBaseURL: URL(string: "http://192.168.1.25:8000")!
                )
            )
        }
    }
}
```

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
source venv/bin/activate
uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000 --reload

```

For physical device testing, use `--host 0.0.0.0` for the backend and your Mac LAN IP in `AppConfiguration`.

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

This package can be syntax-checked without Xcode:

```bash
cd ios/Cottonoha
swift package resolve
swift build
```

Xcode is not installed in this environment, so simulator/device compilation needs to happen in a full Xcode install.
