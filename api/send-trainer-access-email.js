import { randomBytes } from "crypto";
import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function sanitizeText(value) {
  return String(value || "").trim();
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function isMissingColumnError(error, columnName) {
  const message = String(error?.message || "").toLowerCase();
  return message.includes(String(columnName || "").toLowerCase()) && message.includes("column");
}

function withoutUndefined(payload) {
  return Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined));
}

async function updateWithOptionalColumns(table, payload, filters, optionalColumns = []) {
  const omittedColumns = [];
  let currentPayload = withoutUndefined({ ...payload });

  for (let attempt = 0; attempt <= optionalColumns.length; attempt += 1) {
    let query = supabase.from(table).update(currentPayload);
    filters.forEach(filter => {
      query = query.eq(filter.column, filter.value);
    });

    const { data, error } = await query.select().single();
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

async function requireAdmin(req) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length).trim()
    : "";

  if (!token) return { ok: false, status: 401, error: "Token d'authentification manquant" };

  const { data: { user }, error: userError } = await supabase.auth.getUser(token);
  if (userError || !user?.email) return { ok: false, status: 401, error: "Session admin invalide" };

  const { data: adminUser, error: adminError } = await supabase
    .from("admin_users")
    .select("id, email")
    .eq("email", normalizeEmail(user.email))
    .maybeSingle();

  if (adminError) return { ok: false, status: 500, error: "Erreur de vérification admin" };
  if (!adminUser) return { ok: false, status: 403, error: "Accès refusé" };

  return { ok: true, user, adminUser };
}

function getOrigin(req) {
  return String(process.env.APP_BASE_URL || req.headers.origin || "https://www.vital-protect.fr").replace(/\/$/, "");
}

function getMailFrom() {
  return sanitizeText(
    process.env.RESEND_FROM_EMAIL ||
    process.env.MAIL_FROM ||
    process.env.EMAIL_FROM ||
    "VITAL PROTECT <contact@vital-protect.fr>"
  );
}

function getReplyTo() {
  return sanitizeText(
    process.env.RESEND_REPLY_TO ||
    process.env.MAIL_REPLY_TO ||
    process.env.EMAIL_REPLY_TO ||
    "vitalprotectformation@gmail.com"
  );
}

function buildEmailHtml(registration, accessLink) {
  const firstName = escapeHtml(registration.first_name || registration.firstName || "");

  return `
    <div style="font-family:Arial,Helvetica,sans-serif;line-height:1.55;color:#0b1736;max-width:620px;margin:0 auto;padding:24px;">
      <h2 style="margin:0 0 14px;color:#0b2e59;">Votre dashboard formateur est prêt</h2>
      <p>Bonjour ${firstName || ""},</p>
      <p>Votre parcours formateur <strong>VITAL PROTECT</strong> est enregistré.</p>
      <p>Vous pouvez créer votre mot de passe et accéder à votre dashboard formateur avec le bouton ci-dessous.</p>
      <p style="margin:26px 0;">
        <a href="${escapeHtml(accessLink)}" style="display:inline-block;padding:13px 20px;border-radius:12px;background:#0b2e59;color:#ffffff;text-decoration:none;font-weight:700;">
          Créer mon accès formateur
        </a>
      </p>
      <p>Ce lien est personnel et valable 7 jours.</p>
      <p style="font-size:13px;color:#52627a;">Si le bouton ne fonctionne pas, copiez-collez ce lien dans votre navigateur :<br>${escapeHtml(accessLink)}</p>
      <p><strong>VITAL PROTECT</strong></p>
    </div>
  `;
}

function buildEmailText(registration, accessLink) {
  const firstName = sanitizeText(registration.first_name || registration.firstName || "");
  return [
    `Bonjour ${firstName || ""},`,
    "",
    "Votre parcours formateur VITAL PROTECT est enregistré.",
    "Vous pouvez créer votre mot de passe et accéder à votre dashboard formateur avec le lien ci-dessous :",
    "",
    accessLink,
    "",
    "Ce lien est personnel et valable 7 jours.",
    "",
    "VITAL PROTECT"
  ].join("\n");
}

