self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", () => {
  // Runtime caching can be added in future versions.
});

self.addEventListener("notificationclick", (event) => {
  const notification = event.notification;
  const data = notification.data || {};
  const action = event.action || "open";
  notification.close();

  const payload = {
    type: "REMINDER_NOTIF",
    action,
    reminderId: data.reminderId,
    title: data.title,
  };

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url && client.url.includes(self.location.origin)) {
          client.postMessage(payload);
          if ("focus" in client) {
            return client.focus();
          }
        }
      }
      const url = new URL("/dashboard", self.location.origin);
      url.searchParams.set("notifAction", action);
      if (data.reminderId) {
        url.searchParams.set("reminderId", data.reminderId);
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(url.href);
      }
    })
  );
});
