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
      trainer_id,
      title,
      training_type,
      description,
      city,
      department,
      region,
      address,
      stage_date,
      start_time,
      duration,
      max_participants,
      remaining_places,
      price,
      status
    } = req.body || {};

    const payload = {
      trainer_id: sanitizeText(trainer_id) || null,
      title: sanitizeText(title),
      training_type: sanitizeText(training_type),
      description: sanitizeText(description),
      city: sanitizeText(city),
      department: sanitizeText(department),
      region: sanitizeText(region),
      address: sanitizeText(address),
      stage_date: sanitizeText(stage_date),
      start_time: sanitizeText(start_time),
      duration: sanitizeText(duration),
      max_participants: Number(max_participants || 0),
      remaining_places: Number(remaining_places || 0),
      price: Number(price || 0),
      status: sanitizeText(status, "published")
    };

    if (!payload.title) {
      return res.status(400).json({ error: "Titre manquant" });
    }

    if (!payload.training_type) {
      return res.status(400).json({ error: "Module manquant" });
    }

    if (!payload.city) {
      return res.status(400).json({ error: "Ville manquante" });
    }

    if (!payload.stage_date) {
      return res.status(400).json({ error: "Date manquante" });
    }

    if (!payload.price || payload.price < 0) {
      return res.status(400).json({ error: "Prix invalide" });
    }

    if (!payload.max_participants || payload.max_participants < 1) {
      return res.status(400).json({ error: "Nombre maximal de participants invalide" });
    }

    if (payload.remaining_places < 0) {
      return res.status(400).json({ error: "Nombre de places restantes invalide" });
    }

    if (payload.remaining_places > payload.max_participants) {
      return res.status(400).json({
        error: "Les places restantes ne peuvent pas dépasser le nombre maximal"
      });
    }

    if (!["published", "pending"].includes(payload.status)) {
      return res.status(400).json({ error: "Statut invalide" });
    }

    if (payload.trainer_id) {
      const { data: trainer, error: trainerError } = await supabase
        .from("trainers")
        .select("id")
        .eq("id", payload.trainer_id)
        .maybeSingle();

      if (trainerError) {
        console.error("Trainer check error:", trainerError);
        return res.status(500).json({ error: "Erreur de vérification du formateur" });
      }

      if (!trainer) {
        return res.status(404).json({ error: "Formateur introuvable" });
      }
    }

    const { data, error } = await supabase
      .from("stages")
      .insert(payload)
      .select()
      .single();

    if (error) {
      console.error("Admin create stage error:", error);
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json({
      success: true,
      stage: data
    });
  } catch (err) {
    console.error("Admin create stage fatal error:", err);
    return res.status(500).json({ error: err.message });
  }
}
