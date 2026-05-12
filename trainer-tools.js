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
    trainer_payout_amount: payoutAmount,
    vital_protect_commission_rate: commissionTier.rate
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

  if (!trainer) {
    return {
      ok: false,
      status: 403,
      error: "Profil formateur introuvable"
    };
  }

  return {
    ok: true,
    user,
    trainer
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

  if (moduleName) {
    const { data, error } = await supabase
      .from("training_modules")
      .select("*")
      .ilike("name", moduleName)
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

  if (moduleRow?.name) {
    const { data, error } = await supabase
      .from("trainer_modules")
      .select("*")
      .eq("trainer_id", trainerId)
      .eq("module_name", moduleRow.name)
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

  if (normalize(trainerModule.status) !== "certified") {
    return res.status(403).json({
      error: "Ce module n'est pas certifié"
    });
  }

  if (!isFutureOrToday(trainerModule.expires_at)) {
    return res.status(403).json({
      error: "Ce module est expiré"
    });
  }

  const title = `${moduleRow.name} — ${city} — ${stageDate}`;

  const payload = {
    trainer_id: trainer.id,
    module_slug: moduleRow.slug,
    title,
    training_type: moduleRow.name,
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

async function handleDashboard(req, res, trainer) {
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
      return await handleCreateStage(req, res, trainerCheck.trainer);
    }

    if (action === "dashboard") {
      return await handleDashboard(req, res, trainerCheck.trainer);
    }

    if (action === "update_stage_status") {
      return await handleUpdateStageStatus(req, res, trainerCheck.trainer);
    }

    return res.status(400).json({ error: "action inconnue" });
  } catch (err) {
    console.error("Trainer tools error:", err);
    return res.status(500).json({ error: err.message });
  }
}
