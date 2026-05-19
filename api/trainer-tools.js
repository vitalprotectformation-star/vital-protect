import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import { Buffer } from "node:buffer";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const PUBLIC_STAGE_UNIT_PRICE = 30;
const ENTERPRISE_STAGE_PRICE = 390;
const PAYOUT_DAY_OF_MONTH = 20;

const TRAINER_DOCUMENT_BUCKET = process.env.TRAINER_DOCUMENT_BUCKET || "trainer-documents";
const TRAINER_DOCUMENT_MAX_BYTES = 4 * 1024 * 1024;
const STRIPE_CONNECT_ACCOUNT_TYPE = process.env.STRIPE_CONNECT_ACCOUNT_TYPE || "express";
const STRIPE_CONNECT_COUNTRY = process.env.STRIPE_CONNECT_COUNTRY || "FR";
let stripeClient = null;
const TRAINER_DOCUMENT_ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp"
]);

const TRAINER_DOCUMENT_REQUIREMENTS = [
  {
    type: "identity",
    label: "Pièce d’identité",
    category: "external",
    required: true,
    description: "Vérification externe via Stripe Connect. Aucun scan d’identité n’est stocké sur le site."
  },
  {
    type: "bank_account",
    label: "RIB / compte bancaire",
    category: "external",
    required: true,
    description: "À connecter via Stripe Connect pour les reversements. Aucun RIB PDF n’est stocké sur le site."
  },
  {
    type: "criminal_record",
    label: "Casier judiciaire B3",
    category: "upload",
    required: true,
    sensitive: true,
    description: "À transmettre pour vérification. Conservation limitée recommandée après validation."
  },
  {
    type: "liability_insurance",
    label: "Attestation RC pro",
    category: "upload",
    required: true,
    description: "À transmettre si vous exercez avec une assurance responsabilité civile professionnelle."
  },
  {
    type: "diploma",
    label: "Diplôme / certification",
    category: "upload",
    required: false,
    description: "Diplôme, certification ou justificatif d’expérience utile au dossier."
  },
  {
    type: "charter",
    label: "Charte VITAL PROTECT",
    category: "acceptance",
    required: true,
    description: "Acceptation numérique de la charte et des règles réseau VITAL PROTECT."
  }
];


function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function sanitizeText(value, fallback = "") {
  return String(value || fallback).trim();
}


function getStripe() {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error("Configuration Stripe manquante : STRIPE_SECRET_KEY");
  }
  if (!stripeClient) {
    stripeClient = new Stripe(process.env.STRIPE_SECRET_KEY);
  }
  return stripeClient;
}

function getOrigin(req) {
  return String(process.env.APP_BASE_URL || req.headers.origin || "https://www.vital-protect.fr")
    .replace(/\/$/, "");
}

function asArray(value) {
  if (Array.isArray(value)) return value.filter(Boolean).map(item => String(item));
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.filter(Boolean).map(item => String(item)) : [];
    } catch (_) {
      return value.split(",").map(item => item.trim()).filter(Boolean);
    }
  }
  return [];
}

function uniqueArray(values = []) {
  return [...new Set((values || []).filter(Boolean).map(item => String(item)))];
}

function getStripeRequirementKeys(account = {}) {
  const requirements = account.requirements || {};
  return uniqueArray([
    ...asArray(requirements.currently_due),
    ...asArray(requirements.eventually_due),
    ...asArray(requirements.past_due),
    ...asArray(requirements.pending_verification)
  ]);
}

function buildStripeConnectStatus(row = {}, account = null) {
  const accountId = sanitizeText(account?.id || row.stripe_connect_account_id || "");
  const detailsSubmitted = Boolean(account ? account.details_submitted : row.stripe_connect_details_submitted);
  const chargesEnabled = Boolean(account ? account.charges_enabled : row.stripe_connect_charges_enabled);
  const payoutsEnabled = Boolean(account ? account.payouts_enabled : row.stripe_connect_payouts_enabled);
  const requirementsDue = account ? getStripeRequirementKeys(account) : asArray(row.stripe_connect_requirements_due);

  let status = "not_connected";
  if (accountId && payoutsEnabled) status = "payouts_enabled";
  else if (accountId && requirementsDue.length) status = "requirements_due";
  else if (accountId && detailsSubmitted) status = "pending_review";
  else if (accountId) status = "onboarding_required";

  return {
    account_id: accountId,
    status,
    details_submitted: detailsSubmitted,
    charges_enabled: chargesEnabled,
    payouts_enabled: payoutsEnabled,
    requirements_due: requirementsDue,
    setup_required: false,
    last_synced_at: row.stripe_connect_last_synced_at || null
  };
}

