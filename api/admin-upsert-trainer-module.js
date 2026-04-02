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

function isValidDate(value) {
  if (!value) return false;
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value).trim());
}

function addYears(dateString, years) {
  const d = new Date(dateString);
  d.setFullYear(d.getFullYear() + years);
  return d.toISOString().split("T")[0];
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

    const trainerId = sanitizeText(req.body?.trainer_id);
    const moduleName = sanitizeText(req.body?.module_name);
    const status = sanitizeText(req.body?.status || "certified").toLowerCase();
    let validatedAt = sanitizeText(req.body?.validated_at);
    let expiresAt = sanitizeText(req.body?.expires_at);

    if (!trainerId) {
      return res.status(400).json({ error: "trainer_id manquant" });
    }

    if (!moduleName) {
      return res.status(400).json({ error: "module_name manquant" });
    }

    if (!["certified", "expired", "suspended"].includes(status)) {
      return res.status(400).json({ error: "Statut de module invalide" });
    }

    const { data: trainer, error: trainerError } = await supabase
      .from("trainers")
      .select("id, email, first_name, last_name")
      .eq("id", trainerId)
      .maybeSingle();

    if (trainerError) {
      console.error("Trainer fetch error:", trainerError);
      return res.status(500).json({ error: trainerError.message });
    }

    if (!trainer) {
      return res.status(404).json({ error: "Formateur introuvable" });
    }

    const today = new Date().toISOString().split("T")[0];

    if (!validatedAt) {
      validatedAt = today;
    }

    if (!isValidDate(validatedAt)) {
      return res.status(400).json({ error: "validated_at invalide" });
    }

    if (!expiresAt) {
      expiresAt = addYears(validatedAt, 2);
    }

    if (!isValidDate(expiresAt)) {
      return res.status(400).json({ error: "expires_at invalide" });
    }

    const payload = {
      trainer_id: trainerId,
      module_name: moduleName,
      status,
      validated_at: validatedAt,
      expires_at: expiresAt
    };

    const { data, error } = await supabase
      .from("trainer_modules")
      .upsert(payload, { onConflict: "trainer_id,module_name" })
      .select()
      .single();

    if (error) {
      console.error("Trainer module upsert error:", error);
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json({
      success: true,
      trainer,
      trainer_module: data
    });
  } catch (err) {
    console.error("Admin upsert trainer module error:", err);
    return res.status(500).json({ error: err.message });
  }
}
