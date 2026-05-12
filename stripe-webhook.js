import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;
const resend = new Resend(process.env.RESEND_API_KEY);

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const PUBLIC_STAGE_UNIT_PRICE = 30;
const ENTERPRISE_STAGE_PRICE = 390;
const PAYOUT_DAY_OF_MONTH = 20;

export const config = {
  api: {
    bodyParser: false
  }
};

async function getRawBody(readable) {
  const chunks = [];

  for await (const chunk of readable) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }

  return Buffer.concat(chunks);
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatDateForEmail(value) {
  if (!value) return "à confirmer";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  });
}

function formatDateOnly(date) {
  return new Date(date).toISOString().split("T")[0];
}

function formatEuroAmount(value) {
  const amount = Number(value || 0);
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0
  }).format(Number.isFinite(amount) ? amount : 0);
}

function addYears(date, years) {
  const d = new Date(date);
  d.setFullYear(d.getFullYear() + years);
  return formatDateOnly(d);
}

function isMissingColumnError(error, columnName) {
  const message = String(error?.message || "").toLowerCase();
  return message.includes(String(columnName || "").toLowerCase()) && message.includes("column");
}

function withoutUndefined(payload) {
  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined)
  );
}

async function insertWithOptionalColumns(table, payload, optionalColumns = []) {
  const omittedColumns = [];
  let currentPayload = withoutUndefined({ ...payload });

  for (let attempt = 0; attempt <= optionalColumns.length; attempt += 1) {
    const { data, error } = await supabase
      .from(table)
      .insert(currentPayload)
      .select()
      .single();

    if (!error) {
      return { data, error: null, omittedColumns };
    }

    const missingColumn = optionalColumns.find(
      columnName => Object.prototype.hasOwnProperty.call(currentPayload, columnName) && isMissingColumnError(error, columnName)
    );

    if (!missingColumn) {
      return { data: null, error, omittedColumns };
    }

    omittedColumns.push(missingColumn);
    currentPayload = { ...currentPayload };
    delete currentPayload[missingColumn];
  }

  return {
    data: null,
    error: new Error("Impossible d'enregistrer : colonnes optionnelles incompatibles"),
    omittedColumns
  };
}

async function sendEmailSafe(payload) {
  try {
    if (!process.env.RESEND_API_KEY) return;
    const response = await resend.emails.send(payload);
    console.log("Email envoyé :", response);
  } catch (error) {
    console.error("Erreur envoi email :", error);
  }
}

function classifyModule(...values) {
  const text = values
    .filter(Boolean)
    .map(value => normalize(value)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, " "))
    .join(" ");

  if (!text.trim()) return "public";

  if (
    text.includes("professionnel") ||
    text.includes("professionnelle") ||
    text.includes("entreprise") ||
    text.includes("salarie") ||
    text.includes("salaries") ||
    text.includes("equipe") ||
    text.includes("agressif") ||
    text.includes("agressive") ||
    text.includes("tendu") ||
    text.includes("tendue") ||
    text.includes("comportement")
  ) {
    return "enterprise";
  }

  return "public";
}

function getStageOfferType(stage = {}) {
  const explicit = normalize(
    stage.stage_kind ||
    stage.offer_type ||
    stage.audience ||
    stage.price_model
  );

  if (["enterprise", "entreprise", "team", "b2b", "company", "package"].includes(explicit)) {
    return "enterprise";
  }

  if (["public", "particulier", "individual", "per_person", "standard"].includes(explicit)) {
    return "public";
  }

  return classifyModule(stage.training_type, stage.title, stage.description, stage.module_slug);
}

function isRealizedStage(stage) {
  const status = normalize(stage?.status);
  return ["completed", "realized", "réalisé", "realise"].includes(status);
}

function isInLast12Months(dateString) {
  if (!dateString) return false;
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return false;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = new Date(today);
  start.setFullYear(start.getFullYear() - 1);

  date.setHours(0, 0, 0, 0);
  return date >= start && date <= today;
}

