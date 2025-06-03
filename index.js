const express = require("express");
const admin = require("firebase-admin");
const nodemailer = require("nodemailer");
const bodyParser = require("body-parser");
require("dotenv").config();

const serviceAccount = require("/etc/secrets/.firebaseServiceAccount.json");

const app = express();
app.use(bodyParser.json());

// ✅ Route de test GET /
app.get("/", (req, res) => {
  res.send("✅ Serveur actif - route GET / OK");
});

// 🔐 Initialisation Firebase Admin SDK
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});
const db = admin.firestore();

// ✉️ Transport SMTP
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
  // —— LOG 1 : on affiche toujours la payload reçue ——
  console.log("📥 Payload reçue du webhook :", JSON.stringify(req.body));

  try {
    const order = req.body;
    const email = order?.billing?.email;
    if (!email) {
      console.warn("⚠️ Email manquant dans la payload !");
      return res.status(400).send("Email manquant.");
    }

    // 🔍 On prend un code Premium non utilisé dans Firestore
    const snapshot = await db
      .collection("codesPremium")
      .where("used", "==", false)
      .limit(1)
      .get();

    if (snapshot.empty) {
      console.warn("⚠️ Aucun code disponible dans Firestore !");
      return res.status(404).send("Aucun code disponible.");
    }

    const doc = snapshot.docs[0];
    const code = doc.data().code;

    // ✅ On marque ce code comme utilisé
    await doc.ref.update({
      used: true,
      usedBy: email,
      emailEnvoye: true,
      envoyeLe: new Date().toISOString(),
    });

    // ✉️ Préparation du mail
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

    // —— LOG 2 : on affiche l’objet mailOptions juste avant l’envoi ——
    console.log("🔔 Envoi e-mail nodemailer avec options : ", mailOptions);

    try {
      await transporter.sendMail(mailOptions);
      // —— LOG 3 : si l’envoi a réussi, on l’indique ——
      console.log(`✅ Code envoyé à ${email} : ${code}`);
    } catch (smtpError) {
      // —— LOG 4 : si l’envoi a échoué, on affiche l’erreur complète ——
      console.error("❌ Échec de l’envoi SMTP :", smtpError);
      return res.status(500).send("Erreur d’envoi d’email");
    }

    return res.status(200).send(`Code envoyé à ${email} : ${code}`);
  } catch (err) {
    console.error("❌ Erreur serveur dans /api/envoi-code-premium :", err);
    return res.status(500).send("Erreur serveur");
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Serveur en écoute sur le port ${PORT}`));
