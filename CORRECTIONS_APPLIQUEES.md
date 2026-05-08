# Corrections appliquées

## Modules / admin
- Persistance des champs envoyés par le formulaire catalogue : `category`, `level_label`, `default_duration`, `is_active`, `public_visible`.
- Cohérence `status` / `is_active` / `public_visible` côté API admin.
- Suppression d'une requête incohérente lors de la suppression d'un module.
- Échappement HTML des principales données affichées dans les tableaux admin et dans les listes déroulantes générées dynamiquement.

## Paiement / Stripe
- Suppression des redirections basées sur `req.headers.origin`.
- Utilisation de `APP_BASE_URL` ou `https://vital-protect.fr` comme origine de confiance.
- Validation renforcée du prénom, nom, email et téléphone pour les réservations de stages.
- Validation email ajoutée sur les flux checkout.
- Renouvellement d'affiliation protégé par session formateur Supabase.

## Places restantes
- Décrémentation optimiste des places dans le webhook Stripe avec vérification concurrente (`remaining_places` ne doit pas avoir changé entre lecture et écriture).
- Décrémentation ajoutée pour les sessions formateur.
- Restauration d'une place formateur quand un dossier autorisé est refusé.
- Les paiements de stage arrivant après épuisement des places sont marqués `overbooked` au lieu de décrémenter sous zéro.

## Sécurité affichage
- Échappement HTML ajouté dans l'espace formateur pour les données issues de Supabase.
- Échappement des modules certifiés injectés dans les `<option>`.
- Échappement des contenus dynamiques dans les emails envoyés par le webhook.

## Pages publiques
- La page `devenir-formateur.html` filtre maintenant les modules sur `status = active`, `is_active = true` et `public_visible = true`.

## Validation
- Contrôle de syntaxe effectué sur les fichiers JS API et sur les scripts inline HTML extraits.
