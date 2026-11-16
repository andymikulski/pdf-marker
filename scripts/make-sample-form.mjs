// Generates test-output/sample-form.pdf: a fake bubble questionnaire with a
// name field and ruled answer lines, plus a /Rotate 90 page, for manual testing.
import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib';
import { mkdirSync, writeFileSync } from 'node:fs';

const doc = await PDFDocument.create();
const font = await doc.embedFont(StandardFonts.Helvetica);
const grey = rgb(0.35, 0.35, 0.35);

for (const rot of [0, 90]) {
  const p = doc.addPage([612, 792]);
  p.setRotation(degrees(rot));
  p.drawText(`Sample questionnaire${rot ? ' (rotated page)' : ''}`, { x: 60, y: 740, size: 18, font });
  p.drawText('Name:', { x: 60, y: 705, size: 11, font });
  p.drawLine({ start: { x: 100, y: 703 }, end: { x: 360, y: 703 }, thickness: 0.6, color: grey });
  for (let q = 0; q < 14; q++) {
    const y = 660 - q * 28;
    p.drawText(`${q + 1}. How much do you agree with statement ${q + 1}?`, { x: 60, y, size: 10, font });
    ['A', 'B', 'C', 'D', 'E'].forEach((l, i) => {
      const cx = 380 + i * 34;
      p.drawCircle({ x: cx, y: y + 3.5, size: 7, borderColor: grey, borderWidth: 0.7 });
      p.drawText(l, { x: cx - 2.6, y: y + 0.5, size: 7, font, color: grey });
    });
  }
  p.drawText('Describe anything else we should know:', { x: 60, y: 240, size: 10, font });
  for (let i = 0; i < 6; i++) {
    const y = 220 - i * 18;
    p.drawLine({ start: { x: 60, y }, end: { x: 552, y }, thickness: 0.5, color: grey });
  }
}

mkdirSync('test-output', { recursive: true });
writeFileSync('test-output/sample-form.pdf', await doc.save());
console.log('wrote test-output/sample-form.pdf');
