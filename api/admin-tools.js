import Stripe from "stripe";
import { Resend } from "resend";
import { createHash, randomBytes } from "crypto";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "");
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

const PUBLIC_STAGE_UNIT_PRICE = 30;
const ENTERPRISE_STAGE_PRICE = 390;
const PAYOUT_DAY_OF_MONTH = 20;

const TRAINER_DOCUMENT_BUCKET = process.env.TRAINER_DOCUMENT_BUCKET || "trainer-documents";

const TRAINER_DOCUMENT_REQUIREMENTS = [
  { type: "identity", label: "Pièce d’identité", category: "external", required: true },
  { type: "bank_account", label: "RIB / compte bancaire", category: "external", required: true },
  { type: "criminal_record", label: "Casier judiciaire B3", category: "upload", required: true, sensitive: true },
  { type: "liability_insurance", label: "Attestation RC pro", category: "upload", required: true },
  { type: "diploma", label: "Diplôme / certification", category: "upload", required: false },
  { type: "charter", label: "Charte VITAL PROTECT", category: "acceptance", required: true }
];


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


function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDateForEmail(value) {
  if (!value) return "à confirmer";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value || "");
  return date.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  });
}

function formatEuroAmount(value) {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount)) return "0 €";
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR"
  }).format(amount);
}


function getPublicSiteUrl() {
  return String(
    process.env.PUBLIC_SITE_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.SITE_URL ||
    "https://www.vital-protect.fr"
  ).replace(/\/+$/, "");
}

function generateReportResponseToken() {
  return randomBytes(32).toString("hex");
}

function buildReportResponseUrl(token) {
  return `${getPublicSiteUrl()}/reponse-report.html?token=${encodeURIComponent(token || "")}`;
}

function isReportResponseBlocking(row = {}) {
  return ["pending", "refund_requested"].includes(normalize(row.report_response_status || ""));
}

function isReportResponseRefundRequested(row = {}) {
  return normalize(row.report_response_status || "") === "refund_requested";
}

function getStageDisplayTitle(stage = {}, reservation = {}) {
  return replaceLegacyModuleNames(
    stage.title ||
    stage.training_type ||
    reservation.stage_title ||
    reservation.stageTitle ||
    "Stage VITAL PROTECT"
  );
}

async function sendEmailSafe(payload) {
  try {
    if (!resend || !payload?.to) return { sent: false, skipped: true };
    const response = await resend.emails.send({
      from: process.env.RESEND_FROM || "VITAL PROTECT <contact@vital-protect.fr>",
      replyTo: process.env.RESEND_REPLY_TO || "contact@vital-protect.fr",
      ...payload
    });
    console.log("Email envoyé :", response);
    return { sent: true, response };
  } catch (error) {
    console.error("Erreur envoi email :", error);
    return { sent: false, error: error.message };
  }
}

async function notifyReservationRescheduled({ stage = {}, reservation = {}, newStageDate = "", token = "" }) {
  const email = normalizeEmail(reservation.email || reservation.customer_email || "");
  if (!email) return { sent: false, skipped: true };

  const title = getStageDisplayTitle(stage, reservation);
  const oldDateLabel = formatDateForEmail(reservation.report_original_stage_date || reservation.original_stage_date || reservation.stage_date || stage.original_stage_date);
  const dateLabel = formatDateForEmail(newStageDate || reservation.report_proposed_stage_date || stage.stage_date);
  const timeLabelPlain = stage.start_time ? ` à ${stage.start_time}` : "";
  const timeLabelHtml = stage.start_time ? ` à ${escapeHtml(stage.start_time)}` : "";
  const cityLabel = stage.city || reservation.city || "à confirmer";
  const responseUrl = buildReportResponseUrl(token || reservation.report_response_token || "");
  const clientName = `${reservation.first_name || ""} ${reservation.last_name || ""}`.trim();

  return await sendEmailSafe({
    to: email,
    subject: "Nouvelle date proposée pour votre stage Vital Protect",
    text: [
      `Bonjour ${clientName || ""},`,
      "",
      "Nous vous contactons au sujet de votre réservation Vital Protect.",
      "Le stage ne peut pas être maintenu à la date initialement prévue. Une nouvelle date vous est proposée.",
      "",
      `Stage : ${title}`,
      `Date initiale : ${oldDateLabel}`,
      `Nouvelle date proposée : ${dateLabel}${timeLabelPlain}`,
      `Lieu : ${cityLabel}`,
      "",
      "Merci d’indiquer votre choix depuis ce lien sécurisé :",
      responseUrl,
      "",
      "Vous pourrez accepter la nouvelle date ou demander le remboursement de votre réservation.",
      "",
      "VITAL PROTECT"
    ].join("\n"),
    html: `
      <div style="display:none;max-height:0;overflow:hidden;color:#ffffff;opacity:0;">
        Merci de confirmer votre choix pour la nouvelle date proposée.
      </div>
      <div style="font-family:Arial,sans-serif;color:#10223a;line-height:1.65;max-width:640px;">
        <h2 style="margin:0 0 12px;color:#0f243d;">Nouvelle date proposée pour votre stage</h2>
        <p>Bonjour ${escapeHtml(clientName)},</p>
        <p>Nous vous contactons au sujet de votre réservation <strong>Vital Protect</strong>.</p>
        <p>Le stage ne peut pas être maintenu à la date initialement prévue. Une nouvelle date vous est proposée.</p>
        <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:18px 0;background:#f6f9fc;border:1px solid #dce8f1;border-radius:14px;overflow:hidden;">
          <tr><td style="padding:12px 14px;font-weight:700;width:170px;">Stage</td><td style="padding:12px 14px;">${escapeHtml(title)}</td></tr>
          <tr><td style="padding:12px 14px;font-weight:700;">Date initiale</td><td style="padding:12px 14px;">${escapeHtml(oldDateLabel)}</td></tr>
          <tr><td style="padding:12px 14px;font-weight:700;">Nouvelle date</td><td style="padding:12px 14px;">${escapeHtml(dateLabel)}${timeLabelHtml}</td></tr>
          <tr><td style="padding:12px 14px;font-weight:700;">Lieu</td><td style="padding:12px 14px;">${escapeHtml(cityLabel)}</td></tr>
        </table>
        <p>Merci d’indiquer votre choix depuis le lien sécurisé ci-dessous.</p>
        <p style="margin:22px 0;">
          <a href="${escapeHtml(responseUrl)}" style="display:inline-block;padding:13px 20px;border-radius:999px;background:#12324a;color:#ffffff;text-decoration:none;font-weight:700;">
            Répondre à la proposition
          </a>
        </p>
        <p>Vous pourrez accepter la nouvelle date ou demander le remboursement de votre réservation.</p>
        <p style="font-size:13px;color:#66758a;">Si le bouton ne fonctionne pas, copiez ce lien dans votre navigateur :<br>${escapeHtml(responseUrl)}</p>
        <p style="margin-top:18px;"><strong>VITAL PROTECT</strong></p>
      </div>
    `
  });
}

