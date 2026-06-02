import { Resend } from "resend";
import { createClient } from "@supabase/supabase-js";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";

const resend = new Resend(process.env.RESEND_API_KEY);

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function sanitizeText(value, fallback = "") {
  return String(value || fallback).trim();
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function formatDate(value) {
  if (!value) return new Date().toLocaleDateString("fr-FR");
  return new Date(value).toLocaleDateString("fr-FR", {
    day: "2-digit", month: "2-digit", year: "numeric"
  });
}

function formatPrice(cents) {
  return (Number(cents || 0) / 100).toFixed(2).replace(".", ",") + " €";
}

// Génère un numéro de facture séquentiel: VP-2026-000001
async function getNextInvoiceNumber() {
  const year = new Date().getFullYear();
  const prefix = `VP-${year}-`;

  const { data, error } = await supabase
    .from("invoices")
    .select("invoice_number")
    .like("invoice_number", `${prefix}%`)
    .order("invoice_number", { ascending: false })
    .limit(1);

  if (error) {
    console.error("Invoice number fetch error:", error);
    return `${prefix}${String(Date.now()).slice(-6)}`;
  }

  if (!data || !data.length) {
    return `${prefix}000001`;
  }

  const last = data[0].invoice_number;
  const lastNum = parseInt(last.replace(prefix, ""), 10);
  const next = isNaN(lastNum) ? 1 : lastNum + 1;
  return `${prefix}${String(next).padStart(6, "0")}`;
}

async function generateInvoicePDF({
  invoiceNumber,
  invoiceDate,
  clientName,
  clientEmail,
  description,
  quantity,
  unitPrice,
  totalAmount,
  invoiceType // "stage" | "trainer"
}) {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595, 842]); // A4
  const { width, height } = page.getSize();

  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontReg  = await pdfDoc.embedFont(StandardFonts.Helvetica);

  const navy   = rgb(0.122, 0.212, 0.392); // #1F3864
  const dark   = rgb(0.1,   0.1,   0.1);
  const gray   = rgb(0.45,  0.45,  0.45);
  const light  = rgb(0.95,  0.95,  0.97);
  const white  = rgb(1,     1,     1);

  // ── Header band ───────────────────────────────────────────────────────
  page.drawRectangle({ x: 0, y: height - 100, width, height: 100, color: navy });

  page.drawText("VITAL PROTECT", {
    x: 40, y: height - 45,
    font: fontBold, size: 22, color: white
  });
  page.drawText("Formation à la sécurité personnelle", {
    x: 40, y: height - 65,
    font: fontReg, size: 10, color: rgb(0.7, 0.8, 0.9)
  });
  page.drawText("FACTURE", {
    x: width - 130, y: height - 50,
    font: fontBold, size: 20, color: white
  });

  // ── Seller info ────────────────────────────────────────────────────────
  let y = height - 130;
  const leftCol = 40;
  const rightCol = 320;

  page.drawText("Émetteur", { x: leftCol, y, font: fontBold, size: 9, color: navy });
  y -= 14;
  const sellerLines = [
    "GONIN Yann Oliver",
    "Micro-entrepreneur",
    "SIRET : 812540847 00018",
    "24 chemin de Chomillac",
    "26200 Montélimar",
    "vitalprotectformation@gmail.com",
    "07.62.33.68.99"
  ];
  for (const line of sellerLines) {
    page.drawText(line, { x: leftCol, y, font: fontReg, size: 9, color: dark });
    y -= 13;
  }
  page.drawText("TVA non applicable – art. 293B CGI", {
    x: leftCol, y, font: fontReg, size: 8, color: gray
  });

  // ── Client info ────────────────────────────────────────────────────────
  let yRight = height - 143;
  page.drawText("Client", { x: rightCol, y: yRight, font: fontBold, size: 9, color: navy });
  yRight -= 14;
  page.drawText(sanitizeText(clientName, "Client"), { x: rightCol, y: yRight, font: fontReg, size: 9, color: dark });
  yRight -= 13;
  page.drawText(sanitizeText(clientEmail), { x: rightCol, y: yRight, font: fontReg, size: 9, color: dark });

  // ── Invoice meta ───────────────────────────────────────────────────────
  yRight -= 30;
  page.drawText(`N° de facture : ${invoiceNumber}`, { x: rightCol, y: yRight, font: fontBold, size: 9, color: dark });
  yRight -= 14;
  page.drawText(`Date : ${formatDate(invoiceDate)}`, { x: rightCol, y: yRight, font: fontReg, size: 9, color: dark });

  // ── Table header ───────────────────────────────────────────────────────
  const tableTop = height - 320;
  page.drawRectangle({ x: 30, y: tableTop - 2, width: width - 60, height: 22, color: navy });
  page.drawText("Description", { x: 40, y: tableTop + 5, font: fontBold, size: 9, color: white });
  page.drawText("Qté", { x: 360, y: tableTop + 5, font: fontBold, size: 9, color: white });
  page.drawText("P.U. HT", { x: 400, y: tableTop + 5, font: fontBold, size: 9, color: white });
  page.drawText("Total HT", { x: 460, y: tableTop + 5, font: fontBold, size: 9, color: white });

  // ── Table row ──────────────────────────────────────────────────────────
  const rowY = tableTop - 26;
  page.drawRectangle({ x: 30, y: rowY - 5, width: width - 60, height: 24, color: light });

  // Wrap description if too long
  const desc = sanitizeText(description, "Prestation VITAL PROTECT");
  const descLines = [];
  let current = "";
  for (const word of desc.split(" ")) {
    if ((current + " " + word).length > 45) {
      descLines.push(current);
      current = word;
    } else {
      current = current ? current + " " + word : word;
    }
  }
  if (current) descLines.push(current);

  page.drawText(descLines[0] || desc, { x: 40, y: rowY + 6, font: fontReg, size: 9, color: dark });
  if (descLines[1]) {
    page.drawText(descLines[1], { x: 40, y: rowY - 5, font: fontReg, size: 8, color: gray });
  }
  page.drawText(String(quantity || 1), { x: 368, y: rowY + 6, font: fontReg, size: 9, color: dark });
  page.drawText(formatPrice(unitPrice * 100), { x: 398, y: rowY + 6, font: fontReg, size: 9, color: dark });
  page.drawText(formatPrice(totalAmount * 100), { x: 458, y: rowY + 6, font: fontReg, size: 9, color: dark });

  // ── Totals ─────────────────────────────────────────────────────────────
  const totY = rowY - 50;
  page.drawLine({ start: { x: 350, y: totY + 15 }, end: { x: width - 30, y: totY + 15 }, thickness: 0.5, color: gray });
  page.drawText("Total HT :", { x: 370, y: totY, font: fontReg, size: 9, color: dark });
  page.drawText(formatPrice(totalAmount * 100), { x: 458, y: totY, font: fontReg, size: 9, color: dark });

  const vatY = totY - 14;
  page.drawText("TVA (0%) :", { x: 370, y: vatY, font: fontReg, size: 9, color: gray });
  page.drawText("0,00 €", { x: 458, y: vatY, font: fontReg, size: 9, color: gray });

  const totalY = vatY - 18;
  page.drawRectangle({ x: 350, y: totalY - 5, width: width - 380, height: 20, color: navy });
  page.drawText("TOTAL TTC :", { x: 360, y: totalY + 2, font: fontBold, size: 10, color: white });
  page.drawText(formatPrice(totalAmount * 100), { x: 458, y: totalY + 2, font: fontBold, size: 10, color: white });

  // ── Legal mention ──────────────────────────────────────────────────────
  const legalY = 80;
  page.drawLine({ start: { x: 30, y: legalY + 20 }, end: { x: width - 30, y: legalY + 20 }, thickness: 0.5, color: light });
  page.drawText("TVA non applicable en vertu de l'article 293B du CGI.", { x: 40, y: legalY + 5, font: fontReg, size: 8, color: gray });
  page.drawText("VITAL PROTECT — GONIN Yann Oliver — SIRET 812540847 — 24 chemin de Chomillac, 26200 Montélimar", { x: 40, y: legalY - 8, font: fontReg, size: 7, color: gray });

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}

