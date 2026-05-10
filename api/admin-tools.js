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

function sanitizeSlug(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function isValidDate(value) {
  if (!value) return false;
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value).trim());
}

function isMissingColumnError(error, columnName) {
  const message = String(error?.message || "").toLowerCase();
  return message.includes(String(columnName || "").toLowerCase()) && message.includes("column");
}

async function insertWithOptionalPostalCode(table, payload) {
  const { data, error } = await supabase
    .from(table)
    .insert(payload)
    .select()
    .single();

  if (!error) {
    return { data, error: null, usedPostalCode: Object.prototype.hasOwnProperty.call(payload, "postal_code") };
  }

  if (Object.prototype.hasOwnProperty.call(payload, "postal_code") && isMissingColumnError(error, "postal_code")) {
    const fallbackPayload = { ...payload };
    delete fallbackPayload.postal_code;

    const fallback = await supabase
      .from(table)
      .insert(fallbackPayload)
      .select()
      .single();

    return {
      data: fallback.data,
      error: fallback.error,
      usedPostalCode: false,
      postalCodeFallback: true
    };
  }

  return { data: null, error, usedPostalCode: false };
}

function toBoolean(value, fallback = false) {
  if (typeof value === "boolean") return value;
  if (value === null || value === undefined || value === "") return fallback;

  const normalized = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "oui", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "non", "off"].includes(normalized)) return false;
  return fallback;
}

function withoutUndefined(payload) {
  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined)
  );
}

async function insertWithOptionalColumns(table, payload, optionalColumns = []) {
  const attemptedMissingColumns = [];
  let currentPayload = withoutUndefined({ ...payload });

  for (let attempt = 0; attempt <= optionalColumns.length; attempt += 1) {
    const { data, error } = await supabase
      .from(table)
      .insert(currentPayload)
      .select()
      .single();

    if (!error) {
      return { data, error: null, omittedColumns: attemptedMissingColumns };
    }

    const missingColumn = optionalColumns.find(
      columnName => Object.prototype.hasOwnProperty.call(currentPayload, columnName) && isMissingColumnError(error, columnName)
    );

    if (!missingColumn) {
      return { data: null, error, omittedColumns: attemptedMissingColumns };
    }

    attemptedMissingColumns.push(missingColumn);
    currentPayload = { ...currentPayload };
    delete currentPayload[missingColumn];
  }

  return {
    data: null,
    error: new Error("Impossible d'enregistrer : colonnes optionnelles incompatibles"),
    omittedColumns: attemptedMissingColumns
  };
}