async function notifyReservationRefunded({ stage = {}, reservation = {}, refund = null, amount = 0 }) {
  const email = normalizeEmail(reservation.email || reservation.customer_email || "");
  if (!email) return { sent: false, skipped: true };

  const title = getStageDisplayTitle(stage, reservation);
  const refundId = refund?.id || reservation.stripe_refund_id || "";
  const amountLabel = formatEuroAmount(amount || reservation.refunded_amount || reservation.total_amount || 0);

  return await sendEmailSafe({
    to: email,
    subject: "Remboursement de votre réservation VITAL PROTECT",
    html: `
      <h2>Votre remboursement a été lancé</h2>
      <p>Bonjour ${escapeHtml(reservation.first_name || "")} ${escapeHtml(reservation.last_name || "")},</p>
      <p>Votre réservation pour le stage ci-dessous a été remboursée.</p>
      <ul>
        <li><strong>Stage :</strong> ${escapeHtml(title)}</li>
        <li><strong>Montant remboursé :</strong> ${escapeHtml(amountLabel)}</li>
        ${refundId ? `<li><strong>Référence remboursement :</strong> ${escapeHtml(refundId)}</li>` : ""}
      </ul>
      <p>Selon votre banque, le remboursement peut mettre quelques jours à apparaître sur votre compte.</p>
      <p><strong>VITAL PROTECT</strong></p>
    `
  });
}

async function notifyReservationTrainerChanged({ stage = {}, reservation = {}, trainer = {} }) {
  const email = normalizeEmail(reservation.email || reservation.customer_email || "");
  if (!email) return { sent: false, skipped: true };

  const title = getStageDisplayTitle(stage, reservation);
  const trainerName = `${trainer.first_name || ""} ${trainer.last_name || ""}`.trim() || "un formateur VITAL PROTECT";

  return await sendEmailSafe({
    to: email,
    subject: "Votre stage VITAL PROTECT est maintenu avec un autre formateur",
    html: `
      <h2>Votre stage est maintenu</h2>
      <p>Bonjour ${escapeHtml(reservation.first_name || "")} ${escapeHtml(reservation.last_name || "")},</p>
      <p>Votre stage <strong>VITAL PROTECT</strong> est maintenu. Le formateur initial est remplacé.</p>
      <ul>
        <li><strong>Stage :</strong> ${escapeHtml(title)}</li>
        <li><strong>Date :</strong> ${escapeHtml(formatDateForEmail(stage.stage_date))}${stage.start_time ? ` à ${escapeHtml(stage.start_time)}` : ""}</li>
        <li><strong>Lieu :</strong> ${escapeHtml(stage.city || reservation.city || "à confirmer")}</li>
        <li><strong>Nouveau formateur :</strong> ${escapeHtml(trainerName)}</li>
      </ul>
      <p>Votre réservation reste bien enregistrée.</p>
      <p><strong>VITAL PROTECT</strong></p>
    `
  });
}


function isMissingRelationError(error) {
  const message = String(error?.message || "").toLowerCase();
  return error?.code === "42P01" || message.includes("relation") || message.includes("does not exist");
}

function getTrainerDocumentRequirement(type) {
  return TRAINER_DOCUMENT_REQUIREMENTS.find(item => item.type === String(type || "").trim());
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
    storage_bucket: row.storage_bucket || "",
    has_file: Boolean(row.storage_path),
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


const VP_MODULE_NAMES = {
  module1: "Prévenir, éviter, réagir – Module 1",
  module2: "Prévenir, éviter, réagir – Module 2",
  pro: "Faire face aux situations tendues et comportements agressifs en milieu professionnel",
  baton: "Interpellation simple et usage du bâton télescopique – Police / Sécurité",
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
    text.includes("baton") ||
    text.includes("bâton") ||
    text.includes("telescopique") ||
    text.includes("télescopique") ||
    text.includes("interpellation") ||
    text.includes("police") ||
    text.includes("securite police") ||
    text.includes("module baton")
  ) return "baton";
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
  if (
    normalized.includes("baton") ||
    normalized.includes("bâton") ||
    normalized.includes("telescopique") ||
    normalized.includes("télescopique") ||
    normalized.includes("interpellation") ||
    normalized.includes("police securite") ||
    normalized.includes("module baton")
  ) pushOfficialModule(modules, VP_MODULE_NAMES.baton);

  return modules.slice(0, 4);
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
  text = text.replace(/Interpellation\s*simple.*?bâton\s*télescopique/gi, VP_MODULE_NAMES.baton);
  text = text.replace(/Interpellation.*?baton/gi, VP_MODULE_NAMES.baton);
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


function isRealizedStage(row = {}) {
  return ["completed", "realized", "réalisé", "realise"].includes(normalize(row.status || ""));
}

function isCancelledStage(row = {}) {
  return ["cancelled", "canceled", "annulé", "annule"].includes(normalize(row.status || ""));
}

function isReservationAlreadyTransferred(row = {}) {
  return Boolean(
    normalize(row.trainer_payout_status || "") === "paid" ||
    row.trainer_payout_paid_at ||
    row.trainer_payout_stripe_transfer_id
  );
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
    return { rate: 0.075, trainerShareRate: 0.925, label: "Formateur mensuel" };
  }
  if (count >= 6) {
    return { rate: 0.15, trainerShareRate: 0.85, label: "Formateur régulier" };
  }
  return { rate: 0.30, trainerShareRate: 0.70, label: "Formateur lancement" };
}

function getReservationGrossAmount(reservation = {}, stage = {}) {
  const storedTotal = Number(reservation.total_amount || 0);
  if (Number.isFinite(storedTotal) && storedTotal > 0) return storedTotal;

  const offerType = getStageOfferType(stage);
  if (offerType === "enterprise") return ENTERPRISE_STAGE_PRICE;

  const places = Number(reservation.places || 0);
  return places * PUBLIC_STAGE_UNIT_PRICE;
}

function calculateTrainerPayout(grossAmount, commissionRate) {
  const amount = Number(grossAmount || 0);
  const rate = Number(commissionRate || 0);
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  if (!Number.isFinite(rate) || rate < 0 || rate >= 1) return amount;
  return Math.round(amount * (1 - rate) * 100) / 100;
}

function eurosToCents(value) {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  return Math.round(amount * 100);
}

function getPayoutDateForStage(stageDateString) {
  if (!stageDateString) return null;
  const stageDate = new Date(stageDateString);
  if (Number.isNaN(stageDate.getTime())) return null;
  const payoutDate = new Date(stageDate.getFullYear(), stageDate.getMonth() + 1, 20);
  return payoutDate.toISOString().slice(0, 10);
}

