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

async function sendAdminNotification({ reservation = {}, stage = {}, decision = "" }) {
  const to = process.env.ADMIN_NOTIFY_EMAIL || process.env.RESEND_REPLY_TO || "contact@vital-protect.fr";
  if (!resend || !to) return { sent: false, skipped: true };

  const decisionLabel = decision === "accepted"
    ? "a accepté la nouvelle date"
    : "demande le remboursement";

  try {
    const response = await resend.emails.send({
      from: process.env.RESEND_FROM || "VITAL PROTECT <contact@vital-protect.fr>",
      replyTo: process.env.RESEND_REPLY_TO || "contact@vital-protect.fr",
      to,
      subject: `Réponse client au report VITAL PROTECT — ${decisionLabel}`,
      html: `
        <h2>Réponse client au report</h2>
        <p><strong>${escapeHtml(reservation.first_name || "")} ${escapeHtml(reservation.last_name || "")}</strong> ${escapeHtml(decisionLabel)}.</p>
        <ul>
          <li><strong>Email :</strong> ${escapeHtml(reservation.email || reservation.customer_email || "")}</li>
          <li><strong>Stage :</strong> ${escapeHtml(stage.title || reservation.stage_title || "Stage VITAL PROTECT")}</li>
          <li><strong>Date initiale :</strong> ${escapeHtml(formatDateForEmail(reservation.report_original_stage_date))}</li>
          <li><strong>Nouvelle date :</strong> ${escapeHtml(formatDateForEmail(reservation.report_proposed_stage_date || stage.stage_date))}</li>
        </ul>
      `
    });
    return { sent: true, response };
  } catch (error) {
    console.error("Erreur notification admin report:", error);
    return { sent: false, error: error.message };
  }
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

    const adminNotification = await sendAdminNotification({
      reservation: data,
      stage,
      decision: accepted ? "accepted" : "refund_requested"
    });

    return res.status(200).json({
      success: true,
      decision: accepted ? "accepted" : "refund_requested",
      reservation: publicReservation(data, stage),
      admin_email_sent: Boolean(adminNotification?.sent)
    });
  } catch (error) {
    console.error("respond-report error:", error);
    return res.status(500).json({ error: error.message || "Erreur serveur" });
  }
}