async function saveInvoice({ invoiceNumber, invoiceDate, clientEmail, clientName, description, totalAmount, invoiceType, referenceId }) {
  try {
    await supabase.from("invoices").insert({
      invoice_number: invoiceNumber,
      invoice_date: invoiceDate || new Date().toISOString(),
      client_email: normalizeEmail(clientEmail),
      client_name: sanitizeText(clientName),
      description: sanitizeText(description),
      total_amount: totalAmount,
      invoice_type: invoiceType,
      reference_id: referenceId || null
    });
  } catch (err) {
    console.error("Invoice save error:", err);
    // Non-bloquant
  }
}

export async function sendInvoice({
  clientEmail,
  clientName,
  description,
  quantity = 1,
  unitPrice,
  totalAmount,
  invoiceType,
  referenceId,
  invoiceDate
}) {
  try {
    if (!clientEmail) return { sent: false, error: "Email client manquant" };

    const invoiceNumber = await getNextInvoiceNumber();
    const date = invoiceDate || new Date().toISOString();

    const pdfBuffer = await generateInvoicePDF({
      invoiceNumber,
      invoiceDate: date,
      clientName,
      clientEmail,
      description,
      quantity,
      unitPrice: unitPrice || totalAmount,
      totalAmount
    });

    const base64PDF = pdfBuffer.toString("base64");

    await resend.emails.send({
      from: "VITAL PROTECT <contact@vital-protect.fr>",
      to: normalizeEmail(clientEmail),
      replyTo: "vitalprotectformation@gmail.com",
      subject: `Votre facture VITAL PROTECT — ${invoiceNumber}`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:24px;">
            <div style="width:28px;height:28px;background:#1F3864;border-radius:5px;"></div>
            <strong style="color:#1F3864;font-size:15px;letter-spacing:0.04em;">VITAL PROTECT</strong>
          </div>
          <h2 style="color:#1F3864;font-size:18px;margin:0 0 16px;">Votre facture est disponible</h2>
          <p style="color:#444;font-size:14px;line-height:1.6;margin:0 0 12px;">
            Bonjour${clientName ? ` ${sanitizeText(clientName).split(" ")[0]}` : ""},
          </p>
          <p style="color:#444;font-size:14px;line-height:1.6;margin:0 0 12px;">
            Veuillez trouver ci-joint votre facture <strong>${invoiceNumber}</strong> 
            pour : <em>${sanitizeText(description)}</em>.
          </p>
          <p style="color:#444;font-size:14px;line-height:1.6;margin:0 0 24px;">
            Montant total : <strong>${totalAmount.toFixed(2).replace(".", ",")} €</strong> TTC
          </p>
          <p style="color:#999;font-size:12px;margin-top:32px;line-height:1.5;">
            VITAL PROTECT — Formation à la sécurité personnelle<br/>
            SIRET : 812540847 — vitalprotectformation@gmail.com
          </p>
        </div>
      `,
      attachments: [
        {
          filename: `facture-${invoiceNumber}.pdf`,
          content: base64PDF
        }
      ]
    });

    await saveInvoice({ invoiceNumber, invoiceDate: date, clientEmail, clientName, description, totalAmount, invoiceType, referenceId });

    return { sent: true, invoiceNumber };
  } catch (err) {
    console.error("sendInvoice error:", err);
    return { sent: false, error: err.message };
  }
}

// API endpoint — appelable aussi manuellement depuis l'admin
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { client_email, client_name, description, quantity, unit_price, total_amount, invoice_type, reference_id } = req.body || {};

    if (!client_email || !total_amount) {
      return res.status(400).json({ error: "client_email et total_amount requis" });
    }

    const result = await sendInvoice({
      clientEmail: client_email,
      clientName: client_name,
      description,
      quantity: quantity || 1,
      unitPrice: unit_price || total_amount,
      totalAmount: Number(total_amount),
      invoiceType: invoice_type || "stage",
      referenceId: reference_id
    });

    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