function buildStripeIdempotencyKey(prefix, values = []) {
  const hash = createHash("sha256")
    .update(values.map(value => String(value || "")).join("|"))
    .digest("hex")
    .slice(0, 32);
  return `${prefix}_${hash}`.slice(0, 255);
}


function getStripeId(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  return String(value.id || "");
}

async function getReservationStripeChargeId(reservation = {}) {
  const directChargeId = sanitizeText(
    reservation.stripe_charge_id ||
    reservation.stripe_latest_charge_id ||
    reservation.stripe_source_transaction_id ||
    reservation.payment_charge_id ||
    ""
  );

  if (directChargeId && directChargeId.startsWith("ch_")) return directChargeId;

  const sessionId = sanitizeText(reservation.stripe_session_id || reservation.checkout_session_id || "");
  if (!sessionId) return "";

  const session = await stripe.checkout.sessions.retrieve(sessionId, {
    expand: ["payment_intent.latest_charge"]
  });

  if (session.payment_status && session.payment_status !== "paid") {
    throw new Error(`Réservation ${reservation.id} : paiement Stripe non encaissé (${session.payment_status}).`);
  }

  const paymentIntent = session.payment_intent;
  const latestCharge = typeof paymentIntent === "object" && paymentIntent
    ? paymentIntent.latest_charge
    : null;

  const chargeId = getStripeId(latestCharge);
  if (chargeId && chargeId.startsWith("ch_")) return chargeId;

  const paymentIntentId = getStripeId(paymentIntent) || sanitizeText(reservation.stripe_payment_intent_id || "");
  if (!paymentIntentId) return "";

  const retrievedPaymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId, {
    expand: ["latest_charge"]
  });

  return getStripeId(retrievedPaymentIntent.latest_charge);
}

async function getReservationStripePaymentIntentId(reservation = {}) {
  const directPaymentIntentId = sanitizeText(
    reservation.stripe_payment_intent_id ||
    reservation.payment_intent_id ||
    reservation.payment_intent ||
    ""
  );

  if (directPaymentIntentId && directPaymentIntentId.startsWith("pi_")) {
    return directPaymentIntentId;
  }

  const sessionId = sanitizeText(reservation.stripe_session_id || reservation.checkout_session_id || "");
  if (!sessionId) return "";

  const session = await stripe.checkout.sessions.retrieve(sessionId);
  return getStripeId(session.payment_intent);
}

function isReservationRefunded(row = {}) {
  return Boolean(
    normalize(row.payment_status || "") === "refunded" ||
    row.refunded_at ||
    row.stripe_refund_id
  );
}

async function getTrainerCommissionTier(trainerId) {
  if (!trainerId) return getCommissionTier(0);

  const { data, error } = await supabase
    .from("stages")
    .select("id, status, stage_date")
    .eq("trainer_id", trainerId);

  if (error) {
    console.error("Supabase trainer commission fetch error:", error);
    return getCommissionTier(0);
  }

  const realizedStages12Months = (data || []).filter(stage => isRealizedStage(stage) && isInLast12Months(stage.stage_date)).length;
  return getCommissionTier(realizedStages12Months);
}

