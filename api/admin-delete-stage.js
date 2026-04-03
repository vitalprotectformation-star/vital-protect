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

function formatLongDate(dateString) {
  if (!dateString) return "";
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "long",
    year: "numeric"
  });
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

  const email = normalizeEmail(user.email);

  const { data: trainer, error: trainerError } = await supabase
    .from("trainers")
    .select("*")
    .ilike("email", email)
    .maybeSingle();

  if (trainerError) {
    return {
      ok: false,
      status: 500,
      error: trainerError.message
    };
  }

  if (!trainer) {
    return {
      ok: false,
      status: 404,
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
  const moduleName = sanitizeText(req.body?.training_type);
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

  if (!moduleName) {
    return res.status(400).json({ error: "Module manquant" });
  }

  if (!city) {
    return res.status(400).json({ error: "Ville manquante" });
  }

  if (!department) {
    return res.status(400).json({ error: "Département manquant" });
  }

  if (!region) {
    return res.status(400).json({ error: "Région manquante" });
  }

  if (!stageDate || !isValidDate(stageDate)) {
    return res.status(400).json({ error: "Date de stage invalide" });
  }

  if (Number.isNaN(price) || price < 0) {
    return res.status(400).json({ error: "Prix invalide" });
  }

  if (Number.isNaN(maxParticipants) || maxParticipants < 1) {
    return res.status(400).json({ error: "Nombre maximum de places invalide" });
  }

  if (Number.isNaN(remainingPlaces) || remainingPlaces < 1) {
    return res.status(400).json({ error: "Nombre de places restantes invalide" });
  }

  if (remainingPlaces > maxParticipants) {
    return res.status(400).json({
      error: "Les places restantes ne peuvent pas dépasser les places max"
    });
  }

  const affiliationValid =
    normalizeEmail(trainer.affiliation_status) === "active" &&
    isFutureOrToday(trainer.affiliation_end);

  if (!affiliationValid) {
    return res.status(403).json({
      error: "Affiliation inactive ou expirée"
    });
  }

  const certificationValid = isFutureOrToday(trainer.certification_expiry);

  if (!certificationValid) {
    return res.status(403).json({
      error: "Certification globale expirée"
    });
  }

  const { data: trainerModule, error: trainerModuleError } = await supabase
    .from("trainer_modules")
    .select("*")
    .eq("trainer_id", trainer.id)
    .eq("module_name", moduleName)
    .maybeSingle();

  if (trainerModuleError) {
    return res.status(500).json({ error: trainerModuleError.message });
  }

  if (!trainerModule) {
    return res.status(403).json({
      error: "Ce module n'est pas autorisé pour ce formateur"
    });
  }

  const moduleStatus = sanitizeText(trainerModule.status).toLowerCase();

  if (moduleStatus === "suspended") {
    return res.status(403).json({
      error: "Ce module est suspendu"
    });
  }

  if (!isFutureOrToday(trainerModule.expires_at)) {
    return res.status(403).json({
      error: "Ce module est expiré"
    });
  }

  const generatedTitle = `${moduleName} — ${city} — ${formatLongDate(stageDate)}`;

  const payload = {
    trainer_id: trainer.id,
    title: generatedTitle,
    training_type: moduleName,
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

  const { data: stage, error: stageError } = await supabase
    .from("stages")
    .insert(payload)
    .select()
    .single();

  if (stageError) {
    return res.status(500).json({ error: stageError.message });
  }

  return res.status(200).json({
    success: true,
    stage
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
