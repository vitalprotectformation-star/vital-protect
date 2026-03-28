import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function addYears(date, years) {
  const d = new Date(date);
  d.setFullYear(d.getFullYear() + years);
  return d.toISOString().split("T")[0];
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { registration_id, payment_intent_id } = req.body;

    if (!registration_id || !payment_intent_id) {
      return res.status(400).json({ error: "Missing parameters" });
    }

    console.log("🔄 Capture start", { registration_id, payment_intent_id });

    // 1. Lire l'inscription
    const { data: registration, error: registrationError } = await supabase
      .from("trainer_session_registrations")
      .select("*")
      .eq("id", registration_id)
      .single();

    if (registrationError || !registration) {
      console.error("❌ Registration fetch error:", registrationError);
      return res.status(404).json({ error: "Registration not found" });
    }

    console.log("✅ Registration found:", registration.email);

    // 2. Éviter double capture
    if (registration.payment_status === "captured") {
      console.log("⚠️ Already captured:", registration_id);
    } else {
      const paymentIntent = await stripe.paymentIntents.capture(payment_intent_id);
      console.log("💳 Stripe captured:", paymentIntent.id);
    }

    // 3. Update inscription
    const nowIso = new Date().toISOString();
    const today = nowIso.split("T")[0];

    const { error: updateRegistrationError } = await supabase
      .from("trainer_session_registrations")
      .update({
        payment_status: "captured",
        validation_status: "validated",
        training_result: "passed",
        validated_at: nowIso
      })
      .eq("id", registration_id);

    if (updateRegistrationError) {
      console.error("❌ Registration update error:", updateRegistrationError);
      return res.status(500).json({ error: "Registration update failed" });
    }

    console.log("✅ Registration updated");

    // 4. Calcul dates
    const certificationDate = today;
    const certificationExpiry = addYears(today, 2);
    const affiliationStart = today;
    const affiliationEnd = addYears(today, 1);

    const cleanEmail = normalizeEmail(registration.email);

    // 5. Vérifier si le trainer existe déjà
    const { data: existingTrainer, error: existingTrainerError } = await supabase
      .from("trainers")
      .select("id, email")
      .eq("email", cleanEmail)
      .maybeSingle();

    if (existingTrainerError) {
      console.error("❌ Existing trainer lookup error:", existingTrainerError);
      return res.status(500).json({ error: "Trainer lookup failed" });
    }

    const trainerPayload = {
      first_name: registration.first_name || "",
      last_name: registration.last_name || "",
      email: cleanEmail,
      phone: registration.phone || "",
      city: registration.city || "",
      certification_date: certificationDate,
      certification_expiry: certificationExpiry,
      affiliation_start: affiliationStart,
      affiliation_end: affiliationEnd,
      affiliation_status: "active"
    };

    console.log("🧩 Trainer payload:", trainerPayload);

    let trainerResult;
    let trainerWriteError;

    if (existingTrainer) {
      console.log("ℹ️ Trainer already exists, updating:", existingTrainer.id);

      const { data, error } = await supabase
        .from("trainers")
        .update(trainerPayload)
        .eq("id", existingTrainer.id)
        .select();

      trainerResult = data;
      trainerWriteError = error;
    } else {
      console.log("➕ Creating new trainer");

      const { data, error } = await supabase
        .from("trainers")
        .insert(trainerPayload)
        .select();

      trainerResult = data;
      trainerWriteError = error;
    }

    if (trainerWriteError) {
      console.error("❌ Trainer write error:", trainerWriteError);
      return res.status(500).json({
        error: "Trainer creation/update failed",
        details: trainerWriteError.message
      });
    }

    console.log("✅ Trainer written:", trainerResult);

    return res.status(200).json({
      success: true,
      trainer: trainerResult
    });
  } catch (err) {
    console.error("🔥 Capture payment fatal error:", err);
    return res.status(500).json({
      error: "Internal server error",
      details: err.message
    });
  }
}
