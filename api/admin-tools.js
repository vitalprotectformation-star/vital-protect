import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const PUBLIC_STAGE_UNIT_PRICE = 30;
const ENTERPRISE_STAGE_PRICE = 390;
const PAYOUT_DAY_OF_MONTH = 20;

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function classifyModule(...values) {
  const text = values
    .filter(Boolean)
    .map(value => normalize(value)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, " "))
    .join(" ");

  if (!text.trim()) return "public";

  if (
    text.includes("professionnel") ||
    text.includes("professionnelle") ||
    text.includes("entreprise") ||
    text.includes("salarie") ||
    text.includes("salaries") ||
    text.includes("equipe") ||
    text.includes("agressif") ||
    text.includes("agressive") ||
    text.includes("tendu") ||
    text.includes("tendue") ||
    text.includes("comportement")
  ) {
    return "enterprise";
  }

  return "public";
}

function getStageOfferType(stage = {}) {
  const explicit = normalize(
    stage.stage_kind ||
    stage.offer_type ||
    stage.audience ||
    stage.price_model
  );

  if (["enterprise", "entreprise", "team", "b2b", "company", "package"].includes(explicit)) {
    return "enterprise";
  }

  if (["public", "particulier", "individual", "per_person", "standard"].includes(explicit)) {
    return "public";
  }

  return classifyModule(stage.training_type, stage.title, stage.description, stage.module_slug);
}

function getStandardStagePrice(offerType) {
  return offerType === "enterprise" ? ENTERPRISE_STAGE_PRICE : PUBLIC_STAGE_UNIT_PRICE;
}

function getTrainerSessionLaunchPrice(moduleCount) {
  const count = Number(moduleCount || 1);
  if (count >= 3) return 690;
  if (count >= 2) return 590;
  return 490;
}

function sanitizeText(value, fallback = "") {
  return String(value || fallback).trim();
}


const VP_MODULE_NAMES = {
  module1: "Prévenir, éviter, réagir – Module 1",
  module2: "Prévenir, éviter, réagir – Module 2",
  pro: "Faire face aux situations tendues et comportements agressifs en milieu professionnel"
};

function normalizeModuleKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function getCanonicalModuleType(...values) {
  const text = values.map(normalizeModuleKey).filter(Boolean).join(" ");
  if (!text) return "";
  if (text.includes("niveau 2") || text.includes("niv 2") || text.includes("module 2")) return "module2";
  if (
    text.includes("professionnel") ||
    text.includes("professionnelle") ||
    text.includes("entreprise") ||
    text.includes("salarie") ||
    text.includes("salaries") ||
    text.includes("equipe") ||
    text.includes("agressif") ||
    text.includes("agressive") ||
    text.includes("tendu") ||
    text.includes("tendue") ||
    text.includes("comportement") ||
    text.includes("self pro")
  ) return "pro";
  if (
    text.includes("niveau 1") ||
    text.includes("niv 1") ||
    text.includes("module 1") ||
    text.includes("self defense") ||
    text.includes("securite personnelle") ||
    text.includes("prevenir eviter reagir")
  ) return "module1";
  return "";
}

function getCanonicalModuleName(value) {
  const type = getCanonicalModuleType(value);
  return type ? VP_MODULE_NAMES[type] : String(value || "").trim();
}

function getOfficialModuleName(value) {
  const type = getCanonicalModuleType(value);
  return type ? VP_MODULE_NAMES[type] : "";
}

function isOfficialModuleName(value) {
  return Boolean(getOfficialModuleName(value));
}

function pushOfficialModule(modules, value) {
  const moduleName = getOfficialModuleName(value);
  if (!moduleName) return;
  const key = normalizeModuleKey(moduleName);
  if (!modules.some(existing => normalizeModuleKey(existing) === key)) {
    modules.push(moduleName);
  }
}

