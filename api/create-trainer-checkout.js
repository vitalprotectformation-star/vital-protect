import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

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

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

function getTrainerSessionPrice(trainerSession) {
  const explicitLaunchPrice = Number(trainerSession.launch_price || 0);
  const explicitStandardPrice = Number(trainerSession.standard_price || 0);
  if (explicitLaunchPrice > 0) return explicitLaunchPrice;
  if (explicitStandardPrice > 0) return explicitStandardPrice;

  const moduleCount = Number(trainerSession.module_count || 1);
  if (moduleCount >= 3) return 690;
  if (moduleCount >= 2) return 590;
  return 490;
}

function getTrainerFormulaPrice(moduleCount) {
  const count = Number(moduleCount || 1);
  if (count >= 3) return 690;
  if (count >= 2) return 590;
  return 490;
}

function parseSelectedModules(value) {
  let rawItems = [];

  if (Array.isArray(value)) {
    rawItems = value;
  } else if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) rawItems = parsed;
      } catch (_) {
        rawItems = [];
      }
    }
    if (!rawItems.length) {
      rawItems = trimmed.split(/\s*\|\s*|\s*,\s*/g);
    }
  }

  const modules = [];
  rawItems.forEach((item) => {
    const canonical = getCanonicalModuleName(replaceLegacyModuleNames(item));
    if (!canonical) return;
    if (!modules.some((existing) => existing.toLowerCase() === canonical.toLowerCase())) {
      modules.push(canonical);
    }
  });

  return modules.slice(0, 3);
}

function sameCanonicalModule(a, b) {
  return getCanonicalModuleName(a).toLowerCase() === getCanonicalModuleName(b).toLowerCase();
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const {
      first_name,
      last_name,
      email,
      phone,
      city,
      postal_code,
      selected_module,
      selected_modules,
      selected_module_count,
      module_count,
      training_type,
      experience,
      message,
      session_id
    } = req.body || {};

    const cleanFirstName = sanitizeText(first_name);
    const cleanLastName = sanitizeText(last_name);
    const cleanEmail = normalizeEmail(email);
    const cleanPhone = sanitizeText(phone);
    const cleanCity = sanitizeText(city);
    const cleanPostalCode = sanitizeText(postal_code);
    const requestedModules = parseSelectedModules(selected_modules);
    const fallbackModule = getCanonicalModuleName(sanitizeText(selected_module || training_type));
    const cleanSelectedModules = requestedModules.length ? requestedModules : (fallbackModule ? [fallbackModule] : []);
    const requestedModuleCount = Number(selected_module_count || module_count || cleanSelectedModules.length || 1);
    const cleanModuleCount = Math.max(1, Math.min(3, requestedModuleCount));
    const cleanSelectedModule = cleanSelectedModules[0] || "";
    const cleanExperience = sanitizeText(experience);
    const cleanMessage = sanitizeText(message);
    const cleanSessionId = sanitizeText(session_id);

    if (!cleanFirstName) {
      return res.status(400).json({ error: "Prénom manquant" });
    }

    if (!cleanLastName) {
      return res.status(400).json({ error: "Nom manquant" });
    }

    if (!cleanEmail) {
      return res.status(400).json({ error: "Email manquant" });
    }

    if (!isValidEmail(cleanEmail)) {
      return res.status(400).json({ error: "Email invalide" });
    }

    if (!cleanPhone) {
      return res.status(400).json({ error: "Téléphone manquant" });
    }

    if (!cleanSelectedModule || !cleanSelectedModules.length) {
      return res.status(400).json({ error: "Module manquant" });
    }

    if (cleanSelectedModules.length !== cleanModuleCount) {
      return res.status(400).json({
        error: `Votre formule comprend ${cleanModuleCount} module(s). Merci de sélectionner exactement ${cleanModuleCount} module(s).`
      });
    }

    if (!cleanSessionId) {
      return res.status(400).json({ error: "Session manquante" });
    }

    const { data: trainerSession, error: sessionError } = await supabase
      .from("trainer_sessions")
      .select("*")
      .eq("id", cleanSessionId)
      .maybeSingle();

    if (sessionError) {
      console.error("Trainer session fetch error:", sessionError);
      return res.status(500).json({ error: "Erreur lecture session formateur" });
    }

    if (!trainerSession) {
      return res.status(404).json({ error: "Session formateur introuvable" });
    }

    if (String(trainerSession.status || "").toLowerCase() !== "open") {
      return res.status(400).json({
        error: "Cette session n'est pas ouverte à la réservation"
      });
    }

    const remainingPlaces = Number(trainerSession.remaining_places || 0);
    if (remainingPlaces <= 0) {
      return res.status(400).json({ error: "Cette session est complète" });
    }

    const sessionModuleName = getCanonicalModuleName(sanitizeText(
      trainerSession.module_name ||
      trainerSession.training_type ||
      trainerSession.title
    ));

    if (
      sessionModuleName &&
      cleanSelectedModules.length &&
      !cleanSelectedModules.some((moduleName) => sameCanonicalModule(moduleName, sessionModuleName))
    ) {
      return res.status(400).json({
        error: "La session choisie ne correspond à aucun des modules sélectionnés"
      });
    }

    const selectedPrice = getTrainerFormulaPrice(cleanModuleCount) || getTrainerSessionPrice(trainerSession);

    if (!selectedPrice || selectedPrice <= 0) {
      return res.status(400).json({ error: "Tarif session invalide" });
    }

    const origin =
      process.env.APP_BASE_URL ||
      req.headers.origin ||
      "https://www.vital-protect.fr";

    const checkoutSession = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",
      customer_email: cleanEmail,

      line_items: [
        {
          price_data: {
            currency: "eur",
            product_data: {
              name: `Formation formateur VITAL PROTECT — ${cleanModuleCount} module${cleanModuleCount > 1 ? "s" : ""}`,
              description: `Modules : ${cleanSelectedModules.join(" + ")}${
                trainerSession.city ? ` - ${trainerSession.city}` : ""
              }`
            },
            unit_amount: Math.round(selectedPrice * 100)
          },
          quantity: 1
        }
      ],

      payment_intent_data: {
        capture_method: "manual"
      },

      metadata: {
        type: "trainer",
        session_id: cleanSessionId,
        training_type: cleanSelectedModules.join(" | "),
        selected_module: cleanSelectedModule,
        selected_modules: JSON.stringify(cleanSelectedModules),
        selected_module_count: String(cleanModuleCount),
        formula_price: String(selectedPrice),
        first_name: cleanFirstName,
        last_name: cleanLastName,
        email: cleanEmail,
        phone: cleanPhone,
        city: cleanCity,
        postal_code: cleanPostalCode,
        experience: cleanExperience,
        message: cleanMessage
      },

      success_url: `${origin}/trainer-success.html?session_id=${encodeURIComponent(cleanSessionId)}`,
      cancel_url: `${origin}/trainer-cancel.html?session_id=${encodeURIComponent(cleanSessionId)}`
    });

    return res.status(200).json({ url: checkoutSession.url });
  } catch (err) {
    console.error("Create trainer checkout error:", err);
    return res.status(500).json({ error: "Erreur Stripe checkout formateur" });
  }
}