function getStripeConnectRowFromAccess(access = {}) {
  return access.account_type === "trainer" ? access.trainer || {} : access.candidate || {};
}

async function updateStripeConnectRow(access = {}, account = {}) {
  const row = getStripeConnectRowFromAccess(access);
  const table = access.account_type === "trainer" ? "trainers" : "trainer_session_registrations";
  if (!row?.id || !account?.id) return { row, setupRequired: false };

  const payload = {
    stripe_connect_account_id: account.id,
    stripe_connect_onboarding_status: buildStripeConnectStatus(row, account).status,
    stripe_connect_details_submitted: Boolean(account.details_submitted),
    stripe_connect_charges_enabled: Boolean(account.charges_enabled),
    stripe_connect_payouts_enabled: Boolean(account.payouts_enabled),
    stripe_connect_requirements_due: getStripeRequirementKeys(account),
    stripe_connect_last_synced_at: new Date().toISOString()
  };

  const { data, error } = await supabase
    .from(table)
    .update(payload)
    .eq("id", row.id)
    .select()
    .maybeSingle();

  if (error) {
    const missingStripeColumn = [
      "stripe_connect_account_id",
      "stripe_connect_onboarding_status",
      "stripe_connect_details_submitted",
      "stripe_connect_charges_enabled",
      "stripe_connect_payouts_enabled",
      "stripe_connect_requirements_due",
      "stripe_connect_last_synced_at"
    ].some(column => isMissingColumnError(error, column));

    if (missingStripeColumn) {
      return { row, setupRequired: true, error };
    }
    throw error;
  }

  return { row: data || row, setupRequired: false };
}

async function getStripeConnectForAccess(access = {}) {
  const row = getStripeConnectRowFromAccess(access);
  const accountId = sanitizeText(row.stripe_connect_account_id || "");
  const fallback = buildStripeConnectStatus(row);

  if (!accountId) return fallback;

  try {
    const account = await getStripe().accounts.retrieve(accountId);
    const updateResult = await updateStripeConnectRow(access, account);
    return {
      ...buildStripeConnectStatus(updateResult.row, account),
      setup_required: Boolean(updateResult.setupRequired)
    };
  } catch (error) {
    console.error("Stripe Connect status refresh error:", error);
    return {
      ...fallback,
      status: fallback.status === "not_connected" ? "not_connected" : "sync_error",
      error: error.message || "Synchronisation Stripe impossible"
    };
  }
}


function isMissingRelationError(error) {
  const message = String(error?.message || "").toLowerCase();
  return error?.code === "42P01" || message.includes("relation") || message.includes("does not exist");
}

function getTrainerDocumentRequirement(type) {
  return TRAINER_DOCUMENT_REQUIREMENTS.find(item => item.type === String(type || "").trim());
}

function isUploadDocumentType(type) {
  return getTrainerDocumentRequirement(type)?.category === "upload";
}

function sanitizeFileName(value) {
  const fallback = "document.pdf";
  const raw = String(value || fallback).trim().split(/[\\/]/).pop() || fallback;
  return raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || fallback;
}

function sanitizeStorageSegment(value, fallback = "formateur") {
  return String(value || fallback)
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || fallback;
}

function parseBase64File(fileData = "", fileMimeType = "") {
  let data = String(fileData || "").trim();
  let mimeType = String(fileMimeType || "").trim().toLowerCase();

  const match = data.match(/^data:([^;]+);base64,(.+)$/);
  if (match) {
    mimeType = String(match[1] || mimeType).toLowerCase();
    data = match[2] || "";
  }

  if (!data) {
    return { error: "Fichier manquant" };
  }

  if (!TRAINER_DOCUMENT_ALLOWED_MIME_TYPES.has(mimeType)) {
    return { error: "Format refusé. Formats acceptés : PDF, JPG, PNG ou WEBP." };
  }

  const buffer = Buffer.from(data, "base64");

  if (!buffer.length) {
    return { error: "Fichier vide ou illisible" };
  }

  if (buffer.length > TRAINER_DOCUMENT_MAX_BYTES) {
    return { error: "Fichier trop lourd. Taille maximum : 4 Mo." };
  }

  return { buffer, mimeType };
}

