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

    const moduleId = sanitizeText(req.body?.module_id);
    const action = sanitizeText(req.body?.action).toLowerCase();

    if (!moduleId) {
      return res.status(400).json({ error: "module_id manquant" });
    }

    if (!["extend_2_years", "mark_expired", "reactivate_2_years"].includes(action)) {
      return res.status(400).json({ error: "Action invalide" });
    }

    const { data: moduleRow, error: moduleFetchError } = await supabase
      .from("trainer_modules")
      .select("*")
      .eq("id", moduleId)
      .maybeSingle();

    if (moduleFetchError) {
      console.error("Trainer module fetch error:", moduleFetchError);
      return res.status(500).json({ error: moduleFetchError.message });
    }

    if (!moduleRow) {
      return res.status(404).json({ error: "Module introuvable" });
    }

    const today = new Date().toISOString().split("T")[0];
    let updatePayload = {};

    if (action === "extend_2_years") {
      const baseDate = moduleRow.expires_at && moduleRow.expires_at > today
        ? moduleRow.expires_at
        : today;

      updatePayload = {
        status: "certified",
        expires_at: addYears(baseDate, 2)
      };
    }

    if (action === "mark_expired") {
      updatePayload = {
        status: "expired",
        expires_at: today
      };
    }

    if (action === "reactivate_2_years") {
      updatePayload = {
        status: "certified",
        validated_at: today,
        expires_at: addYears(today, 2)
      };
    }

    const { data, error } = await supabase
      .from("trainer_modules")
      .update(updatePayload)
      .eq("id", moduleId)
      .select()
      .single();

    if (error) {
      console.error("Trainer module update error:", error);
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json({
      success: true,
      trainer_module: data
    });
  } catch (err) {
    console.error("Admin update trainer module error:", err);
    return res.status(500).json({ error: err.message });
  }
}
