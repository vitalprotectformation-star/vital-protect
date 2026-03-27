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

function addYears(date, years) {
  const d = new Date(date);
  d.setFullYear(d.getFullYear() + years);
  return d.toISOString().split("T")[0];
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).send("Method not allowed");
  }

  try {
    const rawBody = await getRawBody(req);
    const signature = req.headers["stripe-signature"];

    const event = stripe.webhooks.constructEvent(
      rawBody,
      signature,
      endpointSecret
    );

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const metadata = session.metadata || {};

      // =========================================
      // CAS AFFILIATION
      // =========================================
      if (metadata.type === "affiliation") {
        const email = normalizeEmail(metadata.email || session.customer_email || "");

        if (!email) {
          return res.status(400).send("Missing email for affiliation");
        }

        const today = new Date().toISOString();
        const affiliationStart = today.split("T")[0];
        const affiliationEnd = addYears(today, 1);

        const { error: affiliationUpdateError } = await supabase
          .from("trainers")
          .update({
            affiliation_status: "active",
            affiliation_start: affiliationStart,
            affiliation_end: affiliationEnd
          })
          .eq("email", email);

        if (affiliationUpdateError) {
          console.error("Supabase affiliation update error:", affiliationUpdateError);
          return res.status(500).send("Failed to update affiliation");
        }

        try {
          const emailResponse = await resend.emails.send({
            from: "VITAL PROTECT <contact@vital-protect.fr>",
            to: email,
            replyTo: "contact@vital-protect.fr",
            subject: "Affiliation renouvelée avec succès",
            html: `
              <h2>Affiliation renouvelée ✅</h2>
              <p>Bonjour,</p>
              <p>Votre affiliation <strong>VITAL PROTECT</strong> a bien été renouvelée.</p>
              <ul>
                <li><strong>Début :</strong> ${affiliationStart}</li>
                <li><strong>Fin :</strong> ${affiliationEnd}</li>
              </ul>
              <p>Merci pour votre confiance.</p>
              <p><strong>VITAL PROTECT</strong></p>
            `
          });

          console.log("Email affiliation envoyé :", emailResponse);
        } catch (emailError) {
          console.error("Resend affiliation email error:", emailError);
        }

        return res.status(200).json({ received: true });
      }

      // =========================================
      // CAS FORMATEUR
      // =========================================
      if (metadata.type === "trainer") {
        const firstName = metadata.first_name || "";
        const lastName = metadata.last_name || "";
        const email = normalizeEmail(metadata.email || session.customer_email || "");
        const phone = metadata.phone || "";
        const city = metadata.city || "";
        const trainingType = metadata.training_type || "";
        const message = metadata.message || "";
        const trainerSessionId = metadata.session_id || null;

        const stripePaymentIntentId =
          typeof session.payment_intent === "string"
            ? session.payment_intent
            : session.payment_intent?.id || "";

        const { data: existingTrainerRegistration } = await supabase
          .from("trainer_session_registrations")
          .select("id")
          .eq("stripe_session_id", session.id)
          .maybeSingle();

        if (!existingTrainerRegistration) {
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
            return res.status(500).send("Failed to save trainer registration");
          }

          try {
            const emailResponse = await resend.emails.send({
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

            console.log("Email formateur envoyé :", emailResponse);
          } catch (emailError) {
            console.error("Resend trainer email error:", emailError);
          }
        }

        return res.status(200).json({ received: true });
      }

      // =========================================
      // CAS STAGE
      // =========================================
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
        return res.status(400).send("Missing stage_id in metadata");
      }

      const { data: existingReservation } = await supabase
        .from("reservations")
        .select("id")
        .eq("stripe_session_id", session.id)
        .maybeSingle();

      if (!existingReservation) {
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
          return res.status(500).send("Failed to save reservation");
        }

        const { data: stage, error: stageError } = await supabase
          .from("stages")
          .select("remaining_places")
          .eq("id", stageId)
          .single();

        if (stageError) {
          console.error("Supabase stage fetch error:", stageError);
          return res.status(500).send("Failed to fetch stage");
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
          return res.status(500).send("Failed to update stage places");
        }

        try {
          const emailResponse = await resend.emails.send({
            from: "VITAL PROTECT <contact@vital-protect.fr>",
            to: email,
            replyTo: "contact@vital-protect.fr",
            subject: "Confirmation de votre réservation",
            html: `
              <h2>Réservation confirmée ✅</h2>
              <p>Bonjour ${firstName || ""} ${lastName || ""},</p>
              <p>Votre réservation a bien été enregistrée sur <strong>VITAL PROTECT</strong>.</p>
              <ul>
                <li><strong>Stage :</strong> ${stageTitle}</li>
                <li><strong>Places :</strong> ${places}</li>
                <li><strong>Montant :</strong> ${totalAmount} €</li>
              </ul>
              <p>Merci pour votre confiance.</p>
              <p><strong>VITAL PROTECT</strong></p>
            `
          });

          console.log("Email envoyé :", emailResponse);
        } catch (emailError) {
          console.error("Resend email error:", emailError);
        }
      }
    }

    return res.status(200).json({ received: true });
  } catch (error) {
    console.error("Stripe webhook error:", error.message);
    return res.status(400).send(`Webhook Error: ${error.message}`);
  }
}
