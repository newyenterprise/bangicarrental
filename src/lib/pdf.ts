import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';

const A4 = { width: 595.28, height: 841.89 };
const MARGIN = 54;
const INK = rgb(0.086, 0.235, 0.2);
const MUTED = rgb(0.35, 0.41, 0.37);

/** The standard PDF fonts cover Latin text (BM and English); anything else becomes '?'. */
function safe(font: PDFFont, text: string): string {
  let out = '';
  for (const ch of text.replace(/\t/g, ' ')) {
    try {
      font.encodeText(ch);
      out += ch;
    } catch {
      out += '?';
    }
  }
  return out;
}

function wrap(font: PDFFont, text: string, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    // a single over-long token (for example a URL) is broken hard
    let rest = word;
    while (font.widthOfTextAtSize(rest, size) > maxWidth) {
      let cut = rest.length - 1;
      while (cut > 1 && font.widthOfTextAtSize(rest.slice(0, cut), size) > maxWidth) cut -= 1;
      lines.push(rest.slice(0, cut));
      rest = rest.slice(cut);
    }
    line = rest;
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

export type SignatureBlock = {
  heading: string;
  rows: [string, string][];
  /** PNG bytes of the drawn signature. */
  image: Uint8Array;
  footer: string;
};

/**
 * Renders agreement text (lines starting with "## " are headings, "- " are
 * bullets) to an A4 PDF, followed by the signature and signing record.
 */
export async function renderAgreementPdf(input: {
  title: string;
  subtitle: string;
  body: string;
  signature: SignatureBlock;
}): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(input.title);
  pdf.setCreator('Bangi Car Rental');
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const width = A4.width - MARGIN * 2;

  let page: PDFPage = pdf.addPage([A4.width, A4.height]);
  let y = A4.height - MARGIN;
  const need = (height: number) => {
    if (y - height < MARGIN) {
      page = pdf.addPage([A4.width, A4.height]);
      y = A4.height - MARGIN;
    }
  };
  const write = (text: string, font: PDFFont, size: number, opts: { indent?: number; color?: ReturnType<typeof rgb>; gap?: number } = {}) => {
    const indent = opts.indent ?? 0;
    for (const line of wrap(font, safe(font, text), size, width - indent)) {
      need(size * 1.45);
      y -= size * 1.45;
      page.drawText(line, { x: MARGIN + indent, y, size, font, color: opts.color ?? INK });
    }
    y -= opts.gap ?? 0;
  };

  write(input.title, bold, 18, { gap: 2 });
  write(input.subtitle, regular, 9.5, { color: MUTED, gap: 10 });

  for (const raw of input.body.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) {
      y -= 5;
    } else if (line.startsWith('## ')) {
      y -= 6;
      need(40);
      write(line.slice(3), bold, 11.5, { gap: 2 });
    } else if (line.startsWith('- ')) {
      need(14);
      const top = y;
      write(line.slice(2), regular, 10, { indent: 14 });
      page.drawText('•', { x: MARGIN + 3, y: top - 10 * 1.45, size: 10, font: regular, color: INK });
    } else {
      write(line, regular, 10);
    }
  }

  // Signature block is kept together on one page.
  const sig = input.signature;
  const blockHeight = 150 + sig.rows.length * 14;
  need(blockHeight);
  y -= 18;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: A4.width - MARGIN, y }, thickness: 0.7, color: MUTED });
  write(sig.heading, bold, 11.5, { gap: 4 });

  const image = await pdf.embedPng(sig.image);
  const scale = Math.min(220 / image.width, 80 / image.height, 1);
  const imgHeight = image.height * scale;
  need(imgHeight + 8);
  y -= imgHeight + 4;
  page.drawImage(image, { x: MARGIN, y, width: image.width * scale, height: imgHeight });
  y -= 4;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: MARGIN + 230, y }, thickness: 0.7, color: INK });
  y -= 4;

  for (const [label, value] of sig.rows) {
    need(14);
    y -= 14;
    page.drawText(safe(bold, `${label}:`), { x: MARGIN, y, size: 9.5, font: bold, color: INK });
    const valueLines = wrap(regular, safe(regular, value), 9.5, width - 150);
    page.drawText(valueLines[0], { x: MARGIN + 150, y, size: 9.5, font: regular, color: INK });
    for (const extra of valueLines.slice(1)) {
      need(14);
      y -= 13;
      page.drawText(extra, { x: MARGIN + 150, y, size: 9.5, font: regular, color: INK });
    }
  }
  y -= 8;
  write(sig.footer, regular, 8.5, { color: MUTED });

  const pages = pdf.getPages();
  pages.forEach((p, index) => {
    p.drawText(`${index + 1} / ${pages.length}`, { x: A4.width - MARGIN - 30, y: 28, size: 8.5, font: regular, color: MUTED });
  });
  return pdf.save();
}
