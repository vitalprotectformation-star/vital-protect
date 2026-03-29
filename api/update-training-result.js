import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function archiveRegistration(registration, archiveReason) {
  const { data: existingArchive } = await supabase
    .from("trainer_candidate_archives")
    .select("id")
    .eq("registration_id", registration.id)
    .maybeSingle();

  if (existingArchive) {
    const { error: updateArchiveError } = await supabase
      .from("trainer_candidate_archives")
      .update({
        payment_status: registration.payment_status || "",
        validation_status: registration.validation_status || "",
        training_result: registration.training_result || "",
        archive_reason: archiveReason,
        archived_at: new Date().toISOString()
      })
      .eq("id", existingArchive.id);

    if (updateArchiveError) {
      throw updateArchiveError;
    }

    return;
  }

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
    training_result: registration.training_result || "",
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

async function removeArchive(registrationId) {
  const { error } = await supabase
    .from("trainer_candidate_archives")
    .delete()
    .eq("registration_id", registrationId);

  if (error) {
    throw error;
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { registration_id, result } = req.body;

    if (!registration_id) {
      return res.status(400).json({ error: "Missing registration_id" });
    }

    if (!["passed", "failed", "resit"].includes(result)) {
      return res.status(400).json({ error: "Invalid result" });
    }

    const { data: registration, error: registrationError } = await supabase
      .from("trainer_session_registrations")
      .select("*")
      .eq("id", registration_id)
      .single();

    if (registrationError || !registration) {
      return res.status(404).json({ error: "Registration not found" });
    }

    const { error: updateError } = await supabase
      .from("trainer_session_registrations")
      .update({
        training_result: result
      })
      .eq("id", registration_id);

    if (updateError) {
      return res.status(500).json({ error: updateError.message });
    }

    const updatedRegistration = {
      ...registration,
      training_result: result
    };

    if (result === "failed") {
      await archiveRegistration(updatedRegistration, "training_failed");
    } else {
      await removeArchive(registration_id);
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("Update training result error:", err);
    return res.status(500).json({ error: err.message });
  }
}
