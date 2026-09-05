# CapitalFlow — legal launch checklist

**Draft date:** 2026-08-28  
**Target effective date:** 2026-08-29  
**Controller:** CDX S.A.S., NIT 901.772.807  
**Authoritative code baseline:** `7c41b37e547e356559c8bebd7e933b1d3915228c`

This is an implementation and counsel-review checklist, not legal advice. No automated or AI review may set `CF_LEGAL_APPROVED=true`. That gate requires the name and date of a real qualified human reviewer.

## Draft documents

- `/privacy/`: bilingual global Privacy Policy.
- `/terms/`: bilingual Terms of Service and Subscription.
- `/cookies/`: bilingual Cookie and Local Storage Policy.
- `/legal-regions/`: Latin America, United States, Canada/Quebec, United Kingdom and Australia addenda.

## Decisions applied to the pilot

- `AGE_GATE=18_PLUS_ONLY`. Parental supervision is not used as a waiver or alternate eligibility path.
- `DATA_SALE=DISABLED`, `TARGETED_ADVERTISING=DISABLED`, and `FINANCIAL_DATA_GENERAL_AI_TRAINING=DISABLED` until separate granular opt-ins, withdrawal controls, records and jurisdictional assessments exist.
- Non-essential analytics and advertising technologies remain disabled until a consent manager is implemented and verified.
- “No refunds” is qualified by mandatory cooling-off, consumer-guarantee, unauthorized-charge and service-not-provided rights.
- “24/7” is an operational objective, not a 100% uptime warranty or SLA.
- Colombian law/courts are subject to mandatory consumer law and local forum rights.
- “Lifetime” means while CDX continues commercially operating CapitalFlow and must be prominently disclosed at checkout.
- Whop is described conservatively as the checkout/payment service and membership provider; the selected Whop tax configuration must be verified before sales.

## Runtime facts verified against the repository

- No direct bank API connection.
- Android filtering is local; only parsed, sanitized financial signals leave the device.
- Gmail uses metadata plus snippet, not the complete message body in the current flow.
- Original spreadsheet bytes are not retained; normalized rows and import metadata are retained.
- AI receives a validated plan and rejects raw-email, notification, token and account-identifier fields.
- Full card number and CVC are not stored by CDX; Whop membership/plan identifiers and state are stored.
- In-app account deletion requires the phrase `ELIMINAR` and deletes the Supabase Auth user, cascading application rows.
- Retention automation deletes rejected candidates after 30 days and processed/deduplication/webhook events after 90 days. Audit retention is not yet configured.
- Google Drive backups use `appDataFolder`; current account deletion does not automatically delete the remote Drive file.

## BLOCKER — required before open commercial launch

1. `HUMAN_LEGAL_APPROVAL`: qualified counsel must review Colombia consumer/e-commerce/privacy law and each offered market; record reviewer name and approval date.
2. `LEGAL_ENTITY_DETAILS`: confirm NIT verification digit, city/department/postal code for the legal address, legal-representative name and whether a Colombian RNBD registration or update is required.
3. `BRAZIL_PORTUGUESE`: Portuguese policies, terms, consent, checkout and support plus LGPD transfer/contact review before Brazil.
4. `QUEBEC_FRENCH`: legally reviewed French contract/privacy versions, French-interface rules, privacy impact/transfer assessment and formal privacy officer before Quebec.
5. `UK_REPRESENTATIVE`: determine UK GDPR extraterritorial scope, appoint and publish a UK representative where required, confirm ICO fee/registration and transfer mechanism before open UK marketing.
6. `AI_SUBPROCESSOR`: identify the external AI provider, hosting regions, contract, retention and transfer safeguards before enabling `AI_GATEWAY_URL`; otherwise keep deterministic fallback only.
7. `WHOP_TAX_ROLE`: record the exact direct-checkout tax setting and merchant/payment roles for every market; do not assume Whop remits tax globally.
8. `RENEWAL_DISCLOSURE`: verify every Whop checkout prominently shows price, currency, tax, cadence, automatic renewal, cancellation method, lifetime-plan meaning and applicable refund rights.
9. `PRIVACY_ACCEPTANCE_RECORD`: persist policy/terms version, timestamp, locale and source for account creation and material re-consent. The current checkbox is a UI gate only.
10. `REMOTE_BACKUP_DELETION`: delete or offer verified deletion of the user’s Google Drive `appDataFolder` backup before revoking credentials; record outcome and show recovery instructions if Google blocks cleanup.
11. `COOKIE_CONSENT_MANAGER`: before adding analytics/ads, implement Accept, Reject and Configure with equal prominence, per-purpose storage, revocation, GPC where applicable and proof that tags remain blocked before consent.
12. `SECURITY_INCIDENT_PLAN`: name internal owners, severity/timing criteria, regulator matrix, secure contact intake and affected-user notification templates.
13. `MARKET_AVAILABILITY`: implement a checkout allow-list so unreviewed or unsupported countries cannot purchase merely because a public URL is reachable.