async function updateReservationsWithOptionalColumns(reservationIds, payload, optionalColumns = []) {
  const attemptedMissingColumns = [];
  let currentPayload = withoutUndefined({ ...payload });

  for (let attempt = 0; attempt <= optionalColumns.length; attempt += 1) {
    const { data, error } = await supabase
      .from("reservations")
      .update(currentPayload)
      .in("id", reservationIds)
      .select("id, stage_id, trainer_payout_status, trainer_payout_paid_at");

    if (!error) {
      return { data: data || [], error: null, omittedColumns: attemptedMissingColumns };
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
    error: new Error("Impossible de mettre à jour les réservations : colonnes optionnelles incompatibles"),
    omittedColumns: attemptedMissingColumns
  };
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

  let payoutRowsUpdated = 0;

  if (status === "cancelled") {
    const { data: paidReservations, error: reservationFetchError } = await supabase
      .from("reservations")
      .select("id, trainer_payout_status, trainer_payout_paid_at, trainer_payout_stripe_transfer_id")
      .eq("stage_id", stageId)
      .eq("payment_status", "paid");

    if (reservationFetchError) {
      return res.status(500).json({ error: reservationFetchError.message });
    }

    const reservationIds = (paidReservations || [])
      .filter(row => !isReservationAlreadyTransferred(row))
      .map(row => row.id);

    if (reservationIds.length) {
      const updateResult = await updateReservationsWithOptionalColumns(reservationIds, {
        trainer_payout_status: "blocked",
        trainer_payout_admin_note: "Stage annulé : aucun reversement formateur. Choisir remplacement formateur, report de date ou remboursement client."
      }, []);

      if (updateResult.error) {
        return res.status(500).json({ error: updateResult.error.message });
      }

      payoutRowsUpdated = updateResult.data.length;
    }
  }

  return res.status(200).json({ success: true, stage: data, payout_rows_updated: payoutRowsUpdated });
}

async function handleUpdateStageTrainer(req, res) {
  const stageId = sanitizeText(req.body?.stage_id);
  const trainerIdInput = sanitizeText(req.body?.trainer_id);
  const trainerEmailInput = sanitizeText(req.body?.trainer_email).toLowerCase();
  const note = sanitizeText(req.body?.note || "Remplacement formateur");

  if (!stageId) {
    return res.status(400).json({ error: "stage_id manquant" });
  }

  if (!trainerIdInput && !trainerEmailInput) {
    return res.status(400).json({ error: "trainer_id ou trainer_email manquant" });
  }

  let trainerQuery = supabase.from("trainers").select("*").limit(1);
  if (trainerIdInput) {
    trainerQuery = trainerQuery.eq("id", trainerIdInput);
  } else {
    trainerQuery = trainerQuery.ilike("email", trainerEmailInput);
  }

  const { data: trainers, error: trainerError } = await trainerQuery;
  if (trainerError) return res.status(500).json({ error: trainerError.message });

  const trainer = Array.isArray(trainers) ? trainers[0] : null;
  if (!trainer) {
    return res.status(404).json({ error: "Formateur remplaçant introuvable" });
  }

  const { data: stage, error: stageError } = await supabase
    .from("stages")
    .update({
      trainer_id: trainer.id,
      status: "published"
    })
    .eq("id", stageId)
    .select()
    .single();

  if (stageError) return res.status(500).json({ error: stageError.message });

  const { data: paidReservations, error: reservationFetchError } = await supabase
    .from("reservations")
    .select("*")
    .eq("stage_id", stageId)
    .eq("payment_status", "paid");

  if (reservationFetchError) return res.status(500).json({ error: reservationFetchError.message });

  const reservationIds = (paidReservations || [])
    .filter(row => !isReservationAlreadyTransferred(row))
    .map(row => row.id);

  let payoutRowsUpdated = 0;
  if (reservationIds.length) {
    const updateResult = await updateReservationsWithOptionalColumns(reservationIds, {
      trainer_payout_status: "scheduled",
      trainer_payout_paid_at: null,
      trainer_payout_admin_note: `${note} : reversement réattribué au nouveau formateur.`.slice(0, 1000)
    }, []);

    if (updateResult.error) return res.status(500).json({ error: updateResult.error.message });
    payoutRowsUpdated = updateResult.data.length;
  }

  const emailResults = [];
  for (const reservation of paidReservations || []) {
    emailResults.push(await notifyReservationTrainerChanged({ stage, reservation, trainer }));
  }

  return res.status(200).json({
    success: true,
    stage,
    trainer: {
      id: trainer.id,
      email: trainer.email,
      first_name: trainer.first_name,
      last_name: trainer.last_name
    },
    payout_rows_updated: payoutRowsUpdated,
    emails_sent: emailResults.filter(item => item?.sent).length
  });
}

async function handleRescheduleStage(req, res) {
  const stageId = sanitizeText(req.body?.stage_id);
  const stageDate = sanitizeText(req.body?.stage_date);
  const note = sanitizeText(req.body?.note || "Report du stage");

  if (!stageId) {
    return res.status(400).json({ error: "stage_id manquant" });
  }

  if (!isValidDate(stageDate)) {
    return res.status(400).json({ error: "Nouvelle date invalide" });
  }

  const { data: previousStage, error: previousStageError } = await supabase
    .from("stages")
    .select("*")
    .eq("id", stageId)
    .maybeSingle();

  if (previousStageError) return res.status(500).json({ error: previousStageError.message });
  if (!previousStage) return res.status(404).json({ error: "Stage introuvable" });

  const originalStageDate = previousStage.stage_date || null;

  const { data: stage, error: stageError } = await supabase
    .from("stages")
    .update({
      stage_date: stageDate,
      status: "published"
    })
    .eq("id", stageId)
    .select()
    .single();

  if (stageError) return res.status(500).json({ error: stageError.message });

  const { data: paidReservations, error: reservationFetchError } = await supabase
    .from("reservations")
    .select("*")
    .eq("stage_id", stageId)
    .eq("payment_status", "paid");

  if (reservationFetchError) return res.status(500).json({ error: reservationFetchError.message });

  const now = new Date().toISOString();
  const emailResults = [];
  const updatedReservationIds = [];

  for (const reservation of paidReservations || []) {
    if (isReservationAlreadyTransferred(reservation) || isReservationRefunded(reservation)) {
      continue;
    }

    const token = generateReportResponseToken();
    const updateResult = await updateReservationsWithOptionalColumns([reservation.id], {
      trainer_payout_status: "blocked",
      trainer_payout_paid_at: null,
      trainer_payout_due_date: getPayoutDateForStage(stageDate),
      trainer_payout_admin_note: `${note} : attente réponse client pour la nouvelle date.`.slice(0, 1000),
      report_response_status: "pending",
      report_response_token: token,
      report_original_stage_date: originalStageDate,
      report_proposed_stage_date: stageDate,
      report_requested_at: now,
      report_responded_at: null
    }, [
      "trainer_payout_due_date",
      "report_response_status",
      "report_response_token",
      "report_original_stage_date",
      "report_proposed_stage_date",
      "report_requested_at",
      "report_responded_at"
    ]);

    if (updateResult.error) return res.status(500).json({ error: updateResult.error.message });

    updatedReservationIds.push(reservation.id);
    emailResults.push(await notifyReservationRescheduled({
      stage: { ...stage, original_stage_date: originalStageDate },
      reservation: {
        ...reservation,
        report_response_token: token,
        report_original_stage_date: originalStageDate,
        report_proposed_stage_date: stageDate
      },
      newStageDate: stageDate,
      token
    }));
  }

  return res.status(200).json({
    success: true,
    stage,
    original_stage_date: originalStageDate,
    proposed_stage_date: stageDate,
    report_pending: updatedReservationIds.length,
    payout_rows_updated: updatedReservationIds.length,
    updated_reservation_ids: updatedReservationIds,
    emails_sent: emailResults.filter(item => item?.sent).length
  });
}


async function handleRefundReservation(req, res) {
  const reservationId = sanitizeText(req.body?.reservation_id);
  const note = sanitizeText(req.body?.note || "Remboursement demandé après proposition de report");

  if (!reservationId) {
    return res.status(400).json({ error: "reservation_id manquant" });
  }

  const { data: reservation, error: reservationError } = await supabase
    .from("reservations")
    .select("*")
    .eq("id", reservationId)
    .maybeSingle();

  if (reservationError) return res.status(500).json({ error: reservationError.message });
  if (!reservation) return res.status(404).json({ error: "Réservation introuvable" });

  if (normalize(reservation.payment_status || "") !== "paid") {
    return res.status(400).json({ error: "La réservation n’est pas payée ou a déjà été traitée." });
  }

  if (isReservationRefunded(reservation)) {
    return res.status(400).json({ error: "Cette réservation est déjà remboursée." });
  }

  if (isReservationAlreadyTransferred(reservation)) {
    return res.status(400).json({ error: "Remboursement automatique bloqué : cette réservation a déjà été reversée au formateur." });
  }

  const { data: stageRow, error: stageError } = await supabase
    .from("stages")
    .select("*")
    .eq("id", reservation.stage_id)
    .maybeSingle();

  if (stageError) return res.status(500).json({ error: stageError.message });

  const stage = stageRow || { id: reservation.stage_id, status: "cancelled", title: reservation.stage_title };
  const grossAmount = getReservationGrossAmount(reservation, stage);
  const amountCents = eurosToCents(grossAmount);

  if (!amountCents) {
    return res.status(400).json({ error: "Montant de remboursement invalide pour cette réservation." });
  }

  let paymentIntentId = "";
  try {
    paymentIntentId = await getReservationStripePaymentIntentId(reservation);
  } catch (error) {
    return res.status(400).json({ error: `PaymentIntent Stripe introuvable : ${error.message}` });
  }

  if (!paymentIntentId || !paymentIntentId.startsWith("pi_")) {
    return res.status(400).json({ error: "PaymentIntent Stripe introuvable. Impossible de rembourser automatiquement." });
  }

  const idempotencyKey = buildStripeIdempotencyKey("vp_reservation_refund", [
    reservation.id,
    paymentIntentId,
    amountCents
  ]);

  let refund;
  try {
    refund = await stripe.refunds.create({
      payment_intent: paymentIntentId,
      amount: amountCents,
      reason: "requested_by_customer",
      metadata: {
        platform: "vital_protect",
        stage_id: String(reservation.stage_id || ""),
        reservation_id: String(reservation.id || ""),
        stripe_session_id: String(reservation.stripe_session_id || ""),
        refund_reason: "reschedule_refused",
        admin_note: note.slice(0, 450)
      }
    }, { idempotencyKey });
  } catch (error) {
    const failureNote = `Erreur remboursement Stripe : ${error.message}`.slice(0, 1000);
    await updateReservationsWithOptionalColumns([reservation.id], {
      trainer_payout_status: "blocked",
      trainer_payout_admin_note: failureNote
    }, []);
    return res.status(400).json({ error: `Remboursement Stripe impossible : ${error.message}` });
  }

  const now = new Date().toISOString();
  const updateResult = await updateReservationsWithOptionalColumns([reservation.id], {
    payment_status: "refunded",
    refunded_at: now,
    refunded_amount: Math.round((amountCents / 100) * 100) / 100,
    stripe_refund_id: refund.id,
    trainer_payout_status: "blocked",
    trainer_payout_admin_note: note || `Remboursement Stripe ${refund.id}`,
    report_response_status: "refunded",
    report_responded_at: now
  }, [
    "refunded_at",
    "refunded_amount",
    "stripe_refund_id",
    "report_response_status",
    "report_responded_at"
  ]);

  if (updateResult.error) {
    return res.status(500).json({
      error: `Remboursement Stripe créé (${refund.id}), mais mise à jour Supabase impossible : ${updateResult.error.message}`,
      refund_id: refund.id
    });
  }

  const emailResult = await notifyReservationRefunded({
    stage,
    reservation,
    refund,
    amount: amountCents / 100
  });

  return res.status(200).json({
    success: true,
    reservation_id: reservation.id,
    refund_id: refund.id,
    amount: amountCents / 100,
    amount_cents: amountCents,
    currency: refund.currency,
    email_sent: Boolean(emailResult?.sent)
  });
}

async function handleRefundStageReservations(req, res) {
  const stageId = sanitizeText(req.body?.stage_id);
  const note = sanitizeText(req.body?.note || "Remboursement clients après annulation du stage");

  if (!stageId) {
    return res.status(400).json({ error: "stage_id manquant" });
  }

  const { data: stageRow, error: stageError } = await supabase
    .from("stages")
    .select("*")
    .eq("id", stageId)
    .maybeSingle();

  if (stageError) return res.status(500).json({ error: stageError.message });

  // Un stage annulé peut être masqué de certaines vues publiques/admin. Le remboursement
  // doit rester possible tant que les réservations payées existent et qu’aucun reversement
  // formateur n’a été transféré. On utilise donc un fallback minimal si la ligne stage
  // n’est plus visible/trouvable, avec les montants stockés dans reservations.
  const stage = stageRow || { id: stageId, status: "cancelled" };

  const { data: reservations, error: reservationsError } = await supabase
    .from("reservations")
    .select("*")
    .eq("stage_id", stageId)
    .eq("payment_status", "paid");

  if (reservationsError) return res.status(500).json({ error: reservationsError.message });

  const paidReservations = reservations || [];
  const alreadyTransferred = paidReservations.filter(row => isReservationAlreadyTransferred(row));

  if (alreadyTransferred.length) {
    return res.status(400).json({
      error: "Remboursement automatique bloqué : au moins une réservation a déjà été reversée au formateur. Traiter ce cas manuellement dans Stripe/comptabilité."
    });
  }

  const refundableReservations = paidReservations.filter(row => !isReservationRefunded(row));

  if (!refundableReservations.length) {
    return res.status(400).json({ error: "Aucune réservation payée à rembourser pour ce stage." });
  }

  const refunds = [];
  const refundedReservationIds = [];

  for (const reservation of refundableReservations) {
    const grossAmount = getReservationGrossAmount(reservation, stage);
    const amountCents = eurosToCents(grossAmount);

    if (!amountCents) {
      return res.status(400).json({
        error: `Montant de remboursement invalide pour la réservation ${reservation.id}.`
      });
    }

    let paymentIntentId = "";
    try {
      paymentIntentId = await getReservationStripePaymentIntentId(reservation);
    } catch (error) {
      return res.status(400).json({
        error: `PaymentIntent Stripe introuvable pour la réservation ${reservation.id} : ${error.message}`
      });
    }

    if (!paymentIntentId || !paymentIntentId.startsWith("pi_")) {
      return res.status(400).json({
        error: `PaymentIntent Stripe introuvable pour la réservation ${reservation.id}. Impossible de rembourser automatiquement.`
      });
    }

    const idempotencyKey = buildStripeIdempotencyKey("vp_stage_refund", [
      stageId,
      reservation.id,
      paymentIntentId,
      amountCents
    ]);

    let refund;
    try {
      refund = await stripe.refunds.create({
        payment_intent: paymentIntentId,
        amount: amountCents,
        reason: "requested_by_customer",
        metadata: {
          platform: "vital_protect",
          stage_id: stageId,
          reservation_id: String(reservation.id || ""),
          stripe_session_id: String(reservation.stripe_session_id || ""),
          refund_reason: "stage_cancelled",
          admin_note: note.slice(0, 450)
        }
      }, {
        idempotencyKey
      });
    } catch (error) {
      const failureNote = `Erreur remboursement Stripe : ${error.message}`.slice(0, 1000);
      await updateReservationsWithOptionalColumns([reservation.id], {
        trainer_payout_status: "blocked",
        trainer_payout_admin_note: failureNote
      }, []);

      if (refundedReservationIds.length) {
        return res.status(400).json({
          error: `Remboursement partiel : ${refundedReservationIds.length} réservation(s) remboursée(s), puis échec Stripe sur ${reservation.id} : ${error.message}`,
          refunds,
          refunded_reservation_ids: refundedReservationIds
        });
      }

      return res.status(400).json({
        error: `Remboursement Stripe impossible : ${error.message}`
      });
    }

    const now = new Date().toISOString();
    const updateResult = await updateReservationsWithOptionalColumns([reservation.id], {
      payment_status: "refunded",
      refunded_at: now,
      refunded_amount: Math.round((amountCents / 100) * 100) / 100,
      stripe_refund_id: refund.id,
      trainer_payout_status: "blocked",
      trainer_payout_admin_note: note || `Remboursement Stripe ${refund.id}`
    }, [
      "refunded_at",
      "refunded_amount",
      "stripe_refund_id"
    ]);

    if (updateResult.error) {
      return res.status(500).json({
        error: `Remboursement Stripe créé (${refund.id}), mais mise à jour Supabase impossible : ${updateResult.error.message}`,
        refund_id: refund.id
      });
    }

    const emailResult = await notifyReservationRefunded({
      stage,
      reservation,
      refund,
      amount: amountCents / 100
    });

    refunds.push({
      reservation_id: reservation.id,
      refund_id: refund.id,
      payment_intent: paymentIntentId,
      amount: amountCents / 100,
      amount_cents: amountCents,
      currency: refund.currency,
      status: refund.status,
      email_sent: Boolean(emailResult?.sent)
    });
    refundedReservationIds.push(reservation.id);
  }

  await supabase
    .from("stages")
    .update({ status: "cancelled" })
    .eq("id", stageId);

  return res.status(200).json({
    success: true,
    refunds,
    refund_ids: refunds.map(item => item.refund_id).join(","),
    amount: Math.round(refunds.reduce((sum, item) => sum + Number(item.amount || 0), 0) * 100) / 100,
    amount_cents: refunds.reduce((sum, item) => sum + Number(item.amount_cents || 0), 0),
    currency: "eur",
    updated: refundedReservationIds.length,
    refunded_reservation_ids: refundedReservationIds,
    emails_sent: refunds.filter(item => item.email_sent).length
  });
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

  let selectQuery = supabase.from("reservations").select("*").eq("payment_status", "paid");
  if (reservationId) {
    selectQuery = selectQuery.eq("id", reservationId);
  } else {
    selectQuery = selectQuery.eq("stage_id", stageId);
  }

  const { data: rows, error: selectError } = await selectQuery;
  if (selectError) return res.status(500).json({ error: selectError.message });

  const targetRows = (rows || []).filter(row => {
    if (["validated", "scheduled"].includes(status) && isReportResponseBlocking(row)) return false;
    if (isReservationRefunded(row)) return false;
    return true;
  });

  if (!targetRows.length) {
    return res.status(400).json({
      error: "Aucune réservation éligible. Les réservations en attente de réponse client ou en demande de remboursement restent bloquées."
    });
  }

  const payload = {
    trainer_payout_status: status,
    trainer_payout_paid_at: status === "paid" ? new Date().toISOString() : null,
    trainer_payout_admin_note: note || null
  };

  const updateResult = await updateReservationsWithOptionalColumns(targetRows.map(row => row.id), payload, []);

  if (updateResult.error) {
    const message = String(updateResult.error.message || "");
    if (message.toLowerCase().includes("trainer_payout")) {
      return res.status(500).json({
        error: "Colonnes reversements manquantes dans Supabase. Exécute le fichier SUPABASE_REVERSEMENTS_FORMATEURS.sql puis réessaie."
      });
    }
    return res.status(500).json({ error: updateResult.error.message });
  }

  return res.status(200).json({
    success: true,
    updated: updateResult.data.length,
    skipped_report_pending: (rows || []).length - targetRows.length,
    payout_status: status,
    rows: updateResult.data || []
  });
}


async function handleExecuteTrainerPayout(req, res) {
  const stageId = sanitizeText(req.body?.stage_id);
  const note = sanitizeText(req.body?.note || "");

  if (!stageId) {
    return res.status(400).json({ error: "stage_id manquant" });
  }

  const { data: stage, error: stageError } = await supabase
    .from("stages")
    .select("*")
    .eq("id", stageId)
    .maybeSingle();

  if (stageError) return res.status(500).json({ error: stageError.message });
  if (!stage) return res.status(404).json({ error: "Stage introuvable" });

  if (!stage.trainer_id) {
    return res.status(400).json({ error: "Aucun formateur rattaché à ce stage" });
  }

  if (isCancelledStage(stage)) {
    return res.status(400).json({ error: "Stage annulé : aucun reversement ne doit être envoyé au formateur." });
  }

  const { data: trainer, error: trainerError } = await supabase
    .from("trainers")
    .select("*")
    .eq("id", stage.trainer_id)
    .maybeSingle();

  if (trainerError) return res.status(500).json({ error: trainerError.message });
  if (!trainer) return res.status(404).json({ error: "Formateur introuvable" });

  const connectAccountId = sanitizeText(trainer.stripe_connect_account_id);
  if (!connectAccountId) {
    return res.status(400).json({ error: "Le formateur n’a pas encore connecté son compte Stripe Connect." });
  }

  let stripeAccount;
  try {
    stripeAccount = await stripe.accounts.retrieve(connectAccountId);
  } catch (error) {
    return res.status(400).json({ error: `Compte Stripe Connect introuvable ou inaccessible : ${error.message}` });
  }

  if (!stripeAccount.payouts_enabled) {
    return res.status(400).json({
      error: "Les reversements Stripe ne sont pas encore activés pour ce formateur. Il doit compléter son onboarding Stripe."
    });
  }

  const { data: reservations, error: reservationsError } = await supabase
    .from("reservations")
    .select("*")
    .eq("stage_id", stageId)
    .eq("payment_status", "paid");

  if (reservationsError) return res.status(500).json({ error: reservationsError.message });

  const payableReservations = (reservations || []).filter(row => {
    const status = normalize(row.trainer_payout_status || "scheduled");
    return !isReportResponseBlocking(row) && status !== "paid" && !row.trainer_payout_paid_at && !row.trainer_payout_stripe_transfer_id;
  });

  if (!payableReservations.length) {
    return res.status(400).json({ error: "Aucun reversement restant à transférer pour ce stage." });
  }

  const notValidated = payableReservations.filter(row => normalize(row.trainer_payout_status || "scheduled") !== "validated");
  if (notValidated.length) {
    return res.status(400).json({
      error: "Le reversement doit d’abord être validé par l’admin avant transfert Stripe."
    });
  }

  const commissionTier = await getTrainerCommissionTier(stage.trainer_id);
  const reservationBreakdown = [];

  for (const row of payableReservations) {
    const grossAmount = getReservationGrossAmount(row, stage);
    const storedRate = Number(row.vital_protect_commission_rate);
    const commissionRate = Number.isFinite(storedRate) && storedRate >= 0 && storedRate < 1 ? storedRate : commissionTier.rate;
    const storedPayout = Number(row.trainer_payout_amount);
    const payoutAmount = Number.isFinite(storedPayout) && storedPayout > 0
      ? storedPayout
      : calculateTrainerPayout(grossAmount, commissionRate);

    let sourceChargeId = "";
    try {
      sourceChargeId = await getReservationStripeChargeId(row);
    } catch (error) {
      return res.status(400).json({
        error: `Charge Stripe source introuvable pour la réservation ${row.id} : ${error.message}`
      });
    }

    if (!sourceChargeId || !sourceChargeId.startsWith("ch_")) {
      return res.status(400).json({
        error: `Charge Stripe source introuvable pour la réservation ${row.id}. Impossible de lier le transfert au paiement client.`
      });
    }

    reservationBreakdown.push({
      id: row.id,
      stripe_session_id: row.stripe_session_id || "",
      grossAmount,
      commissionRate,
      payoutAmount,
      sourceChargeId
    });
  }

  const totalPayoutAmount = Math.round(reservationBreakdown.reduce((sum, row) => sum + Number(row.payoutAmount || 0), 0) * 100) / 100;
  const totalAmountCents = eurosToCents(totalPayoutAmount);

  if (!totalAmountCents) {
    return res.status(400).json({ error: "Montant de reversement nul ou invalide." });
  }

  const transfers = [];
  const paidReservationIds = [];

  for (const row of reservationBreakdown) {
    const amountCents = eurosToCents(row.payoutAmount);
    if (!amountCents) continue;

    const idempotencyKey = buildStripeIdempotencyKey("vp_trainer_payout", [
      stageId,
      row.id,
      connectAccountId,
      amountCents,
      row.sourceChargeId
    ]);

    let transfer;
    try {
      transfer = await stripe.transfers.create({
        amount: amountCents,
        currency: "eur",
        destination: connectAccountId,
        source_transaction: row.sourceChargeId,
        transfer_group: `vp_stage_${stageId}`,
        metadata: {
          platform: "vital_protect",
          stage_id: stageId,
          trainer_id: String(stage.trainer_id || ""),
          trainer_email: String(trainer.email || ""),
          reservation_id: String(row.id || ""),
          stripe_session_id: String(row.stripe_session_id || ""),
          source_charge_id: row.sourceChargeId,
          payout_amount_eur: String(row.payoutAmount),
          commission_rate: String(row.commissionRate)
        }
      }, {
        idempotencyKey
      });
    } catch (error) {
      const failureNote = `Erreur transfert Stripe : ${error.message}`.slice(0, 1000);
      await updateReservationsWithOptionalColumns([row.id], {
        trainer_payout_status: "blocked",
        trainer_payout_admin_note: failureNote
      }, []);

      if (paidReservationIds.length) {
        return res.status(400).json({
          error: `Transfert partiel : ${paidReservationIds.length} réservation(s) transférée(s), puis échec Stripe sur ${row.id} : ${error.message}`,
          transfers,
          paid_reservation_ids: paidReservationIds
        });
      }

      return res.status(400).json({
        error: `Transfert Stripe impossible : ${error.message}`
      });
    }

    const now = new Date().toISOString();
    const updateResult = await updateReservationsWithOptionalColumns([row.id], {
      trainer_payout_status: "paid",
      trainer_payout_paid_at: now,
      trainer_payout_transferred_at: now,
      trainer_payout_stripe_transfer_id: transfer.id,
      trainer_payout_admin_note: note || `Reversement Stripe Connect ${transfer.id}`
    }, [
      "trainer_payout_transferred_at",
      "trainer_payout_stripe_transfer_id"
    ]);

    if (updateResult.error) {
      return res.status(500).json({
        error: `Transfert Stripe créé (${transfer.id}), mais mise à jour Supabase impossible : ${updateResult.error.message}`,
        transfer_id: transfer.id
      });
    }

    transfers.push({
      reservation_id: row.id,
      transfer_id: transfer.id,
      amount: row.payoutAmount,
      amount_cents: amountCents,
      currency: transfer.currency,
      source_transaction: row.sourceChargeId
    });
    paidReservationIds.push(row.id);
  }

  return res.status(200).json({
    success: true,
    transfers,
    transfer_id: transfers.map(item => item.transfer_id).join(","),
    amount: totalPayoutAmount,
    amount_cents: totalAmountCents,
    currency: "eur",
    destination: connectAccountId,
    updated: paidReservationIds.length,
    paid_reservation_ids: paidReservationIds
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


async function handleListTrainerDocuments(req, res) {
  const { data, error } = await supabase
    .from("trainer_documents")
    .select("*")
    .order("updated_at", { ascending: false });

  if (error) {
    if (isMissingRelationError(error)) {
      return res.status(200).json({
        success: true,
        setup_required: true,
        document_requirements: TRAINER_DOCUMENT_REQUIREMENTS,
        trainer_documents: []
      });
    }
    return res.status(500).json({ error: error.message });
  }

  return res.status(200).json({
    success: true,
    setup_required: false,
    document_requirements: TRAINER_DOCUMENT_REQUIREMENTS,
    trainer_documents: (data || []).map(sanitizeTrainerDocumentRow)
  });
}

async function handleGetTrainerDocumentUrl(req, res) {
  const documentId = sanitizeText(req.body?.document_id);

  if (!documentId) {
    return res.status(400).json({ error: "document_id manquant" });
  }

  const { data: documentRow, error } = await supabase
    .from("trainer_documents")
    .select("id, storage_bucket, storage_path, file_name")
    .eq("id", documentId)
    .maybeSingle();

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  if (!documentRow?.storage_path) {
    return res.status(404).json({ error: "Fichier introuvable pour ce document" });
  }

  const bucket = documentRow.storage_bucket || TRAINER_DOCUMENT_BUCKET;
  const { data: signed, error: signedError } = await supabase.storage
    .from(bucket)
    .createSignedUrl(documentRow.storage_path, 300, {
      download: documentRow.file_name || undefined
    });

  if (signedError) {
    return res.status(500).json({ error: signedError.message });
  }

  return res.status(200).json({
    success: true,
    signed_url: signed?.signedUrl || "",
    expires_in_seconds: 300
  });
}

async function handleUpdateTrainerDocumentStatus(req, res) {
  const documentId = sanitizeText(req.body?.document_id);
  const status = sanitizeText(req.body?.status).toLowerCase();
  const adminNote = sanitizeText(req.body?.admin_note || "");
  const expiresAt = sanitizeText(req.body?.expires_at || "");

  if (!documentId) {
    return res.status(400).json({ error: "document_id manquant" });
  }

  if (!["submitted", "in_review", "validated", "refused", "expired"].includes(status)) {
    return res.status(400).json({ error: "Statut document invalide" });
  }

  if (expiresAt && !isValidDate(expiresAt)) {
    return res.status(400).json({ error: "expires_at invalide" });
  }

  const now = new Date().toISOString();
  const payload = {
    status,
    admin_note: adminNote || null,
    expires_at: expiresAt || null,
    updated_at: now
  };

  if (status === "validated") {
    payload.validated_at = now;
    payload.refused_at = null;
  }

  if (status === "refused") {
    payload.refused_at = now;
  }

  const { data, error } = await supabase
    .from("trainer_documents")
    .update(payload)
    .eq("id", documentId)
    .select()
    .single();

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  return res.status(200).json({
    success: true,
    trainer_document: sanitizeTrainerDocumentRow(data)
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


async function handleGetSatisfaction(req, res) {
  const { data, error } = await supabase
    .from("satisfaction_summary")
    .select("*");

  if (error) {
    // Fallback if view doesn't exist yet
    const { data: raw, error: rawError } = await supabase
      .from("satisfaction_responses")
      .select("*, stages(module_name, stage_date, city)")
      .order("created_at", { ascending: false })
      .limit(200);

    if (rawError) return res.status(500).json({ error: rawError.message });
    return res.status(200).json({ success: true, responses: raw || [], summary: [] });
  }

  return res.status(200).json({ success: true, summary: data || [] });
}


async function handleRefundTrainerRegistration(req, res) {
  const registrationId = sanitizeText(req.body?.registration_id);
  const paymentRef = sanitizeText(
    req.body?.payment_ref ||
    req.body?.stripe_payment_intent_id ||
    req.body?.stripe_session_id
  );

  if (!registrationId && !paymentRef) {
    return res.status(400).json({ error: "registration_id ou référence Stripe manquant" });
  }

  const registrationSelect = "*";
  const isUuid = value => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));

  async function findRegistration(field, value) {
    if (!value) return null;

    const { data, error } = await supabase
      .from("trainer_session_registrations")
      .select(registrationSelect)
      .eq(field, value)
      .order("created_at", { ascending: false })
      .limit(1);

    if (error) throw error;
    return Array.isArray(data) && data.length ? data[0] : null;
  }

  let reg = null;

  try {
    // Recherche normale par ID Supabase. On évite les valeurs non UUID pour ne pas casser
    // si le front envoie une mauvaise référence.
    if (isUuid(registrationId)) {
      reg = await findRegistration("id", registrationId);
    }

    // Sécurité : si l'ID affiché côté admin ne correspond pas à la ligne,
    // on retrouve l'inscription via la référence Stripe transmise par le bouton.
    if (!reg && paymentRef) {
      reg = await findRegistration("stripe_payment_intent_id", paymentRef);
    }

    if (!reg && paymentRef) {
      reg = await findRegistration("stripe_session_id", paymentRef);
    }
  } catch (regError) {
    return res.status(500).json({ error: `Erreur recherche inscription : ${regError.message || regError}` });
  }

  if (!reg) {
    return res.status(404).json({
      error: "Inscription introuvable",
      registration_id: registrationId || null,
      payment_ref: paymentRef || null
    });
  }

  // Check not already refunded/cancelled. Certaines bases n’ont pas les colonnes
  // refunded_at / stripe_refund_id, donc on se base d’abord sur payment_status.
  const currentPaymentStatus = normalize(reg.payment_status || "");
  if (currentPaymentStatus === "refunded" || currentPaymentStatus === "canceled" || currentPaymentStatus === "cancelled" || reg.refunded_at || reg.stripe_refund_id) {
    return res.status(400).json({ error: "Cette inscription a déjà été remboursée ou annulée" });
  }

  // Check not already activated as trainer
  const { data: trainer } = await supabase
    .from("trainers")
    .select("id")
    .ilike("email", reg.email || "")
    .maybeSingle();

  if (trainer) {
    return res.status(400).json({ error: "Ce formateur est déjà activé — remboursement impossible depuis l'admin" });
  }

  // Get payment intent from Stripe session if needed
  let paymentIntentId = reg.stripe_payment_intent_id;

  if (!paymentIntentId && reg.stripe_session_id) {
    try {
      const session = await stripe.checkout.sessions.retrieve(reg.stripe_session_id);
      paymentIntentId = session.payment_intent;
    } catch (err) {
      return res.status(500).json({ error: "Impossible de récupérer la session Stripe : " + err.message });
    }
  }

  if (!paymentIntentId) {
    return res.status(400).json({ error: "Aucun paiement Stripe trouvé pour cette inscription" });
  }

  // Process refund / cancellation
  try {
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

    // Si le paiement est seulement autorisé mais pas encore encaissé, Stripe ne fait pas
    // un refund : il faut annuler l'autorisation pour libérer l'empreinte bancaire.
    if (
      paymentIntent.status === "requires_capture" ||
      (Number(paymentIntent.amount_capturable || 0) > 0 && !paymentIntent.latest_charge)
    ) {
      const canceledIntent = await stripe.paymentIntents.cancel(paymentIntentId);

      const { error: cancelUpdateError } = await supabase
        .from("trainer_session_registrations")
        .update({
          payment_status: "canceled",
          validation_status: "rejected"
        })
        .eq("id", reg.id);

      if (cancelUpdateError) {
        return res.status(500).json({ error: cancelUpdateError.message });
      }

      return res.status(200).json({
        success: true,
        canceled: true,
        payment_intent_id: canceledIntent.id,
        amount: 0
      });
    }

    const refund = await stripe.refunds.create({
      payment_intent: paymentIntentId,
      reason: "requested_by_customer"
    });

    const refundUpdateResult = await updateWithOptionalColumns(
      "trainer_session_registrations",
      {
        refunded_at: new Date().toISOString(),
        stripe_refund_id: refund.id,
        payment_status: "refunded",
        validation_status: "rejected"
      },
      [{ column: "id", value: reg.id }],
      ["refunded_at", "stripe_refund_id"]
    );

    if (refundUpdateResult.error) {
      return res.status(500).json({ error: refundUpdateResult.error.message });
    }

    return res.status(200).json({
      success: true,
      refund_id: refund.id,
      amount: refund.amount
    });

  } catch (err) {
    return res.status(500).json({ error: "Erreur Stripe : " + err.message });
  }
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

    if (action === "update_stage_trainer") {
      return await handleUpdateStageTrainer(req, res);
    }

    if (action === "reschedule_stage") {
      return await handleRescheduleStage(req, res);
    }

    if (action === "delete_stage") {
      return await handleDeleteStage(req, res);
    }

    if (action === "update_payout_status") {
      return await handleUpdatePayoutStatus(req, res);
    }

    if (action === "execute_trainer_payout") {
      return await handleExecuteTrainerPayout(req, res);
    }

    if (action === "refund_reservation") {
      return await handleRefundReservation(req, res);
    }

    if (action === "refund_stage_reservations") {
      return await handleRefundStageReservations(req, res);
    }

    if (action === "list_trainer_documents") {
      return await handleListTrainerDocuments(req, res);
    }

    if (action === "get_trainer_document_url") {
      return await handleGetTrainerDocumentUrl(req, res);
    }

    if (action === "update_trainer_document_status") {
      return await handleUpdateTrainerDocumentStatus(req, res);
    }

    if (action === "upsert_trainer_module") {
      return await handleUpsertTrainerModule(req, res);
    }

    if (action === "update_trainer_module") {
      return await handleUpdateTrainerModule(req, res);
    }

    if (action === "get_satisfaction") {
      return await handleGetSatisfaction(req, res);
    }

    if (action === "refund_trainer_registration") {
      return await handleRefundTrainerRegistration(req, res);
    }

    return res.status(400).json({ error: "action inconnue" });
  } catch (err) {
    console.error("Admin tools error:", err);
    return res.status(500).json({ error: err.message });
  }
}
