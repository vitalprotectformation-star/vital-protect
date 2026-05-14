import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const PUBLIC_STAGE_UNIT_PRICE = 30;
const ENTERPRISE_STAGE_PRICE = 390;
const PAYOUT_DAY_OF_MONTH = 20;

function normalize(value) {
  return String(value || "").trim().toLowerCase();
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
    text.includes("self pro") ||
    text.includes("module 3") ||
    text.includes("mod 3")
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

function countSelectedModuleSessions(moduleSessions = {}) {
  return Object.values(moduleSessions).filter(entry => entry && entry.session_id).length;
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

function isMissingColumnError(error, columnName) {
  const message = String(error?.message || "").toLowerCase();
  return message.includes(String(columnName || "").toLowerCase()) && message.includes("column");
}

function withoutUndefined(payload) {
  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined)
  );
}

async function insertWithOptionalColumns(table, payload, optionalColumns = []) {
  const omittedColumns = [];
  let currentPayload = withoutUndefined({ ...payload });

  for (let attempt = 0; attempt <= optionalColumns.length; attempt += 1) {
    const { data, error } = await supabase
      .from(table)
      .insert(currentPayload)
      .select()
      .single();

    if (!error) {
      return { data, error: null, omittedColumns };
    }

    const missingColumn = optionalColumns.find(
      columnName => Object.prototype.hasOwnProperty.call(currentPayload, columnName) && isMissingColumnError(error, columnName)
    );

    if (!missingColumn) {
      return { data: null, error, omittedColumns };
    }

    omittedColumns.push(missingColumn);
    currentPayload = { ...currentPayload };
    delete currentPayload[missingColumn];
  }

  return {
    data: null,
    error: new Error("Impossible d'enregistrer : colonnes optionnelles incompatibles"),
    omittedColumns
  };
}


async function updateWithOptionalColumns(table, payload, filters, optionalColumns = []) {
  const omittedColumns = [];
  let currentPayload = withoutUndefined({ ...payload });

  for (let attempt = 0; attempt <= optionalColumns.length; attempt += 1) {
    let query = supabase.from(table).update(currentPayload);

    for (const filter of filters) {
      query = query.eq(filter.column, filter.value);
    }

    const { data, error } = await query.select().single();

    if (!error) {
      return { data, error: null, omittedColumns };
    }

    const missingColumn = optionalColumns.find(
      columnName => Object.prototype.hasOwnProperty.call(currentPayload, columnName) && isMissingColumnError(error, columnName)
    );

    if (!missingColumn) {
      return { data: null, error, omittedColumns };
    }

    omittedColumns.push(missingColumn);
    currentPayload = { ...currentPayload };
    delete currentPayload[missingColumn];
  }

  return {
    data: null,
    error: new Error("Impossible de mettre à jour : colonnes optionnelles incompatibles"),
    omittedColumns
  };
}

function parseNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
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

function getStageOfferType(stageOrPayload = {}, moduleRow = {}) {
  const explicit = normalize(
    stageOrPayload.stage_kind ||
    stageOrPayload.offer_type ||
    stageOrPayload.audience ||
    stageOrPayload.price_model
  );

  if (["enterprise", "entreprise", "team", "b2b", "company", "package"].includes(explicit)) {
    return "enterprise";
  }

  if (["public", "particulier", "individual", "per_person", "standard"].includes(explicit)) {
    return "public";
  }

  return classifyModule(
    stageOrPayload.training_type,
    stageOrPayload.title,
    stageOrPayload.description,
    moduleRow.name,
    moduleRow.category,
    moduleRow.audience,
    moduleRow.slug
  );
}

function getStandardStagePrice(offerType) {
  return offerType === "enterprise" ? ENTERPRISE_STAGE_PRICE : PUBLIC_STAGE_UNIT_PRICE;
}

function getPayoutDateForStage(stageDateString) {
  if (!stageDateString) return null;
  const stageDate = new Date(stageDateString);
  if (Number.isNaN(stageDate.getTime())) return null;

  const payoutDate = new Date(stageDate.getFullYear(), stageDate.getMonth() + 1, PAYOUT_DAY_OF_MONTH);
  return payoutDate.toISOString().slice(0, 10);
}

function isRealizedStage(stage) {
  const status = normalize(stage?.status);
  return ["completed", "realized", "réalisé", "realise"].includes(status);
}