function getCommissionTier(realizedStages12Months) {
  const count = Number(realizedStages12Months || 0);
  if (count >= 12) return { rate: 0.075, label: "Formateur mensuel" };
  if (count >= 6) return { rate: 0.15, label: "Formateur régulier" };
  return { rate: 0.30, label: "Formateur lancement" };
}

function getPayoutDateForStage(stageDateString) {
  if (!stageDateString) return null;
  const stageDate = new Date(stageDateString);
  if (Number.isNaN(stageDate.getTime())) return null;
  const payoutDate = new Date(stageDate.getFullYear(), stageDate.getMonth() + 1, PAYOUT_DAY_OF_MONTH);
  return payoutDate.toISOString().slice(0, 10);
}

function calculateTrainerPayout(grossAmount, commissionRate) {
  const amount = Number(grossAmount || 0);
  const rate = Number(commissionRate || 0);
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  if (!Number.isFinite(rate) || rate < 0 || rate >= 1) return amount;
  return Math.round(amount * (1 - rate) * 100) / 100;
}

async function getTrainerCommissionTier(trainerId) {
  if (!trainerId) return getCommissionTier(0);

  const { data, error } = await supabase
    .from("stages")
    .select("id, status, stage_date")
    .eq("trainer_id", trainerId);

  if (error) {
    console.error("Supabase trainer commission fetch error:", error);
    return getCommissionTier(0);
  }

  const realizedStages12Months = (data || []).filter(stage => isRealizedStage(stage) && isInLast12Months(stage.stage_date)).length;
  return getCommissionTier(realizedStages12Months);
}

async function handleAffiliationCheckout(session) {
  const metadata = session.metadata || {};
  const email = normalizeEmail(metadata.email || session.customer_email || "");

  if (!email) {
    throw new Error("Missing email for affiliation");
  }

  const today = new Date();
  const affiliationStart = formatDateOnly(today);
  const affiliationEnd = addYears(today, 1);

  const { data: trainer, error: trainerFetchError } = await supabase
    .from("trainers")
    .select("id, email, first_name, last_name")
    .eq("email", email)
    .maybeSingle();

  if (trainerFetchError) {
    console.error("Supabase trainer fetch error:", trainerFetchError);
    throw new Error("Failed to fetch trainer for affiliation");
  }

  if (!trainer) {
    console.error("Aucun trainer trouvé pour :", email);
    return;
  }

  const { error: affiliationUpdateError } = await supabase
    .from("trainers")
    .update({
      affiliation_status: "active",
      affiliation_start: affiliationStart,
      affiliation_end: affiliationEnd
    })
    .eq("id", trainer.id);

  if (affiliationUpdateError) {
    console.error("Supabase affiliation update error:", affiliationUpdateError);
    throw new Error("Failed to update affiliation");
  }

  await sendEmailSafe({
    from: "VITAL PROTECT <contact@vital-protect.fr>",
    to: email,
    replyTo: "contact@vital-protect.fr",
    subject: "Affiliation renouvelée avec succès",
    html: `
      <h2>Affiliation renouvelée ✅</h2>
      <p>Bonjour ${escapeHtml(trainer.first_name || "")} ${escapeHtml(trainer.last_name || "")},</p>
      <p>Votre affiliation <strong>VITAL PROTECT</strong> a bien été renouvelée.</p>
      <ul>
        <li><strong>Début :</strong> ${escapeHtml(affiliationStart)}</li>
        <li><strong>Fin :</strong> ${escapeHtml(affiliationEnd)}</li>
      </ul>
      <p>Merci pour votre confiance.</p>
      <p><strong>VITAL PROTECT</strong></p>
    `
  });
}

