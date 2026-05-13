# Yapson Mobile Backend

Backend API pour la plateforme de gestion Mobile Money (Orange, MTN, Moov, Wave).

## Architecture

```
App Android ──── POST /api/android/sms        → Réception SMS
             ──── POST /api/android/notification → Réception notif Wave
             ──── GET  /api/android/pending    → Opérations à traiter

Plateforme Admin ──── /api/operators          → Config opérateurs
                 ──── /api/stats/users         → Gestion utilisateurs
                 ──── /api/devices             → Gestion appareils

Plateforme User ──── POST /api/operations     → Créer dépôt/retrait
                ──── GET  /api/operations      → Historique
                ──── WS   ws://host/           → Statuts temps réel
```

## Déploiement sur Railway

1. Créer un projet Railway
2. Ajouter un plugin PostgreSQL
3. Déployer ce repo
4. Configurer les variables d'environnement (voir `.env.example`)
5. Le démarrage exécute automatiquement `prisma migrate deploy`
6. Lancer le seed: `npm run db:seed`

## Variables d'environnement

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | URL PostgreSQL (auto-fournie par Railway) |
| `JWT_SECRET` | Clé secrète JWT (générer avec `openssl rand -hex 64`) |
| `JWT_EXPIRES_IN` | Durée token (défaut: 7d) |
| `ADMIN_EMAIL` | Email admin initial |
| `ADMIN_PASSWORD` | Mot de passe admin initial |
| `ALLOWED_ORIGINS` | CORS origins autorisées (séparées par virgule) |

## Endpoints principaux

### Auth
- `POST /api/auth/login` — Connexion
- `GET  /api/auth/me` — Profil

### Opérations
- `POST /api/operations` — Créer une opération
- `GET  /api/operations` — Lister (filtres: status, operator, type, from, to)
- `GET  /api/operations/:id` — Détail + logs
- `PATCH /api/operations/:id/status` — Modifier statut (Admin)

### Android (token appareil dans header `x-device-token`)
- `GET  /api/android/pending` — Opérations PENDING à traiter
- `POST /api/android/take/:id` — Prendre en charge une opération
- `POST /api/android/sms` — Envoyer un SMS reçu
- `POST /api/android/notification` — Envoyer une notification Wave
- `POST /api/android/heartbeat` — Ping

### Opérateurs (Admin)
- `GET  /api/operators` — Lister configs
- `PUT  /api/operators/:operator` — Configurer (ORANGE, MTN, MOOV, WAVE)
- `POST /api/operators/:operator/test-pattern` — Tester un pattern regex

### Stats (Admin)
- `GET /api/stats/overview` — Dashboard global
- `GET /api/stats/my` — Stats utilisateur
- `GET /api/stats/users` — Gestion utilisateurs

### Appareils (Admin)
- `GET  /api/devices` — Lister
- `POST /api/devices` — Enregistrer un appareil Android
- `PATCH /api/devices/:id` — Activer/désactiver

## WebSocket

Connexion: `ws://votre-domaine`

Messages à envoyer après connexion:
```json
{ "type": "subscribe", "room": "operations" }
{ "type": "subscribe", "room": "user:USER_ID" }
{ "type": "subscribe", "room": "operation:OPERATION_ID" }
```

Événements reçus:
```json
{ "type": "operation_update", "data": { ...operation } }
```

## Patterns SMS (Regex)

Les patterns utilisent la syntaxe RegExp JavaScript avec groupes nommés:
- `(?P<txid>[A-Z0-9]+)` — Capturer l'ID de transaction
- Les patterns d'échec sont testés EN PREMIER (un par ligne)
- Si un pattern d'échec match → FAILED
- Si le pattern succès match → SUCCESS
- Sinon → reste en PROCESSING (attente d'autre message)

Exemple Orange:
```
Pattern succès dépôt: transaction effectu[ée]e.*ref[:\s]+(?P<txid>[A-Z0-9]+)
Pattern échec: echec
               solde insuffisant
               transaction annulee
```
