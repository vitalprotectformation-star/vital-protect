import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

function sanitizeText(value, fallback = "") {
  return String(value || fallback).trim();
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatOptionalRow(label, value) {
  const sanitized = sanitizeText(value);

  if (!sanitized) {
    return "";
  }

  return `<p><strong>${escapeHtml(label)} :</strong> ${escapeHtml(sanitized).replaceAll("\n", "<br />")}</p>`;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const firstName = sanitizeText(req.body?.first_name);
    const lastName = sanitizeText(req.body?.last_name);
    const email = normalizeEmail(req.body?.email);
    const phone = sanitizeText(req.body?.phone);
    const location = sanitizeText(req.body?.location);
    const organization = sanitizeText(req.body?.organization);
    const subject = sanitizeText(req.body?.subject);
    const contactType = sanitizeText(req.body?.contact_type);
    const message = sanitizeText(req.body?.message);
    const website = sanitizeText(req.body?.website); // honeypot anti-spam
    const details = req.body?.details && typeof req.body.details === "object" ? req.body.details : {};

    if (website) {
      return res.status(200).json({ success: true });
    }

    if (!firstName) {
      return res.status(400).json({ error: "Prénom manquant" });
    }

    if (!lastName) {
      return res.status(400).json({ error: "Nom manquant" });
    }

    if (!email) {
      return res.status(400).json({ error: "Email manquant" });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({ error: "Email invalide" });
    }

    if (!location) {
      return res.status(400).json({ error: "Ville, département ou zone géographique manquant" });
    }

    if (contactType === "entreprise" && !organization) {
      return res.status(400).json({ error: "Structure ou entreprise manquante" });
    }

    if (!subject) {
      return res.status(400).json({ error: "Sujet manquant" });
    }

    if (!message || message.length < 10) {
      return res.status(400).json({
        error: "Merci de saisir un message plus détaillé"
      });
    }

    const toEmail =
      process.env.CONTACT_TO_EMAIL ||
      process.env.RESEND_CONTACT_TO ||
      "vitalprotectformation@gmail.com";

    const fromEmail =
      process.env.CONTACT_FROM_EMAIL ||
      "VITAL PROTECT <contact@vital-protect.fr>";

    const safeFirstName = escapeHtml(firstName);
    const safeLastName = escapeHtml(lastName);
    const safeEmail = escapeHtml(email);
    const safePhone = escapeHtml(phone || "Non renseigné");
    const safeLocation = escapeHtml(location);
    const safeOrganization = escapeHtml(organization || "Non renseigné");
    const safeSubject = escapeHtml(subject);
    const safeContactType = escapeHtml(contactType || "Non renseigné");
    const safeMessage = escapeHtml(message).replaceAll("\n", "<br />");

    const detailRows = [
      formatOptionalRow("Disponibilités souhaitées", details.stage_availability),
      formatOptionalRow("Contrainte physique éventuelle", details.stage_constraints),
      formatOptionalRow("Nombre de participants", details.participant_count),
      formatOptionalRow("Secteur / activité", details.sector),
      formatOptionalRow("Contexte entreprise", details.enterprise_context),
      formatOptionalRow("Expérience pédagogique", details.pedagogical_experience),
      formatOptionalRow("Module / parcours visé", details.target_module),
      formatOptionalRow("Type de projet", details.project_type),
      formatOptionalRow("Zone du projet", details.project_zone),
      formatOptionalRow("Échéance", details.deadline)
    ].filter(Boolean).join("\n");

    await resend.emails.send({
      from: fromEmail,
      to: toEmail,
      replyTo: email,
      subject: `[Contact site] ${subject} — ${firstName} ${lastName}`,
      html: `
        <h2>Nouvelle demande de contact</h2>

        <p><strong>Prénom :</strong> ${safeFirstName}</p>
        <p><strong>Nom :</strong> ${safeLastName}</p>
        <p><strong>Email :</strong> ${safeEmail}</p>
        <p><strong>Téléphone :</strong> ${safePhone}</p>
        <p><strong>Ville / département / zone :</strong> ${safeLocation}</p>
        <p><strong>Structure / entreprise :</strong> ${safeOrganization}</p>
        <p><strong>Sujet :</strong> ${safeSubject}</p>
        <p><strong>Type de demande :</strong> ${safeContactType}</p>

        ${detailRows ? `<hr /><h3>Précisions complémentaires</h3>${detailRows}` : ""}

        <hr />

        <p><strong>Message :</strong></p>
        <p>${safeMessage}</p>
      `
    });

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("Contact form error:", error);
    return res.status(500).json({
      error: "Impossible d'envoyer votre demande pour le moment"
    });
  }
}
