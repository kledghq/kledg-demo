/**
 * Builds a tiny one-page PDF receipt for the simulated Qonto attachments.
 * Hand-written PDF 1.4 with the standard Helvetica font (no dependency).
 */

function escapePdfText(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
}

/** Keeps characters that WinAnsi (latin1 subset) can render. */
function toLatin1(text: string): string {
  return text.replace(/[‘’]/g, "'").replace(/[^\x20-\x7e\xa0-\xff]/g, '?')
}

export function buildReceiptPdf(title: string, lines: string[]): Buffer {
  const content = [
    'BT',
    '/F1 18 Tf',
    '50 780 Td',
    `(${escapePdfText(toLatin1(title))}) Tj`,
    '/F1 11 Tf',
    ...lines.flatMap((line) => ['0 -22 Td', `(${escapePdfText(toLatin1(line))}) Tj`]),
    '0 -44 Td',
    '/F1 9 Tf',
    `(${escapePdfText(toLatin1('Document fictif généré par l\'instance de démonstration Kledg.'))}) Tj`,
    'ET',
  ].join('\n')

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`,
  ]

  let pdf = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'))
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`
  })
  const xrefOffset = Buffer.byteLength(pdf, 'latin1')
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
  return Buffer.from(pdf, 'latin1')
}
