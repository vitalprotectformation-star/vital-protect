import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function archiveRegistration(registration, archiveReason) {
  const archivePayload = {
    registration_id: registration.id,
    session_id: registration.session_id || null,
    first_name: registration.first_name || "",
    last_name: registration.last_name || "",
    email: registration.email || "",
    phone: registration.phone || "",
    city: registration.city || "",
    stripe_session_id: registration.stripe_session_id || "",
    stripe_payment_intent_id: registration.stripe_payment_intent_id || "",
    payment_status: registration.payment_status || "",
    validation_status: registration.validation_status || "",
    training_result: registration.training_result || "pending",
    archive_reason: archiveReason,
    source_created_at: registration.created_at || null
  };

  const { error } = await supabase
    .from("trainer_candidate_archives")
    .insert(archivePayload);

  if (error) {
    throw error;
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { registration_id } = req.body;

    if (!registration_id) {
      return res.status(400).json({ error: "Missing registration_id" });
    }

    const { data: registration, error: registrationError } = await supabase
      .from("trainer_session_registrations")
      .select("*")
      .eq("id", registration_id)
      .single();

    if (registrationError || !registration) {
      console.error("Registration fetch error:", registrationError);
      return res.status(404).json({ error: "Registration not found" });
    }

    if (registration.validation_status === "rejected") {
      return res.status(400).json({ error: "Candidate already rejected" });
    }

    if (registration.payment_status === "captured") {
      return res.status(400).json({
        error: "Impossible de refuser un dossier déjà encaissé"
      });
    }

    if (
      registration.stripe_payment_intent_id &&
      registration.payment_status === "authorized"
    ) {
      try {
        await stripe.paymentIntents.cancel(registration.stripe_payment_intent_id);
      } catch (stripeError) {
        console.error("Stripe cancel error:", stripeError);
        return res.status(500).json({
          error: "Stripe cancel failed",
          details: stripeError.message
        });
      }
    }

    const { error: updateError } = await supabase
      .from("trainer_session_registrations")
      .update({
        payment_status: "canceled",
        validation_status: "rejected"
      })
      .eq("id", registration_id);

    if (updateError) {
      console.error("Registration update error:", updateError);
      return res.status(500).json({ error: updateError.message });
    }

    await archiveRegistration(
      {
        ...registration,
        payment_status: "canceled",
        validation_status: "rejected"
      },
      "dossier_rejected"
    );

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("Reject candidate error:", err);
    return res.status(500).json({ error: err.message });
  }
}
