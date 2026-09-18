/**
 * 最小 node:sqlite 环境声明。
 *
 * 原因：当前 @types/node 为 20.x，尚未内置 node:sqlite 类型（Node 22.5+ 才有）。
 * 运行环境为 Node 24（node:sqlite 可用），此处仅声明本项目实际使用到的最小 API。
 * 仅服务端导入；不要从客户端组件引用。
 */
declare module 'node:sqlite' {
  export interface StatementSync {
    run(...params: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint };
    get(...params: unknown[]): Record<string, unknown> | undefined;
    all(...params: unknown[]): Record<string, unknown>[];
  }

  export class DatabaseSync {
    constructor(path: string, options?: { open?: boolean; readOnly?: boolean; enableForeignKeyConstraints?: boolean });
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    close(): void;
  }
}
