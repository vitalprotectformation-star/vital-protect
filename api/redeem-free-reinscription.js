import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const resend = new Resend(process.env.RESEND_API_KEY);

const FREE_REINSCRIPTION_WINDOW_DAYS = 365;
const PUBLIC_STAGE_UNIT_PRICE = 30; // valeur notionnelle créditée au formateur pour une place gratuite

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char]));
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

function isMissingColumnError(error, columnName) {
  const message = String(error?.message || "").toLowerCase();
  return message.includes(String(columnName || "").toLowerCase()) && message.includes("column");
}

function withoutUndefined(payload) {
  return Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined));
}

async function insertWithOptionalColumns(table, payload, optionalColumns = []) {
  let currentPayload = withoutUndefined({ ...payload });

  for (let attempt = 0; attempt <= optionalColumns.length; attempt += 1) {
    const { data, error } = await supabase.from(table).insert(currentPayload).select().single();

    if (!error) return { data, error: null };

    const missingColumn = optionalColumns.find(
      columnName => Object.prototype.hasOwnProperty.call(currentPayload, columnName) && isMissingColumnError(error, columnName)
    );

    if (!missingColumn) return { data: null, error };

    currentPayload = { ...currentPayload };
    delete currentPayload[missingColumn];
  }

  return { data: null, error: new Error("Impossible d'enregistrer : colonnes optionnelles incompatibles") };
}

function getStageOfferType(stage = {}) {
  const explicit = normalize(stage.stage_kind || stage.offer_type);
  return explicit === "enterprise" ? "enterprise" : "public";
}

async function findEligibleSourceReservation(email, targetModuleSlug) {
  const normalizedEmail = normalize(email);

  const { data: pastReservations, error: reservationsError } = await supabase
    .from("reservations")
    .select("id, stage_id, is_free_reinscription")
    .ilike("email", normalizedEmail)
    .eq("payment_status", "paid");

  if (reservationsError || !pastReservations?.length) return null;

  const candidates = pastReservations.filter(row => !row.is_free_reinscription);
  if (!candidates.length) return null;

  const stageIds = [...new Set(candidates.map(row => row.stage_id).filter(Boolean))];
  if (!stageIds.length) return null;

  const { data: candidateStages, error: stagesError } = await supabase
    .from("stages")
    .select("id, module_slug, stage_date")
    .in("id", stageIds);

  if (stagesError || !candidateStages?.length) return null;

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - FREE_REINSCRIPTION_WINDOW_DAYS);
  const now = new Date();

  const eligibleStageIds = new Set(
    candidateStages
      .filter(stage => {
        if (normalize(stage.module_slug) !== normalize(targetModuleSlug)) return false;
        const stageDate = new Date(stage.stage_date);
        if (Number.isNaN(stageDate.getTime())) return false;
        return stageDate <= now && stageDate >= cutoff;
      })
      .map(stage => stage.id)
  );

  const eligibleReservations = candidates.filter(row => eligibleStageIds.has(row.stage_id));
  if (!eligibleReservations.length) return null;

  const { data: alreadyConsumed } = await supabase
    .from("reservations")
    .select("free_reinscription_source_reservation_id")
    .in("free_reinscription_source_reservation_id", eligibleReservations.map(row => row.id));

  const consumedIds = new Set((alreadyConsumed || []).map(row => row.free_reinscription_source_reservation_id));
  const usable = eligibleReservations.find(row => !consumedIds.has(row.id));

  return usable || null;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const firstName = String(req.body?.first_name || "").trim();
    const lastName = String(req.body?.last_name || "").trim();
    const email = normalize(req.body?.email);
    const phone = String(req.body?.phone || "").trim();
    const stageId = String(req.body?.stage_id || "").trim();

    if (!firstName) return res.status(400).json({ error: "Prénom manquant" });
    if (!email || !isValidEmail(email)) return res.status(400).json({ error: "Email invalide" });
    if (!stageId) return res.status(400).json({ error: "Stage manquant" });

    const { data: stage, error: stageError } = await supabase
      .from("stages")
      .select("*")
      .eq("id", stageId)
      .eq("status", "published")
      .single();

    if (stageError || !stage) {
      return res.status(404).json({ error: "Stage introuvable" });
    }

    if (getStageOfferType(stage) === "enterprise") {
      return res.status(400).json({ error: "La réinscription gratuite n'est pas disponible sur les formats entreprise." });
    }

    if (Number(stage.remaining_places || 0) <= 0) {
      return res.status(409).json({ error: "Il n'y a plus de place disponible sur ce stage." });
    }

    const sourceReservation = await findEligibleSourceReservation(email, stage.module_slug);

    if (!sourceReservation) {
      return res.status(403).json({
        error: "Aucune réinscription gratuite éligible trouvée pour cet email sur ce module (stage déjà suivi il y a moins d'un an, non déjà utilisé)."
      });
    }

    const trainerPayoutAmount = PUBLIC_STAGE_UNIT_PRICE; // VP prend 0% de commission, le formateur touche la valeur pleine

    const reservationInsert = await insertWithOptionalColumns("reservations", {
      stage_id: stage.id,
      stage_title: stage.title,
      first_name: firstName,
      last_name: lastName,
      email,
      phone,
      places: 1,
      total_amount: PUBLIC_STAGE_UNIT_PRICE,
      stripe_session_id: `free-reinscription-${sourceReservation.id}`,
      payment_status: "paid",
      stage_kind: "public",
      requested_places: 1,
      trainer_payout_amount: trainerPayoutAmount,
      vital_protect_commission_rate: 0,
      trainer_payout_status: "scheduled",
      is_free_reinscription: true,
      free_reinscription_source_reservation_id: sourceReservation.id
    }, ["is_free_reinscription", "free_reinscription_source_reservation_id"]);

    if (reservationInsert.error) {
      console.error("Erreur insertion réinscription gratuite:", reservationInsert.error);
      return res.status(500).json({ error: "Impossible d'enregistrer la réinscription." });
    }

    const newRemainingPlaces = Math.max(0, Number(stage.remaining_places || 0) - 1);
    await supabase.from("stages").update({ remaining_places: newRemainingPlaces }).eq("id", stage.id);

    if (process.env.RESEND_API_KEY) {
      try {
        await resend.emails.send({
          from: "VITAL PROTECT <contact@vital-protect.fr>",
          to: email,
          replyTo: "contact@vital-protect.fr",
          subject: "Réinscription gratuite confirmée",
          html: `
            <h2>Réinscription gratuite confirmée ✅</h2>
            <p>Bonjour ${escapeHtml(firstName)} ${escapeHtml(lastName)},</p>
            <p>Votre place gratuite sur <strong>${escapeHtml(stage.title)}</strong> est confirmée, dans le cadre de votre réinscription gratuite (stage déjà suivi il y a moins d'un an).</p>
            <p>Merci pour votre confiance.</p>
            <p><strong>VITAL PROTECT</strong></p>
          `
        });
      } catch (emailError) {
        console.error("Erreur envoi email réinscription gratuite:", emailError);
      }
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("Erreur redeem-free-reinscription:", error);
    return res.status(500).json({ error: "Erreur serveur" });
  }
}
