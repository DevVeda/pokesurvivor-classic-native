// Tope de gasto: cuando el presupuesto de Google Cloud avisa de que el coste
// llegó a su importe, se quita la facturación del proyecto (vuelve a la cuota gratis;
// lo que necesita pago deja de funcionar hasta que se vuelva a vincular a mano).
//
// Montaje (una vez, en console.cloud.google.com):
//   1. Facturación → Presupuestos y alertas → Crear: proyecto este, importe 2 €,
//      «Conectar un tema de Pub/Sub» → tema `billing-cap`.
//   2. APIs → habilitar «Cloud Billing API».
//   3. IAM del proyecto: a la cuenta de servicio de la función
//      (<n.º proyecto>-compute@developer.gserviceaccount.com) darle
//      «Administrador de facturación del proyecto» (roles/billing.projectManager).
//   4. cd functions && npm i && npx firebase deploy --only functions
//
// ponytail: los datos de coste llegan con horas de retraso; el tope es aproximado, no exacto.
const { onMessagePublished } = require('firebase-functions/v2/pubsub');

const META = 'http://metadata.google.internal/computeMetadata/v1';

// @step cloud/billing net "Tope de gasto"
// Cloud Function billingCap (Pub/Sub billing-cap) quita la facturación al llegar al presupuesto.
exports.billingCap = onMessagePublished('billing-cap', async (event) => {
  const b = event.data.message.json; // { costAmount, budgetAmount, currencyCode, ... }
  if (!b || typeof b.costAmount !== 'number' || b.costAmount < b.budgetAmount) return;

  const project = process.env.GCLOUD_PROJECT;
  const tok = await (await fetch(`${META}/instance/service-accounts/default/token`, {
    headers: { 'Metadata-Flavor': 'Google' },
  })).json();
  const url = `https://cloudbilling.googleapis.com/v1/projects/${project}/billingInfo`;
  const headers = { Authorization: `Bearer ${tok.access_token}`, 'Content-Type': 'application/json' };

  const info = await (await fetch(url, { headers })).json();
  if (!info.billingEnabled) return;

  const r = await fetch(url, { method: 'PUT', headers, body: JSON.stringify({ billingAccountName: '' }) });
  if (!r.ok) throw new Error(`No se pudo quitar la facturación: ${r.status} ${await r.text()}`);
  console.warn(`Facturación quitada: ${b.costAmount} ${b.currencyCode} >= ${b.budgetAmount}`);
});
