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

## Push notifications

**What's built (client + server code is done):**

- `src/push.ts` requests permission, registers the device for an FCM token, and now
  actually saves that token to a Supabase table (`push_tokens`) keyed to the logged-in
  user, with a retry so it works no matter which arrives first — the token or the login.
  `PUSH_ENABLED` is now `true`.
- `supabase/functions/notify-supervisor/index.ts` — a Supabase Edge Function that fires
  on truck updates, checks whether `assigned_supervisor` just changed to a specific
  supervisor, looks up that supervisor's device token(s), and sends them a push via
  Firebase Cloud Messaging (FCM HTTP v1 API). Currently the *only* trigger is "a
  supervisor was just assigned a truck" — nothing else sends a push yet.

**What you still have to do by hand** (none of this can be done from here — no network
access to Firebase or your Supabase project from this sandbox):

1. **Finish the Firebase project** at [console.firebase.google.com](https://console.firebase.google.com) —
   you said this isn't done yet:
   - Create the project (any name, e.g. "YARDFLOW").
   - Add an Android app with package name `com.yardflow.app`.
   - Download the generated `google-services.json` and place it at
     `android/app/google-services.json`. The Gradle build already conditionally applies
     the Google Services plugin the moment this file exists — no other config needed.
2. **Generate a service-account key** (for the *server* side, separate from step 1's file):
   Firebase console → Project settings (gear icon) → Service accounts tab → "Generate new
   private key". This downloads a JSON file — keep it private, it's a credential.
3. **Create the `push_tokens` table** — run this once in Supabase's SQL Editor:
   ```sql
   CREATE TABLE IF NOT EXISTS push_tokens (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
     token text NOT NULL,
     updated_at timestamptz NOT NULL DEFAULT now(),
     UNIQUE (user_id, token)
   );
   ALTER TABLE push_tokens ENABLE ROW LEVEL SECURITY;
   CREATE POLICY "Users manage their own push tokens" ON push_tokens
     FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
   ```
4. **Deploy the Edge Function.** Needs the [Supabase CLI](https://supabase.com/docs/guides/cli)
   installed and logged in (`supabase login`), then from the repo root:
   ```bash
   supabase link --project-ref xywtiymqveurtuxjzxqi
   supabase functions deploy notify-supervisor
   ```
5. **Set the function's secret** — paste the *entire* JSON contents from step 2 as one value:
   ```bash
   supabase secrets set FIREBASE_SERVICE_ACCOUNT='<paste the full JSON from step 2 here>'
   ```
6. **Wire up the Database Webhook** so the function actually gets called:
   Supabase dashboard → Database → Webhooks → Create a new webhook.
   - Table: `vehicles`
   - Events: `Update`
   - Type: Supabase Edge Function → select `notify-supervisor`
7. Rebuild the app (`npm run build && npx cap sync android`, then rebuild the APK — see
   above) and reinstall it on the Supervisor 1 / Supervisor 2 test devices. On launch it
   registers and saves a token; check `adb logcat` for "Push registration token" or query
   `select * from push_tokens;` in Supabase to confirm a row appeared for that account.

Once all 7 steps are done: assigning a truck to a supervisor (Yard Incharge → "Assign
Supervisor") should make that supervisor's phone buzz with a notification. Other triggers
(e.g. notifying Security when a truck departs) aren't built yet — this is scoped to just
the supervisor-assignment case for now, per your call to keep it simple to start.
