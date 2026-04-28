import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function sanitizeText(value, fallback = "") {
  return String(value || fallback).trim();
}

async function requireAdmin(req) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length).trim()
    : "";

  if (!token) {
    return {
      ok: false,
      status: 401,
      error: "Token d'authentification manquant"
    };
  }

  const {
    data: { user },
    error: userError
  } = await supabase.auth.getUser(token);

  if (userError || !user?.email) {
    return {
      ok: false,
      status: 401,
      error: "Session admin invalide"
    };
  }

  const email = normalizeEmail(user.email);

  const { data: adminUser, error: adminError } = await supabase
    .from("admin_users")
    .select("id, email")
    .eq("email", email)
    .maybeSingle();

  if (adminError) {
    return {
      ok: false,
      status: 500,
      error: "Erreur de vérification admin"
    };
  }

  if (!adminUser) {
    return {
      ok: false,
      status: 403,
      error: "Accès refusé"
    };
  }

  return {
    ok: true,
    user,
    adminUser
  };
}

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
    const adminCheck = await requireAdmin(req);

    if (!adminCheck.ok) {
      return res.status(adminCheck.status).json({ error: adminCheck.error });
    }

    const registrationId = sanitizeText(req.body?.registration_id);
    const result = sanitizeText(req.body?.result);

    if (!registrationId) {
      return res.status(400).json({ error: "Missing registration_id" });
    }

    if (!["passed", "failed", "resit"].includes(result)) {
      return res.status(400).json({ error: "Invalid result" });
    }

    const { data: registration, error: registrationError } = await supabase
      .from("trainer_session_registrations")
      .select("*")
      .eq("id", registrationId)
      .single();

    if (registrationError || !registration) {
      return res.status(404).json({ error: "Registration not found" });
    }

    if (registration.payment_status !== "captured") {
      return res.status(400).json({
        error: "Le paiement doit être capturé avant de définir le résultat"
      });
    }

    if (registration.validation_status !== "validated") {
      return res.status(400).json({
        error: "Le dossier doit être validé avant de définir le résultat"
      });
    }

    const { error: updateError } = await supabase
      .from("trainer_session_registrations")
      .update({
        training_result: result
      })
      .eq("id", registrationId);

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
      await removeArchive(registrationId);
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("Update training result error:", err);
    return res.status(500).json({ error: err.message });
  }
}
