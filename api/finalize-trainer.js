import { createClient } from "@supabase/supabase-js";

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

    if (registration.payment_status !== "captured") {
      return res.status(400).json({ error: "Payment not captured" });
    }

    if (registration.validation_status !== "validated") {
      return res.status(400).json({ error: "Registration not validated" });
    }

    if (registration.training_result !== "passed") {
      return res.status(400).json({ error: "Candidate not passed" });
    }

    const today = new Date().toISOString().split("T")[0];
    const cleanEmail = normalizeEmail(registration.email);

    const trainerPayload = {
      first_name: registration.first_name || "",
      last_name: registration.last_name || "",
      email: cleanEmail,
      phone: registration.phone || "",
      city: registration.city || "",
      certification_date: today,
      certification_expiry: addYears(today, 2),
      certification_status: "certified",
      affiliation_start: today,
      affiliation_end: addYears(today, 1),
      affiliation_status: "active",
      status: "certified"
    };

    const { data: trainerData, error: trainerError } = await supabase
      .from("trainers")
      .upsert(trainerPayload, { onConflict: "email" })
      .select();

    if (trainerError) {
      console.error("Trainer upsert error:", trainerError);
      return res.status(500).json({ error: trainerError.message });
    }

    return res.status(200).json({
      success: true,
      trainer: trainerData
    });
  } catch (err) {
    console.error("Finalize trainer error:", err);
    return res.status(500).json({ error: err.message });
  }
}
