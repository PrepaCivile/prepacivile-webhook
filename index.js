const express = require("express");
const admin = require("firebase-admin");
const nodemailer = require("nodemailer");
const bodyParser = require("body-parser");
require("dotenv").config();

const serviceAccount = require("/etc/secrets/.firebaseServiceAccount.json");

const app = express();
app.use(bodyParser.json());

// 🔐 Initialisation Firebase Admin SDK
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});
const db = admin.firestore();

// ✉️ Transport SMTP (ajuste les variables)
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// 🎯 Route webhook
app.post("/api/envoi-code-premium", async (req, res) => {
  try {
    const order = req.body;
    const email = order?.billing?.email;

    if (!email) return res.status(400).send("Email manquant.");

    // 🔍 Chercher un code inutilisé
    const snapshot = await db.collection("codesPremium")
      .where("used", "==", false)
      .limit(1)
      .get();

    if (snapshot.empty) return res.status(404).send("Aucun code disponible.");

    const doc = snapshot.docs[0];
    const code = doc.data().code;

    // ✅ Marquer le code comme utilisé
    await doc.ref.update({
      used: true,
      usedBy: email,
      emailEnvoye: true,
      envoyeLe: new Date().toISOString(),
    });

    // ✉️ Envoyer l'email
    const mailOptions = {
      from: process.env.EMAIL_FROM,
      to: email,
      subject: "Votre code Premium PrépaCivile+",
      text: `
Bonjour,

Merci pour votre achat !

Voici votre code d’activation Premium : ${code}

Pour l’utiliser :
1. Ouvrez l’application PrépaCivile+
2. Allez dans Paramètres > Activer Premium
3. Entrez ce code

Ce code est valide pour un seul appareil.

— L’équipe PrépaCivile
      `,
    };

    await transporter.sendMail(mailOptions);

    res.status(200).send(`Code envoyé à ${email} : ${code}`);
  } catch (err) {
    console.error(err);
    res.status(500).send("Erreur serveur");
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Serveur en écoute sur le port ${PORT}`));
