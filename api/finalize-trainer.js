import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);
const APP_URL = process.env.APP_URL || "https://vital-protect.fr";

async function sendValidationEmail(trainer, trainerModules) {
  try {
    if (!trainer?.email) return;

    const firstName = trainer.first_name ? `, ${trainer.first_name}` : "";
    const moduleList = trainerModules.map(m => `<li>${m.module_name || m.module_slug}</li>`).join("");
    const loginUrl = `${APP_URL}/formateur-login.html`;

    await resend.emails.send({
      from: "Vital Protect <noreply@vital-protect.fr>",
      to: trainer.email,
      subject: "Votre dossier formateur Vital Protect a été validé",
      html: `
        <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;background:#fff;">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:28px;">
            <div style="width:28px;height:28px;background:#1F3864;border-radius:5px;"></div>
            <strong style="color:#1F3864;font-size:15px;letter-spacing:0.04em;">VITAL PROTECT</strong>
          </div>
          <h2 style="color:#1F3864;font-size:20px;margin:0 0 16px;">Votre dossier a été validé${firstName}.</h2>
          <p style="color:#444;font-size:15px;line-height:1.6;margin:0 0 16px;">
            Votre profil formateur Vital Protect est maintenant actif. Vous êtes habilité à animer les modules suivants :
          </p>
          <ul style="color:#1F3864;font-size:15px;line-height:1.8;margin:0 0 24px;padding-left:20px;">
            ${moduleList}
          </ul>
          <p style="color:#444;font-size:15px;line-height:1.6;margin:0 0 24px;">
            Connectez-vous à votre espace formateur pour planifier vos premières sessions et configurer votre profil de paiement.
          </p>
          <a href="${loginUrl}" style="display:inline-block;background:#1F3864;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px;">
            Accéder à mon espace formateur →
          </a>
          <p style="color:#999;font-size:12px;margin-top:32px;line-height:1.5;">
            Vital Protect — formations à la sécurité personnelle<br/>
            Première année d'affiliation offerte. Recyclage annuel inclus.
          </p>
        </div>
      `
    });
  } catch (err) {
    console.error("sendValidationEmail error:", err);
    // Non-bloquant
  }
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

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

function pushUniqueModule(modules, moduleName) {
  const clean = sanitizeText(moduleName);
  if (!clean) return;
  if (!modules.some((existing) => existing.toLowerCase() === clean.toLowerCase())) {
    modules.push(clean);
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
  if (!modules.some((existing) => normalizeModuleKey(existing) === normalizeModuleKey(moduleName))) {
    modules.push(moduleName);
  }
}

function parseModuleList(value) {
  const text = String(value || "").trim();
  if (!text) return [];

  let items = [];
  if (text.startsWith("[") && text.endsWith("]")) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) items = parsed;
    } catch (_) {
      items = [];
    }
  }

  if (!items.length) {
    // Ne jamais découper sur les virgules : les noms officiels des modules en contiennent.
    items = text.split(/\s*\|\s*|\s*;\s*|\n+/g);
  }

  const modules = [];
  items.forEach((item) => pushOfficialModule(modules, item));

  const normalized = normalizeModuleKey(text);
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

function parseRequestedModulesFromMessage(message) {
  const text = String(message || "");
  const match = text.match(/Modules demandés\s*:\s*([^\n]+)/i);
  if (!match) return [];
  return parseModuleList(match[1]);
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

    if (!registrationId) {
      return res.status(400).json({ error: "Missing registration_id" });
    }

    const { data: registration, error: registrationError } = await supabase
      .from("trainer_session_registrations")
      .select("*")
      .eq("id", registrationId)
      .single();

    if (registrationError || !registration) {
      console.error("Registration fetch error:", registrationError);
      return res.status(404).json({ error: "Registration not found" });
    }

    if (!["captured", "paid"].includes(registration.payment_status)) {
      return res.status(400).json({ error: "Payment not captured" });
    }

    if (registration.validation_status !== "validated") {
      return res.status(400).json({ error: "Registration not validated" });
    }

    if (registration.training_result !== "passed") {
      return res.status(400).json({ error: "Candidate not passed" });
    }

    const today = new Date().toISOString().split("T")[0];
    const cleanEmail = normalizeEmail(registration.email);

    if (!cleanEmail) {
      return res.status(400).json({ error: "Email candidat manquant" });
    }

    let moduleNames = parseRequestedModulesFromMessage(registration.message);

    if (!moduleNames.length && registration.session_id) {
      const { data: trainerSession, error: trainerSessionError } = await supabase
        .from("trainer_sessions")
        .select("id, module_name, title")
        .eq("id", registration.session_id)
        .maybeSingle();

      if (trainerSessionError) {
        console.error("Trainer session fetch error:", trainerSessionError);
        return res.status(500).json({ error: "Erreur de lecture de la session formateur" });
      }

      const moduleName = sanitizeText(
        trainerSession?.module_name || trainerSession?.title || registration.training_type || ""
      );
      if (moduleName) moduleNames = [moduleName];
    }

    if (!moduleNames.length) {
      moduleNames = parseModuleList(registration.training_type || "");
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

    if (trainerResult.error) {
      console.error("Trainer upsert error:", trainerResult.error);
      return res.status(500).json({ error: trainerResult.error.message });
    }

    const trainerData = trainerResult.data;

    const trainerModules = [];

    for (const moduleName of moduleNames) {
      const trainerModulePayload = {
        trainer_id: trainerData.id,
        module_name: moduleName,
        status: "certified",
        validated_at: today,
        expires_at: addYears(today, 2)
      };

      const { data: trainerModuleData, error: trainerModuleError } = await supabase
        .from("trainer_modules")
        .upsert(trainerModulePayload, { onConflict: "trainer_id,module_name" })
        .select()
        .single();

      if (trainerModuleError) {
        console.error("Trainer module upsert error:", trainerModuleError);
        return res.status(500).json({ error: trainerModuleError.message });
      }

      trainerModules.push(trainerModuleData);
    }

    const now = new Date().toISOString();
    await archiveRegistration(
      {
        ...registration,
        training_result: "passed"
      },
      "activated"
    );
    await markRegistrationActivated(registration.id, trainerData.id, now);

    // Envoyer l'email de validation au formateur
    await sendValidationEmail(trainerData, trainerModules);

    return res.status(200).json({
      success: true,
      trainer: trainerData,
      trainer_module: trainerModules[0] || null,
      trainer_modules: trainerModules,
      activated: true
    });
  } catch (err) {
    console.error("Finalize trainer error:", err);
    return res.status(500).json({ error: err.message });
  }
}