async function sendAccessEmail({ registration, accessLink }) {
  if (!resend) {
    return {
      emailSent: false,
      emailError: "RESEND_API_KEY n'est pas configurée."
    };
  }

  try {
    const sendResult = await resend.emails.send({
      from: getMailFrom(),
      to: normalizeEmail(registration.email),
      replyTo: getReplyTo(),
      subject: "Créez votre accès au dashboard formateur Vital Protect",
      html: buildEmailHtml(registration, accessLink),
      text: buildEmailText(registration, accessLink)
    });

    if (sendResult?.error) {
      const message = sendResult.error.message || JSON.stringify(sendResult.error);
      console.error("Resend trainer access email rejected:", sendResult.error);
      return {
        emailSent: false,
        emailError: message || "Resend a refusé l'envoi du mail."
      };
    }

    return {
      emailSent: true,
      emailError: null,
      emailId: sendResult?.data?.id || null
    };
  } catch (error) {
    console.error("Resend trainer access email error:", error);
    return {
      emailSent: false,
      emailError: error.message || "Erreur Resend lors de l'envoi du mail."
    };
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const adminCheck = await requireAdmin(req);
    if (!adminCheck.ok) return res.status(adminCheck.status).json({ error: adminCheck.error });

    const registrationId = sanitizeText(req.body?.registration_id);
    if (!registrationId) return res.status(400).json({ error: "registration_id manquant" });

    const { data: registration, error: registrationError } = await supabase
      .from("trainer_session_registrations")
      .select("*")
      .eq("id", registrationId)
      .maybeSingle();

    if (registrationError) return res.status(500).json({ error: registrationError.message });
    if (!registration?.email) return res.status(404).json({ error: "Candidat introuvable ou email manquant" });

    const paymentStatus = String(registration.payment_status || "").toLowerCase();
    if (!["checkout_created", "authorized", "captured", "paid", "pending_payment"].includes(paymentStatus)) {
      return res.status(403).json({ error: "Ce candidat n'a pas encore de paiement formateur exploitable." });
    }

    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const sentAt = new Date().toISOString();
    const inviteCount = Number(registration.portal_invite_count || 0) + 1;

    const updateResult = await updateWithOptionalColumns(
      "trainer_session_registrations",
      {
        portal_access_token: token,
        portal_access_token_expires_at: expiresAt,
        portal_invite_sent_at: sentAt,
        portal_invite_count: inviteCount
      },
      [{ column: "id", value: registrationId }],
      ["portal_access_token", "portal_access_token_expires_at", "portal_invite_sent_at", "portal_invite_count"]
    );

    if (updateResult.error) {
      return res.status(500).json({ error: updateResult.error.message });
    }

    if (updateResult.omittedColumns.includes("portal_access_token")) {
      return res.status(500).json({
        error: "La colonne portal_access_token est manquante dans Supabase : le lien d'accès ne peut pas être sécurisé."
      });
    }

    const origin = getOrigin(req);
    const accessLink = `${origin}/creer-acces-formateur.html?registration_id=${encodeURIComponent(registrationId)}&token=${encodeURIComponent(token)}`;

    const mailResult = await sendAccessEmail({ registration, accessLink });

    return res.status(200).json({
      success: true,
      email: normalizeEmail(registration.email),
      access_link: accessLink,
      email_sent: Boolean(mailResult.emailSent),
      email_error: mailResult.emailError || null,
      email_id: mailResult.emailId || null,
      expires_at: expiresAt,
      invite_count: inviteCount
    });
  } catch (error) {
    console.error("Send trainer access email error:", error);
    return res.status(500).json({ error: error.message || "Erreur lors de l'envoi du lien d'accès" });
  }
}
