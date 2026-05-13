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

    return res.status(200).json({
      success: true,
      message: overallResult === "passed"
        ? "Module validé. Tous les modules sont validés : le formateur peut être activé."
        : "Résultat du module mis à jour.",
      training_result: overallResult,
      training_module_results: moduleResults
    });
  } catch (err) {
    console.error("Update training module result error:", err);
    return res.status(500).json({ error: err.message });
  }
}
