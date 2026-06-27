import { PDFDocument, StandardFonts, rgb } from "npm:pdf-lib@1.17.1";

export type CertificateRecipient = {
  name: string | null;
  email: string;
  signedAt: string | null;
  signatureAlgorithm: string | null;
};

export type CertificateDocument = {
  fileName: string;
  contentHash: string | null;
};

export async function buildCertificateOfCompletionPdf(input: {
  subject: string;
  envelopeId: string;
  completedAt: string;
  recipients: CertificateRecipient[];
  documents: CertificateDocument[];
}): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  let y = 740;

  const drawLine = (
    text: string,
    options?: { bold?: boolean; size?: number; color?: [number, number, number] },
  ) => {
    const size = options?.size ?? 11;
    const font = options?.bold ? bold : regular;
    const color = options?.color ?? [0.12, 0.12, 0.12];
    page.drawText(text, {
      x: 48,
      y,
      size,
      font,
      color: rgb(color[0], color[1], color[2]),
      maxWidth: 516,
    });
    y -= size + 8;
  };

  drawLine("Certificate of Completion", { bold: true, size: 20 });
  drawLine("Enclave Sign", { size: 10, color: [0.45, 0.45, 0.45] });
  y -= 8;

  drawLine(`Envelope: ${input.subject}`, { bold: true, size: 13 });
  drawLine(`Envelope ID: ${input.envelopeId}`);
  drawLine(`Completed: ${new Date(input.completedAt).toLocaleString()}`);
  y -= 8;

  drawLine("Signers", { bold: true, size: 12 });
  for (const recipient of input.recipients) {
    const label = recipient.name?.trim() || recipient.email;
    const signedAt = recipient.signedAt
      ? new Date(recipient.signedAt).toLocaleString()
      : "—";
    drawLine(
      `• ${label} <${recipient.email}> — signed ${signedAt}${
        recipient.signatureAlgorithm
          ? ` (${recipient.signatureAlgorithm})`
          : ""
      }`,
    );
  }

  y -= 8;
  drawLine("Documents", { bold: true, size: 12 });
  for (const document of input.documents) {
    drawLine(
      `• ${document.fileName}${
        document.contentHash
          ? ` — SHA-256 ${document.contentHash.slice(0, 16)}…`
          : ""
      }`,
    );
  }

  y -= 8;
  drawLine(
    "Field values have been flattened into the completed PDFs. Cryptographic recipient signatures and envelope encryption metadata are retained in Enclave Sign records.",
    { size: 9, color: [0.4, 0.4, 0.4] },
  );

  return pdf.save();
}