function extractOfficialModulesFromText(value) {
  const raw = String(value || "").trim();
  if (!raw) return [];

  let items = [];
  if (raw.startsWith("[") && raw.endsWith("]")) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) items = parsed;
    } catch (_) {
      items = [];
    }
  }

  if (!items.length) {
    items = raw.split(/\s*\|\s*|\s*;\s*|\n+/g);
  }

  const modules = [];
  items.forEach(item => {
    pushOfficialModule(modules, item);
  });

  // Filet de sécurité : détecter plusieurs modules dans un même champ texte,
  // sans jamais découper les noms officiels sur leurs virgules.
  const normalized = normalizeModuleKey(raw);
  if (normalized.includes("module 1") || normalized.includes("niveau 1")) pushOfficialModule(modules, VP_MODULE_NAMES.module1);
  if (normalized.includes("module 2") || normalized.includes("niveau 2")) pushOfficialModule(modules, VP_MODULE_NAMES.module2);
  if (
    normalized.includes("professionnel") ||
    normalized.includes("professionnelle") ||
    normalized.includes("entreprise") ||
    normalized.includes("salarie") ||
    normalized.includes("salaries") ||
    normalized.includes("equipe") ||
    normalized.includes("agressif") ||
    normalized.includes("agressive") ||
    normalized.includes("tendu") ||
    normalized.includes("tendue") ||
    normalized.includes("comportement") ||
    normalized.includes("self pro")
  ) pushOfficialModule(modules, VP_MODULE_NAMES.pro);

  return modules.slice(0, 3);
}

function replaceLegacyModuleNames(value) {
  let text = String(value || "").trim();
  if (!text) return "";
  text = text.replace(/Self\s*Défense\s*en\s*entreprise/gi, VP_MODULE_NAMES.pro);
  text = text.replace(/Self\s*Defense\s*en\s*entreprise/gi, VP_MODULE_NAMES.pro);
  text = text.replace(/Self\s*Pro/gi, VP_MODULE_NAMES.pro);
  text = text.replace(/Self\s*Défense\s*Essentielle\s*Niveau\s*2/gi, VP_MODULE_NAMES.module2);
  text = text.replace(/Self\s*Defense\s*Essentielle\s*Niveau\s*2/gi, VP_MODULE_NAMES.module2);
  text = text.replace(/Self\s*Défense\s*Essentielle\s*Niveau\s*1/gi, VP_MODULE_NAMES.module1);
  text = text.replace(/Self\s*Defense\s*Essentielle\s*Niveau\s*1/gi, VP_MODULE_NAMES.module1);
  text = text.replace(/Self\s*Défense\s*Essentielle/gi, VP_MODULE_NAMES.module1);
  text = text.replace(/Self\s*Defense\s*Essentielle/gi, VP_MODULE_NAMES.module1);
  return text;
}


function normalizeCandidateModuleSessions(value) {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch (_) {
      return {};
    }
  }
  if (typeof value !== "object" || Array.isArray(value)) return {};

  const normalized = {};
  Object.entries(value).forEach(([key, rawEntry]) => {
    const entry = rawEntry && typeof rawEntry === "object" && !Array.isArray(rawEntry) ? rawEntry : {};
    const moduleName = getOfficialModuleName(key) || getOfficialModuleName(entry.module_name) || getOfficialModuleName(entry.title);
    if (!moduleName) return;
    const status = sanitizeText(entry.status || entry.candidate_session_status || "not_selected");
    normalized[moduleName] = {
      module_name: moduleName,
      session_id: sanitizeText(entry.session_id || entry.id || ""),
      status: ["not_selected", "session_requested", "session_confirmed", "session_declined"].includes(status) ? status : "not_selected",
      requested_at: entry.requested_at || entry.candidate_session_requested_at || null,
      confirmed_at: entry.confirmed_at || entry.candidate_session_confirmed_at || null,
      admin_note: sanitizeText(entry.admin_note || entry.candidate_session_admin_note || "")
    };
  });

  return normalized;
}

