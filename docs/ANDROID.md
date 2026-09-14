# Native Android companion

The project in `apps/android-agent` is a real Kotlin Android application. It targets SDK 35, supports API 26+, uses Gradle 8.13/AGP 8.9.1 and includes Android Keystore, OkHttp WebSocket, SAF and native SDK operations.

## Build and install

Open `apps/android-agent` in Android Studio. Select a JDK 17+ compatible with Gradle/AGP (Android Studio's bundled JBR works) and SDK 35. Or:

```powershell
cd apps/android-agent
.\gradlew.bat assembleDebug testDebugUnitTest lintDebug
```

Debug APK: `apps/android-agent/app/build/outputs/apk/debug/app-debug.apk`. A debug build is suitable for personal sideloading; it is not a Play Store release. Gradle unit tests verify path handling. Actual device permission behavior requires a phone or emulator.

From the repository root, with Android SDK platform-tools on PATH:

```powershell
adb devices
adb install -r apps/android-agent/app/build/outputs/apk/debug/app-debug.apk
adb reverse tcp:4319 tcp:4319
node scripts/admin.mjs pair
```

Enable USB debugging and approve the computer's USB prompt on your phone. Keep the core and Windows agent running. Open **Personal MCP**, leave the endpoint as `http://127.0.0.1:4319`, enter the one-use code returned by the pairing CLI, and tap **Pair**. The code expires after five minutes. The app stores the device token encrypted and reconnects while foregrounded. Its device ID appears in `device.list`. Select it with `session.prefer` or pass its explicit `deviceId` to a tool.

Keep the companion visible. It deliberately disconnects when backgrounded; opening another app via an intent may therefore make the companion offline until you return. The OS still owns app switching, permission prompts and sharing dialogs. Re-run `adb reverse` after reconnecting USB or restarting adb. If you change the core port, change both the reverse command and endpoint.

## Implemented capabilities

| Capability                                                                           | Behavior and platform requirements                                                                                               |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `device.info`, `device.battery`, `device.network`                                    | Model/SDK, charge percent, connectivity status                                                                                   |
| `apps.list`, `apps.launch`                                                           | Visible launcher apps; no unrestricted inventory of every package                                                                |
| `intent.open`, `browser.open`                                                        | Opens HTTP, HTTPS, mailto or tel through Android's normal intent resolution                                                      |
| `intent.share`                                                                       | Opens the system text-sharing chooser; user completes sharing                                                                    |
| `clipboard.read`, `clipboard.write`                                                  | Foreground app clipboard access; Android privacy restrictions apply                                                              |
| `files.list`, `files.read`, `files.write`, `files.copy`, `files.move`, `files.share` | Files beneath the SAF tree chosen through **Choose allowed folder**; bounded UTF-8 content, no arbitrary filesystem paths        |
| `notifications.list`                                                                 | Package, notification ID and posting time only; requires **Notification access** in Settings; message contents/OTPs are excluded |
| `media.list`                                                                         | Up to 100 image identifiers/names visible to this app; requires granted full or selected image access                            |

The catalog advertises implemented operations. Permission-dependent calls return structured errors until the corresponding permission is granted. SAF access persists if the provider supports it. Read-only providers reject writes. Image access supports Android 14 selected-photo permission. Read/write/copy/move payloads are capped at 1 MiB. The app does not implement a generic Android shell, root access, global UI control, another application's private files, browser DOM control, silent message sending, or screen capture. Screen recording would require a separate explicit MediaProjection consent flow and is not part of V1.

Pairing is USB/loopback only in V1. The phone executes Android capabilities but does not itself host the Node MCP core or an MCP client. An external MCP client connected to the core chooses the phone through routing. Unattended background execution and remote home/office transport are not implemented.
