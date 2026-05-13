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
    session_id: row.session_id || null,
    candidate_session_status: row.candidate_session_status || (row.session_id ? "session_requested" : "not_selected"),
    candidate_session_requested_at: row.candidate_session_requested_at || null,
    candidate_session_confirmed_at: row.candidate_session_confirmed_at || null,
    candidate_session_admin_note: row.candidate_session_admin_note || null
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
    const emails = [...new Set(rows.map(row => normalizeEmail(row.email)).filter(Boolean))];
    let activatedEmails = new Set();

    if (emails.length) {
      const { data: trainers, error: trainersError } = await supabase
        .from("trainers")
        .select("email, status, certification_status, affiliation_status")
        .limit(1000);

      if (!trainersError) {
        activatedEmails = new Set(
          (trainers || [])
            .filter(trainer => emails.includes(normalizeEmail(trainer.email)))
            .filter(trainer => !["candidate", "pending", "in_training"].includes(String(trainer.status || trainer.certification_status || "").trim().toLowerCase()))
            .map(trainer => normalizeEmail(trainer.email))
        );
      }
    }

    const rowsWithActivation = rows.map(row => ({
      ...row,
      is_activated: activatedEmails.has(normalizeEmail(row.email))
    }));

    return res.status(200).json({
      success: true,
      source: "list-trainer-registrations",
      count: typeof count === "number" ? count : rowsWithActivation.length,
      trainer_registrations: rowsWithActivation
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message || "Erreur serveur lors du chargement des candidats formateurs"
    });
  }
}