function sanitizeTrainerDocumentRow(row = {}) {
  const requirement = getTrainerDocumentRequirement(row.document_type) || {};
  return {
    id: row.id,
    candidate_id: row.candidate_id || null,
    trainer_id: row.trainer_id || null,
    email: row.email || "",
    first_name: row.first_name || "",
    last_name: row.last_name || "",
    document_type: row.document_type || "",
    document_label: row.document_label || requirement.label || row.document_type || "Document",
    category: requirement.category || "upload",
    required: requirement.required !== false,
    sensitive: Boolean(requirement.sensitive),
    status: row.status || "submitted",
    file_name: row.file_name || "",
    file_mime_type: row.file_mime_type || "",
    file_size_bytes: Number(row.file_size_bytes || 0),
    uploaded_at: row.uploaded_at || null,
    accepted_at: row.accepted_at || null,
    validated_at: row.validated_at || null,
    refused_at: row.refused_at || null,
    expires_at: row.expires_at || null,
    admin_note: row.admin_note || "",
    updated_at: row.updated_at || row.created_at || null
  };
}

function getAccessDocumentOwner(access = {}) {
  const isTrainer = access.account_type === "trainer";
  const owner = isTrainer ? access.trainer : access.candidate;
  return {
    account_type: access.account_type,
    trainer_id: isTrainer ? owner?.id || null : null,
    candidate_id: !isTrainer ? owner?.id || null : null,
    email: normalize(access.user?.email || owner?.email || ""),
    first_name: sanitizeText(owner?.first_name || ""),
    last_name: sanitizeText(owner?.last_name || "")
  };
}

async function listTrainerDocumentsForAccess(access = {}) {
  const owner = getAccessDocumentOwner(access);
  if (!owner.email) return { rows: [], setupRequired: false };

  const { data, error } = await supabase
    .from("trainer_documents")
    .select("*")
    .ilike("email", owner.email)
    .order("updated_at", { ascending: false });

  if (error) {
    if (isMissingRelationError(error)) {
      return { rows: [], setupRequired: true };
    }
    throw error;
  }

  return {
    rows: (data || []).map(sanitizeTrainerDocumentRow),
    setupRequired: false
  };
}

async function ensureTrainerDocumentBucket() {
  const { data, error } = await supabase.storage.getBucket(TRAINER_DOCUMENT_BUCKET);
  if (!error && data?.id) return;

  const { error: createError } = await supabase.storage.createBucket(TRAINER_DOCUMENT_BUCKET, {
    public: false,
    fileSizeLimit: TRAINER_DOCUMENT_MAX_BYTES,
    allowedMimeTypes: Array.from(TRAINER_DOCUMENT_ALLOWED_MIME_TYPES)
  });

  if (createError && !String(createError.message || "").toLowerCase().includes("already exists")) {
    throw createError;
  }
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
  const commissionRate = Number(row.vital_protect_commission_rate ?? commissionTier.rate);
  const safeCommissionRate = Number.isFinite(commissionRate) ? commissionRate : commissionTier.rate;
  const payoutAmount = calculateTrainerPayout(grossAmount, safeCommissionRate);
  const storedPayoutAmount = Number(row.trainer_payout_amount);
  const trainerPayoutAmount = Number.isFinite(storedPayoutAmount) && storedPayoutAmount >= 0
    ? storedPayoutAmount
    : payoutAmount;
  const commissionAmount = Math.max(0, Math.round((grossAmount - trainerPayoutAmount) * 100) / 100);

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
    trainer_payout_gross_amount: grossAmount,
    vital_protect_commission_amount: commissionAmount,
    trainer_payout_amount: trainerPayoutAmount,
    trainer_payout_status: row.trainer_payout_status || "scheduled",
    trainer_payout_due_date: row.trainer_payout_due_date || getPayoutDateForStage(stage?.stage_date),
    trainer_payout_paid_at: row.trainer_payout_paid_at || null,
    trainer_payout_transferred_at: row.trainer_payout_transferred_at || null,
    trainer_payout_stripe_transfer_id: row.trainer_payout_stripe_transfer_id || "",
    vital_protect_commission_rate: safeCommissionRate
  };
}

