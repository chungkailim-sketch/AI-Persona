import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { readBriefFile } from '../../src/advice/briefImport';

describe('reading a brief file', () => {
  it('hands a PDF and an image to the model as attachments', async () => {
    const pdf = await readBriefFile(Buffer.from('%PDF-1.7\n...'), 'brief.pdf');
    expect(pdf.attachments[0]?.mediaType).toBe('application/pdf');
    const png = await readBriefFile(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]), 'scan.png');
    expect(png.attachments[0]?.mediaType).toBe('image/png');
  });

  it('takes the text out of Word and PowerPoint files, slide by slide', async () => {
    const pptx = new JSZip();
    pptx.file('ppt/slides/slide2.xml', '<p:sld><a:p><a:r><a:t>Second slide</a:t></a:r></a:p></p:sld>');
    pptx.file('ppt/slides/slide1.xml', '<p:sld><a:p><a:r><a:t>Objectives &amp; markets</a:t></a:r></a:p></p:sld>');
    const r = await readBriefFile(await pptx.generateAsync({ type: 'nodebuffer' }), 'deck.pptx');
    expect(r.text).toBe('## Slide 1\nObjectives & markets\n\n## Slide 2\nSecond slide');
  });

  it('reads HTML, RTF and plain text', async () => {
    expect((await readBriefFile(Buffer.from('<html><body><p>Launch in <b>Thailand</b></p><script>x()</script></body></html>'), 'b.html')).text).toBe('Launch in Thailand');
    expect((await readBriefFile(Buffer.from('{\\rtf1\\ansi Launch plan\\par Second line}'), 'b.rtf')).text).toContain('Launch plan\nSecond line');
    expect((await readBriefFile(Buffer.from('品牌简报：进入印尼市场'), 'b.txt')).text).toBe('品牌简报：进入印尼市场');
  });
});
