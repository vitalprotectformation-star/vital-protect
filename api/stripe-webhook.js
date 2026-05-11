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

function addYears(date, years) {
  const d = new Date(date);
  d.setFullYear(d.getFullYear() + years);
  return formatDateOnly(d);
}

async function sendEmailSafe(payload) {
  try {
    const response = await resend.emails.send(payload);
    console.log("Email envoyé :", response);
  } catch (error) {
    console.error("Erreur envoi email :", error);
  }
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
      <p>Bonjour ${trainer.first_name || ""} ${trainer.last_name || ""},</p>
      <p>Votre affiliation <strong>VITAL PROTECT</strong> a bien été renouvelée.</p>
      <ul>
        <li><strong>Début :</strong> ${affiliationStart}</li>
        <li><strong>Fin :</strong> ${affiliationEnd}</li>
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
    console.error(
      "Supabase existing trainer registration fetch error:",
      existingTrainerRegistrationError
    );
    throw new Error("Failed to check existing trainer registration");
  }

  if (existingTrainerRegistration) {
    return;
  }

  const { error: trainerRegistrationError } = await supabase
    .from("trainer_session_registrations")
    .insert({
      session_id: trainerSessionId,
      first_name: firstName,
      last_name: lastName,
      email: email,
      phone: phone,
      city: city,
      message: message,
      stripe_session_id: session.id,
      stripe_payment_intent_id: stripePaymentIntentId,
      payment_mode: "manual_capture",
      payment_status: "authorized",
      validation_status: "pending"
    });

  if (trainerRegistrationError) {
    console.error(
      "Supabase trainer registration insert error:",
      trainerRegistrationError
    );
    throw new Error("Failed to save trainer registration");
  }

  await sendEmailSafe({
    from: "VITAL PROTECT <contact@vital-protect.fr>",
    to: email,
    replyTo: "contact@vital-protect.fr",
    subject: "Réservation de votre place confirmée",
    html: `
      <h2>Réservation enregistrée ✅</h2>
      <p>Bonjour ${firstName} ${lastName},</p>
      <p>Votre réservation pour le parcours formateur <strong>VITAL PROTECT</strong> a bien été enregistrée.</p>
      <ul>
        <li><strong>Module :</strong> ${trainingType}</li>
        <li><strong>Statut paiement :</strong> empreinte bancaire autorisée</li>
        <li><strong>Validation :</strong> en attente</li>
      </ul>
      <p>Vous recevrez la suite des étapes prochainement.</p>
      <p><strong>VITAL PROTECT</strong></p>
    `
  });
}

async function notifyTrainerStageReservation({ stage, reservation, newRemainingPlaces, previousRemainingPlaces }) {
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

    const capacity = Number(stage.max_participants || 0);
    const previousRemaining = Number(previousRemainingPlaces || 0);
    const remaining = Number(newRemainingPlaces || 0);
    const soldPlaces = capacity > 0 ? Math.max(0, capacity - remaining) : null;
    const fillPercent = capacity > 0 ? Math.min(100, Math.round((soldPlaces / capacity) * 100)) : null;
    const previousPercent = capacity > 0 ? Math.min(100, Math.round(((capacity - previousRemaining) / capacity) * 100)) : 0;

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
        <h2>Nouvelle inscription ✅</h2>
        <p>Bonjour ${escapeHtml(trainer.first_name || "")},</p>
        <p>Une nouvelle réservation payée vient d’être enregistrée pour votre stage.</p>
        <ul>
          <li><strong>Stage :</strong> ${escapeHtml(stage.title || reservation.stageTitle || "Stage VITAL PROTECT")}</li>
          <li><strong>Date :</strong> ${escapeHtml(formatDateForEmail(stage.stage_date))}${stage.start_time ? ` à ${escapeHtml(stage.start_time)}` : ""}</li>
          <li><strong>Ville :</strong> ${escapeHtml(stage.city || "à confirmer")}</li>
          <li><strong>Participant :</strong> ${escapeHtml(reservation.firstName || "")} ${escapeHtml(reservation.lastName || "")}</li>
          <li><strong>Email :</strong> ${escapeHtml(reservation.email || "—")}</li>
          <li><strong>Téléphone :</strong> ${escapeHtml(reservation.phone || "—")}</li>
          <li><strong>Places réservées :</strong> ${escapeHtml(reservation.places)}</li>
          <li><strong>Montant :</strong> ${escapeHtml(reservation.totalAmount)} €</li>
          ${capacity > 0 ? `<li><strong>Remplissage :</strong> ${soldPlaces}/${capacity} place(s), soit ${fillPercent} %</li>` : ""}
          <li><strong>Places restantes :</strong> ${escapeHtml(remaining)}</li>
        </ul>
        <p>Vous pouvez retrouver le suivi complet depuis votre espace formateur.</p>
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
  const firstName = metadata.first_name || "";
  const lastName = metadata.last_name || "";
  const email = normalizeEmail(metadata.email || session.customer_email || "");
  const phone = metadata.phone || "";
  const places = Number(metadata.places || 1);
  const unitPrice = Number(metadata.unit_price || 0);
  const totalAmount = places * unitPrice;

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

  if (existingReservation) {
    return;
  }

  const { error: reservationError } = await supabase
    .from("reservations")
    .insert({
      stage_id: stageId,
      stage_title: stageTitle,
      first_name: firstName,
      last_name: lastName,
      email: email,
      phone: phone,
      places: places,
      total_amount: totalAmount,
      stripe_session_id: session.id,
      payment_status: "paid"
    });

  if (reservationError) {
    console.error("Supabase reservation insert error:", reservationError);
    throw new Error("Failed to save reservation");
  }

  const { data: stage, error: stageError } = await supabase
    .from("stages")
    .select("id, title, trainer_id, city, stage_date, start_time, max_participants, remaining_places")
    .eq("id", stageId)
    .single();

  if (stageError) {
    console.error("Supabase stage fetch error:", stageError);
    throw new Error("Failed to fetch stage");
  }

  const newRemainingPlaces = Math.max(
    0,
    Number(stage.remaining_places || 0) - places
  );

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
          <li><strong>Places :</strong> ${escapeHtml(places)}</li>
          <li><strong>Montant :</strong> ${escapeHtml(totalAmount)} €</li>
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
      places,
      totalAmount
    },
    previousRemainingPlaces: Number(stage.remaining_places || 0),
    newRemainingPlaces
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
