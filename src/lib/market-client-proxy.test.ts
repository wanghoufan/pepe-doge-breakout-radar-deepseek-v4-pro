/**
 * market-client 代理 plumbing 单测（本地 dev 经 HTTP(S)_PROXY 直连 OKX，绕开沙箱 DNS 墙）。
 * 只测请求线路：环境变量解析、dispatcher 构造分支、真实走本地回环代理桩。
 * 不碰任何指标/阈值/状态机/解析逻辑；禁依赖外网。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { ProxyAgent } from 'undici';
import { readProxyUrl, getRequestDispatcher, getOkxSwapInstruments } from './market-client';

const PROXY_ENV_KEYS = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy'] as const;

/** 显式 env 对象，避免测试继承 shell 的真实代理变量（127.0.0.1:7897）污染断言。 */
function env(vars: Record<string, string | undefined>): NodeJS.ProcessEnv {
  return vars as NodeJS.ProcessEnv;
}

function clearProxyEnv() {
  for (const k of PROXY_ENV_KEYS) delete process.env[k];
}

function saveProxyEnv(): Record<string, string | undefined> {
  return Object.fromEntries(PROXY_ENV_KEYS.map((k) => [k, process.env[k]]));
}

function restoreProxyEnv(saved: Record<string, string | undefined>) {
  for (const k of PROXY_ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
}

/** 本地回环代理桩：只记录抵达的 CONNECT 目标并立刻失败，不触达外网。 */
function startProxyStub(): Promise<{ port: number; connects: string[]; close: () => Promise<void> }> {
  return new Promise((resolve, reject) => {
    const connects: string[] = [];
    const server = createServer((_req, res) => {
      res.statusCode = 405;
      res.end();
    });
    server.on('connect', (req, socket) => {
      connects.push(req.url ?? '');
      socket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n');
      socket.destroy();
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({
        port,
        connects,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

test('PROXY-U1：无代理变量 → 默认 dispatcher（undefined，行为不变）', () => {
  assert.equal(readProxyUrl(env({})), null);
  assert.equal(getRequestDispatcher(env({})), undefined);
});

test('PROXY-U2：大小写环境变量均认，HTTPS 优先于 HTTP', () => {
  assert.equal(readProxyUrl(env({ https_proxy: 'http://a:1' })), 'http://a:1');
  assert.equal(readProxyUrl(env({ http_proxy: 'http://b:2' })), 'http://b:2');
  assert.equal(readProxyUrl(env({ HTTP_PROXY: 'http://b:2' })), 'http://b:2');
  assert.equal(readProxyUrl(env({ HTTPS_PROXY: 'http://a:1', http_proxy: 'http://b:2' })), 'http://a:1');
});

test('PROXY-U3：有变量 → 构造 ProxyAgent，同地址复用同一实例', () => {
  const a = getRequestDispatcher(env({ HTTPS_PROXY: 'http://127.0.0.1:7897' }));
  assert.ok(a instanceof ProxyAgent, '应返回 ProxyAgent 实例');
  const b = getRequestDispatcher(env({ https_proxy: 'http://127.0.0.1:7897' }));
  assert.equal(a, b, '同一代理地址应复用同一实例');
  assert.equal(getRequestDispatcher(env({})), undefined, '无变量仍为默认行为');
});

test('PROXY-E1：有代理变量 → 请求经本地回环代理桩（CONNECT 命中，不外网）', async () => {
  const stub = await startProxyStub();
  const saved = saveProxyEnv();
  const stubUrl = `http://127.0.0.1:${stub.port}`;
  clearProxyEnv();
  process.env.HTTPS_PROXY = stubUrl;
  process.env.HTTP_PROXY = stubUrl;
  try {
    assert.equal(readProxyUrl(env({ HTTPS_PROXY: stubUrl })), stubUrl, '显式 env 应解析到桩地址');
    assert.ok(
      getRequestDispatcher(env({ HTTPS_PROXY: stubUrl })) instanceof ProxyAgent,
      '显式 env 应返回 ProxyAgent',
    );
    const res = await getOkxSwapInstruments();
    assert.equal(res.ok, false, '桩返回 502，结果应为失败（未触达真实 OKX）');
    assert.ok(stub.connects.length >= 1, '代理桩应收到 CONNECT');
    assert.ok(
      stub.connects.every((t) => t.includes('okx.com:443')),
      `CONNECT 目标应为 OKX:443，实际：${stub.connects.join(',')}`,
    );
    assert.equal(res.diag.cached, false);
  } finally {
    restoreProxyEnv(saved);
    await stub.close();
  }
});
