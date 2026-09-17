import { describe, expect, it } from 'vitest';
import {
  buildEdithMcpConfig,
  buildGenericHttpExample,
  buildStdioBridgeConfig,
  edithMcpServerEntry,
  mcpEndpoint,
} from './client-onboarding.js';

const input = { baseUrl: 'https://wiki.example.com/', token: 'ewk_test123' };

describe('client-onboarding（AI-FIRST-CLIENT-INTEGRATION-DESIGN ADR-C4）', () => {
  it('mcpEndpoint 归一化尾斜杠并拼托管端点', () => {
    expect(mcpEndpoint('https://w.example.com')).toBe('https://w.example.com/api/open/v1/mcp');
    expect(mcpEndpoint('https://w.example.com/')).toBe('https://w.example.com/api/open/v1/mcp');
    expect(mcpEndpoint('https://w.example.com///')).toBe('https://w.example.com/api/open/v1/mcp');
  });

  it('edith 条目：transport 必须是 streamable-http（edith 不支持 stdio）', () => {
    const entry = edithMcpServerEntry(input);
    expect(entry.transport).toBe('streamable-http');
  });

  it('edith 配置全文是「JSON 数组」格式（edith mcp-config-loader 实现事实，锁死防回退成 map）', () => {
    const parsed = JSON.parse(buildEdithMcpConfig(input)) as unknown[];
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(1);
    const entry = parsed[0] as Record<string, unknown>;
    expect(entry.id).toBe('ewiki');
    expect(entry.url).toBe('https://wiki.example.com/api/open/v1/mcp');
    // 不是 {"mcpServers": {...}} map
    expect(parsed.hasOwnProperty('mcpServers')).toBe(false);
  });

  it('edith 条目显式 enabled（edith 默认 opt-in，显式越过首次启用）且 PAT 走 Bearer 头', () => {
    const entry = edithMcpServerEntry(input);
    expect(entry.enabled).toBe(true);
    expect(entry.headers.Authorization).toBe('Bearer ewk_test123');
  });

  it('stdio 桥配置：mcpServers map + npx tsx 仓库源码 + 双 env（@ewiki/mcp 未发布 npm）', () => {
    const parsed = JSON.parse(buildStdioBridgeConfig(input, 'D:/works/wiki-space/ewiki')) as {
      mcpServers: Record<string, { command: string; args: string[]; env: Record<string, string> }>;
    };
    const server = parsed.mcpServers.ewiki;
    expect(server.command).toBe('npx');
    expect(server.args[0]).toBe('tsx');
    expect(server.args[1]).toMatch(/packages\/mcp\/src\/stdio\.ts$/);
    expect(server.env.EWIKI_BASE_URL).toBe('https://wiki.example.com');
    expect(server.env.EWIKI_TOKEN).toBe('ewk_test123');
  });

  it('通用 HTTP 示例包含握手端点与 REST 投影端点', () => {
    const text = buildGenericHttpExample(input);
    expect(text).toContain('https://wiki.example.com/api/open/v1/mcp');
    expect(text).toContain('/api/open/v1/search');
    expect(text).toContain('Bearer ewk_test123');
  });
});
