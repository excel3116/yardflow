import { Capacitor } from "@capacitor/core";
import { PushNotifications } from "@capacitor/push-notifications";

// PushNotifications.register() reaches into Firebase Messaging, which
// crashes the whole app on launch (uncaught native exception, not
// something a JS try/catch can stop) if google-services.json hasn't been
// added yet. Flip this to true only after dropping google-services.json
// into android/app/ and rebuilding — see ANDROID_BUILD.md.
const PUSH_ENABLED = false;

// Registers this device for push notifications when running as the native
// Android app. No-ops on the web build — Capacitor.isNativePlatform() is
// false there, so this file has zero effect on the browser version of the app.
//
// This only wires up the client side (permission + FCM token + listeners).
// Actually *sending* a push (e.g. "new truck Departed" -> notify Security)
// needs a server-side trigger calling Firebase Cloud Messaging, which isn't
// set up yet — see ANDROID_BUILD.md for what's still needed.
export async function initPushNotifications() {
  if (!Capacitor.isNativePlatform() || !PUSH_ENABLED) return;

  const permission = await PushNotifications.requestPermissions();
  if (permission.receive !== "granted") return;

  await PushNotifications.register();

  PushNotifications.addListener("registration", (token) => {
    // The FCM token that identifies this device. Once a server-side send
    // pipeline exists, this is what gets stored (e.g. in a Supabase
    // `push_tokens` table keyed by role/user) so notifications can be
    // targeted to it.
    console.log("Push registration token:", token.value);
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
