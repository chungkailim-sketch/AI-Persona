import { describe, expect, it } from 'vitest';
import { parseLang, registerTranslations, translate } from '../../src/ui/i18n/translate';
import { ZH } from '../../src/ui/i18n/zh';

describe('interface translation', () => {
  it('translates interface wording and keeps surrounding whitespace', () => {
    expect(translate('Source data')).toBe('源数据');
    expect(translate('  Run the swarm debate ')).toBe('  运行智能体群辩论 ');
  });

  it('carries numbers through a template in order', () => {
    expect(translate('3 of 16 stages finished.')).toBe('已完成 3 / 16 个阶段。');
    expect(translate('Reading 1,204 file(s).')).toBe('正在读取 1,204 个文件。');
  });

  it('places numbers by position where the Chinese word order differs', () => {
    expect(translate('12 rows parsed from 1 file(s).')).toBe('已从 1 个文件解析 12 行。');
  });

  it('leaves anything that is not interface wording untouched', () => {
    expect(translate('I would trust a product recommended by an AI assistant')).toBeNull();
    expect(translate('Mintel Global Consumer — China')).toBeNull();
    expect(translate('42')).toBeNull();
    expect(translate('中文')).toBeNull();
  });

  it('has a translation with matching placeholders for every entry', () => {
    for (const [en, zh] of Object.entries(ZH)) {
      expect(zh.trim().length, en).toBeGreaterThan(0);
      expect(zh.split('#').length, en).toBe(en.split('#').length);
    }
  });

  it('translates text composed of interface phrases piece by piece, leaving data as it is', () => {
    expect(translate('Indonesia · Premium Pioneers')).toBe('印度尼西亚 · 高端品质追求者');
    expect(translate('Tech & digital 74 · Travel 71')).toBe('科技数码 74 · 旅游出行 71');
    expect(translate('Source file: Completed; Validation: Completed')).toBe('源文件：已完成；验证：已完成');
    expect(translate('Indonesia · Acme Snacks Ltd')).toBe('印度尼西亚 · Acme Snacks Ltd');
    expect(translate('Openness to trying a foreign brand, 0 to 100. An illustration of the format, not study data.')).toContain('0 到 100');
  });

  it('uses a page’s registered content translations after the dictionary', () => {
    expect(translate('A quote nobody wrote into the dictionary')).toBeNull();
    registerTranslations({ 'A quote nobody wrote into the dictionary': '一句不在词典里的话' });
    expect(translate('“A quote nobody wrote into the dictionary”')).toBe('“一句不在词典里的话”');
  });

  it('defaults to English for anything but zh', () => {
    expect(parseLang('zh')).toBe('zh');
    expect(parseLang('fr')).toBe('en');
    expect(parseLang(undefined)).toBe('en');
  });
});