async function updateWithOptionalColumns(table, payload, filters, optionalColumns = []) {
  const attemptedMissingColumns = [];
  let currentPayload = withoutUndefined({ ...payload });

  for (let attempt = 0; attempt <= optionalColumns.length; attempt += 1) {
    let query = supabase.from(table).update(currentPayload);

    for (const filter of filters) {
      query = query.eq(filter.column, filter.value);
    }

    const { data, error } = await query.select().single();

    if (!error) {
      return { data, error: null, omittedColumns: attemptedMissingColumns };
    }

    const missingColumn = optionalColumns.find(
      columnName => Object.prototype.hasOwnProperty.call(currentPayload, columnName) && isMissingColumnError(error, columnName)
    );

    if (!missingColumn) {
      return { data: null, error, omittedColumns: attemptedMissingColumns };
    }

    attemptedMissingColumns.push(missingColumn);
    currentPayload = { ...currentPayload };
    delete currentPayload[missingColumn];
  }

  return {
    data: null,
    error: new Error("Impossible de mettre à jour : colonnes optionnelles incompatibles"),
    omittedColumns: attemptedMissingColumns
  };
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

async function handleCreateModule(req, res) {
  const name = sanitizeText(req.body?.name);
  const slug = sanitizeSlug(req.body?.slug || name);
  const category = sanitizeText(req.body?.category);
  const shortDescription = sanitizeText(req.body?.short_description);
  const longDescription = sanitizeText(req.body?.long_description);
  const audience = sanitizeText(req.body?.audience);
  const levelLabel = sanitizeText(req.body?.level_label);
  const defaultDuration = sanitizeText(req.body?.default_duration);
  const objectives = sanitizeText(req.body?.objectives);
  const status = sanitizeText(req.body?.status || "active").toLowerCase();
  const isActive = toBoolean(req.body?.is_active, status === "active");
  const publicVisible = toBoolean(req.body?.public_visible, true);
  const sortOrder = Number(req.body?.sort_order || 0);

  if (!name) {
    return res.status(400).json({ error: "name manquant" });
  }

  if (!slug) {
    return res.status(400).json({ error: "slug invalide" });
  }

  if (!["active", "inactive"].includes(status)) {
    return res.status(400).json({ error: "status invalide" });
  }

  if (!Number.isInteger(sortOrder) || sortOrder < 0) {
    return res.status(400).json({ error: "sort_order invalide" });
  }

  const payload = {
    name,
    slug,
    category,
    short_description: shortDescription,
    long_description: longDescription,
    audience,
    level_label: levelLabel,
    default_duration: defaultDuration,
    objectives,
    status,
    is_active: isActive,
    public_visible: publicVisible,
    sort_order: sortOrder
  };

  const result = await insertWithOptionalColumns(
    "training_modules",
    payload,
    ["category", "level_label", "default_duration", "is_active", "public_visible"]
  );

  if (result.error) {
    return res.status(500).json({ error: result.error.message });
  }

  return res.status(200).json({
    success: true,
    module: result.data,
    omitted_columns: result.omittedColumns
  });
}

async function handleUpdateModule(req, res) {
  const moduleId = sanitizeText(req.body?.module_id);
  const name = sanitizeText(req.body?.name);
  const slug = sanitizeSlug(req.body?.slug || name);
  const category = sanitizeText(req.body?.category);
  const shortDescription = sanitizeText(req.body?.short_description);
  const longDescription = sanitizeText(req.body?.long_description);
  const audience = sanitizeText(req.body?.audience);
  const levelLabel = sanitizeText(req.body?.level_label);
  const defaultDuration = sanitizeText(req.body?.default_duration);
  const objectives = sanitizeText(req.body?.objectives);
  const status = sanitizeText(req.body?.status || "active").toLowerCase();
  const isActive = toBoolean(req.body?.is_active, status === "active");
  const publicVisible = toBoolean(req.body?.public_visible, true);
  const sortOrder = Number(req.body?.sort_order || 0);

  if (!moduleId) {
    return res.status(400).json({ error: "module_id manquant" });
  }

  if (!name) {
    return res.status(400).json({ error: "name manquant" });
  }

  if (!slug) {
    return res.status(400).json({ error: "slug invalide" });
  }

  if (!["active", "inactive"].includes(status)) {
    return res.status(400).json({ error: "status invalide" });
  }

  if (!Number.isInteger(sortOrder) || sortOrder < 0) {
    return res.status(400).json({ error: "sort_order invalide" });
  }

  const payload = {
    name,
    slug,
    category,
    short_description: shortDescription,
    long_description: longDescription,
    audience,
    level_label: levelLabel,
    default_duration: defaultDuration,
    objectives,
    status,
    is_active: isActive,
    public_visible: publicVisible,
    sort_order: sortOrder
  };

  const result = await updateWithOptionalColumns(
    "training_modules",
    payload,
    [{ column: "id", value: moduleId }],
    ["category", "level_label", "default_duration", "is_active", "public_visible"]
  );

  if (result.error) {
    return res.status(500).json({ error: result.error.message });
  }

  return res.status(200).json({
    success: true,
    module: result.data,
    omitted_columns: result.omittedColumns
  });
}

async function handleDeleteModule(req, res) {
  const moduleId = sanitizeText(req.body?.module_id);

  if (!moduleId) {
    return res.status(400).json({ error: "module_id manquant" });
  }

  const { data: moduleRow, error: moduleFetchError } = await supabase
    .from("training_modules")
    .select("*")
    .eq("id", moduleId)
    .maybeSingle();

  if (moduleFetchError) {
    return res.status(500).json({ error: moduleFetchError.message });
  }

  if (!moduleRow) {
    return res.status(404).json({ error: "Module introuvable" });
  }

  const { data: linkedTrainerModulesByName, error: linkedByNameError } = await supabase
    .from("trainer_modules")
    .select("id")
    .eq("module_name", moduleRow.name);

  if (linkedByNameError) {
    return res.status(500).json({ error: linkedByNameError.message });
  }

  const { data: linkedStages, error: stagesError } = await supabase
    .from("stages")
    .select("id")
    .eq("training_type", moduleRow.name);

  if (stagesError) {
    return res.status(500).json({ error: stagesError.message });
  }

  const { data: linkedSessions, error: sessionsError } = await supabase
    .from("trainer_sessions")
    .select("id")
    .eq("module_name", moduleRow.name);

  if (sessionsError) {
    return res.status(500).json({ error: sessionsError.message });
  }

  const isUsed = Boolean(
    (linkedTrainerModulesByName && linkedTrainerModulesByName.length) ||
    (linkedStages && linkedStages.length) ||
    (linkedSessions && linkedSessions.length)
  );

  if (isUsed) {
    const result = await updateWithOptionalColumns(
      "training_modules",
      {
        status: "inactive",
        is_active: false,
        public_visible: false
      },
      [{ column: "id", value: moduleId }],
      ["is_active", "public_visible"]
    );

    if (result.error) {
      return res.status(500).json({ error: result.error.message });
    }

    return res.status(200).json({
      success: true,
      deactivated: true,
      message: "Module utilisé : il a été désactivé et masqué au lieu d'être supprimé."
    });
  }

  const { error } = await supabase
    .from("training_modules")
    .delete()
    .eq("id", moduleId);

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  return res.status(200).json({ success: true, deleted: true });
}

async function handleListModules(req, res) {
  const { data, error } = await supabase
    .from("training_modules")
    .select("*")
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  return res.status(200).json({ success: true, modules: data || [] });
}

async function handleListStages(req, res) {
  const { data, error } = await supabase
    .from("stages")
    .select("*")
    .order("stage_date", { ascending: true });

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  return res.status(200).json({ success: true, stages: data || [] });
}

async function handleCreateStage(req, res) {
  const trainerId = sanitizeText(req.body?.trainer_id) || null;
  const title = sanitizeText(req.body?.title);
  const trainingType = sanitizeText(req.body?.training_type);
  const description = sanitizeText(req.body?.description);
  const city = sanitizeText(req.body?.city);
  const department = sanitizeText(req.body?.department);
  const region = sanitizeText(req.body?.region);
  const postalCode = sanitizeText(req.body?.postal_code);
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
    postal_code: postalCode,
    address,
    stage_date: stageDate,
    start_time: startTime,
    duration,
    max_participants: maxParticipants,
    remaining_places: remainingPlaces,
    price,
    status
  };

  const insertResult = await insertWithOptionalPostalCode("stages", payload);

  if (insertResult.error) {
    return res.status(500).json({ error: insertResult.error.message });
  }

  return res.status(200).json({
    success: true,
    stage: insertResult.data,
    postal_code_saved: insertResult.usedPostalCode,
    postal_code_fallback: insertResult.postalCodeFallback || false
  });
}

