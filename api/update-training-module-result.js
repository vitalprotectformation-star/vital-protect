import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const VP_MODULE_NAMES = {
  module1: "Prévenir, éviter, réagir – Module 1",
  module2: "Prévenir, éviter, réagir – Module 2",
  pro: "Faire face aux situations tendues et comportements agressifs en milieu professionnel"
};

function addYears(date, years) {
  const d = new Date(date);
  d.setFullYear(d.getFullYear() + years);
  return d.toISOString().split("T")[0];
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function sanitizeText(value, fallback = "") {
  return String(value || fallback).trim();
}

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

function getOfficialModuleName(value) {
  const type = getCanonicalModuleType(value);
  return type ? VP_MODULE_NAMES[type] : "";
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
    // Ne pas découper sur les virgules : les noms officiels en contiennent.
    items = raw.split(/\s*\|\s*|\s*;\s*|\n+/g);
  }

  const modules = [];
  items.forEach(item => pushOfficialModule(modules, item));

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

function getCandidateModules(registration) {
  const rawParts = [];
  const message = String(registration.message || "");
  const match = message.match(/Modules demandés\s*:\s*([^\n]+)/i);
  if (match?.[1]) rawParts.push(match[1]);
  if (Array.isArray(registration.selected_modules)) rawParts.push(registration.selected_modules.join(" | "));
  if (registration.training_type) rawParts.push(registration.training_type);
  if (registration.selected_module) rawParts.push(registration.selected_module);

  const modules = [];
  rawParts.forEach(value => {
    extractOfficialModulesFromText(replaceLegacyModuleNames(value)).forEach(moduleName => pushOfficialModule(modules, moduleName));
  });

  return modules.slice(0, 3);
}

function normalizeModuleResults(results) {
  if (!results) return {};
  if (typeof results === "string") {
    try {
      results = JSON.parse(results);
    } catch (_) {
      return {};
    }
  }
  if (typeof results !== "object" || Array.isArray(results)) return {};

  const normalized = {};
  Object.entries(results).forEach(([key, value]) => {
    const moduleName = getOfficialModuleName(key) || key;
    if (!moduleName) return;
    const status = sanitizeText(value).toLowerCase();
    normalized[moduleName] = ["pending", "passed", "resit", "failed"].includes(status) ? status : "pending";
  });
  return normalized;
}

function isMissingColumnError(error, columnName) {
  const message = `${error?.message || ""} ${error?.details || ""} ${error?.hint || ""}`.toLowerCase();
  const column = String(columnName || "").toLowerCase();
  return Boolean(
    column &&
    (message.includes(`'${column}'`) ||
      message.includes(`"${column}"`) ||
      message.includes(`column ${column}`) ||
      message.includes(`column \"${column}\"`) ||
      message.includes("could not find") ||
      message.includes("schema cache"))
  );
}

function withoutUndefined(payload) {
  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined)
  );
}


async function upsertWithOptionalColumns(table, payload, options = {}, optionalColumns = []) {
  const omittedColumns = [];
  let currentPayload = withoutUndefined({ ...payload });

  for (let attempt = 0; attempt <= optionalColumns.length; attempt += 1) {
    const { data, error } = await supabase
      .from(table)
      .upsert(currentPayload, options)
      .select()
      .single();

    if (!error) return { data, error: null, omittedColumns };

    const missingColumn = optionalColumns.find(
      columnName => Object.prototype.hasOwnProperty.call(currentPayload, columnName) && isMissingColumnError(error, columnName)
    );

    if (!missingColumn) return { data: null, error, omittedColumns };

    omittedColumns.push(missingColumn);
    currentPayload = { ...currentPayload };
    delete currentPayload[missingColumn];
  }

  return { data: null, error: new Error("Colonnes optionnelles incompatibles"), omittedColumns };
}

async function updateWithOptionalColumns(table, payload, filters, optionalColumns = []) {
  const omittedColumns = [];
  let currentPayload = withoutUndefined({ ...payload });

  for (let attempt = 0; attempt <= optionalColumns.length; attempt += 1) {
    if (!Object.keys(currentPayload).length) {
      return { data: null, error: null, omittedColumns };
    }

    let query = supabase.from(table).update(currentPayload);
    for (const filter of filters) {
      query = query.eq(filter.column, filter.value);
    }

    const { data, error } = await query.select().maybeSingle();
    if (!error) return { data, error: null, omittedColumns };

    const missingColumn = optionalColumns.find(
      columnName => Object.prototype.hasOwnProperty.call(currentPayload, columnName) && isMissingColumnError(error, columnName)
    );

    if (!missingColumn) return { data: null, error, omittedColumns };

    omittedColumns.push(missingColumn);
    currentPayload = { ...currentPayload };
    delete currentPayload[missingColumn];
  }

  return { data: null, error: null, omittedColumns };
}

