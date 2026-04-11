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

function parseNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
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

async function resolveTrainingModule({ moduleSlug, moduleName }) {
  if (moduleSlug) {
    const { data, error } = await supabase
      .from("training_modules")
      .select("*")
      .eq("slug", moduleSlug)
      .or("and(is_active.eq.true,status.eq.active),and(is_active.eq.true),and(status.eq.active)")
      .maybeSingle();

    if (error) throw error;
    if (data) return data;
  }

  if (moduleName) {
    const { data, error } = await supabase
      .from("training_modules")
      .select("*")
      .ilike("name", moduleName)
      .or("and(is_active.eq.true,status.eq.active),and(is_active.eq.true),and(status.eq.active)")
      .maybeSingle();

    if (error) throw error;
    if (data) return data;
  }

  return null;
}

async function findTrainerCertifiedModule(trainerId, moduleRow) {
  if (moduleRow?.slug) {
    const { data, error } = await supabase
      .from("trainer_modules")
      .select("*")
      .eq("trainer_id", trainerId)
      .eq("module_slug", moduleRow.slug)
      .maybeSingle();

    if (error) throw error;
    if (data) return data;
  }

  if (moduleRow?.name) {
    const { data, error } = await supabase
      .from("trainer_modules")
      .select("*")
      .eq("trainer_id", trainerId)
      .eq("module_name", moduleRow.name)
      .maybeSingle();

    if (error) throw error;
    if (data) return data;
  }

  return null;
}

async function handleCreateStage(req, res, trainer) {
  const moduleSlug = sanitizeText(req.body?.module_slug);
  const moduleName =
    sanitizeText(req.body?.module_name) ||
    sanitizeText(req.body?.training_type);

  const description = sanitizeText(req.body?.description);
  const city = sanitizeText(req.body?.city);
  const department = sanitizeText(req.body?.department);
  const region = sanitizeText(req.body?.region);
  const address = sanitizeText(req.body?.address);
  const stageDate = sanitizeText(req.body?.stage_date);
  const startTime = sanitizeText(req.body?.start_time);
  const duration = sanitizeText(req.body?.duration);
  const maxParticipants = parseNumber(req.body?.max_participants, 20);
  const remainingPlaces = parseNumber(req.body?.remaining_places, maxParticipants);
  const price = parseNumber(req.body?.price, 0);

  const moduleRow = await resolveTrainingModule({
    moduleSlug,
    moduleName
  });

  if (!moduleRow) {
    return res.status(400).json({ error: "Module introuvable ou inactif" });
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

  if (
    normalize(trainer.affiliation_status) !== "active" ||
    !isFutureOrToday(trainer.affiliation_end)
  ) {
    return res.status(403).json({
      error: "Affiliation inactive ou expirée"
    });
  }

  if (!isFutureOrToday(trainer.certification_expiry)) {
    return res.status(403).json({
      error: "Certification expirée"
    });
  }

  const trainerModule = await findTrainerCertifiedModule(trainer.id, moduleRow);

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

  const title = `${moduleRow.name} — ${city} — ${stageDate}`;

  const payload = {
    trainer_id: trainer.id,
    module_slug: moduleRow.slug,
    title,
    training_type: moduleRow.name,
    description,
    city,
    department,
    region,
    address,
    stage_date: stageDate,
    start_time: startTime,
    duration: duration || moduleRow.default_duration || "",
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