function isInLast12Months(dateString) {
  if (!dateString) return false;
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return false;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = new Date(today);
  start.setFullYear(start.getFullYear() - 1);

  date.setHours(0, 0, 0, 0);
  return date >= start && date <= today;
}

function getCommissionTier(realizedStages12Months) {
  const count = Number(realizedStages12Months || 0);

  if (count >= 12) {
    return {
      rate: 0.075,
      trainerShareRate: 0.925,
      label: "Formateur mensuel",
      description: "12 stages réalisés ou plus sur 12 mois"
    };
  }

  if (count >= 6) {
    return {
      rate: 0.15,
      trainerShareRate: 0.85,
      label: "Formateur régulier",
      description: "6 à 11 stages réalisés sur 12 mois"
    };
  }

  return {
    rate: 0.30,
    trainerShareRate: 0.70,
    label: "Formateur lancement",
    description: "moins de 6 stages réalisés sur 12 mois"
  };
}

function getReservationGrossAmount(reservation, stage) {
  const storedTotal = Number(reservation?.total_amount || 0);
  if (Number.isFinite(storedTotal) && storedTotal > 0) return storedTotal;

  const offerType = getStageOfferType(stage);
  if (offerType === "enterprise") return ENTERPRISE_STAGE_PRICE;

  const places = Number(reservation?.places || 0);
  return places * PUBLIC_STAGE_UNIT_PRICE;
}

function calculateTrainerPayout(grossAmount, commissionRate) {
  const amount = Number(grossAmount || 0);
  const rate = Number(commissionRate || 0);
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  if (!Number.isFinite(rate) || rate < 0 || rate >= 1) return amount;
  return Math.round(amount * (1 - rate) * 100) / 100;
}

function sanitizeReservationForTrainer(row, stage, commissionTier) {
  const grossAmount = getReservationGrossAmount(row, stage);
  const payoutAmount = calculateTrainerPayout(grossAmount, commissionTier.rate);

  return {
    id: row.id,
    stage_id: row.stage_id,
    stage_title: row.stage_title,
    first_name: row.first_name,
    last_name: row.last_name,
    email: row.email,
    phone: row.phone,
    places: row.places,
    payment_status: row.payment_status,
    created_at: row.created_at,
    trainer_payout_amount: Number(row.trainer_payout_amount ?? payoutAmount),
    trainer_payout_status: row.trainer_payout_status || "scheduled",
    trainer_payout_due_date: row.trainer_payout_due_date || getPayoutDateForStage(stage?.stage_date),
    trainer_payout_paid_at: row.trainer_payout_paid_at || null,
    vital_protect_commission_rate: Number(row.vital_protect_commission_rate ?? commissionTier.rate)
  };
}

function sanitizeStageForTrainer(stage, reservations, commissionTier) {
  const offerType = getStageOfferType(stage);
  const paidReservations = reservations.filter(row => normalize(row.payment_status || "paid") === "paid");
  const grossAmount = paidReservations.reduce((sum, row) => sum + getReservationGrossAmount(row, stage), 0);
  const payoutAmount = calculateTrainerPayout(grossAmount, commissionTier.rate);
  const inventoryCapacity = offerType === "enterprise" ? 1 : Number(stage.max_participants || 0);
  const paidUnits = offerType === "enterprise"
    ? paidReservations.length
    : paidReservations.reduce((sum, row) => sum + Number(row.places || 0), 0);

  return {
    id: stage.id,
    trainer_id: stage.trainer_id,
    module_slug: stage.module_slug,
    title: stage.title,
    training_type: stage.training_type,
    description: stage.description,
    city: stage.city,
    department: stage.department,
    region: stage.region,
    postal_code: stage.postal_code,
    address: stage.address,
    stage_date: stage.stage_date,
    start_time: stage.start_time,
    duration: stage.duration,
    max_participants: stage.max_participants,
    remaining_places: stage.remaining_places,
    status: stage.status,
    stage_kind: offerType,
    standard_price: getStandardStagePrice(offerType),
    trainer_payout_estimate: payoutAmount,
    trainer_payout_due_date: getPayoutDateForStage(stage.stage_date),
    vital_protect_commission_rate: commissionTier.rate,
    vital_protect_commission_label: commissionTier.label,
    paid_units: paidUnits,
    inventory_capacity: inventoryCapacity || Number(stage.remaining_places || 0) + paidUnits
  };
}

