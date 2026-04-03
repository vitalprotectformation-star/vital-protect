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

async function handleCreateStage(req, res) {
  const trainerId = sanitizeText(req.body?.trainer_id) || null;
  const title = sanitizeText(req.body?.title);
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
  const status = sanitizeText(req.body?.status || "published");

  if (!title) {
    return res.status(400).json({ error: "title manquant" });
  }

  if (!trainingType) {
    return res.status(400).json({ error: "training_type manquant" });
  }

  if (!city) {
    return res.status(400).json({ error: "city manquante" });
  }

  if (!stageDate || !isValidDate(stageDate)) {
    return res.status(400).json({ error: "stage_date invalide" });
  }

  if (Number.isNaN(price) || price < 0) {
    return res.status(400).json({ error: "price invalide" });
  }

  const payload = {
    trainer_id: trainerId,
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
    status
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

async function handleCreateTrainerSession(req, res) {
  const moduleName = sanitizeText(req.body?.module_name);
  const title = sanitizeText(req.body?.title || moduleName);
  const city = sanitizeText(req.body?.city);
  const address = sanitizeText(req.body?.address);
  const startDate = sanitizeText(req.body?.start_date);
  const endDate = sanitizeText(req.body?.end_date);
  const durationDays = Number(req.body?.duration_days || 3);
  const maxPlaces = Number(req.body?.max_places || 10);
  const remainingPlaces = Number(req.body?.remaining_places || 10);
  const standardPrice = Number(req.body?.standard_price || 590);
  const launchPrice = Number(req.body?.launch_price || 490);
  const status = sanitizeText(req.body?.status || "open");

  if (!moduleName) {
    return res.status(400).json({ error: "module_name manquant" });
  }

  if (!city) {
    return res.status(400).json({ error: "city manquante" });
  }

  if (!startDate || !isValidDate(startDate)) {
    return res.status(400).json({ error: "start_date invalide" });
  }

  if (!endDate || !isValidDate(endDate)) {
    return res.status(400).json({ error: "end_date invalide" });
  }

  const payload = {
    module_name: moduleName,
    title,
    city,
    address,
    start_date: startDate,
    end_date: endDate,
    duration_days: durationDays,
    max_places: maxPlaces,
    remaining_places: remainingPlaces,
    standard_price: standardPrice,
    launch_price: launchPrice,
    status
  };

  const { data, error } = await supabase
    .from("trainer_sessions")
    .insert(payload)
    .select()
    .single();

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  return res.status(200).json({
    success: true,
    trainer_session: data
  });
}

async function handleDeleteStage(req, res) {
  const stageId = sanitizeText(req.body?.stage_id);

  if (!stageId) {
    return res.status(400).json({ error: "stage_id manquant" });
  }

  const { error } = await supabase
    .from("stages")
    .delete()
    .eq("id", stageId);

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  return res.status(200).json({ success: true });
}

async function handleUpsertTrainerModule(req, res) {
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
    return res.status(500).json({ error: error.message });
  }

  return res.status(200).json({
    success: true,
    trainer,
    trainer_module: data
  });
}

async function handleUpdateTrainerModule(req, res) {
  const moduleId = sanitizeText(req.body?.module_id);
  const moduleAction = sanitizeText(req.body?.module_action).toLowerCase();

  if (!moduleId) {
    return res.status(400).json({ error: "module_id manquant" });
  }

  if (!["extend_2_years", "mark_expired", "reactivate_2_years"].includes(moduleAction)) {
    return res.status(400).json({ error: "Action module invalide" });
  }

  const { data: moduleRow, error: moduleFetchError } = await supabase
    .from("trainer_modules")
    .select("*")
    .eq("id", moduleId)
    .maybeSingle();

  if (moduleFetchError) {
    return res.status(500).json({ error: moduleFetchError.message });
  }

  if (!moduleRow) {
    return res.status(404).json({ error: "Module introuvable" });
  }

  const today = new Date().toISOString().split("T")[0];
  let updatePayload = {};

  if (moduleAction === "extend_2_years") {
    const baseDate =
      moduleRow.expires_at && moduleRow.expires_at > today
        ? moduleRow.expires_at
        : today;

    updatePayload = {
      status: "certified",
      expires_at: addYears(baseDate, 2)
    };
  }

  if (moduleAction === "mark_expired") {
    updatePayload = {
      status: "expired",
      expires_at: today
    };
  }

  if (moduleAction === "reactivate_2_years") {
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
    return res.status(500).json({ error: error.message });
  }

  return res.status(200).json({
    success: true,
    trainer_module: data
  });
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

    const action = sanitizeText(req.body?.action).toLowerCase();

    if (!action) {
      return res.status(400).json({ error: "action manquante" });
    }

    if (action === "create_stage") {
      return await handleCreateStage(req, res);
    }

    if (action === "create_trainer_session") {
      return await handleCreateTrainerSession(req, res);
    }

    if (action === "delete_stage") {
      return await handleDeleteStage(req, res);
    }

    if (action === "upsert_trainer_module") {
      return await handleUpsertTrainerModule(req, res);
    }

    if (action === "update_trainer_module") {
      return await handleUpdateTrainerModule(req, res);
    }

    return res.status(400).json({ error: "action inconnue" });
  } catch (err) {
    console.error("Admin tools error:", err);
    return res.status(500).json({ error: err.message });
  }
}
