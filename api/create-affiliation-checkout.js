import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).send("Method not allowed");
  }

  const { email } = req.body;

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",

      line_items: [
        {
          price_data: {
            currency: "eur",
            product_data: {
              name: "Affiliation VITAL PROTECT (1 an)"
            },
            unit_amount: 9900 // 99€
          },
          quantity: 1
        }
      ],

      success_url: "https://www.vital-protect.fr/success.html",
      cancel_url: "https://www.vital-protect.fr/cancel.html",

      metadata: {
        type: "affiliation",
        email: email
      }
    });

    res.status(200).json({ url: session.url });
  } catch (err) {
    console.error(err);
    res.status(500).send("Erreur Stripe");
  }
}