async function handleCreateTrainerSession(req, res) {
  const moduleName = sanitizeText(req.body?.module_name);
  const title = sanitizeText(req.body?.title || moduleName);
  const city = sanitizeText(req.body?.city);
  const department = sanitizeText(req.body?.department);
  const region = sanitizeText(req.body?.region);
  const postalCode = sanitizeText(req.body?.postal_code);
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

  if (!department) {
    return res.status(400).json({ error: "department manquant" });
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
    department,
    region,
    postal_code: postalCode,
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

  const insertResult = await insertWithOptionalColumns("trainer_sessions", payload, ["postal_code", "region"]);

  if (insertResult.error) {
    return res.status(500).json({ error: insertResult.error.message });
  }

  return res.status(200).json({
    success: true,
    trainer_session: insertResult.data,
    omitted_columns: insertResult.omittedColumns || []
  });
}

async function handleDeleteStage(req, res) {
  const stageId = sanitizeText(req.body?.stage_id);

  if (!stageId) {
    return res.status(400).json({ error: "stage_id manquant" });
  }

  const { data: stageRow, error: stageFetchError } = await supabase
    .from("stages")
    .select("id")
    .eq("id", stageId)
    .maybeSingle();

  if (stageFetchError) {
    return res.status(500).json({ error: stageFetchError.message });
  }

  if (!stageRow) {
    return res.status(404).json({ error: "Stage introuvable" });
  }

  const { error: reservationsError } = await supabase
    .from("reservations")
    .delete()
    .eq("stage_id", stageId);

  if (reservationsError) {
    return res.status(500).json({ error: reservationsError.message });
  }

  const { error: stageDeleteError } = await supabase
    .from("stages")
    .delete()
    .eq("id", stageId);

  if (stageDeleteError) {
    return res.status(500).json({ error: stageDeleteError.message });
  }

  return res.status(200).json({ success: true });
}

async function handleUpdateStageStatus(req, res) {
  const stageId = sanitizeText(req.body?.stage_id);
  const status = sanitizeText(req.body?.status || "").toLowerCase();

  if (!stageId) {
    return res.status(400).json({ error: "stage_id manquant" });
  }

  if (!["published", "pending", "draft", "cancelled"].includes(status)) {
    return res.status(400).json({ error: "status invalide" });
  }

  const { data, error } = await supabase
    .from("stages")
    .update({ status })
    .eq("id", stageId)
    .select()
    .single();

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  return res.status(200).json({ success: true, stage: data });
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

    if (action === "list_modules") {
      return await handleListModules(req, res);
    }

    if (action === "create_module") {
      return await handleCreateModule(req, res);
    }

    if (action === "update_module") {
      return await handleUpdateModule(req, res);
    }

    if (action === "delete_module") {
      return await handleDeleteModule(req, res);
    }

    if (action === "list_stages") {
      return await handleListStages(req, res);
    }

    if (action === "create_stage") {
      return await handleCreateStage(req, res);
    }

    if (action === "create_trainer_session") {
      return await handleCreateTrainerSession(req, res);
    }

    if (action === "update_stage_status") {
      return await handleUpdateStageStatus(req, res);
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