async function archiveRegistration(registration, archiveReason) {
  const now = new Date().toISOString();

  const archivePayload = {
    registration_id: registration.id,
    session_id: registration.session_id || null,
    first_name: registration.first_name || "",
    last_name: registration.last_name || "",
    email: registration.email || "",
    phone: registration.phone || "",
    city: registration.city || "",
    stripe_session_id: registration.stripe_session_id || "",
    stripe_payment_intent_id: registration.stripe_payment_intent_id || "",
    payment_status: registration.payment_status || "",
    validation_status: registration.validation_status || "",
    training_result: registration.training_result || "",
    archive_reason: archiveReason,
    source_created_at: registration.created_at || null,
    archived_at: now
  };

  const { data: existingArchive, error: archiveLookupError } = await supabase
    .from("trainer_candidate_archives")
    .select("id")
    .eq("registration_id", registration.id)
    .maybeSingle();

  if (archiveLookupError) throw archiveLookupError;

  if (existingArchive?.id) {
    const { error: archiveUpdateError } = await supabase
      .from("trainer_candidate_archives")
      .update(archivePayload)
      .eq("id", existingArchive.id);

    if (archiveUpdateError) throw archiveUpdateError;
    return;
  }

  const { error: archiveInsertError } = await supabase
    .from("trainer_candidate_archives")
    .insert(archivePayload);

  if (archiveInsertError) throw archiveInsertError;
}

async function markRegistrationActivated(registrationId, trainerId, now) {
  const updateResult = await updateWithOptionalColumns(
    "trainer_session_registrations",
    {
      activated_at: now,
      trainer_activated_at: now,
      candidate_activated_at: now,
      activated_trainer_id: trainerId || null,
      archive_reason: "activated",
      archived_at: now
    },
    [{ column: "id", value: registrationId }],
    ["activated_at", "trainer_activated_at", "candidate_activated_at", "activated_trainer_id", "archive_reason", "archived_at"]
  );

  if (updateResult.error) {
    console.warn("Marquage activation candidat ignoré :", updateResult.error.message || updateResult.error);
  }
}

async function activateTrainerFromRegistration(registration, modules) {
  const today = new Date().toISOString().split("T")[0];
  const now = new Date().toISOString();
  const cleanEmail = normalizeEmail(registration.email);

  if (!cleanEmail) {
    throw new Error("Email candidat manquant : activation formateur impossible");
  }

  const trainerPayload = {
    first_name: registration.first_name || "",
    last_name: registration.last_name || "",
    email: cleanEmail,
    phone: registration.phone || "",
    city: registration.city || "",
    postal_code: registration.postal_code || "",
    department: registration.department || "",
    region: registration.region || "",
    stripe_connect_account_id: registration.stripe_connect_account_id || "",
    stripe_connect_onboarding_status: registration.stripe_connect_onboarding_status || "",
    stripe_connect_details_submitted: Boolean(registration.stripe_connect_details_submitted),
    stripe_connect_charges_enabled: Boolean(registration.stripe_connect_charges_enabled),
    stripe_connect_payouts_enabled: Boolean(registration.stripe_connect_payouts_enabled),
    stripe_connect_requirements_due: registration.stripe_connect_requirements_due || [],
    stripe_connect_last_synced_at: registration.stripe_connect_last_synced_at || null,
    certification_date: today,
    certification_expiry: addYears(today, 2),
    certification_status: "active",
    affiliation_start: today,
    affiliation_end: addYears(today, 1),
    affiliation_status: "active",
    status: "active"
  };

  const trainerResult = await upsertWithOptionalColumns(
    "trainers",
    trainerPayload,
    { onConflict: "email" },
    [
      "postal_code",
      "department",
      "region",
      "stripe_connect_account_id",
      "stripe_connect_onboarding_status",
      "stripe_connect_details_submitted",
      "stripe_connect_charges_enabled",
      "stripe_connect_payouts_enabled",
      "stripe_connect_requirements_due",
      "stripe_connect_last_synced_at"
    ]
  );

  if (trainerResult.error) throw trainerResult.error;
  const trainerData = trainerResult.data;

  const trainerModules = [];
  for (const moduleName of modules) {
    const { data: trainerModuleData, error: trainerModuleError } = await supabase
      .from("trainer_modules")
      .upsert({
        trainer_id: trainerData.id,
        module_name: moduleName,
        status: "certified",
        validated_at: today,
        expires_at: addYears(today, 2)
      }, { onConflict: "trainer_id,module_name" })
      .select()
      .single();

    if (trainerModuleError) throw trainerModuleError;
    trainerModules.push(trainerModuleData);
  }

  await archiveRegistration(
    {
      ...registration,
      training_result: "passed"
    },
    "activated"
  );
  await markRegistrationActivated(registration.id, trainerData.id, now);

  return { trainer: trainerData, trainer_modules: trainerModules };
}

