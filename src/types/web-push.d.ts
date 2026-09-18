/**
 * 最小 web-push 环境声明（web-push 3.x 未内置 TypeScript 类型）。
 * 仅声明本项目实际使用到的最小 API；仅服务端导入。
 */
declare module 'web-push' {
  export interface PushSubscription {
    endpoint: string;
    keys: { p256dh: string; auth: string };
  }

  export interface SendResult {
    statusCode: number;
    body: string;
    headers: Record<string, string>;
  }

  export interface VapidKeys {
    publicKey: string;
    privateKey: string;
  }

  export function generateVAPIDKeys(): VapidKeys;
  export function setVapidDetails(subject: string, publicKey: string, privateKey: string): void;
  export function sendNotification(subscription: PushSubscription, payload?: string): Promise<SendResult>;

  const webpush: {
    generateVAPIDKeys: typeof generateVAPIDKeys;
    setVapidDetails: typeof setVapidDetails;
    sendNotification: typeof sendNotification;
  };
  export default webpush;
}