async function handleTrainerCheckout(session) {
  const metadata = session.metadata || {};

  const firstName = metadata.first_name || "";
  const lastName = metadata.last_name || "";
  const email = normalizeEmail(metadata.email || session.customer_email || "");
  const phone = metadata.phone || "";
  const city = metadata.city || "";
  const trainingType = metadata.training_type || "";
  const message = metadata.message || "";
  const trainerSessionId = metadata.session_id || null;

  if (!email) {
    throw new Error("Missing email for trainer checkout");
  }

  const stripePaymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id || "";

  const { data: existingTrainerRegistration, error: existingTrainerRegistrationError } =
    await supabase
      .from("trainer_session_registrations")
      .select("id")
      .eq("stripe_session_id", session.id)
      .maybeSingle();

  if (existingTrainerRegistrationError) {
    console.error("Supabase existing trainer registration fetch error:", existingTrainerRegistrationError);
    throw new Error("Failed to check existing trainer registration");
  }

  if (existingTrainerRegistration) return;

  const { error: trainerRegistrationError } = await supabase
    .from("trainer_session_registrations")
    .insert({
      session_id: trainerSessionId,
      first_name: firstName,
      last_name: lastName,
      email,
      phone,
      city,
      message,
      stripe_session_id: session.id,
      stripe_payment_intent_id: stripePaymentIntentId,
      payment_mode: "manual_capture",
      payment_status: "authorized",
      validation_status: "pending"
    });

  if (trainerRegistrationError) {
    console.error("Supabase trainer registration insert error:", trainerRegistrationError);
    throw new Error("Failed to save trainer registration");
  }

  await sendEmailSafe({
    from: "VITAL PROTECT <contact@vital-protect.fr>",
    to: email,
    replyTo: "contact@vital-protect.fr",
    subject: "Réservation de votre place confirmée",
    html: `
      <h2>Réservation enregistrée ✅</h2>
      <p>Bonjour ${escapeHtml(firstName)} ${escapeHtml(lastName)},</p>
      <p>Votre réservation pour le parcours formateur <strong>VITAL PROTECT</strong> a bien été enregistrée.</p>
      <ul>
        <li><strong>Module :</strong> ${escapeHtml(trainingType)}</li>
        <li><strong>Statut paiement :</strong> empreinte bancaire autorisée</li>
        <li><strong>Validation :</strong> en attente</li>
      </ul>
      <p>Vous recevrez la suite des étapes prochainement.</p>
      <p><strong>VITAL PROTECT</strong></p>
    `
  });
}