async function requireAdmin(req) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length).trim()
    : "";

  if (!token) {
    return { ok: false, status: 401, error: "Token d'authentification manquant" };
  }

  const {
    data: { user },
    error: userError
  } = await supabase.auth.getUser(token);

  if (userError || !user?.email) {
    return { ok: false, status: 401, error: "Session admin invalide" };
  }

  const { data: adminUser, error: adminError } = await supabase
    .from("admin_users")
    .select("id, email")
    .eq("email", normalizeEmail(user.email))
    .maybeSingle();

  if (adminError) {
    return { ok: false, status: 500, error: "Erreur de vérification admin" };
  }

  if (!adminUser) {
    return { ok: false, status: 403, error: "Accès refusé" };
  }

  return { ok: true, user, adminUser };
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

    const registrationId = sanitizeText(req.body?.registration_id);
    const requestedModuleName = sanitizeText(req.body?.module_name);
    const result = sanitizeText(req.body?.result).toLowerCase();

    if (!registrationId) return res.status(400).json({ error: "Missing registration_id" });
    if (!requestedModuleName) return res.status(400).json({ error: "Missing module_name" });
    if (!["passed", "failed", "resit", "pending"].includes(result)) {
      return res.status(400).json({ error: "Invalid result" });
    }

    const officialModuleName = getOfficialModuleName(requestedModuleName);
    if (!officialModuleName) {
      return res.status(400).json({ error: "Module non reconnu" });
    }

    const { data: registration, error: registrationError } = await supabase
      .from("trainer_session_registrations")
      .select("*")
      .eq("id", registrationId)
      .single();

    if (registrationError || !registration) {
      return res.status(404).json({ error: "Registration not found" });
    }

    if (!["captured", "paid"].includes(registration.payment_status)) {
      return res.status(400).json({ error: "Le paiement doit être encaissé avant de valider les modules" });
    }

    if (registration.validation_status !== "validated") {
      return res.status(400).json({ error: "Le dossier doit être validé avant de valider les modules" });
    }

    const modules = getCandidateModules(registration);
    if (!modules.some(moduleName => normalizeModuleKey(moduleName) === normalizeModuleKey(officialModuleName))) {
      return res.status(400).json({ error: "Ce module ne fait pas partie de la formule achetée par le candidat" });
    }

    const moduleResults = normalizeModuleResults(registration.training_module_results);
    moduleResults[officialModuleName] = result;

    let overallResult = "pending";
    if (modules.every(moduleName => moduleResults[moduleName] === "passed")) {
      overallResult = "passed";
    } else if (modules.some(moduleName => moduleResults[moduleName] === "failed")) {
      overallResult = "failed";
    } else if (modules.some(moduleName => moduleResults[moduleName] === "resit")) {
      overallResult = "resit";
    }

    const { error: updateError } = await supabase
      .from("trainer_session_registrations")
      .update({
        training_module_results: moduleResults,
        training_result: overallResult
      })
      .eq("id", registrationId);

    if (updateError) {
      return res.status(500).json({ error: updateError.message });
    }

    // Activer le formateur sur chaque module réussi indépendamment
    // Un seul module réussi suffit à créer/activer le profil formateur
    const passedModules = modules.filter(m => moduleResults[m] === "passed");
    const failedModules = modules.filter(m => moduleResults[m] === "failed");

    let activation = null;
    if (passedModules.length > 0) {
      activation = await activateTrainerFromRegistration(
        {
          ...registration,
          training_module_results: moduleResults,
          training_result: overallResult
        },
        passedModules  // seulement les modules réussis
      );
    }

    // Désactiver les modules échoués si le formateur existe déjà
    if (failedModules.length > 0 && activation?.trainer?.id) {
      for (const moduleName of failedModules) {
        await supabase
          .from("trainer_modules")
          .update({ status: "failed" })
          .eq("trainer_id", activation.trainer.id)
          .eq("module_name", moduleName);
      }
    }

    // Message adapté selon le résultat
    let message = "Résultat du module mis à jour.";
    if (passedModules.length > 0 && failedModules.length === 0) {
      message = "Tous les modules validés — formateur activé sur l'ensemble de ses modules.";
    } else if (passedModules.length > 0) {
      message = `Formateur activé sur ${passedModules.length} module(s). ${failedModules.length} module(s) échoué(s) — rachat requis pour retenter.`;
    } else if (overallResult === "resit") {
      message = "Rattrapage à planifier.";
    } else if (overallResult === "failed") {
      message = "Tous les modules échoués. Le candidat doit racheter les modules pour se représenter.";
    }

    return res.status(200).json({
      success: true,
      message,
      training_result: overallResult,
      training_module_results: moduleResults,
      passed_modules: passedModules,
      failed_modules: failedModules,
      activated: Boolean(activation),
      trainer: activation?.trainer || null,
      trainer_modules: activation?.trainer_modules || []
    });
  } catch (err) {
    console.error("Update training module result error:", err);
    return res.status(500).json({ error: err.message });
  }
}