function aggregateCandidateSessionStatus(moduleSessions = {}, legacyStatus = "not_selected") {
  const entries = Object.values(moduleSessions).filter(entry => entry && entry.session_id);
  if (!entries.length) return "not_selected";
  if (entries.some(entry => entry.status === "session_requested")) return "session_requested";
  if (entries.some(entry => entry.status === "session_declined")) return "session_declined";
  if (entries.every(entry => entry.status === "session_confirmed")) return "session_confirmed";
  return legacyStatus || "session_requested";
}

function getModuleNameCandidates(value) {
  const raw = String(value || "").trim();
  const canonical = getCanonicalModuleName(raw);
  const type = getCanonicalModuleType(raw);
  const candidates = [raw, canonical];
  if (type === "module1") {
    candidates.push("Self Défense Essentielle", "Self Defense Essentielle", "Self Défense Essentielle Niveau 1", "Self Defense Essentielle Niveau 1");
  }
  if (type === "module2") {
    candidates.push("Self Défense Essentielle Niveau 2", "Self Defense Essentielle Niveau 2");
  }
  if (type === "pro") {
    candidates.push("Self Défense en entreprise", "Self Defense en entreprise", "Self Pro");
  }
  return [...new Set(candidates.filter(Boolean))];
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
  const rawName = sanitizeText(req.body?.name);
  const name = getCanonicalModuleName(rawName);
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
  const rawName = sanitizeText(req.body?.name);
  const name = getCanonicalModuleName(rawName);
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

function isActiveTrainerRow(row) {
  const status = normalize(row?.status || "");
  const certificationStatus = normalize(row?.certification_status || "");
  return row?.is_active === true || ["active", "certified"].includes(status) || ["active", "certified"].includes(certificationStatus);
}

async function handleListTrainerRegistrations(req, res) {
  const { data, error } = await supabase
    .from("trainer_session_registrations")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  const rows = data || [];
  const candidateEmails = [...new Set(rows.map(row => normalizeEmail(row.email)).filter(Boolean))];
  const activeTrainerEmails = new Set();

  if (candidateEmails.length) {
    const { data: trainers, error: trainersError } = await supabase
      .from("trainers")
      .select("email, status, certification_status, is_active")
      .in("email", candidateEmails);

    if (!trainersError) {
      (trainers || []).forEach(trainer => {
        if (isActiveTrainerRow(trainer)) activeTrainerEmails.add(normalizeEmail(trainer.email));
      });
    } else {
      console.warn("Lecture formateurs actifs impossible pour le statut candidat :", trainersError.message || trainersError);
    }
  }

  return res.status(200).json({
    success: true,
    trainer_registrations: rows.map(row => ({
      ...row,
      is_activated: Boolean(
        row.activated_at ||
        row.trainer_activated_at ||
        row.candidate_activated_at ||
        row.validation_status === "activated" ||
        row.archive_reason === "activated" ||
        (row.training_result === "passed" && activeTrainerEmails.has(normalizeEmail(row.email)))
      )
    }))
  });
}


async function handleCreateStage(req, res) {
  const trainerId = sanitizeText(req.body?.trainer_id) || null;
  const rawTitle = sanitizeText(req.body?.title);
  const rawTrainingType = sanitizeText(req.body?.training_type);
  const trainingType = getCanonicalModuleName(rawTrainingType);
  const title = replaceLegacyModuleNames(rawTitle || trainingType);
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
  const offerType = getStageOfferType({
    stage_kind: req.body?.stage_kind,
    offer_type: req.body?.offer_type,
    price_model: req.body?.price_model,
    training_type: trainingType,
    title,
    description
  });
  const inventoryCapacity = offerType === "enterprise" ? 1 : maxParticipants;
  const remainingPlaces = offerType === "enterprise"
    ? 1
    : Number(req.body?.remaining_places || maxParticipants || 20);
  const price = getStandardStagePrice(offerType);
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

  if (Number.isNaN(maxParticipants) || maxParticipants < 1) {
    return res.status(400).json({ error: "max_participants invalide" });
  }

  if (Number.isNaN(remainingPlaces) || remainingPlaces < 0 || remainingPlaces > inventoryCapacity) {
    return res.status(400).json({ error: "remaining_places invalide" });
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
    status,
    stage_kind: offerType,
    price_model: offerType === "enterprise" ? "package" : "per_person",
    public_unit_price: PUBLIC_STAGE_UNIT_PRICE,
    enterprise_package_price: ENTERPRISE_STAGE_PRICE
  };

  const insertResult = await insertWithOptionalColumns("stages", payload, [
    "postal_code",
    "stage_kind",
    "price_model",
    "public_unit_price",
    "enterprise_package_price"
  ]);

  if (insertResult.error) {
    return res.status(500).json({ error: insertResult.error.message });
  }

  return res.status(200).json({
    success: true,
    stage: insertResult.data,
    omitted_columns: insertResult.omittedColumns || []
  });
}

async function handleCreateTrainerSession(req, res) {
  const rawModuleName = sanitizeText(req.body?.module_name);
  const moduleName = getOfficialModuleName(rawModuleName);
  const title = moduleName;
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
  const moduleCount = Number(req.body?.module_count || 1);
  const standardPrice = Number(req.body?.standard_price || getTrainerSessionLaunchPrice(moduleCount));
  const launchPrice = Number(req.body?.launch_price || getTrainerSessionLaunchPrice(moduleCount));
  const status = sanitizeText(req.body?.status || "open");

  if (!moduleName) {
    return res.status(400).json({ error: "Module formateur invalide : seuls les modules officiels VITAL PROTECT sont autorisés." });
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
    module_count: moduleCount,
    status
  };

  const insertResult = await insertWithOptionalColumns("trainer_sessions", payload, ["postal_code", "region", "module_count"]);

  if (insertResult.error) {
    return res.status(500).json({ error: insertResult.error.message });
  }

  return res.status(200).json({
    success: true,
    trainer_session: insertResult.data,
    omitted_columns: insertResult.omittedColumns || []
  });
}

async function handleDeleteTrainerSession(req, res) {
  const trainerSessionId = sanitizeText(req.body?.trainer_session_id || req.body?.session_id);

  if (!trainerSessionId) {
    return res.status(400).json({ error: "trainer_session_id manquant" });
  }

  const { data: sessionRow, error: sessionFetchError } = await supabase
    .from("trainer_sessions")
    .select("id, title, module_name")
    .eq("id", trainerSessionId)
    .maybeSingle();

  if (sessionFetchError) {
    return res.status(500).json({ error: sessionFetchError.message });
  }

  if (!sessionRow) {
    return res.status(404).json({ error: "Session formateur introuvable" });
  }

  // Si des candidats pointent encore vers cette session, on les repasse à planifier au lieu de les supprimer.
  const registrationReset = await updateWithOptionalColumns(
    "trainer_session_registrations",
    {
      session_id: null,
      candidate_session_status: "not_selected",
      candidate_session_requested_at: null,
      candidate_session_confirmed_at: null,
      candidate_session_admin_note: null
    },
    [{ column: "session_id", value: trainerSessionId }],
    ["candidate_session_status", "candidate_session_requested_at", "candidate_session_confirmed_at", "candidate_session_admin_note"]
  );

  const registrationUpdateError = registrationReset.error;

  if (registrationUpdateError) {
    console.error("Trainer session registrations detach error:", registrationUpdateError);
    return res.status(500).json({ error: registrationUpdateError.message });
  }

  const { error: deleteError } = await supabase
    .from("trainer_sessions")
    .delete()
    .eq("id", trainerSessionId);

  if (deleteError) {
    return res.status(500).json({ error: deleteError.message });
  }

  return res.status(200).json({
    success: true,
    deleted_session_id: trainerSessionId
  });
}


async function handleUpdateCandidateSessionStatus(req, res) {
  const registrationId = sanitizeText(req.body?.registration_id);
  const requestedStatus = sanitizeText(req.body?.status || req.body?.candidate_session_status);
  const note = sanitizeText(req.body?.note || req.body?.admin_note || "");
  const requestedModuleName = getOfficialModuleName(req.body?.module_name || req.body?.module || "");

  if (!registrationId) {
    return res.status(400).json({ error: "registration_id manquant" });
  }

  const allowedStatuses = ["session_requested", "session_confirmed", "session_declined", "not_selected"];
  if (!allowedStatuses.includes(requestedStatus)) {
    return res.status(400).json({ error: "Statut de session candidat invalide" });
  }

  const { data: registration, error: fetchError } = await supabase
    .from("trainer_session_registrations")
    .select("id, session_id, candidate_session_status, candidate_module_sessions")
    .eq("id", registrationId)
    .maybeSingle();

  if (fetchError) {
    return res.status(500).json({ error: fetchError.message });
  }

  if (!registration) {
    return res.status(404).json({ error: "Candidat introuvable" });
  }

  const now = new Date().toISOString();
  const payload = {
    candidate_session_admin_note: note || null
  };

  // Nouveau workflow : une session par module acheté.
  if (requestedModuleName) {
    const moduleSessions = normalizeCandidateModuleSessions(registration.candidate_module_sessions);
    const currentEntry = moduleSessions[requestedModuleName];

    if (["session_requested", "session_confirmed", "session_declined"].includes(requestedStatus) && !currentEntry?.session_id) {
      return res.status(400).json({ error: "Aucune session n’est rattachée à ce module" });
    }

    if (requestedStatus === "not_selected") {
      delete moduleSessions[requestedModuleName];
    } else {
      moduleSessions[requestedModuleName] = {
        ...(currentEntry || {}),
        module_name: requestedModuleName,
        status: requestedStatus,
        admin_note: note || ""
      };

      if (requestedStatus === "session_confirmed") {
        moduleSessions[requestedModuleName].confirmed_at = now;
      }
      if (requestedStatus === "session_requested") {
        moduleSessions[requestedModuleName].requested_at = now;
        moduleSessions[requestedModuleName].confirmed_at = null;
      }
      if (requestedStatus === "session_declined") {
        moduleSessions[requestedModuleName].confirmed_at = null;
      }
    }

    const remainingEntries = Object.values(moduleSessions).filter(entry => entry && entry.session_id);
    payload.candidate_module_sessions = moduleSessions;
    payload.candidate_session_status = aggregateCandidateSessionStatus(moduleSessions, registration.candidate_session_status || "not_selected");

    if (!remainingEntries.length) {
      payload.session_id = null;
      payload.candidate_session_requested_at = null;
      payload.candidate_session_confirmed_at = null;
    } else {
      payload.session_id = remainingEntries[0].session_id;
      payload.candidate_session_requested_at = now;
      payload.candidate_session_confirmed_at = remainingEntries.every(entry => entry.status === "session_confirmed") ? now : null;
    }

    const result = await updateWithOptionalColumns(
      "trainer_session_registrations",
      payload,
      [{ column: "id", value: registrationId }],
      ["candidate_module_sessions", "candidate_session_status", "candidate_session_requested_at", "candidate_session_confirmed_at", "candidate_session_admin_note"]
    );

    if (result.error) {
      return res.status(500).json({ error: result.error.message });
    }

    return res.status(200).json({
      success: true,
      registration: result.data,
      omitted_columns: result.omittedColumns || []
    });
  }

  // Compatibilité ancienne version : une seule session globale.
  if (["session_requested", "session_confirmed", "session_declined"].includes(requestedStatus) && !registration.session_id) {
    return res.status(400).json({ error: "Aucune session n’est rattachée à ce candidat" });
  }

  payload.candidate_session_status = requestedStatus;

  if (requestedStatus === "session_confirmed") {
    payload.candidate_session_confirmed_at = now;
  }

  if (requestedStatus === "session_requested") {
    payload.candidate_session_requested_at = now;
    payload.candidate_session_confirmed_at = null;
  }

  if (requestedStatus === "session_declined") {
    payload.candidate_session_confirmed_at = null;
  }

  if (requestedStatus === "not_selected") {
    payload.session_id = null;
    payload.candidate_session_requested_at = null;
    payload.candidate_session_confirmed_at = null;
  }

  const result = await updateWithOptionalColumns(
    "trainer_session_registrations",
    payload,
    [{ column: "id", value: registrationId }],
    ["candidate_session_status", "candidate_session_requested_at", "candidate_session_confirmed_at", "candidate_session_admin_note"]
  );

  if (result.error) {
    return res.status(500).json({ error: result.error.message });
  }

  return res.status(200).json({
    success: true,
    registration: result.data,
    omitted_columns: result.omittedColumns || []
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

  if (!["published", "pending", "draft", "cancelled", "completed", "hidden"].includes(status)) {
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


async function handleUpdatePayoutStatus(req, res) {
  const stageId = sanitizeText(req.body?.stage_id);
  const reservationId = sanitizeText(req.body?.reservation_id);
  const status = sanitizeText(req.body?.status || "").toLowerCase();
  const note = sanitizeText(req.body?.note);

  if (!stageId && !reservationId) {
    return res.status(400).json({ error: "stage_id ou reservation_id manquant" });
  }

  if (!["scheduled", "validated", "paid", "blocked"].includes(status)) {
    return res.status(400).json({ error: "status de reversement invalide" });
  }

  const payload = {
    trainer_payout_status: status,
    trainer_payout_paid_at: status === "paid" ? new Date().toISOString() : null,
    trainer_payout_admin_note: note || null
  };

  let query = supabase.from("reservations").update(payload);

  if (reservationId) {
    query = query.eq("id", reservationId);
  } else {
    query = query.eq("stage_id", stageId).eq("payment_status", "paid");
  }

  const { data, error } = await query.select("id, stage_id, trainer_payout_status, trainer_payout_paid_at");

  if (error) {
    const message = String(error.message || "");
    if (message.toLowerCase().includes("trainer_payout")) {
      return res.status(500).json({
        error: "Colonnes reversements manquantes dans Supabase. Exécute le fichier SUPABASE_REVERSEMENTS_FORMATEURS.sql puis réessaie."
      });
    }
    return res.status(500).json({ error: error.message });
  }

  return res.status(200).json({
    success: true,
    updated: Array.isArray(data) ? data.length : 0,
    payout_status: status,
    rows: data || []
  });
}

async function handleUpsertTrainerModule(req, res) {
  const trainerId = sanitizeText(req.body?.trainer_id);
  const moduleName = getCanonicalModuleName(sanitizeText(req.body?.module_name));
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

    if (action === "list_trainer_registrations") {
      return await handleListTrainerRegistrations(req, res);
    }

    if (action === "create_stage") {
      return await handleCreateStage(req, res);
    }

    if (action === "create_trainer_session") {
      return await handleCreateTrainerSession(req, res);
    }

    if (action === "delete_trainer_session") {
      return await handleDeleteTrainerSession(req, res);
    }

    if (action === "update_candidate_session_status") {
      return await handleUpdateCandidateSessionStatus(req, res);
    }

    if (action === "update_stage_status") {
      return await handleUpdateStageStatus(req, res);
    }

    if (action === "delete_stage") {
      return await handleDeleteStage(req, res);
    }

    if (action === "update_payout_status") {
      return await handleUpdatePayoutStatus(req, res);
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
