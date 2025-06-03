// index.js

const express    = require("express");
const admin      = require("firebase-admin");
const nodemailer = require("nodemailer");
const bodyParser = require("body-parser");
require("dotenv").config();

// Chemin vers le JSON de service account stocké dans /etc/secrets sur Render
const serviceAccount = require("/etc/secrets/.firebaseServiceAccount.json");

const app = express();
app.use(bodyParser.json());

////////////////////////////////////////////////////////////////////////////////
// 1) ROUTE GET pour valider l’URL du webhook (ne pas renvoyer d’erreur 400) //
////////////////////////////////////////////////////////////////////////////////
app.get("/api/envoi-code-premium", (req, res) => {
  // WooCommerce envoie une requête GET au moment de l’enregistrement ou de la mise à jour du webhook.
  // On renvoie simplement 200 OK pour indiquer que l’endpoint est bien actif.
  return res.status(200).send("Webhook endpoint actif.");
});

//////////////////////////////////////////////////////////////////////////////
// 2) INITIALISATION DE FIREBASE ADMIN SDK (authentification via JSON file) //
//////////////////////////////////////////////////////////////////////////////
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});
const db = admin.firestore();

////////////////////////////////////////////////
// 3) CONFIGURATION DU TRANSPORT SMTP HOSTINGER 
////////////////////////////////////////////////
// On passe en SSL sur le port 465 (secure: true)
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,   // ex. "smtp.hostinger.com"
  port: 465,                     // port SSL pour Hostinger
  secure: true,                  // true = SSL implicite
  auth: {
    user: process.env.SMTP_USER, // ex. "team@prepacivile.com"
    pass: process.env.SMTP_PASS, // ex. "8D:NuLtBpqms"
  },
});

///////////////////////////////////////////////////////////
// 4) ROUTE POST : VRAI WEBHOOK pour ENVOI DU CODE PREMIUM //
///////////////////////////////////////////////////////////
app.post("/api/envoi-code-premium", async (req, res) => {
  // —— LOG 1 : On affiche toujours la payload reçue ——
  console.log("📥 Payload reçue du webhook :", JSON.stringify(req.body));

  try {
    const order = req.body;
    const email = order?.billing?.email;

    // Si on n’a pas d’email dans la payload, on renvoie 400
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

    const doc  = snapshot.docs[0];
    const code = doc.data().code;

    // ✅ On marque ce code comme utilisé
    await doc.ref.update({
      used:        true,
      usedBy:      email,
      emailEnvoye: true,
      envoyeLe:    new Date().toISOString(),
    });

    // ✉️ Préparation du mail
    const mailOptions = {
      from:    process.env.EMAIL_FROM,
      to:      email,
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
