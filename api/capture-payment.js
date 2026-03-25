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

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { payment_intent_id, registration_id } = req.body;

    if (!payment_intent_id || !registration_id) {
      return res.status(400).json({ error: "Missing data" });
    }

    // 1. Lire l'inscription formateur
    const { data: registration, error: registrationError } = await supabase
      .from("trainer_session_registrations")
      .select("*")
      .eq("id", registration_id)
      .single();

    if (registrationError || !registration) {
      console.error(registrationError);
      return res.status(404).json({ error: "Registration not found" });
    }

    // 2. Capturer le paiement Stripe
    await stripe.paymentIntents.capture(payment_intent_id);

    const today = new Date().toISOString();
    const certificationDate = today.split("T")[0];
    const certificationExpiry = addYears(today, 2);
    const affiliationStart = certificationDate;
    const affiliationEnd = addYears(today, 1);

    // 3. Mettre à jour trainer_session_registrations
    const { error: updateRegistrationError } = await supabase
      .from("trainer_session_registrations")
      .update({
        payment_status: "captured",
        validation_status: "validated",
        training_result: "passed",
        validated_at: today
      })
      .eq("id", registration_id);

    if (updateRegistrationError) {
      console.error(updateRegistrationError);
      return res.status(500).json({ error: "Registration update error" });
    }

    // 4. Vérifier si le formateur existe déjà par email
    const { data: existingTrainer, error: existingTrainerError } = await supabase
      .from("trainers")
      .select("id")
      .eq("email", registration.email)
      .maybeSingle();

    if (existingTrainerError) {
      console.error(existingTrainerError);
      return res.status(500).json({ error: "Trainer lookup error" });
    }

    if (existingTrainer) {
      // 5A. Mise à jour du formateur existant
      const { error: trainerUpdateError } = await supabase
        .from("trainers")
        .update({
          first_name: registration.first_name || "",
          last_name: registration.last_name || "",
          phone: registration.phone || "",
          city: registration.city || "",
          status: "certified",
          affiliation_status: "active",
          certification_status: "certified",
          certification_date: certificationDate,
          certification_expiry: certificationExpiry,
          affiliation_start: affiliationStart,
          affiliation_end: affiliationEnd
        })
        .eq("id", existingTrainer.id);

      if (trainerUpdateError) {
        console.error(trainerUpdateError);
        return res.status(500).json({ error: "Trainer update error" });
      }
    } else {
      // 5B. Création du formateur
      const { error: trainerInsertError } = await supabase
        .from("trainers")
        .insert({
          first_name: registration.first_name || "",
          last_name: registration.last_name || "",
          email: registration.email || "",
          phone: registration.phone || "",
          city: registration.city || "",
          status: "certified",
          affiliation_status: "active",
          certification_status: "certified",
          certification_date: certificationDate,
          certification_expiry: certificationExpiry,
          affiliation_start: affiliationStart,
          affiliation_end: affiliationEnd
        });

      if (trainerInsertError) {
        console.error(trainerInsertError);
        return res.status(500).json({ error: "Trainer insert error" });
      }
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Capture error" });
  }
}
