import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function sanitizeText(value, fallback = "") {
  return String(value || fallback).trim();
}

function isValidDate(value) {
  if (!value) return false;
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value).trim());
}

function isFutureOrToday(dateString) {
  if (!dateString) return false;

  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return false;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  date.setHours(0, 0, 0, 0);
  return date >= today;
}

async function requireTrainer(req) {
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
      error: "Session formateur invalide"
    };
  }

  const email = normalize(user.email);

  const { data: trainer, error: trainerError } = await supabase
    .from("trainers")
    .select("*")
    .ilike("email", email)
    .maybeSingle();

  if (trainerError) {
    return {
      ok: false,
      status: 500,
      error: "Erreur de vérification formateur"
    };
  }

  if (!trainer) {
    return {
      ok: false,
      status: 403,
      error: "Profil formateur introuvable"
    };
  }

  return {
    ok: true,
    user,
    trainer
  };
}

async function handleCreateStage(req, res, trainer) {
  const trainingType = sanitizeText(req.body?.training_type);
  const description = sanitizeText(req.body?.description);
  const city = sanitizeText(req.body?.city);
  const department = sanitizeText(req.body?.department);
  const region = sanitizeText(req.body?.region);
  const address = sanitizeText(req.body?.address);
  const stageDate = sanitizeText(req.body?.stage_date);
  const startTime = sanitizeText(req.body?.start_time);
  const duration = sanitizeText(req.body?.duration);
  const maxParticipants = Number(req.body?.max_participants || 20);
  const remainingPlaces = Number(req.body?.remaining_places || 20);
  const price = Number(req.body?.price || 0);

  if (!trainingType) {
    return res.status(400).json({ error: "training_type manquant" });
  }

  if (!city) {
    return res.status(400).json({ error: "city manquante" });
  }

  if (!department) {
    return res.status(400).json({ error: "department manquant" });
  }

  if (!region) {
    return res.status(400).json({ error: "region manquante" });
  }

  if (!stageDate || !isValidDate(stageDate)) {
    return res.status(400).json({ error: "stage_date invalide" });
  }

  if (Number.isNaN(price) || price < 0) {
    return res.status(400).json({ error: "price invalide" });
  }

  if (normalize(trainer.affiliation_status) !== "active" || !isFutureOrToday(trainer.affiliation_end)) {
    return res.status(403).json({
      error: "Affiliation inactive ou expirée"
    });
  }

  if (!isFutureOrToday(trainer.certification_expiry)) {
    return res.status(403).json({
      error: "Certification expirée"
    });
  }

  const { data: trainerModule, error: moduleError } = await supabase
    .from("trainer_modules")
    .select("*")
    .eq("trainer_id", trainer.id)
    .eq("module_name", trainingType)
    .maybeSingle();

  if (moduleError) {
    return res.status(500).json({ error: "Erreur de vérification du module" });
  }

  if (!trainerModule) {
    return res.status(403).json({
      error: "Aucun module certifié trouvé pour ce type de stage"
    });
  }

  if (normalize(trainerModule.status) === "suspended") {
    return res.status(403).json({
      error: "Ce module est suspendu"
    });
  }

  if (normalize(trainerModule.status) !== "certified") {
    return res.status(403).json({
      error: "Ce module n'est pas certifié"
    });
  }

  if (!isFutureOrToday(trainerModule.expires_at)) {
    return res.status(403).json({
      error: "Ce module est expiré"
    });
  }

  const title = `${trainingType} — ${city} — ${stageDate}`;

  const payload = {
    trainer_id: trainer.id,
    title,
    training_type: trainingType,
    description,
    city,
    department,
    region,
    address,
    stage_date: stageDate,
    start_time: startTime,
    duration,
    max_participants: maxParticipants,
    remaining_places: remainingPlaces,
    price,
    status: "published"
  };

  const { data, error } = await supabase
    .from("stages")
    .insert(payload)
    .select()
    .single();

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  return res.status(200).json({
    success: true,
    stage: data
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const trainerCheck = await requireTrainer(req);

    if (!trainerCheck.ok) {
      return res.status(trainerCheck.status).json({ error: trainerCheck.error });
    }

    const action = sanitizeText(req.body?.action).toLowerCase();

    if (!action) {
      return res.status(400).json({ error: "action manquante" });
    }

    if (action === "create_stage") {
      return await handleCreateStage(req, res, trainerCheck.trainer);
    }

    return res.status(400).json({ error: "action inconnue" });
  } catch (err) {
    console.error("Trainer tools error:", err);
    return res.status(500).json({ error: err.message });
  }
}
