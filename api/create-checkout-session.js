import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).send("Method not allowed");
  }

  try {
    const { email } = req.body;
    const cleanEmail = normalizeEmail(email);

    if (!cleanEmail) {
      return res.status(400).json({ error: "Email manquant" });
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
              name: "Affiliation VITAL PROTECT (1 an)",
              description: "Renouvellement annuel de l’affiliation formateur"
            },
            unit_amount: 9900
          },
          quantity: 1
        }
      ],

      metadata: {
        type: "affiliation",
        email: cleanEmail
      },

      customer_email: cleanEmail,

      success_url: `${origin}/espace-formateur.html?affiliation=success`,
      cancel_url: `${origin}/espace-formateur.html?affiliation=cancel`
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error("Stripe affiliation checkout error:", err);
    return res.status(500).json({ error: "Erreur Stripe" });
  }
}
