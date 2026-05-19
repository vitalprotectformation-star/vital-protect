import { Resend } from "resend";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function sanitizeText(value, fallback = "") {
  return String(value || fallback).trim();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDateForEmail(value) {
  if (!value) return "à confirmer";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value || "");
  return date.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function publicReservation(row = {}, stage = {}) {
  return {
    id: row.id,
    first_name: row.first_name || "",
    last_name: row.last_name || "",
    email: row.email || row.customer_email || "",
    stage_title: stage.title || row.stage_title || "Stage VITAL PROTECT",
    city: stage.city || row.city || "",
    postal_code: stage.postal_code || row.postal_code || "",
    original_stage_date: row.report_original_stage_date || row.original_stage_date || "",
    proposed_stage_date: row.report_proposed_stage_date || stage.stage_date || "",
    response_status: row.report_response_status || "pending",
    payment_status: row.payment_status || "",
    refunded_at: row.refunded_at || "",
    stripe_refund_id: row.stripe_refund_id || "",
    places: row.places || 1,
    total_amount: row.total_amount || 0
  };
}

async function getReservationByToken(token) {
  const { data: reservation, error } = await supabase
    .from("reservations")
    .select("*")
    .eq("report_response_token", token)
    .maybeSingle();

  if (error) throw error;
  if (!reservation) return { reservation: null, stage: null };

  const { data: stage, error: stageError } = await supabase
    .from("stages")
    .select("*")
    .eq("id", reservation.stage_id)
    .maybeSingle();

  if (stageError) throw stageError;
  return { reservation, stage: stage || {} };
}

function getMailFrom() {
  return process.env.RESEND_FROM || "VITAL PROTECT <contact@vital-protect.fr>";
}

function getMailReplyTo() {
  return process.env.RESEND_REPLY_TO || process.env.ADMIN_NOTIFY_EMAIL || "contact@vital-protect.fr";
}

function getAdminNotificationEmail() {
  return process.env.ADMIN_NOTIFY_EMAIL || process.env.RESEND_ADMIN_EMAIL || process.env.RESEND_REPLY_TO || "herosboxinggym@gmail.com";
}

function getDecisionLabel(decision = "") {
  return decision === "accepted"
    ? "a accepté la nouvelle date"
    : "demande le remboursement";
}

function buildStageLines({ reservation = {}, stage = {} }) {
  const title = stage.title || reservation.stage_title || "Stage VITAL PROTECT";
  const oldDate = formatDateForEmail(reservation.report_original_stage_date);
  const newDate = formatDateForEmail(reservation.report_proposed_stage_date || stage.stage_date);
  const place = [stage.city || reservation.city || "", stage.postal_code || reservation.postal_code || ""].filter(Boolean).join(" · ") || "à confirmer";
  return { title, oldDate, newDate, place };
}

async function sendEmailSafe(payload) {
  try {
    if (!resend || !payload?.to) return { sent: false, skipped: true };
    const response = await resend.emails.send({
      from: getMailFrom(),
      replyTo: getMailReplyTo(),
      ...payload
    });
    return { sent: true, response };
  } catch (error) {
    console.error("Erreur email report:", error);
    return { sent: false, error: error.message };
  }
}

async function sendAdminNotification({ reservation = {}, stage = {}, decision = "" }) {
  const to = getAdminNotificationEmail();
  const decisionLabel = getDecisionLabel(decision);
  const { title, oldDate, newDate, place } = buildStageLines({ reservation, stage });
  const clientName = `${reservation.first_name || ""} ${reservation.last_name || ""}`.trim() || "Client";
  const clientEmail = reservation.email || reservation.customer_email || "";

  return await sendEmailSafe({
    to,
    subject: `Réponse client au report — ${decisionLabel}`,
    text: [
      "Réponse client au report VITAL PROTECT",
      "",
      `${clientName} ${decisionLabel}.`,
      `Email client : ${clientEmail}`,
      `Stage : ${title}`,
      `Lieu : ${place}`,
      `Date initiale : ${oldDate}`,
      `Nouvelle date : ${newDate}`,
      "",
      decision === "accepted"
        ? "La réservation reste confirmée sur la nouvelle date."
        : "Le client demande un remboursement. La demande doit être traitée dans l’admin."
    ].join("\n"),
    html: `
      <div style="font-family:Arial,sans-serif;color:#10223a;line-height:1.55;">
        <h2 style="margin:0 0 12px;color:#0f243d;">Réponse client au report</h2>
        <p><strong>${escapeHtml(clientName)}</strong> ${escapeHtml(decisionLabel)}.</p>
        <ul>
          <li><strong>Email client :</strong> ${escapeHtml(clientEmail)}</li>
          <li><strong>Stage :</strong> ${escapeHtml(title)}</li>
          <li><strong>Lieu :</strong> ${escapeHtml(place)}</li>
          <li><strong>Date initiale :</strong> ${escapeHtml(oldDate)}</li>
          <li><strong>Nouvelle date :</strong> ${escapeHtml(newDate)}</li>
        </ul>
        <p>${decision === "accepted"
          ? "La réservation reste confirmée sur la nouvelle date."
          : "Le client demande un remboursement. La demande doit être traitée dans l’admin."}</p>
        <p style="margin-top:18px;"><strong>VITAL PROTECT</strong></p>
      </div>
    `
  });
}

async function sendClientConfirmation({ reservation = {}, stage = {}, decision = "" }) {
  const to = reservation.email || reservation.customer_email || "";
  if (!to) return { sent: false, skipped: true };

  const accepted = decision === "accepted";
  const { title, oldDate, newDate, place } = buildStageLines({ reservation, stage });
  const clientName = `${reservation.first_name || ""} ${reservation.last_name || ""}`.trim();
  const subject = accepted
    ? "Votre nouvelle date de stage est confirmée"
    : "Votre demande de remboursement est bien reçue";
  const mainText = accepted
    ? "Nous confirmons la prise en compte de votre accord pour la nouvelle date. Votre réservation reste active."
    : "Nous confirmons la prise en compte de votre demande de remboursement. VITAL PROTECT va la traiter depuis l’espace d’administration.";

  return await sendEmailSafe({
    to,
    subject,
    text: [
      `Bonjour ${clientName || ""},`,
      "",
      mainText,
      "",
      `Stage : ${title}`,
      `Lieu : ${place}`,
      `Date initiale : ${oldDate}`,
      `Nouvelle date proposée : ${newDate}`,
      "",
      accepted
        ? "Aucune autre action n’est nécessaire de votre côté."
        : "Vous recevrez une confirmation lorsque le remboursement aura été lancé.",
      "",
      "VITAL PROTECT"
    ].join("\n"),
    html: `
      <div style="font-family:Arial,sans-serif;color:#10223a;line-height:1.65;">
        <h2 style="margin:0 0 12px;color:#0f243d;">${escapeHtml(subject)}</h2>
        <p>Bonjour ${escapeHtml(clientName)},</p>
        <p>${escapeHtml(mainText)}</p>
        <ul>
          <li><strong>Stage :</strong> ${escapeHtml(title)}</li>
          <li><strong>Lieu :</strong> ${escapeHtml(place)}</li>
          <li><strong>Date initiale :</strong> ${escapeHtml(oldDate)}</li>
          <li><strong>Nouvelle date proposée :</strong> ${escapeHtml(newDate)}</li>
        </ul>
        <p>${accepted
          ? "Aucune autre action n’est nécessaire de votre côté."
          : "Vous recevrez une confirmation lorsque le remboursement aura été lancé."}</p>
        <p style="margin-top:18px;"><strong>VITAL PROTECT</strong></p>
      </div>
    `
  });
}

export default async function handler(req, res) {
  try {
    const token = sanitizeText(req.method === "GET" ? req.query?.token : req.body?.token);
    if (!token || token.length < 20) {
      return res.status(400).json({ error: "Lien de réponse invalide ou expiré." });
    }

    const { reservation, stage } = await getReservationByToken(token);
    if (!reservation) {
      return res.status(404).json({ error: "Réservation introuvable pour ce lien." });
    }

    if (req.method === "GET") {
      return res.status(200).json({ success: true, reservation: publicReservation(reservation, stage) });
    }

    if (req.method !== "POST") {
      res.setHeader("Allow", "GET, POST");
      return res.status(405).json({ error: "Méthode non autorisée" });
    }

    const decision = normalize(req.body?.decision);
    if (!["accept", "accepted", "refund", "refund_requested"].includes(decision)) {
      return res.status(400).json({ error: "Choix invalide." });
    }

    if (normalize(reservation.payment_status) === "refunded" || reservation.refunded_at || reservation.stripe_refund_id) {
      return res.status(400).json({ error: "Cette réservation est déjà remboursée." });
    }

    if (reservation.trainer_payout_stripe_transfer_id || reservation.trainer_payout_paid_at) {
      return res.status(400).json({ error: "Cette réservation a déjà été reversée au formateur. Contactez VITAL PROTECT." });
    }

    const now = new Date().toISOString();
    const accepted = decision === "accept" || decision === "accepted";
    const updatePayload = accepted
      ? {
          report_response_status: "accepted",
          report_responded_at: now,
          trainer_payout_status: "scheduled",
          trainer_payout_admin_note: "Client : nouvelle date acceptée. Reversement replanifié après réalisation du stage."
        }
      : {
          report_response_status: "refund_requested",
          report_responded_at: now,
          trainer_payout_status: "blocked",
          trainer_payout_admin_note: "Client : remboursement demandé après proposition de report."
        };

    const { data, error } = await supabase
      .from("reservations")
      .update(updatePayload)
      .eq("id", reservation.id)
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });

    const decisionStatus = accepted ? "accepted" : "refund_requested";
    const [adminNotification, clientConfirmation] = await Promise.all([
      sendAdminNotification({ reservation: data, stage, decision: decisionStatus }),
      sendClientConfirmation({ reservation: data, stage, decision: decisionStatus })
    ]);

    return res.status(200).json({
      success: true,
      decision: decisionStatus,
      reservation: publicReservation(data, stage),
      admin_email_sent: Boolean(adminNotification?.sent),
      client_email_sent: Boolean(clientConfirmation?.sent)
    });
  } catch (error) {
    console.error("respond-report error:", error);
    return res.status(500).json({ error: error.message || "Erreur serveur" });
  }
}
