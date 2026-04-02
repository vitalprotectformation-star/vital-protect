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

    const {
      module_name,
      title,
      city,
      address,
      start_date,
      end_date,
      duration_days,
      max_places,
      remaining_places,
      standard_price,
      launch_price,
      status
    } = req.body || {};

    const payload = {
      module_name: sanitizeText(module_name),
      title: sanitizeText(title),
      city: sanitizeText(city),
      address: sanitizeText(address),
      start_date: sanitizeText(start_date),
      end_date: sanitizeText(end_date),
      duration_days: Number(duration_days || 0),
      max_places: Number(max_places || 0),
      remaining_places: Number(remaining_places || 0),
      standard_price: Number(standard_price || 0),
      launch_price: Number(launch_price || 0),
      status: sanitizeText(status, "open")
    };

    if (!payload.module_name) {
      return res.status(400).json({ error: "Module manquant" });
    }

    if (!payload.title) {
      return res.status(400).json({ error: "Titre manquant" });
    }

    if (!payload.city) {
      return res.status(400).json({ error: "Ville manquante" });
    }

    if (!payload.start_date) {
      return res.status(400).json({ error: "Date de début manquante" });
    }

    if (!payload.end_date) {
      return res.status(400).json({ error: "Date de fin manquante" });
    }

    if (!payload.duration_days || payload.duration_days < 1) {
      return res.status(400).json({ error: "Durée invalide" });
    }

    if (!payload.max_places || payload.max_places < 1) {
      return res.status(400).json({ error: "Nombre maximal de places invalide" });
    }

    if (payload.remaining_places < 0) {
      return res.status(400).json({ error: "Nombre de places restantes invalide" });
    }

    if (payload.remaining_places > payload.max_places) {
      return res.status(400).json({
        error: "Les places restantes ne peuvent pas dépasser le nombre maximal"
      });
    }

    if (payload.standard_price < 0 || payload.launch_price < 0) {
      return res.status(400).json({ error: "Tarif invalide" });
    }

    if (!["open", "closed"].includes(payload.status)) {
      return res.status(400).json({ error: "Statut invalide" });
    }

    if (new Date(payload.end_date) < new Date(payload.start_date)) {
      return res.status(400).json({
        error: "La date de fin ne peut pas être antérieure à la date de début"
      });
    }

    const { data, error } = await supabase
      .from("trainer_sessions")
      .insert(payload)
      .select()
      .single();

    if (error) {
      console.error("Admin create trainer session error:", error);
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json({
      success: true,
      trainer_session: data
    });
  } catch (err) {
    console.error("Admin create trainer session fatal error:", err);
    return res.status(500).json({ error: err.message });
  }
}