function parseCandidateModules(row = {}) {
  const rawParts = [];
  if (row.training_type) rawParts.push(row.training_type);
  if (row.selected_module) rawParts.push(row.selected_module);
  if (row.message) {
    const match = String(row.message).match(/Modules demandés\s*:\s*([^\n]+)/i);
    if (match?.[1]) rawParts.push(match[1]);
  }

  const modules = [];
  rawParts.forEach(value => {
    extractOfficialModulesFromText(replaceLegacyModuleNames(value)).forEach(moduleName => pushOfficialModule(modules, moduleName));
  });

  return modules.slice(0, 3);
}

async function findPaidTrainerCandidateByEmail(email) {
  const cleanEmail = normalize(email);
  if (!cleanEmail) return null;

  const { data, error } = await supabase
    .from("trainer_session_registrations")
    .select("*")
    .ilike("email", cleanEmail)
    .in("payment_status", ["authorized", "captured", "paid", "checkout_created"])
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) throw error;
  return data?.[0] || null;
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

  if (trainer) {
    return {
      ok: true,
      account_type: "trainer",
      user,
      trainer
    };
  }

  try {
    const candidate = await findPaidTrainerCandidateByEmail(email);
    if (candidate) {
      return {
        ok: true,
        account_type: "candidate",
        user,
        candidate
      };
    }
  } catch (candidateError) {
    console.error("Candidate access check error:", candidateError);
    return {
      ok: false,
      status: 500,
      error: "Erreur de vérification candidat formateur"
    };
  }

  return {
    ok: false,
    status: 403,
    error: "Profil formateur introuvable"
  };
}

