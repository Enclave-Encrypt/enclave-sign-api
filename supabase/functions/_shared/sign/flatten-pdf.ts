import {
  PDFDocument,
  StandardFonts,
  rgb,
} from "npm:pdf-lib@1.17.1";

export type FlattenField = {
  fieldType: string;
  pageIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
  value: string | null;
};

function displayFieldValue(field: FlattenField): string {
  const value = field.value?.trim() ?? "";

  if (field.fieldType === "checkbox") {
    return value === "true" ? "✓" : "";
  }

  return value;
}

function isSignatureLike(fieldType: string) {
  return fieldType === "signature" || fieldType === "initials";
}

export async function flattenFieldsIntoPdf(
  pdfBytes: Uint8Array,
  fields: FlattenField[],
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(pdfBytes);
  const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const helveticaOblique = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);
  const pages = pdfDoc.getPages();

  for (const field of fields) {
    const page = pages[field.pageIndex];
    if (!page) {
      continue;
    }

    const { width: pageWidth, height: pageHeight } = page.getSize();
    const boxWidth = field.width * pageWidth;
    const boxHeight = field.height * pageHeight;
    const boxLeft = field.x * pageWidth;
    const boxBottom = pageHeight - (field.y + field.height) * pageHeight;
    const text = displayFieldValue(field);

    page.drawRectangle({
      x: boxLeft,
      y: boxBottom,
      width: boxWidth,
      height: boxHeight,
      borderColor: rgb(0.75, 0.75, 0.75),
      borderWidth: 0.5,
    });

    if (!text) {
      continue;
    }

    const fontSize = Math.max(
      8,
      Math.min(14, boxHeight * 0.55),
    );
    const font = isSignatureLike(field.fieldType) ? helveticaOblique : helvetica;

    page.drawText(text, {
      x: boxLeft + 4,
      y: boxBottom + Math.max(4, boxHeight * 0.22),
      size: fontSize,
      font,
      color: rgb(0.1, 0.1, 0.1),
      maxWidth: Math.max(boxWidth - 8, 8),
    });
  }

  return pdfDoc.save();
}

export async function mergePdfDocuments(
  pdfByteSets: Uint8Array[],
): Promise<Uint8Array> {
  const merged = await PDFDocument.create();

  for (const bytes of pdfByteSets) {
    const source = await PDFDocument.load(bytes);
    const copied = await merged.copyPages(source, source.getPageIndices());
    for (const page of copied) {
      merged.addPage(page);
    }
  }

  return merged.save();
}
