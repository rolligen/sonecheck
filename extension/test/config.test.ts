import { describe, expect, it } from 'vitest';
import { normalizeConfig } from '../src/core';
import { JEV_ENDPOINT_DEFAULT, MAX_ITEMS, RISK_THRESHOLD } from '../src/constants';

describe('normalizeConfig', () => {
  it('缺省字段补齐默认值', () => {
    expect(normalizeConfig({})).toEqual({
      riskThreshold: RISK_THRESHOLD,
      maxItems: MAX_ITEMS,
      enabled: true,
      sensitivePathPatterns: ['auth', 'payment', 'migration'],
      endpoint: JEV_ENDPOINT_DEFAULT,
    });
  });

  it('endpoint 为 https 时原样保留', () => {
    for (const value of [
      'https://api.typesafe.ai/v1/systemone',
      'https://gateway.internal.example/jev/v1/systemone',
      '  https://gateway.internal.example/jev  ',
    ]) {
      expect(normalizeConfig({ endpoint: value }).endpoint).toBe(value.trim());
    }
  });

  it('endpoint 为回环 http 时保留（契约仿真端点与自托管网关）', () => {
    for (const host of ['127.0.0.1', 'localhost', '[::1]']) {
      const endpoint = `http://${host}:8787/v1/systemone`;
      expect(normalizeConfig({ endpoint }).endpoint).toBe(endpoint);
    }
  });

  it('endpoint 为远端 http / 非法值 / 空串时回退默认（不得明文外发）', () => {
    for (const value of [
      'http://example.com/v1/systemone',
      'http://10.0.0.5:8787/v1/systemone',
      'ftp://api.typesafe.ai/v1/systemone',
      'not-a-url',
      '',
      '   ',
      undefined,
    ]) {
      expect(normalizeConfig({ endpoint: value }).endpoint).toBe(JEV_ENDPOINT_DEFAULT);
    }
  });

  it('阈值越界回退默认值且不抛错', () => {
    for (const value of [1.5, 1, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(normalizeConfig({ riskThreshold: value }).riskThreshold).toBe(RISK_THRESHOLD);
    }
  });

  it('合法阈值原样保留', () => {
    expect(normalizeConfig({ riskThreshold: 0.2 }).riskThreshold).toBe(0.2);
  });

  it('maxItems 越界或非整数回退默认值', () => {
    for (const value of [0, 21, 2.5]) {
      expect(normalizeConfig({ maxItems: value }).maxItems).toBe(MAX_ITEMS);
    }
    expect(normalizeConfig({ maxItems: 7 }).maxItems).toBe(7);
    expect(normalizeConfig({ maxItems: 1 }).maxItems).toBe(1);
    expect(normalizeConfig({ maxItems: 20 }).maxItems).toBe(20);
  });

  it('敏感路径去除空白项，空集合回退默认值', () => {
    expect(normalizeConfig({ sensitivePathPatterns: ['  ', ''] }).sensitivePathPatterns).toEqual([
      'auth',
      'payment',
      'migration',
    ]);
    expect(normalizeConfig({ sensitivePathPatterns: [' infra '] }).sensitivePathPatterns).toEqual(['infra']);
  });

  it('enabled 缺省为 true，显式 false 保留', () => {
    expect(normalizeConfig({}).enabled).toBe(true);
    expect(normalizeConfig({ enabled: false }).enabled).toBe(false);
  });
});