async function resolveTrainingModule({ moduleSlug, moduleName }) {
  if (moduleSlug) {
    const { data, error } = await supabase
      .from("training_modules")
      .select("*")
      .eq("slug", moduleSlug)
      .eq("is_active", true)
      .maybeSingle();

    if (error) throw error;
    if (data) return data;
  }

  const candidates = getModuleNameCandidates(moduleName);
  for (const candidate of candidates) {
    const { data, error } = await supabase
      .from("training_modules")
      .select("*")
      .ilike("name", candidate)
      .eq("is_active", true)
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

  const candidates = getModuleNameCandidates(moduleRow?.name);
  for (const candidate of candidates) {
    const { data, error } = await supabase
      .from("trainer_modules")
      .select("*")
      .eq("trainer_id", trainerId)
      .eq("module_name", candidate)
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
  const postalCode = sanitizeText(req.body?.postal_code);
  const address = sanitizeText(req.body?.address);
  const stageDate = sanitizeText(req.body?.stage_date);
  const startTime = sanitizeText(req.body?.start_time);
  const duration = sanitizeText(req.body?.duration);
  const maxParticipants = parseNumber(req.body?.max_participants, 20);

  const moduleRow = await resolveTrainingModule({ moduleSlug, moduleName });

  if (!moduleRow) {
    return res.status(400).json({ error: "Module introuvable ou inactif" });
  }

  const offerType = getStageOfferType(req.body, moduleRow);
  const price = getStandardStagePrice(offerType);
  const inventoryCapacity = offerType === "enterprise" ? 1 : maxParticipants;
  const requestedRemainingPlaces = parseNumber(req.body?.remaining_places, inventoryCapacity);
  const remainingPlaces = offerType === "enterprise" ? 1 : requestedRemainingPlaces;

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

  if (!Number.isFinite(maxParticipants) || maxParticipants < 1) {
    return res.status(400).json({ error: "max_participants invalide" });
  }

  if (!Number.isFinite(remainingPlaces) || remainingPlaces < 0 || remainingPlaces > inventoryCapacity) {
    return res.status(400).json({ error: "remaining_places invalide" });
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

  const trainerModuleStatus = normalize(trainerModule.status || "certified");
  if (!["certified", "active"].includes(trainerModuleStatus)) {
    return res.status(403).json({
      error: "Ce module n'est pas certifié"
    });
  }

  if (!isFutureOrToday(trainerModule.expires_at)) {
    return res.status(403).json({
      error: "Ce module est expiré"
    });
  }

  const canonicalModuleName = getCanonicalModuleName(moduleRow.name || moduleName);
  const title = `${canonicalModuleName} — ${city} — ${stageDate}`;

  const payload = {
    trainer_id: trainer.id,
    module_slug: moduleRow.slug,
    title,
    training_type: canonicalModuleName,
    description,
    city,
    department,
    region,
    postal_code: postalCode,
    address,
    stage_date: stageDate,
    start_time: startTime,
    duration: duration || moduleRow.default_duration || "",
    max_participants: maxParticipants,
    remaining_places: remainingPlaces,
    price,
    status: "published",
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
    message: "Stage publié automatiquement. VITAL PROTECT conserve un contrôle total depuis l’admin.",
    omitted_columns: insertResult.omittedColumns || []
  });
}


function sameCanonicalModuleName(a, b) {
  return normalize(getCanonicalModuleName(a)) === normalize(getCanonicalModuleName(b));
}

async function listCandidateSessionsForModules(modules = []) {
  if (!modules.length) return [];

  const { data, error } = await supabase
    .from("trainer_sessions")
    .select("*")
    .in("status", ["open", "published"])
    .order("start_date", { ascending: true });

  if (error) throw error;

  return (data || [])
    .filter(session => {
      const moduleName = getOfficialModuleName(session.module_name || session.training_type || session.title || "");
      if (!moduleName) return false;
      return modules.some(selected => sameCanonicalModuleName(selected, moduleName));
    })
    .map(session => {
      const moduleName = getOfficialModuleName(session.module_name || session.training_type || session.title || "");
      return ({
      id: session.id,
      module_name: moduleName,
      title: moduleName,
      city: session.city || "",
      postal_code: session.postal_code || "",
      department: session.department || "",
      region: session.region || "",
      address: session.address || "",
      start_date: session.start_date || null,
      end_date: session.end_date || null,
      duration_days: session.duration_days || session.duration || null,
      remaining_places: session.remaining_places ?? null,
      max_places: session.max_places ?? null,
      status: session.status || "open"
      });
    });
}


async function handlePreferCandidateSession(req, res, candidate) {
  const sessionId = sanitizeText(req.body?.session_id);

  if (!sessionId) {
    return res.status(400).json({ error: "session_id manquant" });
  }

  const selectedModules = parseCandidateModules(candidate);
  if (!selectedModules.length) {
    return res.status(400).json({ error: "Aucun module financé retrouvé sur votre dossier" });
  }

  const { data: session, error: sessionError } = await supabase
    .from("trainer_sessions")
    .select("*")
    .eq("id", sessionId)
    .maybeSingle();

  if (sessionError) {
    return res.status(500).json({ error: sessionError.message });
  }

  if (!session) {
    return res.status(404).json({ error: "Session introuvable" });
  }

  const sessionStatus = normalize(session.status || "open");
  if (!["open", "published"].includes(sessionStatus)) {
    return res.status(400).json({ error: "Cette session n’est plus ouverte" });
  }

  const sessionModuleName = getOfficialModuleName(session.module_name || session.training_type || session.title || "");
  if (!sessionModuleName) {
    return res.status(400).json({ error: "Module de session non reconnu" });
  }

  const allowed = selectedModules.some(moduleName => sameCanonicalModuleName(moduleName, sessionModuleName));
  if (!allowed) {
    return res.status(403).json({ error: "Cette session ne correspond pas à vos modules financés" });
  }

  const now = new Date().toISOString();
  const moduleSessions = normalizeCandidateModuleSessions(candidate.candidate_module_sessions);
  moduleSessions[sessionModuleName] = {
    module_name: sessionModuleName,
    session_id: sessionId,
    status: "session_requested",
    requested_at: now,
    confirmed_at: null,
    admin_note: ""
  };

  const selectedCount = countSelectedModuleSessions(moduleSessions);

  const updateResult = await updateWithOptionalColumns(
    "trainer_session_registrations",
    {
      // session_id reste renseigné pour compatibilité avec les anciens écrans,
      // mais la vraie source devient candidate_module_sessions : 1 session par module.
      session_id: candidate.session_id || sessionId,
      candidate_module_sessions: moduleSessions,
      candidate_session_status: selectedCount ? "session_requested" : "not_selected",
      candidate_session_requested_at: now,
      candidate_session_confirmed_at: null,
      candidate_session_admin_note: null
    },
    [{ column: "id", value: candidate.id }],
    ["candidate_module_sessions", "candidate_session_status", "candidate_session_requested_at", "candidate_session_confirmed_at", "candidate_session_admin_note"]
  );

  if (updateResult.error) {
    return res.status(500).json({ error: updateResult.error.message });
  }

  const updated = updateResult.data;

  return res.status(200).json({
    success: true,
    message: "Votre choix de session est enregistré. Statut : en attente de confirmation VITAL PROTECT.",
    session: {
      id: session.id,
      module_name: sessionModuleName,
      city: session.city || "",
      department: session.department || "",
      start_date: session.start_date || null,
      end_date: session.end_date || null
    },
    candidate: updated
  });
}

async function handleCandidateDashboard(req, res, candidate) {
  const selectedModules = parseCandidateModules(candidate);
  let sessions = [];
  try {
    sessions = await listCandidateSessionsForModules(selectedModules);
  } catch (error) {
    console.error("Candidate sessions fetch error:", error);
  }

  return res.status(200).json({
    success: true,
    account_type: "candidate",
    candidate: {
      id: candidate.id,
      first_name: candidate.first_name || "",
      last_name: candidate.last_name || "",
      email: candidate.email || "",
      phone: candidate.phone || "",
      city: candidate.city || "",
      payment_status: candidate.payment_status || "authorized",
      validation_status: candidate.validation_status || "pending",
      training_result: candidate.training_result || "pending",
      trainer_formula_module_count: Number(candidate.trainer_formula_module_count || selectedModules.length || 1),
      trainer_formula_price: Number(candidate.trainer_formula_price || 0),
      selected_modules: selectedModules,
      training_type: candidate.training_type || "",
      selected_module: candidate.selected_module || "",
      message: candidate.message || "",
      created_at: candidate.created_at || null,
      session_id: candidate.session_id || null,
      candidate_module_sessions: normalizeCandidateModuleSessions(candidate.candidate_module_sessions),
      candidate_session_status: candidate.candidate_session_status || (candidate.session_id ? "session_requested" : "not_selected"),
      candidate_session_requested_at: candidate.candidate_session_requested_at || null,
      candidate_session_confirmed_at: candidate.candidate_session_confirmed_at || null,
      candidate_session_admin_note: candidate.candidate_session_admin_note || ""
    },
    candidate_sessions: sessions,
    stages: [],
    reservations: [],
    stats: {
      access_level: "candidate",
      can_create_stage: false,
      can_view_payouts: false,
      can_view_registrations: false,
      next_step: "Choisir une session de validation correspondant aux modules achetés puis attendre l’activation VITAL PROTECT."
    }
  });
}

async function handleDashboard(req, res, access) {
  if (access?.account_type === "candidate") {
    return await handleCandidateDashboard(req, res, access.candidate);
  }

  const trainer = access?.trainer || access;

  const { data: stages, error: stagesError } = await supabase
    .from("stages")
    .select("*")
    .eq("trainer_id", trainer.id)
    .order("stage_date", { ascending: true });

  if (stagesError) {
    return res.status(500).json({ error: stagesError.message });
  }

  const stageRows = stages || [];
  const stageIds = stageRows.map(stage => stage.id).filter(Boolean);
  const realizedStages12Months = stageRows.filter(stage => isRealizedStage(stage) && isInLast12Months(stage.stage_date)).length;
  const commissionTier = getCommissionTier(realizedStages12Months);

  if (!stageIds.length) {
    return res.status(200).json({
      success: true,
      account_type: "trainer",
      trainer,
      stages: [],
      reservations: [],
      stats: {
        stages_total: 0,
        stages_upcoming: 0,
        stages_realized_12_months: realizedStages12Months,
        registrations_total: 0,
        trainer_payout_due: 0,
        trainer_payout_available: true,
        commission_rate: commissionTier.rate,
        trainer_share_rate: commissionTier.trainerShareRate,
        commission_label: commissionTier.label,
        commission_description: commissionTier.description,
        habilitation_minimum_required: 2,
        habilitation_at_risk: true,
        next_payout_day: PAYOUT_DAY_OF_MONTH
      }
    });
  }

  const { data: reservations, error: reservationsError } = await supabase
    .from("reservations")
    .select("*")
    .in("stage_id", stageIds)
    .order("created_at", { ascending: false });

  if (reservationsError) {
    return res.status(500).json({ error: reservationsError.message });
  }

  const reservationRows = reservations || [];
  const stageById = new Map(stageRows.map(stage => [stage.id, stage]));
  const reservationsByStageId = new Map();

  for (const reservation of reservationRows) {
    if (!reservationsByStageId.has(reservation.stage_id)) {
      reservationsByStageId.set(reservation.stage_id, []);
    }
    reservationsByStageId.get(reservation.stage_id).push(reservation);
  }

  const safeReservationRows = reservationRows.map(row => sanitizeReservationForTrainer(row, stageById.get(row.stage_id), commissionTier));
  const safeStageRows = stageRows.map(stage => sanitizeStageForTrainer(stage, reservationsByStageId.get(stage.id) || [], commissionTier));

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const stagesUpcoming = stageRows.filter(stage => {
    if (!stage.stage_date) return false;
    const stageDate = new Date(stage.stage_date);
    stageDate.setHours(0, 0, 0, 0);
    return !Number.isNaN(stageDate.getTime()) && stageDate >= today && normalize(stage.status) !== "cancelled";
  }).length;

  const paidReservationRows = reservationRows.filter(row => normalize(row.payment_status || "paid") === "paid");

  const registrationsTotal = paidReservationRows.reduce((sum, row) => {
    const stage = stageById.get(row.stage_id);
    return sum + (getStageOfferType(stage) === "enterprise" ? 1 : Number(row.places || 0));
  }, 0);

  const trainerPayoutDue = paidReservationRows.reduce((sum, row) => {
    const stage = stageById.get(row.stage_id);
    return sum + calculateTrainerPayout(getReservationGrossAmount(row, stage), commissionTier.rate);
  }, 0);

  return res.status(200).json({
    success: true,
    account_type: "trainer",
    trainer,
    stages: safeStageRows,
    reservations: safeReservationRows,
    stats: {
      stages_total: stageRows.length,
      stages_upcoming: stagesUpcoming,
      stages_realized_12_months: realizedStages12Months,
      registrations_total: registrationsTotal,
      trainer_payout_due: trainerPayoutDue,
      trainer_payout_available: true,
      commission_rate: commissionTier.rate,
      trainer_share_rate: commissionTier.trainerShareRate,
      commission_label: commissionTier.label,
      commission_description: commissionTier.description,
      habilitation_minimum_required: 2,
      habilitation_at_risk: realizedStages12Months < 2,
      next_payout_day: PAYOUT_DAY_OF_MONTH
    }
  });
}

async function handleUpdateStageStatus(req, res, trainer) {
  const stageId = sanitizeText(req.body?.stage_id);
  const status = sanitizeText(req.body?.status).toLowerCase();

  if (!stageId) {
    return res.status(400).json({ error: "stage_id manquant" });
  }

  if (!["published", "cancelled"].includes(status)) {
    return res.status(400).json({
      error: "Statut non autorisé depuis l’espace formateur"
    });
  }

  const { data: stage, error: stageFetchError } = await supabase
    .from("stages")
    .select("id, trainer_id, status")
    .eq("id", stageId)
    .eq("trainer_id", trainer.id)
    .maybeSingle();

  if (stageFetchError) {
    return res.status(500).json({ error: stageFetchError.message });
  }

  if (!stage) {
    return res.status(404).json({ error: "Stage introuvable pour ce formateur" });
  }

  const { data, error } = await supabase
    .from("stages")
    .update({ status })
    .eq("id", stageId)
    .eq("trainer_id", trainer.id)
    .select()
    .single();

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  return res.status(200).json({ success: true, stage: data });
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
      if (trainerCheck.account_type !== "trainer") {
        return res.status(403).json({ error: "Votre profil n’est pas encore activé. La création de stage sera disponible après validation VITAL PROTECT." });
      }
      return await handleCreateStage(req, res, trainerCheck.trainer);
    }

    if (action === "dashboard") {
      return await handleDashboard(req, res, trainerCheck);
    }

    if (action === "prefer_candidate_session") {
      if (trainerCheck.account_type !== "candidate") {
        return res.status(403).json({ error: "Cette action est réservée aux candidats formateurs en parcours." });
      }
      return await handlePreferCandidateSession(req, res, trainerCheck.candidate);
    }

    if (action === "update_stage_status") {
      if (trainerCheck.account_type !== "trainer") {
        return res.status(403).json({ error: "Votre profil n’est pas encore activé." });
      }
      return await handleUpdateStageStatus(req, res, trainerCheck.trainer);
    }

    return res.status(400).json({ error: "action inconnue" });
  } catch (err) {
    console.error("Trainer tools error:", err);
    return res.status(500).json({ error: err.message });
  }
}
