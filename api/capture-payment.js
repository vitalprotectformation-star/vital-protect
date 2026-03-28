import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { registration_id, payment_intent_id } = req.body;

    if (!registration_id || !payment_intent_id) {
      return res.status(400).json({ error: "Missing parameters" });
    }

    console.log("🔄 Capture paiement:", registration_id);

    // 1. Récupérer l'inscription
    const { data: registration, error: fetchError } = await supabase
      .from("trainer_session_registrations")
      .select("*")
      .eq("id", registration_id)
      .single();

    if (fetchError || !registration) {
      return res.status(404).json({ error: "Registration not found" });
    }

    // 🔒 sécurité : éviter double capture
    if (registration.payment_status === "captured") {
      return res.status(400).json({ error: "Already captured" });
    }

    // 2. Capture Stripe
    const paymentIntent = await stripe.paymentIntents.capture(
      payment_intent_id
    );

    console.log("💳 Stripe capturé:", paymentIntent.id);

    // 3. Mise à jour inscription
    const { error: updateError } = await supabase
      .from("trainer_session_registrations")
      .update({
        payment_status: "captured",
        validation_status: "validated",
        training_result: "passed"
      })
      .eq("id", registration_id);

    if (updateError) {
      console.error(updateError);
      return res.status(500).json({ error: "DB update failed" });
    }

    // 4. Calcul dates
    const now = new Date();

    const certificationExpiry = new Date();
    certificationExpiry.setFullYear(now.getFullYear() + 2);

    const affiliationEnd = new Date();
    affiliationEnd.setFullYear(now.getFullYear() + 1);

    // 5. Création formateur
    const { error: trainerError } = await supabase
      .from("trainers")
      .insert({
        first_name: registration.first_name,
        last_name: registration.last_name,
        email: registration.email,
        city: registration.city,
        certification_expiry: certificationExpiry,
        affiliation_start: now,
        affiliation_end: affiliationEnd,
        affiliation_status: "active"
      });

    if (trainerError) {
      console.error("Trainer error:", trainerError);
      return res.status(500).json({ error: "Trainer creation failed" });
    }

    console.log("✅ Formateur créé:", registration.email);

    return res.status(200).json({
      success: true,
      payment_intent: paymentIntent.id
    });

  } catch (err) {
    console.error("🔥 ERROR:", err);
    return res.status(500).json({
      error: "Internal server error",
      details: err.message
    });
  }
}