function sanitizeStageForTrainer(stage, reservations, commissionTier) {
  const offerType = getStageOfferType(stage);
  const paidReservations = reservations.filter(row => normalize(row.payment_status || "paid") === "paid");
  const grossAmount = paidReservations.reduce((sum, row) => sum + getReservationGrossAmount(row, stage), 0);
  const payoutAmount = calculateTrainerPayout(grossAmount, commissionTier.rate);
  const commissionAmount = Math.max(0, Math.round((grossAmount - payoutAmount) * 100) / 100);
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
    trainer_payout_gross_estimate: grossAmount,
    vital_protect_commission_estimate: commissionAmount,
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



async function handleCreateStripeConnectOnboarding(req, res, access) {
  const owner = getAccessDocumentOwner(access);
  const row = getStripeConnectRowFromAccess(access);

  if (!owner.email) {
    return res.status(400).json({ error: "Email formateur introuvable" });
  }

  let accountId = sanitizeText(row.stripe_connect_account_id || "");
  let account = null;

  try {
    const stripe = getStripe();

    if (accountId) {
      try {
        account = await stripe.accounts.retrieve(accountId);
      } catch (retrieveError) {
        console.warn("Compte Stripe Connect introuvable, création d’un nouveau compte :", retrieveError.message);
        accountId = "";
      }
    }

    if (!accountId) {
      account = await stripe.accounts.create({
        type: STRIPE_CONNECT_ACCOUNT_TYPE,
        country: STRIPE_CONNECT_COUNTRY,
        email: owner.email,
        business_type: "individual",
        capabilities: {
          transfers: { requested: true }
        },
        metadata: {
          vital_protect_role: "trainer",
          account_type: owner.account_type || "trainer",
          email: owner.email,
          trainer_id: owner.trainer_id || "",
          candidate_id: owner.candidate_id || ""
        }
      });
    }

    const updateResult = await updateStripeConnectRow(access, account);
    if (updateResult.setupRequired) {
      return res.status(500).json({ error: "Colonnes Stripe Connect manquantes. Exécute la SQL v48 puis réessaie." });
    }

    const origin = getOrigin(req);
    const accountLink = await stripe.accountLinks.create({
      account: account.id,
      refresh_url: `${origin}/espace-formateur.html?stripe_connect=refresh`,
      return_url: `${origin}/espace-formateur.html?stripe_connect=return`,
      type: "account_onboarding"
    });

    return res.status(200).json({
      success: true,
      url: accountLink.url,
      stripe_connect: buildStripeConnectStatus(updateResult.row, account)
    });
  } catch (error) {
    console.error("Stripe Connect onboarding error:", error);
    return res.status(500).json({ error: error.message || "Impossible de préparer l’onboarding Stripe Connect" });
  }
}

async function handleUploadTrainerDocument(req, res, access) {
  const owner = getAccessDocumentOwner(access);
  const documentType = sanitizeText(req.body?.document_type).toLowerCase();
  const requirement = getTrainerDocumentRequirement(documentType);

  if (!owner.email) {
    return res.status(400).json({ error: "Email formateur introuvable" });
  }

  if (!requirement) {
    return res.status(400).json({ error: "Type de document inconnu" });
  }

  if (!isUploadDocumentType(documentType)) {
    return res.status(400).json({ error: "Ce justificatif ne doit pas être téléversé sur le site" });
  }

  const parsed = parseBase64File(req.body?.file_data, req.body?.file_mime_type);
  if (parsed.error) {
    return res.status(400).json({ error: parsed.error });
  }

  const fileName = sanitizeFileName(req.body?.file_name || `${documentType}.pdf`);
  const ownerSegment = sanitizeStorageSegment(owner.trainer_id || owner.candidate_id || owner.email);
  const storagePath = `${owner.account_type || "formateur"}/${ownerSegment}/${documentType}/${Date.now()}-${fileName}`;
  const now = new Date().toISOString();

  try {
    await ensureTrainerDocumentBucket();
  } catch (bucketError) {
    return res.status(500).json({ error: `Stockage documents indisponible : ${bucketError.message}` });
  }

  const { error: uploadError } = await supabase.storage
    .from(TRAINER_DOCUMENT_BUCKET)
    .upload(storagePath, parsed.buffer, {
      contentType: parsed.mimeType,
      upsert: true
    });

  if (uploadError) {
    return res.status(500).json({ error: uploadError.message });
  }

  const payload = {
    candidate_id: owner.candidate_id,
    trainer_id: owner.trainer_id,
    email: owner.email,
    first_name: owner.first_name,
    last_name: owner.last_name,
    document_type: documentType,
    document_label: requirement.label,
    status: "submitted",
    storage_bucket: TRAINER_DOCUMENT_BUCKET,
    storage_path: storagePath,
    file_name: fileName,
    file_mime_type: parsed.mimeType,
    file_size_bytes: parsed.buffer.length,
    uploaded_at: now,
    accepted_at: null,
    validated_at: null,
    refused_at: null,
    expires_at: null,
    admin_note: null,
    updated_at: now
  };

  const { data, error } = await supabase
    .from("trainer_documents")
    .upsert(payload, { onConflict: "email,document_type" })
    .select()
    .single();

  if (error) {
    if (isMissingRelationError(error)) {
      return res.status(500).json({ error: "Table trainer_documents manquante. Exécute la SQL v46 puis réessaie." });
    }
    return res.status(500).json({ error: error.message });
  }

  return res.status(200).json({
    success: true,
    document: sanitizeTrainerDocumentRow(data),
    message: "Document transmis. VITAL PROTECT pourra le vérifier depuis le cockpit admin."
  });
}

async function handleAcceptTrainerCharter(req, res, access) {
  const owner = getAccessDocumentOwner(access);
  const requirement = getTrainerDocumentRequirement("charter");
  const now = new Date().toISOString();

  if (!owner.email) {
    return res.status(400).json({ error: "Email formateur introuvable" });
  }

  const payload = {
    candidate_id: owner.candidate_id,
    trainer_id: owner.trainer_id,
    email: owner.email,
    first_name: owner.first_name,
    last_name: owner.last_name,
    document_type: "charter",
    document_label: requirement.label,
    status: "validated",
    accepted_at: now,
    validated_at: now,
    refused_at: null,
    admin_note: null,
    updated_at: now
  };

  const { data, error } = await supabase
    .from("trainer_documents")
    .upsert(payload, { onConflict: "email,document_type" })
    .select()
    .single();

  if (error) {
    if (isMissingRelationError(error)) {
      return res.status(500).json({ error: "Table trainer_documents manquante. Exécute la SQL v46 puis réessaie." });
    }
    return res.status(500).json({ error: error.message });
  }

  return res.status(200).json({
    success: true,
    document: sanitizeTrainerDocumentRow(data),
    message: "Charte VITAL PROTECT acceptée."
  });
}

async function handleCandidateDashboard(req, res, candidate) {
  const selectedModules = parseCandidateModules(candidate);
  let sessions = [];
  let documentsResult = { rows: [], setupRequired: false };
  try {
    sessions = await listCandidateSessionsForModules(selectedModules);
  } catch (error) {
    console.error("Candidate sessions fetch error:", error);
  }

  try {
    documentsResult = await listTrainerDocumentsForAccess({
      account_type: "candidate",
      user: { email: candidate.email },
      candidate
    });
  } catch (error) {
    console.error("Candidate documents fetch error:", error);
  }

  const stripeConnect = await getStripeConnectForAccess({
    account_type: "candidate",
    user: { email: candidate.email },
    candidate
  });

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
    document_requirements: TRAINER_DOCUMENT_REQUIREMENTS,
    trainer_documents: documentsResult.rows,
    documents_setup_required: documentsResult.setupRequired,
    stripe_connect: stripeConnect,
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
  let documentsResult = { rows: [], setupRequired: false };

  try {
    documentsResult = await listTrainerDocumentsForAccess({
      account_type: "trainer",
      user: access?.user || { email: trainer.email },
      trainer
    });
  } catch (error) {
    console.error("Trainer documents fetch error:", error);
  }

  const stripeConnect = await getStripeConnectForAccess({
    account_type: "trainer",
    user: access?.user || { email: trainer.email },
    trainer
  });

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
      document_requirements: TRAINER_DOCUMENT_REQUIREMENTS,
      trainer_documents: documentsResult.rows,
      documents_setup_required: documentsResult.setupRequired,
      stripe_connect: stripeConnect,
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
    document_requirements: TRAINER_DOCUMENT_REQUIREMENTS,
    trainer_documents: documentsResult.rows,
    documents_setup_required: documentsResult.setupRequired,
    stripe_connect: stripeConnect,
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

    if (action === "upload_trainer_document") {
      return await handleUploadTrainerDocument(req, res, trainerCheck);
    }

    if (action === "accept_trainer_charter") {
      return await handleAcceptTrainerCharter(req, res, trainerCheck);
    }

    if (action === "create_stripe_connect_onboarding") {
      return await handleCreateStripeConnectOnboarding(req, res, trainerCheck);
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
