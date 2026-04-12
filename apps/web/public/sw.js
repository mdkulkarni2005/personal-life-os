self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", () => {
  // Runtime caching can be added in future versions.
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }
  const type = payload.type;

  if (type === "share_invite") {
    const title = payload.title || "Shared reminders";
    const body = payload.body || "Open to review";
    const batchKey = payload.batchKey || "";
    const tag = payload.tag || `share-in-${batchKey}`;
    event.waitUntil(
      self.registration.showNotification(title, {
        body,
        icon: "/logo-remindos.svg",
        badge: "/logo-remindos.svg",
        tag,
        data: {
          type: "share_invite",
          batchKey,
          fromUserId: payload.fromUserId,
        },
        actions: [
          { action: "accept", title: "Accept" },
          { action: "deny", title: "Deny" },
        ],
      })
    );
    return;
  }

  if (type === "share_accepted") {
    const title = payload.title || "Reminder share";
    const body = payload.body || "Someone accepted your invites.";
    const tag = payload.tag || "share-accepted";
    event.waitUntil(
      self.registration.showNotification(title, {
        body,
        icon: "/logo-remindos.svg",
        badge: "/logo-remindos.svg",
        tag,
        data: { type: "share_accepted", batchKey: payload.batchKey },
      })
    );
  }
});

self.addEventListener("notificationclick", (event) => {
  const notification = event.notification;
  const data = notification.data || {};
  const action = event.action || "open";
  notification.close();

  if (data.type === "share_invite") {
    const batchKey = data.batchKey || "";
    const payload = {
      type: "SHARE_INVITE_NOTIF",
      action,
      batchKey,
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
        if (action === "accept") {
          url.searchParams.set("shareBatchAction", "accept");
          url.searchParams.set("batchKey", batchKey);
        } else if (action === "deny") {
          url.searchParams.set("shareBatchAction", "deny");
          url.searchParams.set("batchKey", batchKey);
        }
        if (self.clients.openWindow) {
          return self.clients.openWindow(url.href);
        }
      })
    );
    return;
  }

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
