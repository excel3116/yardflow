# Building the YARDFLOW Android app

The app is wrapped as a native Android shell using [Capacitor](https://capacitorjs.com/) —
it's the same React app running inside a WebView, packaged as a real installable `.apk`.
Nothing about the web app changed; `npm run dev` / the Vercel/other web deploy still work
exactly as before.

The native project lives in `android/`. **This repo's sandbox can't reach Google's Android
build servers (`dl.google.com`, `maven.google.com` are blocked here)**, so the actual Gradle
compile has to happen on a machine with normal internet access — your laptop or a CI runner.
Everything else (the native project, icons, manifest, Google Services wiring) is already set up.

## One-time setup (on your machine, not in this sandbox)

1. Install [Android Studio](https://developer.android.com/studio) (it bundles the Android SDK
   and a compatible JDK) — or, for a CLI-only setup, install the Android SDK command-line
   tools and set `ANDROID_HOME`.
2. Clone this repo and run `npm install`.

## Building the APK

```bash
npm run build          # builds the web app into dist/
npx cap sync android    # copies dist/ into the native project + syncs native deps
```

Then either:

- **Android Studio**: `npx cap open android`, then Build → Build Bundle(s)/APK(s) → Build APK(s).
  The APK lands in `android/app/build/outputs/apk/debug/app-debug.apk`.
- **Command line**: `cd android && ./gradlew assembleDebug` — same output path as above.

For a release build (signed, for distributing outside your own device), you'll need to set
up a signing key — see [Capacitor's Android guide](https://capacitorjs.com/docs/android)
or Android Studio's Build → Generate Signed Bundle/APK wizard.

## Re-syncing after code changes

Any time you change `src/`, re-run `npm run build && npx cap sync android` before rebuilding
the APK — the native project loads a bundled copy of the web app, it doesn't fetch it live.

## App icon

Currently a placeholder (truck glyph on the app's blue accent, `#2F6FE0`) — generated at
`android/app/src/main/res/mipmap-*/`. Swap in a real logo any time by replacing those PNGs
(and `ic_launcher_foreground.png` for the adaptive-icon layer) or using
[Android Studio's Image Asset tool](https://developer.android.com/studio/write/create-app-icons).

## Push notifications — what's wired up, what's still needed

The Android project is ready to receive push notifications ( `@capacitor/push-notifications`
is installed, and `android/app/build.gradle` already conditionally applies the Google
Services Gradle plugin the moment a `google-services.json` file is present), and
`src/push.ts` requests permission + registers the device for a token on app start
(no-ops entirely on the web build).

**Currently disabled** — `src/push.ts` has a `PUSH_ENABLED = false` flag at the top.
Calling `PushNotifications.register()` before Firebase is configured crashes the app
immediately on launch (`FirebaseApp is not initialized`, an uncaught native exception —
not something a try/catch can prevent), so it's switched off until you've done the
Firebase setup below.

To actually get this working, in order:

1. **Create a Firebase project** at [console.firebase.google.com](https://console.firebase.google.com)
   (this has to be done by you — it's tied to your Google account, I can't create one for you).
2. Add an Android app to it with package name `com.yardflow.app`.
3. Download the generated `google-services.json` and place it at `android/app/google-services.json`.
   Once that file exists, the Gradle build will automatically pick it up — no other config
   changes needed.
4. In `src/push.ts`, flip `PUSH_ENABLED` to `true`.
5. Rebuild (`npm run build && npx cap sync android` then rebuild the APK as above). The app
   will now register a real FCM token on launch — check `adb logcat` or Android Studio's
   Logcat for "Push registration token:" to confirm.
6. **Sending** notifications (e.g. "new truck Departed → notify Security") isn't built yet —
   that needs a server-side trigger (a Supabase Edge Function or webhook, triggered on the
   relevant DB change, calling the Firebase Admin SDK with your service-account credentials)
   to actually push a message to registered tokens. That's a separate follow-up once steps 1–4
   are done and you have a Firebase service account to work with.
