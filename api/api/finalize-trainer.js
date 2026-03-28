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

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { registration_id } = req.body;

    const { data: registration, error } = await supabase
      .from("trainer_session_registrations")
      .select("*")
      .eq("id", registration_id)
      .single();

    if (error || !registration) {
      return res.status(404).json({ error: "Registration not found" });
    }

    // 🔒 règles métier
    if (registration.payment_status !== "captured") {
      return res.status(400).json({ error: "Payment not captured" });
    }

    if (registration.training_result !== "passed") {
      return res.status(400).json({ error: "Candidate not passed" });
    }

    const today = new Date().toISOString().split("T")[0];

    const payload = {
      first_name: registration.first_name,
      last_name: registration.last_name,
      email: registration.email,
      city: registration.city,
      certification_date: today,
      certification_expiry: addYears(today, 2),
      affiliation_start: today,
      affiliation_end: addYears(today, 1),
      affiliation_status: "active"
    };

    const { error: trainerError } = await supabase
      .from("trainers")
      .upsert(payload, { onConflict: "email" });

    if (trainerError) {
      return res.status(500).json({ error: trainerError.message });
    }

    return res.status(200).json({ success: true });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
