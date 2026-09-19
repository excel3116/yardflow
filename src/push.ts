import { Capacitor } from "@capacitor/core";
import { PushNotifications } from "@capacitor/push-notifications";
import { supabase } from "./supabaseClient";

// PushNotifications.register() reaches into Firebase Messaging, which
// crashes the whole app on launch (uncaught native exception, not
// something a JS try/catch can stop) if google-services.json hasn't been
// added yet. Only flip this to true after dropping google-services.json
// into android/app/ and rebuilding — see ANDROID_BUILD.md.
const PUSH_ENABLED = true;

// The FCM token and the logged-in user id can each arrive first depending on
// timing (token from a native callback, user id from Supabase auth), so both
// are cached here and every save attempt happens once both are known.
let latestToken: string | null = null;
let latestUserId: string | null = null;

async function trySaveToken() {
  if (!latestToken || !latestUserId) return;
  const { error } = await supabase.from("push_tokens").upsert(
    { user_id: latestUserId, token: latestToken, updated_at: new Date().toISOString() },
    { onConflict: "user_id,token" }
  );
  if (error) console.error("Failed to save push token:", error);
}

// Call this whenever the signed-in user changes (sign in, session restore,
// sign out -> null) so a token that already arrived gets attached to the
// right account, and so a sign-in after the token arrived still saves it.
export function setPushUser(userId: string | null) {
  latestUserId = userId;
  trySaveToken();
}

// Registers this device for push notifications when running as the native
// Android app. No-ops on the web build — Capacitor.isNativePlatform() is
// false there, so this file has zero effect on the browser version of the app.
export async function initPushNotifications() {
  if (!Capacitor.isNativePlatform() || !PUSH_ENABLED) return;

  const permission = await PushNotifications.requestPermissions();
  if (permission.receive !== "granted") return;

  await PushNotifications.register();

  PushNotifications.addListener("registration", (token) => {
    latestToken = token.value;
    trySaveToken();
  });

  PushNotifications.addListener("registrationError", (err) => {
    console.error("Push registration error:", err);
  });

  PushNotifications.addListener("pushNotificationReceived", (notification) => {
    console.log("Push received in foreground:", notification);
  });

  PushNotifications.addListener("pushNotificationActionPerformed", (action) => {
    console.log("Push tapped:", action.notification);
  });
}