## REQUIRED_BEFORE_NEXT_GATE

- Replace browser `prompt()` with an accessible destructive-action modal that lists local data, subscriptions, Google Drive backup consequences, legal-retention exceptions and irreversibility.
- Configure an approved retention period for audit events and document payment/tax retention by entity and country.
- Verify Vercel and every subprocessor data-processing agreement and international-transfer terms; maintain a public subprocessor register.
- Add a permanent in-app Privacy Preferences link and separate withdrawal controls for marketing and any future optional processing.
- Add a support workflow that timestamps rights requests, verifies identity proportionately, applies the shortest applicable deadline and records appeals.
- Confirm payment cancellation can be completed without unnecessary friction in every enabled channel.

## DEBT

- Add a legal-document version history and machine-readable last-updated metadata.
- Add automated link, accessibility and content-presence checks for all four legal routes.
- Add Portuguese and French product localization if Brazil and Quebec remain in scope.
- Add a dedicated vulnerability disclosure page and security contact workflow.
- Review app-store disclosures and Google Play Data Safety answers against the final approved policy.

## Human legal gate

After the blockers are closed and counsel approves the exact deployed documents:

```bash
CF_LEGAL_APPROVED=true \
CF_LEGAL_APPROVED_BY="REAL REVIEWER NAME" \
CF_LEGAL_APPROVED_DATE="YYYY-MM-DD" \
CF_PRIVACY_URL="https://capitalflow-pilot.vercel.app/privacy/" \
CF_TERMS_URL="https://capitalflow-pilot.vercel.app/terms/" \
npm run pilot:legal
```

Do not run this command with invented or placeholder approval data.

## Primary official review sources

- Colombia SIC personal-data guidance and Law 1581 framework: <https://www.sic.gov.co/tema/proteccion-de-datos-personales>
- UK ICO, right to be informed: <https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/individual-rights/the-right-to-be-informed/what-privacy-information-should-we-provide/>
- Canada OPC, PIPEDA: <https://www.priv.gc.ca/en/privacy-topics/privacy-laws-in-canada/the-personal-information-protection-and-electronic-documents-act-pipeda/>
- Quebec Commission d’accès à l’information, Law 25: <https://www.cai.gouv.qc.ca/entreprises/protection-des-renseignements-personnels-1/loi-25-nouvelles-dispositions-protegeant-la-vie-privee-des-quebecois-citoyens>
- Australia OAIC, Australian Privacy Principles: <https://www.oaic.gov.au/privacy/australian-privacy-principles>
- California Attorney General, CCPA: <https://oag.ca.gov/privacy/ccpa>
- Brazil ANPD, data-subject rights: <https://www.gov.br/anpd/pt-br/assuntos/titular-de-dados-1/direito-dos-titulares>
- Argentina AAIP, data rights: <https://www.argentina.gob.ar/aaip/datospersonales/derechos>
- Mexico, current LFPDPPP: <https://www.diputados.gob.mx/LeyesBiblio/pdf/LFPDPPP.pdf>
- US FTC, children’s privacy: <https://www.ftc.gov/news-events/topics/protecting-consumer-privacy-security/kids-privacy-coppa>
- Whop taxes for direct sales: <https://docs.whop.com/payments-and-billing/fees/taxes>

