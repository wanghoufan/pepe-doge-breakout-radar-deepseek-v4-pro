/* 全局推送 Service Worker（Web Push）。
 * - push：展示系统通知（标题 + 正文 + tag 去重，同一 tag 覆盖旧通知）。
 * - notificationclick：聚焦已打开的应用窗口并跳回首页；无窗口则打开新窗口。
 * 文案由服务端 payload 提供，沿用 alert-center 口径（禁买入/胜率/概率/必涨）。
 */

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: '突破雷达提醒', body: '收到一条新的状态提醒。' };
  }
  const title = typeof data.title === 'string' && data.title ? data.title : '突破雷达提醒';
  const options = {
    body: typeof data.body === 'string' ? data.body : '',
    tag: typeof data.tag === 'string' && data.tag ? data.tag : undefined,
    renotify: false,
    data: { url: typeof data.url === 'string' && data.url ? data.url : '/' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          client.focus();
          if ('navigate' in client) {
            try {
              client.navigate(url);
            } catch {
              /* navigate 失败不阻断 focus */
            }
          }
          return;
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
      return undefined;
    }),
  );
});
