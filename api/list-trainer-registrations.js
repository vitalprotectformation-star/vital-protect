import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
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

  const { data: adminUser, error: adminError } = await supabase
    .from("admin_users")
    .select("id, email")
    .eq("email", normalizeEmail(user.email))
    .maybeSingle();

  if (adminError) {
    return {
      ok: false,
      status: 500,
      error: `Erreur de vérification admin : ${adminError.message}`
    };
  }

  if (!adminUser) {
    return {
      ok: false,
      status: 403,
      error: "Accès refusé"
    };
  }

  return { ok: true, user, adminUser };
}

function normalizeCandidate(row) {
  const moduleCount = Number(
    row.trainer_formula_module_count ||
    row.selected_module_count ||
    row.module_count ||
    0
  );

  return {
    ...row,
    payment_status: row.payment_status || "checkout_created",
    validation_status: row.validation_status || "pending",
    training_result: row.training_result || "pending",
    trainer_formula_module_count: moduleCount || row.trainer_formula_module_count,
    trainer_formula_price: row.trainer_formula_price || row.formula_price || null,
    session_id: row.session_id || null
  };
}

export default async function handler(req, res) {
  if (!["GET", "POST"].includes(req.method)) {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return res.status(500).json({
        error: "Variables Supabase serveur manquantes : SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY"
      });
    }

    const adminCheck = await requireAdmin(req);

    if (!adminCheck.ok) {
      return res.status(adminCheck.status).json({ error: adminCheck.error });
    }

    const { data, error, count } = await supabase
      .from("trainer_session_registrations")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .limit(500);

    if (error) {
      return res.status(500).json({
        error: `Impossible de lire trainer_session_registrations : ${error.message}`
      });
    }

    const rows = (data || []).map(normalizeCandidate);

    return res.status(200).json({
      success: true,
      source: "list-trainer-registrations",
      count: typeof count === "number" ? count : rows.length,
      trainer_registrations: rows
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message || "Erreur serveur lors du chargement des candidats formateurs"
    });
  }
}
