import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const PUBLIC_STAGE_UNIT_PRICE = 30;
const ENTERPRISE_STAGE_PRICE = 390;

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

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0;
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

function getStageCheckoutPrice(stage) {
  return getStageOfferType(stage) === "enterprise" ? ENTERPRISE_STAGE_PRICE : PUBLIC_STAGE_UNIT_PRICE;
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

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).send("Method not allowed");
  }

  try {
    const origin = process.env.APP_BASE_URL || "https://www.vital-protect.fr";
    const type = sanitizeText(req.body?.type).toLowerCase();

    if (type === "trainer") {
      const firstName = sanitizeText(req.body?.first_name);
      const lastName = sanitizeText(req.body?.last_name);
      const email = normalizeEmail(req.body?.email);
      const phone = sanitizeText(req.body?.phone);
      const city = sanitizeText(req.body?.city);
      const message = sanitizeText(req.body?.message);
      const sessionId = sanitizeText(req.body?.session_id);

      if (!firstName) return res.status(400).json({ error: "Prénom manquant" });
      if (!lastName) return res.status(400).json({ error: "Nom manquant" });
      if (!email) return res.status(400).json({ error: "Email manquant" });
      if (!phone) return res.status(400).json({ error: "Téléphone manquant" });
      if (!city) return res.status(400).json({ error: "Ville manquante" });
      if (!sessionId) return res.status(400).json({ error: "Session formateur manquante" });

      const { data: trainerSession, error: trainerSessionError } = await supabase
        .from("trainer_sessions")
        .select("*")
        .eq("id", sessionId)
        .maybeSingle();

      if (trainerSessionError) return res.status(500).json({ error: trainerSessionError.message });
      if (!trainerSession) return res.status(404).json({ error: "Session formateur introuvable" });

      if (String(trainerSession.status || "").toLowerCase() !== "open") {
        return res.status(400).json({ error: "Cette session n'est pas ouverte" });
      }

      if (Number(trainerSession.remaining_places || 0) < 1) {
        return res.status(400).json({ error: "Cette session est complète" });
      }

      const moduleName = getCanonicalModuleName(sanitizeText(
        trainerSession.module_name || trainerSession.title || "Formation formateur"
      ));

      const unitAmount = Math.round(getTrainerSessionPrice(trainerSession) * 100);

      if (!unitAmount || unitAmount <= 0) {
        return res.status(400).json({ error: "Tarif de session invalide" });
      }

      const session = await stripe.checkout.sessions.create({
        payment_method_types: ["card"],
        mode: "payment",
        customer_email: email,
        line_items: [
          {
            price_data: {
              currency: "eur",
              product_data: {
                name: moduleName,
                description: `Formation formateur VITAL PROTECT — ${trainerSession.city || ""}`
              },
              unit_amount: unitAmount
            },
            quantity: 1
          }
        ],
        payment_intent_data: {
          capture_method: "manual"
        },
        metadata: {
          type: "trainer",
          session_id: sessionId,
          training_type: moduleName,
          first_name: firstName,
          last_name: lastName,
          email,
          phone,
          city,
          message
        },
        success_url: `${origin}/trainer-success.html?session_id=${encodeURIComponent(sessionId)}`,
        cancel_url: `${origin}/trainer-cancel.html?session_id=${encodeURIComponent(sessionId)}`
      });

      return res.status(200).json({ url: session.url });
    }

    const stageId = sanitizeText(req.body?.stage_id);
    const firstName = sanitizeText(req.body?.first_name);
    const lastName = sanitizeText(req.body?.last_name);
    const email = normalizeEmail(req.body?.email);
    const phone = sanitizeText(req.body?.phone);
    const requestedPlaces = Number(req.body?.requested_places || req.body?.places || 1);
    const inventoryPlaces = Number(req.body?.places || requestedPlaces);

    if (!stageId) return res.status(400).json({ error: "Stage manquant" });
    if (!email) return res.status(400).json({ error: "Email manquant" });
    if (!isPositiveInteger(requestedPlaces) || !isPositiveInteger(inventoryPlaces)) return res.status(400).json({ error: "Nombre de places invalide" });

    const { data: stage, error: stageError } = await supabase
      .from("stages")
      .select("*")
      .eq("id", stageId)
      .maybeSingle();

    if (stageError) return res.status(500).json({ error: stageError.message });
    if (!stage) return res.status(404).json({ error: "Stage introuvable" });

    if (String(stage.status || "").toLowerCase() !== "published") {
      return res.status(400).json({ error: "Ce stage n'est pas disponible à la réservation" });
    }

    const offerType = getStageOfferType(stage);
    if (offerType === "enterprise" && requestedPlaces > 20) {
      return res.status(400).json({ error: "Le forfait entreprise est prévu pour 20 personnes maximum" });
    }
    const checkoutQuantity = offerType === "enterprise" ? 1 : inventoryPlaces;
    const unitPrice = getStageCheckoutPrice(stage);
    const remainingPlaces = Number(stage.remaining_places || 0);

    if (remainingPlaces < checkoutQuantity) {
      return res.status(400).json({
        error: offerType === "enterprise"
          ? "Cette session entreprise n'est plus disponible."
          : `Places insuffisantes. Il reste ${remainingPlaces} place(s).`
      });
    }

    if (!unitPrice || unitPrice <= 0) {
      return res.status(400).json({ error: "Prix du stage invalide" });
    }

    const stageTitle = replaceLegacyModuleNames(sanitizeText(stage.title, "Stage VITAL PROTECT"));
    const productDescription = offerType === "enterprise"
      ? "Réservation stage entreprise VITAL PROTECT — forfait jusqu’à 20 personnes"
      : "Réservation stage VITAL PROTECT";

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",
      customer_email: email,
      line_items: [
        {
          price_data: {
            currency: "eur",
            product_data: {
              name: stageTitle,
              description: productDescription
            },
            unit_amount: Math.round(unitPrice * 100)
          },
          quantity: checkoutQuantity
        }
      ],
      metadata: {
        type: "stage",
        stage_id: stage.id,
        stage_title: stageTitle,
        stage_kind: offerType,
        first_name: firstName,
        last_name: lastName,
        email,
        phone,
        places: String(checkoutQuantity),
        requested_places: String(requestedPlaces),
        unit_price: String(unitPrice)
      },
      success_url: `${origin}/success.html`,
      cancel_url: `${origin}/cancel.html`
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error("Stripe checkout session error:", err);
    return res.status(500).json({ error: "Erreur Stripe" });
  }
}
