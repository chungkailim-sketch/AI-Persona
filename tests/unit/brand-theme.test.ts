import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { readBrandTemplate, brandStyle, contrast, BrandTemplateRefused } from '@/report/brandTheme';

const THEME = `<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Acme"><a:themeElements><a:clrScheme name="Acme">
<a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>
<a:dk2><a:srgbClr val="1F2A5C"/></a:dk2><a:lt2><a:srgbClr val="EEF0F7"/></a:lt2>
<a:accent1><a:srgbClr val="FFD200"/></a:accent1><a:accent2><a:srgbClr val="E4002B"/></a:accent2></a:clrScheme>
<a:fontScheme name="Acme"><a:majorFont><a:latin typeface="Georgia"/><a:ea typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Arial"/><a:ea typeface="Microsoft YaHei"/></a:minorFont></a:fontScheme></a:themeElements></a:theme>`;

async function pptx(xml: string | null) {
  const z = new JSZip();
  if (xml) z.file('ppt/theme/theme1.xml', xml);
  z.file('ppt/presentation.xml', '<p/>');
  return Buffer.from(await z.generateAsync({ type: 'nodebuffer' }));
}

describe('brand template', () => {
  it('reads the theme colours and fonts of a PowerPoint template', async () => {
    const t = await readBrandTemplate(await pptx(THEME), 'acme.potx');
    expect(t.name).toBe('Acme');
    expect(t.colors.accents).toEqual(['#ffd200', '#e4002b']);
    expect(t.colors.dark2).toBe('#1f2a5c');
    expect(t.fonts).toEqual({ heading: 'Georgia', body: 'Arial', eastAsian: 'Microsoft YaHei' });
  });

  it('keeps text readable when the brand colour is light', async () => {
    const t = await readBrandTemplate(await pptx(THEME), 'acme.potx');
    const css = brandStyle({ ...t, logo: null, uploadedAt: '' });
    // A yellow primary is darkened until text in it reads on white.
    expect(contrast(css['--color-brand']!, '#ffffff')).toBeGreaterThanOrEqual(4.5);
    expect(contrast(css['--color-brand-deep']!, css['--color-brand-deep-ink']!)).toBeGreaterThanOrEqual(4.5);
    expect(css['--brand-font-body']).toContain("'Arial'");
  });

  it('refuses a file without a theme', async () => {
    await expect(readBrandTemplate(await pptx(null), 'x.pptx')).rejects.toBeInstanceOf(BrandTemplateRefused);
    await expect(readBrandTemplate(Buffer.from('not a zip'), 'x.pptx')).rejects.toBeInstanceOf(BrandTemplateRefused);
  });
});