async function notifyTrainerStageReservation({ stage, reservation, newRemainingPlaces, previousRemainingPlaces, trainerPayoutAmount, commissionTier }) {
  try {
    if (!stage?.trainer_id) return;

    const { data: trainer, error: trainerError } = await supabase
      .from("trainers")
      .select("email, first_name, last_name")
      .eq("id", stage.trainer_id)
      .maybeSingle();

    if (trainerError) {
      console.error("Supabase trainer notification fetch error:", trainerError);
      return;
    }

    if (!trainer?.email) return;

    const offerType = getStageOfferType(stage);
    const inventoryCapacity = offerType === "enterprise" ? 1 : Number(stage.max_participants || 0);
    const previousRemaining = Number(previousRemainingPlaces || 0);
    const remaining = Number(newRemainingPlaces || 0);
    const soldUnits = inventoryCapacity > 0 ? Math.max(0, inventoryCapacity - remaining) : null;
    const fillPercent = inventoryCapacity > 0 ? Math.min(100, Math.round((soldUnits / inventoryCapacity) * 100)) : null;
    const previousPercent = inventoryCapacity > 0 ? Math.min(100, Math.round(((inventoryCapacity - previousRemaining) / inventoryCapacity) * 100)) : 0;

    let subject = "Nouvelle inscription à votre stage VITAL PROTECT";
    if (fillPercent === 100) {
      subject = "Votre stage VITAL PROTECT est complet";
    } else if (previousPercent < 80 && fillPercent >= 80) {
      subject = "Votre stage VITAL PROTECT atteint 80 % de remplissage";
    } else if (previousPercent < 50 && fillPercent >= 50) {
      subject = "Votre stage VITAL PROTECT atteint 50 % de remplissage";
    }

    await sendEmailSafe({
      from: "VITAL PROTECT <contact@vital-protect.fr>",
      to: trainer.email,
      replyTo: "contact@vital-protect.fr",
      subject,
      html: `
        <h2>Nouvelle réservation ✅</h2>
        <p>Bonjour ${escapeHtml(trainer.first_name || "")},</p>
        <p>Une réservation payée vient d’être enregistrée pour votre stage.</p>
        <ul>
          <li><strong>Stage :</strong> ${escapeHtml(stage.title || reservation.stageTitle || "Stage VITAL PROTECT")}</li>
          <li><strong>Date :</strong> ${escapeHtml(formatDateForEmail(stage.stage_date))}${stage.start_time ? ` à ${escapeHtml(stage.start_time)}` : ""}</li>
          <li><strong>Ville :</strong> ${escapeHtml(stage.city || "à confirmer")}</li>
          <li><strong>Client :</strong> ${escapeHtml(reservation.firstName || "")} ${escapeHtml(reservation.lastName || "")}</li>
          <li><strong>Email :</strong> ${escapeHtml(reservation.email || "—")}</li>
          <li><strong>Téléphone :</strong> ${escapeHtml(reservation.phone || "—")}</li>
          <li><strong>Type :</strong> ${offerType === "enterprise" ? "Forfait entreprise" : "Inscription individuelle"}</li>
          <li><strong>${offerType === "enterprise" ? "Session réservée" : "Places réservées"} :</strong> ${escapeHtml(reservation.places)}</li>
          <li><strong>Versement VITAL PROTECT estimé :</strong> ${escapeHtml(formatEuroAmount(trainerPayoutAmount))}</li>
          <li><strong>Niveau de commission :</strong> ${escapeHtml(commissionTier.label)} (${Math.round(commissionTier.rate * 1000) / 10} % VITAL PROTECT)</li>
          ${inventoryCapacity > 0 ? `<li><strong>Remplissage :</strong> ${soldUnits}/${inventoryCapacity}, soit ${fillPercent} %</li>` : ""}
          <li><strong>${offerType === "enterprise" ? "Session disponible" : "Places restantes"} :</strong> ${escapeHtml(remaining)}</li>
        </ul>
        <p>Le reversement sera préparé après réalisation du stage, selon le cycle mensuel VITAL PROTECT.</p>
        <p><strong>VITAL PROTECT</strong></p>
      `
    });
  } catch (error) {
    console.error("Erreur notification formateur:", error);
  }
}

