import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function sanitizeText(value) {
  return String(value || "").trim();
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

  const email = normalizeEmail(user.email);

  const { data: adminUser, error: adminError } = await supabase
    .from("admin_users")
    .select("id, email")
    .eq("email", email)
    .maybeSingle();

  if (adminError) {
    return { ok: false, status: 500, error: "Erreur de vérification admin" };
  }

  if (!adminUser) {
    return { ok: false, status: 403, error: "Accès refusé" };
  }

  return { ok: true, user, adminUser };
}

async function findAuthUserByEmail(email) {
  const target = normalizeEmail(email);
  let page = 1;
  const perPage = 1000;

  while (page <= 20) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });

    if (error) {
      throw new Error(error.message || "Impossible de rechercher l'utilisateur Auth");
    }

    const users = data?.users || [];
    const found = users.find(user => normalizeEmail(user.email) === target);

    if (found) return found;
    if (users.length < perPage) return null;

    page += 1;
  }

  return null;
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

    const trainerId = sanitizeText(req.body?.trainer_id);
    const password = sanitizeText(req.body?.password);

    if (!trainerId) {
      return res.status(400).json({ error: "trainer_id manquant" });
    }

    if (!password || password.length < 8) {
      return res.status(400).json({ error: "Le mot de passe doit contenir au moins 8 caractères" });
    }

    const { data: trainer, error: trainerError } = await supabase
      .from("trainers")
      .select("id, email, first_name, last_name")
      .eq("id", trainerId)
      .maybeSingle();

    if (trainerError) {
      return res.status(500).json({ error: trainerError.message });
    }

    if (!trainer?.email) {
      return res.status(404).json({ error: "Formateur introuvable ou email manquant" });
    }

    const email = normalizeEmail(trainer.email);
    const existingUser = await findAuthUserByEmail(email);

    if (existingUser?.id) {
      const { error: updateError } = await supabase.auth.admin.updateUserById(existingUser.id, {
        password,
        email_confirm: true,
        user_metadata: {
          ...(existingUser.user_metadata || {}),
          role: "trainer",
          trainer_id: trainer.id,
          password_set_by_admin: true,
          password_set_at: new Date().toISOString()
        }
      });

      if (updateError) {
        return res.status(500).json({ error: updateError.message });
      }

      return res.status(200).json({
        success: true,
        created: false,
        email,
        trainer_id: trainer.id
      });
    }

    const { data: created, error: createError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        role: "trainer",
        trainer_id: trainer.id,
        first_name: trainer.first_name || "",
        last_name: trainer.last_name || "",
        password_set_by_admin: true,
        password_set_at: new Date().toISOString()
      }
    });

    if (createError) {
      return res.status(500).json({ error: createError.message });
    }

    return res.status(200).json({
      success: true,
      created: true,
      email,
      trainer_id: trainer.id,
      auth_user_id: created?.user?.id || null
    });
  } catch (err) {
    console.error("Set trainer password error:", err);
    return res.status(500).json({ error: err.message || "Erreur serveur" });
  }
}
