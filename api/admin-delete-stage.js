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

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const adminCheck = await requireAdmin(req);

    if (!adminCheck.ok) {
      return res.status(adminCheck.status).json({ error: adminCheck.error });
    }

    const stageId = sanitizeText(req.body?.stage_id);

    if (!stageId) {
      return res.status(400).json({ error: "stage_id manquant" });
    }

    const { data: stage, error: stageError } = await supabase
      .from("stages")
      .select("id, title")
      .eq("id", stageId)
      .maybeSingle();

    if (stageError) {
      console.error("Stage fetch error:", stageError);
      return res.status(500).json({ error: "Erreur de lecture du stage" });
    }

    if (!stage) {
      return res.status(404).json({ error: "Stage introuvable" });
    }

    const { data: reservations, error: reservationsError } = await supabase
      .from("reservations")
      .select("id")
      .eq("stage_id", stageId);

    if (reservationsError) {
      console.error("Reservations fetch error:", reservationsError);
      return res.status(500).json({ error: "Erreur de lecture des réservations" });
    }

    if ((reservations || []).length > 0) {
      return res.status(400).json({
        error: "Impossible de supprimer un stage ayant des réservations"
      });
    }

    const { error: deleteError } = await supabase
      .from("stages")
      .delete()
      .eq("id", stageId);

    if (deleteError) {
      console.error("Stage delete error:", deleteError);
      return res.status(500).json({ error: deleteError.message });
    }

    return res.status(200).json({
      success: true,
      deleted_stage_id: stageId
    });
  } catch (err) {
    console.error("Admin delete stage fatal error:", err);
    return res.status(500).json({ error: err.message });
  }
}
