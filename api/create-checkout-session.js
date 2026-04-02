import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function sanitizeText(value, fallback = "") {
  return String(value || fallback).trim();
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).send("Method not allowed");
  }

  try {
    const {
      stage_id,
      stage_title,
      first_name,
      last_name,
      email,
      phone,
      places,
      unit_price
    } = req.body;

    const cleanEmail = normalizeEmail(email);
    const cleanFirstName = sanitizeText(first_name);
    const cleanLastName = sanitizeText(last_name);
    const cleanPhone = sanitizeText(phone);
    const cleanStageId = sanitizeText(stage_id);
    const cleanStageTitle = sanitizeText(stage_title, "Stage VITAL PROTECT");
    const quantity = Math.max(1, Number(places || 1));
    const price = Math.max(0, Number(unit_price || 0));

    if (!cleanStageId) {
      return res.status(400).json({ error: "Stage manquant" });
    }

    if (!cleanEmail) {
      return res.status(400).json({ error: "Email manquant" });
    }

    if (!price) {
      return res.status(400).json({ error: "Prix du stage invalide" });
    }

    const origin = req.headers.origin || "https://www.vital-protect.fr";

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",

      line_items: [
        {
          price_data: {
            currency: "eur",
            product_data: {
              name: cleanStageTitle,
              description: "Réservation stage VITAL PROTECT"
            },
            unit_amount: Math.round(price * 100)
          },
          quantity
        }
      ],

      metadata: {
        type: "stage",
        stage_id: cleanStageId,
        stage_title: cleanStageTitle,
        first_name: cleanFirstName,
        last_name: cleanLastName,
        email: cleanEmail,
        phone: cleanPhone,
        places: String(quantity),
        unit_price: String(price)
      },

      customer_email: cleanEmail,

      success_url: `${origin}/success.html`,
      cancel_url: `${origin}/cancel.html`
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error("Stripe checkout session error:", err);
    return res.status(500).json({ error: "Erreur Stripe" });
  }
}
