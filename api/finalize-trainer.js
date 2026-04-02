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

    if (!registrationId) {
      return res.status(400).json({ error: "Missing registration_id" });
    }

    const { data: registration, error: registrationError } = await supabase
      .from("trainer_session_registrations")
      .select("*")
      .eq("id", registrationId)
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

    if (!cleanEmail) {
      return res.status(400).json({ error: "Email candidat manquant" });
    }

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