async function handleStageCheckout(session) {
  const metadata = session.metadata || {};

  const stageId = metadata.stage_id;
  const stageTitle = metadata.stage_title || "Stage";
  const stageKind = metadata.stage_kind || "";
  const firstName = metadata.first_name || "";
  const lastName = metadata.last_name || "";
  const email = normalizeEmail(metadata.email || session.customer_email || "");
  const phone = metadata.phone || "";
  const places = Number(metadata.places || 1);
  const requestedPlaces = Number(metadata.requested_places || places);
  const unitPrice = Number(metadata.unit_price || 0);
  const totalAmount = Number(session.amount_total || 0) > 0
    ? Math.round(Number(session.amount_total) / 100)
    : places * unitPrice;

  if (!stageId) {
    throw new Error("Missing stage_id in metadata");
  }

  const { data: existingReservation, error: existingReservationError } = await supabase
    .from("reservations")
    .select("id")
    .eq("stripe_session_id", session.id)
    .maybeSingle();

  if (existingReservationError) {
    console.error("Supabase existing reservation fetch error:", existingReservationError);
    throw new Error("Failed to check existing reservation");
  }

  if (existingReservation) return;

  const { data: stage, error: stageError } = await supabase
    .from("stages")
    .select("*")
    .eq("id", stageId)
    .single();

  if (stageError) {
    console.error("Supabase stage fetch error:", stageError);
    throw new Error("Failed to fetch stage");
  }

  const offerType = stageKind || getStageOfferType(stage);
  const commissionTier = await getTrainerCommissionTier(stage.trainer_id);
  const trainerPayoutAmount = calculateTrainerPayout(totalAmount, commissionTier.rate);
  const payoutDueDate = getPayoutDateForStage(stage.stage_date);

  const reservationInsert = await insertWithOptionalColumns("reservations", {
    stage_id: stageId,
    stage_title: stageTitle,
    first_name: firstName,
    last_name: lastName,
    email,
    phone,
    places,
    total_amount: totalAmount,
    stripe_session_id: session.id,
    payment_status: "paid",
    stage_kind: offerType,
    requested_places: requestedPlaces,
    trainer_payout_amount: trainerPayoutAmount,
    vital_protect_commission_rate: commissionTier.rate,
    trainer_payout_status: "scheduled",
    trainer_payout_due_date: payoutDueDate
  }, [
    "stage_kind",
    "requested_places",
    "trainer_payout_amount",
    "vital_protect_commission_rate",
    "trainer_payout_status",
    "trainer_payout_due_date"
  ]);

  if (reservationInsert.error) {
    console.error("Supabase reservation insert error:", reservationInsert.error);
    throw new Error("Failed to save reservation");
  }

  const newRemainingPlaces = Math.max(0, Number(stage.remaining_places || 0) - places);

  const { error: updateError } = await supabase
    .from("stages")
    .update({ remaining_places: newRemainingPlaces })
    .eq("id", stageId);

  if (updateError) {
    console.error("Supabase stage update error:", updateError);
    throw new Error("Failed to update stage places");
  }

  if (email) {
    await sendEmailSafe({
      from: "VITAL PROTECT <contact@vital-protect.fr>",
      to: email,
      replyTo: "contact@vital-protect.fr",
      subject: "Confirmation de votre réservation",
      html: `
        <h2>Réservation confirmée ✅</h2>
        <p>Bonjour ${escapeHtml(firstName || "")} ${escapeHtml(lastName || "")},</p>
        <p>Votre réservation a bien été enregistrée sur <strong>VITAL PROTECT</strong>.</p>
        <ul>
          <li><strong>Stage :</strong> ${escapeHtml(stageTitle)}</li>
          <li><strong>Type :</strong> ${offerType === "enterprise" ? "Forfait entreprise jusqu’à 20 personnes" : "Inscription individuelle"}</li>
          <li><strong>${offerType === "enterprise" ? "Session" : "Places"} :</strong> ${escapeHtml(offerType === "enterprise" ? "1" : places)}</li>
          <li><strong>Montant :</strong> ${escapeHtml(formatEuroAmount(totalAmount))}</li>
        </ul>
        <p>Merci pour votre confiance.</p>
        <p><strong>VITAL PROTECT</strong></p>
      `
    });
  }

  await notifyTrainerStageReservation({
    stage,
    reservation: {
      stageTitle,
      firstName,
      lastName,
      email,
      phone,
      places: offerType === "enterprise" ? 1 : places,
      totalAmount
    },
    previousRemainingPlaces: Number(stage.remaining_places || 0),
    newRemainingPlaces,
    trainerPayoutAmount,
    commissionTier
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).send("Method not allowed");
  }

  let event;

  try {
    const rawBody = await getRawBody(req);
    const signature = req.headers["stripe-signature"];

    event = stripe.webhooks.constructEvent(
      rawBody,
      signature,
      endpointSecret
    );
  } catch (error) {
    console.error("Stripe webhook signature error:", error.message);
    return res.status(400).send(`Webhook Error: ${error.message}`);
  }

  try {
    if (event.type !== "checkout.session.completed") {
      return res.status(200).json({ received: true });
    }

    const session = event.data.object;
    const metadata = session.metadata || {};
    const type = metadata.type || "";

    if (type === "affiliation") {
      await handleAffiliationCheckout(session);
      return res.status(200).json({ received: true });
    }

    if (type === "trainer") {
      await handleTrainerCheckout(session);
      return res.status(200).json({ received: true });
    }

    await handleStageCheckout(session);
    return res.status(200).json({ received: true });
  } catch (error) {
    console.error("Stripe webhook processing error:", error);
    return res.status(500).send(`Webhook processing error: ${error.message}`);
  }
}
