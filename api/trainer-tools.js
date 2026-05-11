import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

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

function parseNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function firstFiniteAmount(source, fieldNames) {
  if (!source) return null;

  for (const fieldName of fieldNames) {
    const value = source[fieldName];
    if (value === null || value === undefined || value === "") continue;

    const amount = Number(value);
    if (Number.isFinite(amount)) {
      return amount;
    }
  }

  return null;
}

function getTrainerPayoutAmount(reservation, stage) {
  const reservationAmount = firstFiniteAmount(reservation, [
    "trainer_payout_amount",
    "trainer_amount",
    "payout_amount",
    "amount_to_pay_trainer",
    "trainer_fee_amount",
    "vital_protect_payout_amount"
  ]);

  if (reservationAmount !== null) {
    return reservationAmount;
  }

  const perPlaceAmount = firstFiniteAmount(stage, [
    "trainer_payout_per_place",
    "trainer_amount_per_place",
    "payout_per_place",
    "amount_to_pay_trainer_per_place",
    "trainer_fee_per_place",
    "vital_protect_payout_per_place"
  ]);

  if (perPlaceAmount !== null) {
    return perPlaceAmount * Number(reservation?.places || 0);
  }

  return null;
}

function sanitizeReservationForTrainer(row, stage) {
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
    trainer_payout_amount: getTrainerPayoutAmount(row, stage)
  };
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
  const remainingPlaces = parseNumber(req.body?.remaining_places, maxParticipants);
  // Le tarif public est fixé/validé par VITAL PROTECT avant publication.
  // Un formateur ne peut donc pas définir le prix encaissé sur le site depuis son espace.
  const price = 0;

  const moduleRow = await resolveTrainingModule({
    moduleSlug,
    moduleName
  });

  if (!moduleRow) {
    return res.status(400).json({ error: "Module introuvable ou inactif" });
  }

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

  if (!Number.isFinite(remainingPlaces) || remainingPlaces < 0 || remainingPlaces > maxParticipants) {
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
    status: "pending"
  };

  const insertResult = await insertWithOptionalPostalCode("stages", payload);

  if (insertResult.error) {
    return res.status(500).json({ error: insertResult.error.message });
  }

  return res.status(200).json({
    success: true,
    stage: insertResult.data,
    message: "Stage soumis à validation. Il sera visible publiquement après publication par l’administrateur.",
    postal_code_saved: insertResult.usedPostalCode,
    postal_code_fallback: insertResult.postalCodeFallback || false
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

  if (!stageIds.length) {
    return res.status(200).json({
      success: true,
      stages: [],
      reservations: [],
      stats: {
        stages_total: 0,
        stages_upcoming: 0,
        registrations_total: 0,
        trainer_payout_due: 0,
        trainer_payout_available: true
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
  const safeReservationRows = reservationRows.map(row => sanitizeReservationForTrainer(row, stageById.get(row.stage_id)));
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const stagesUpcoming = stageRows.filter(stage => {
    if (!stage.stage_date) return false;
    const stageDate = new Date(stage.stage_date);
    stageDate.setHours(0, 0, 0, 0);
    return !Number.isNaN(stageDate.getTime()) && stageDate >= today;
  }).length;

  const paidReservationRows = safeReservationRows.filter(row => normalize(row.payment_status || "paid") === "paid");

  const registrationsTotal = paidReservationRows
    .reduce((sum, row) => sum + Number(row.places || 0), 0);

  const trainerPayoutAvailable = paidReservationRows.every(row => row.trainer_payout_amount !== null && row.trainer_payout_amount !== undefined);

  const trainerPayoutDue = trainerPayoutAvailable
    ? paidReservationRows.reduce((sum, row) => sum + Number(row.trainer_payout_amount || 0), 0)
    : null;

  return res.status(200).json({
    success: true,
    stages: stageRows,
    reservations: safeReservationRows,
    stats: {
      stages_total: stageRows.length,
      stages_upcoming: stagesUpcoming,
      registrations_total: registrationsTotal,
      trainer_payout_due: trainerPayoutDue,
      trainer_payout_available: trainerPayoutAvailable
    }
  });
}

async function handleUpdateStageStatus(req, res, trainer) {
  const stageId = sanitizeText(req.body?.stage_id);
  const status = sanitizeText(req.body?.status).toLowerCase();

  if (!stageId) {
    return res.status(400).json({ error: "stage_id manquant" });
  }

  if (!["draft", "pending", "cancelled"].includes(status)) {
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
